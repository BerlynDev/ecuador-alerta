import type { BBox, Confidence, Hotspot } from '@ea/shared';
import { parseCsv } from '../lib/csv.js';

/**
 * NASA FIRMS — area API (checked against the official docs, Nov 2026):
 *
 *   /api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{DAY_RANGE}[/{YYYY-MM-DD}]
 *
 * - Without DATE: returns TODAY back to TODAY-(DAY_RANGE-1).
 * - With DATE:    returns DATE .. DATE+(DAY_RANGE-1).
 * - Dates are UTC calendar days (acq_date / acq_time are UTC).
 * - Suomi-NPP stopped delivering new data on 2026-11-02 → use NOAA-20/21.
 */
export const FIRMS_BASE_URL = 'https://firms.modaps.eosdis.nasa.gov';

/** A hotspot before it has been located in a province. */
export type RawHotspot = Omit<Hotspot, 'province' | 'region'>;

export interface FirmsRequest {
  dayRange: number;
  /** Start date (UTC, YYYY-MM-DD). Omitted = "most recent" mode. */
  date?: string;
}

export function buildAreaUrl(mapKey: string, source: string, bbox: BBox, req: FirmsRequest): string {
  const area = bbox.join(',');
  const parts = ['api/area/csv', encodeURIComponent(mapKey), source, area, String(req.dayRange)];
  if (req.date) parts.push(req.date);
  return `${FIRMS_BASE_URL}/${parts.join('/')}`;
}

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * FIRMS limits how many days one request may cover. To fetch a longer window
 * we split it into consecutive chunks, each anchored with an explicit start
 * date, so together they cover exactly [today-(totalDays-1), today].
 */
export function planRequests(totalDays: number, maxDayRange: number, now: Date): FirmsRequest[] {
  if (totalDays <= maxDayRange) return [{ dayRange: totalDays }];

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const requests: FirmsRequest[] = [];
  let remaining = totalDays;
  let start = todayUtc - (totalDays - 1) * DAY_MS;
  while (remaining > 0) {
    const dayRange = Math.min(maxDayRange, remaining);
    requests.push({ dayRange, date: isoDay(new Date(start)) });
    start += dayRange * DAY_MS;
    remaining -= dayRange;
  }
  return requests;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const SATELLITES: Record<string, string> = {
  N: 'Suomi NPP', N20: 'NOAA-20', '1': 'NOAA-20', N21: 'NOAA-21', '2': 'NOAA-21',
  T: 'Terra', Terra: 'Terra', A: 'Aqua', Aqua: 'Aqua',
};

/**
 * VIIRS reports confidence as a class (l/n/h); MODIS as 0–100 %.
 * FIRMS itself documents MODIS classes as <30 low, 30–79 nominal, ≥80 high,
 * so we map both to the same three-level scale the UI understands.
 */
export function normalizeConfidence(raw: string): Confidence {
  const v = raw.trim().toLowerCase();
  if (v === 'h' || v === 'high') return 'high';
  if (v === 'n' || v === 'nominal') return 'nominal';
  if (v === 'l' || v === 'low') return 'low';
  const pct = Number(v);
  if (Number.isFinite(pct)) return pct >= 80 ? 'high' : pct >= 30 ? 'nominal' : 'low';
  return 'nominal';
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function normalizeFirmsRow(row: Record<string, string>, source: string): RawHotspot | null {
  const lat = num(row.latitude);
  const lon = num(row.longitude);
  const date = row.acq_date;
  if (lat === null || lon === null || !date) return null;

  const time = (row.acq_time ?? '0000').padStart(4, '0');
  const acquiredAt = `${date}T${time.slice(0, 2)}:${time.slice(2, 4)}:00Z`;
  const instrument = (row.instrument ?? (source.startsWith('MODIS') ? 'MODIS' : 'VIIRS')).toUpperCase() === 'MODIS' ? 'MODIS' : 'VIIRS';

  return {
    id: `${source}:${acquiredAt}:${lat.toFixed(5)},${lon.toFixed(5)}`,
    lat,
    lon,
    acquiredAt,
    satellite: SATELLITES[row.satellite ?? ''] ?? row.satellite ?? source,
    instrument,
    confidence: normalizeConfidence(row.confidence ?? ''),
    frp: num(row.frp),
    // VIIRS → bright_ti4, MODIS → brightness
    brightnessK: num(row.bright_ti4) ?? num(row.brightness),
    dayNight: row.daynight === 'N' ? 'N' : 'D',
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class FirmsError extends Error {}

export interface FirmsClientOptions {
  mapKey: string;
  maxDayRange: number;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class FirmsClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: FirmsClientOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async fetchArea(source: string, bbox: BBox, totalDays: number, now: Date): Promise<RawHotspot[]> {
    const requests = planRequests(totalDays, this.opts.maxDayRange, now);
    const chunks = await Promise.all(requests.map((r) => this.fetchChunk(source, bbox, r)));
    return chunks.flat();
  }

  private async fetchChunk(source: string, bbox: BBox, req: FirmsRequest): Promise<RawHotspot[]> {
    const url = buildAreaUrl(this.opts.mapKey, source, bbox, req);
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000) });
    const body = await res.text();

    // FIRMS sometimes answers HTTP 200 with a plain-text error ("Invalid MAP_KEY.")
    // so we validate the payload shape, not just the status code.
    if (!res.ok || !body.startsWith('latitude')) {
      const reason = body.slice(0, 120).trim() || `HTTP ${res.status}`;
      throw new FirmsError(`FIRMS ${source}: ${reason}`);
    }
    return parseCsv(body)
      .map((row) => normalizeFirmsRow(row, source))
      .filter((h): h is RawHotspot => h !== null);
  }
}
