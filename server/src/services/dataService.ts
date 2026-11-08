import type { BBox, Hotspot, NaturalEvent, Region, Snapshot, SnapshotQuery } from '@ea/shared';
import { REGIONS } from '@ea/shared';
import { TtlCache } from '../lib/cache.js';
import { clusterHotspots } from '../domain/clusters.js';
import { regionOf, type ProvinceLocator } from '../domain/provinces.js';
import { dailyCounts } from '../domain/time.js';
import type { FirmsClient } from '../sources/firms.js';
import type { EonetClient } from '../sources/eonet.js';

/**
 * Everything we know for the widest window (7 days), already normalized and
 * geolocated. This is what gets cached.
 *
 * Design choice: we always fetch the *maximum* window once per TTL and apply
 * every filter (24 h / 48 h / 7 d, category, province) in memory. So the
 * number of NASA calls is constant no matter how many users or filter
 * combinations there are: a handful of requests every 45 minutes.
 */
export interface Dataset {
  hotspots: Hotspot[];
  events: NaturalEvent[];
  discardedOutsideEcuador: number;
  firmsSources: string[];
  warnings: string[];
}

export interface DataServiceDeps {
  firms: FirmsClient;
  eonet: EonetClient;
  locator: ProvinceLocator;
  firmsSources: string[];
  cacheTtlMs: number;
  mode: 'live' | 'mock';
  now?: () => number;
}

const HOUR_MS = 3_600_000;
const MAX_WINDOW_HOURS = 168;
/** 168 h back from "now" can touch 8 distinct UTC calendar days. */
const FIRMS_DAYS = 8;

/** Union of both regions, used for single upstream queries. */
const QUERY_BBOX: BBox = [
  Math.min(REGIONS.continental.bbox[0], REGIONS.galapagos.bbox[0]),
  Math.min(REGIONS.continental.bbox[1], REGIONS.galapagos.bbox[1]),
  Math.max(REGIONS.continental.bbox[2], REGIONS.galapagos.bbox[2]),
  Math.max(REGIONS.continental.bbox[3], REGIONS.galapagos.bbox[3]),
];
const AREAS: BBox[] = [REGIONS.continental.bbox, REGIONS.galapagos.bbox];

export class DataService {
  private readonly cache: TtlCache<Dataset>;
  private readonly now: () => number;

  constructor(private readonly deps: DataServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.cache = new TtlCache<Dataset>(deps.cacheTtlMs, this.now);
  }

  async getDataset() {
    return this.cache.getOrLoad('ecuador', () => this.load());
  }

  /** Fetches both sources in parallel; one failing source degrades instead of breaking the app. */
  private async load(): Promise<Dataset> {
    const { firms, eonet, locator, firmsSources } = this.deps;
    const now = new Date(this.now());
    const warnings: string[] = [];

    // FIRMS: one request per region per source keeps the ocean between
    // Galápagos and the mainland out of the query.
    const firmsJobs = firmsSources.flatMap((source) =>
      AREAS.map((bbox) => ({ source, promise: firms.fetchArea(source, bbox, FIRMS_DAYS, now) })),
    );
    const [firmsResults, eonetResult] = await Promise.all([
      Promise.allSettled(firmsJobs.map((j) => j.promise)),
      eonet.fetchEvents(QUERY_BBOX, AREAS, 8).then(
        (events) => ({ ok: true as const, events }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    ]);

    const okSources = new Set<string>();
    const rawHotspots = firmsResults.flatMap((r, i) => {
      if (r.status === 'fulfilled') {
        okSources.add(firmsJobs[i]!.source);
        return r.value;
      }
      warnings.push(String(r.reason instanceof Error ? r.reason.message : r.reason));
      return [];
    });
    if (okSources.size === 0 && !eonetResult.ok) {
      throw new Error(`All upstream sources failed: ${warnings.join(' | ')}`);
    }

    // Geolocate hotspots; drop those in Peru/Colombia that fall inside the bbox.
    let discarded = 0;
    const seen = new Set<string>();
    const hotspots: Hotspot[] = [];
    for (const h of rawHotspots) {
      if (seen.has(h.id)) continue; // overlapping chunks/areas
      seen.add(h.id);
      const province = locator.locate(h.lon, h.lat);
      if (!province) {
        discarded++;
        continue;
      }
      hotspots.push({ ...h, province, region: regionOf(h.lon, h.lat, province)! });
    }

    // Events are rare and relevant even just across the border (a Colombian
    // volcano near Carchi), so we keep them with province = null.
    let events: NaturalEvent[] = [];
    if (eonetResult.ok) {
      events = eonetResult.events.flatMap((e) => {
        const province = locator.locate(e.lon, e.lat);
        const region = regionOf(e.lon, e.lat, province);
        return region ? [{ ...e, province, region }] : [];
      });
    } else {
      warnings.push(`EONET: ${eonetResult.error instanceof Error ? eonetResult.error.message : String(eonetResult.error)}`);
    }

    hotspots.sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt));
    return { hotspots, events, discardedOutsideEcuador: discarded, firmsSources: [...okSources], warnings };
  }

  async getSnapshot(query: SnapshotQuery): Promise<Snapshot> {
    const cached = await this.getDataset();
    const data = cached.value;
    const now = this.now();
    const from = now - Math.min(query.hours, MAX_WINDOW_HOURS) * HOUR_MS;

    const inScope = (x: { region: Region; province: string | null }) =>
      query.regions.includes(x.region) && (!query.province || x.province === query.province);

    const scopedHotspots = query.includeHotspots ? data.hotspots.filter(inScope) : [];
    const hotspots = scopedHotspots.filter((h) => Date.parse(h.acquiredAt) >= from);

    const events = data.events.filter(
      (e) =>
        inScope(e) &&
        (!query.categories || query.categories.includes(e.category)) &&
        (e.status === 'open' || (e.closedAt !== null && Date.parse(e.closedAt) >= from)),
    );

    const warnings = [...data.warnings];
    if (cached.stale) warnings.push(`Datos en caché: la última actualización falló (${cached.error}).`);

    return {
      query,
      window: { from: new Date(from).toISOString(), to: new Date(now).toISOString() },
      hotspots,
      events,
      clusters: clusterHotspots(hotspots),
      // The trend always shows 7 days for context, regardless of the selected window.
      daily: dailyCounts(scopedHotspots.map((h) => h.acquiredAt), now, 7),
      meta: {
        mode: this.deps.mode,
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        stale: cached.stale,
        firmsSources: data.firmsSources,
        discardedOutsideEcuador: data.discardedOutsideEcuador,
        warnings,
      },
    };
  }

  async findEvent(id: string): Promise<NaturalEvent | undefined> {
    return (await this.getDataset()).value.events.find((e) => e.id === id);
  }
}
