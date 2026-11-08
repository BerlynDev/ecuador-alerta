import type { BBox, EventCategory, NaturalEvent, TrackPoint } from '@ea/shared';
import { isEventCategory } from '@ea/shared';
import { inBBox } from '../lib/geo.js';

/**
 * NASA EONET v3 — events API (checked against the official docs, Nov 2026):
 *
 *   https://eonet.gsfc.nasa.gov/api/v3/events?status=open|closed|all&days=N&bbox=...
 *
 * Gotcha worth remembering: EONET's bbox order is
 *   min lon, MAX lat, max lon, MIN lat   (upper-left corner, then lower-right)
 * which differs from FIRMS (west, south, east, north). Getting this wrong
 * silently returns an empty list, so it lives in one tested function.
 */
export const EONET_BASE_URL = 'https://eonet.gsfc.nasa.gov/api/v3';

export function toEonetBBox([west, south, east, north]: BBox): string {
  return [west, north, east, south].join(',');
}

// --- Raw API shapes (only the fields we use) --------------------------------

interface RawGeometry {
  magnitudeValue: number | null;
  magnitudeUnit: string | null;
  date: string;
  type: 'Point' | 'Polygon';
  coordinates: [number, number] | [number, number][][];
}

export interface RawEonetEvent {
  id: string;
  title: string;
  description: string | null;
  closed: string | null;
  categories: { id: string; title: string }[];
  sources: { id: string; url: string }[];
  geometry: RawGeometry[];
}

export interface RawEonetResponse {
  events: RawEonetEvent[];
}

/** Ungeolocated event: province/region are added later by the data service. */
export type RawNaturalEvent = Omit<NaturalEvent, 'province' | 'region'>;

function geometryPoint(g: RawGeometry): TrackPoint | null {
  if (g.type === 'Point') {
    const [lon, lat] = g.coordinates as [number, number];
    return { lon, lat, date: g.date };
  }
  // Polygon: use the vertex average of the outer ring as a representative point.
  const ring = (g.coordinates as [number, number][][])[0];
  if (!ring?.length) return null;
  const lon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  return { lon, lat, date: g.date };
}

/**
 * @param area Used to pick the latest position *inside our area of interest*:
 *   a storm track may start near Galápagos and end thousands of km away.
 */
export function normalizeEonetEvent(raw: RawEonetEvent, area: BBox[]): RawNaturalEvent | null {
  const category = raw.categories.map((c) => c.id).find(isEventCategory) as EventCategory | undefined;
  if (!category) return null;

  const sorted = [...raw.geometry].sort((a, b) => a.date.localeCompare(b.date));
  const track = sorted.map(geometryPoint).filter((p): p is TrackPoint => p !== null);
  const inArea = track.filter((p) => area.some((b) => inBBox(p.lon, p.lat, b)));
  const position = inArea.at(-1) ?? track.at(-1);
  if (!position) return null;

  const latestGeom = sorted.at(-1);
  const magnitude =
    latestGeom?.magnitudeValue != null && latestGeom.magnitudeUnit
      ? { value: latestGeom.magnitudeValue, unit: latestGeom.magnitudeUnit }
      : null;

  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    category,
    status: raw.closed ? 'closed' : 'open',
    closedAt: raw.closed,
    lat: position.lat,
    lon: position.lon,
    date: position.date,
    magnitude,
    sources: raw.sources,
    track,
  };
}

export interface EonetClientOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class EonetClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: EonetClientOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  /**
   * Open events have no date limit (an eruption can stay "open" for months);
   * recently closed events are fetched too so a 7-day view still shows them.
   */
  async fetchEvents(queryBox: BBox, areas: BBox[], closedWithinDays: number): Promise<RawNaturalEvent[]> {
    const bbox = toEonetBBox(queryBox);
    const [open, closed] = await Promise.all([
      this.get({ status: 'open', bbox }),
      this.get({ status: 'closed', days: String(closedWithinDays), bbox }),
    ]);
    const byId = new Map<string, RawEonetEvent>();
    for (const e of [...open.events, ...closed.events]) byId.set(e.id, e);
    return [...byId.values()]
      .map((e) => normalizeEonetEvent(e, areas))
      .filter((e): e is RawNaturalEvent => e !== null);
  }

  private async get(params: Record<string, string>): Promise<RawEonetResponse> {
    const url = `${EONET_BASE_URL}/events?${new URLSearchParams(params)}`;
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000) });
    if (!res.ok) throw new Error(`EONET: HTTP ${res.status}`);
    const json = (await res.json()) as Partial<RawEonetResponse>;
    if (!Array.isArray(json.events)) throw new Error('EONET: unexpected response shape');
    return json as RawEonetResponse;
  }
}
