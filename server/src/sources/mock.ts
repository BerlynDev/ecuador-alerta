/**
 * Demo mode: a fake `fetch` that answers FIRMS and EONET URLs with
 * SYNTHETIC data in the exact wire formats (CSV / JSON) of the real APIs.
 *
 * Because it plugs in at the `fetch` level, demo mode exercises the very same
 * URL building, parsing, normalization and caching code as live mode — only
 * the network is replaced. That makes the app runnable without any API key
 * (great for reviewers cloning the repo) and keeps tests deterministic.
 *
 * The data is plausible but invented. The UI shows a "demo data" banner
 * whenever this mode is active.
 */
import type { BBox } from '@ea/shared';
import { inBBox } from '../lib/geo.js';
import type { RawEonetEvent } from './eonet.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// --- Deterministic pseudo-random numbers -----------------------------------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: string): () => number {
  let a = hashString(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
}

// --- Synthetic FIRMS --------------------------------------------------------

interface HotZone {
  name: string;
  lon: number;
  lat: number;
  spreadKm: number;
  /** Mean detections per overpass, by days-ago (index 0 = today). */
  perPass: (daysAgo: number) => number;
  frpScale: number;
}

const ZONES: HotZone[] = [
  // Persistent industrial heat sources (gas flaring) are a classic FIRMS signal in the Amazon oil region.
  { name: 'shushufindi', lon: -76.65, lat: -0.19, spreadKm: 8, perPass: () => 3, frpScale: 6 },
  { name: 'coca', lon: -76.95, lat: -0.5, spreadKm: 10, perPass: () => 2, frpScale: 5 },
  // A dry-forest fire that grows over the last few days.
  { name: 'catamayo', lon: -79.37, lat: -3.99, spreadKm: 3, perPass: (d) => (d <= 2 ? 9 - d * 2 : 0.4), frpScale: 18 },
  { name: 'portoviejo', lon: -80.35, lat: -1.15, spreadKm: 12, perPass: (d) => (d <= 4 ? 1.2 : 0.3), frpScale: 7 },
  { name: 'santa-elena', lon: -80.6, lat: -2.15, spreadKm: 15, perPass: () => 0.8, frpScale: 6 },
  { name: 'giron', lon: -79.15, lat: -3.15, spreadKm: 4, perPass: (d) => (d === 1 || d === 2 ? 4 : 0.2), frpScale: 12 },
  { name: 'chimborazo', lon: -78.62, lat: -1.72, spreadKm: 10, perPass: () => 0.5, frpScale: 8 },
  { name: 'imbabura', lon: -78.18, lat: 0.38, spreadKm: 8, perPass: (d) => (d <= 1 ? 1.5 : 0.3), frpScale: 9 },
  // Across the border: exercises the "outside Ecuador" filter.
  { name: 'peru-north', lon: -79.6, lat: -4.75, spreadKm: 15, perPass: () => 2, frpScale: 8 },
  { name: 'colombia-south', lon: -77.3, lat: 1.3, spreadKm: 15, perPass: () => 1.5, frpScale: 6 },
];

/** Approximate UTC overpass times over Ecuador (night pass, day pass). */
const OVERPASSES: Record<string, { sat: string; times: string[] }> = {
  VIIRS_NOAA20_NRT: { sat: 'N20', times: ['0612', '1824'] },
  VIIRS_NOAA21_NRT: { sat: 'N21', times: ['0518', '1730'] },
  VIIRS_SNPP_NRT: { sat: 'N', times: ['0700', '1906'] },
};

const VIIRS_HEADER =
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';

function firmsCsv(source: string, bbox: BBox, days: string[], now: number): string {
  const pass = OVERPASSES[source];
  const rows: string[] = [VIIRS_HEADER];
  if (!pass) return rows.join('\n');
  // Suomi NPP stopped delivering data on 2026-11-02.
  if (source === 'VIIRS_SNPP_NRT') days = days.filter((d) => d < '2026-11-02');

  for (const day of days) {
    const daysAgo = Math.round((Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS);
    for (const time of pass.times) {
      const at = Date.parse(`${day}T${time.slice(0, 2)}:${time.slice(2)}:00Z`);
      if (at > now) continue;
      const night = Number(time.slice(0, 2)) < 11;
      for (const zone of ZONES) {
        const rand = rng(`${day}|${source}|${time}|${zone.name}`);
        const mean = zone.perPass(daysAgo) * (night ? 0.6 : 1);
        const count = Math.max(0, Math.round(mean + gaussian(rand) * Math.sqrt(mean)));
        for (let i = 0; i < count; i++) {
          const lat = zone.lat + (gaussian(rand) * zone.spreadKm) / 111;
          const lon = zone.lon + (gaussian(rand) * zone.spreadKm) / 111;
          if (!inBBox(lon, lat, bbox)) continue;
          const frp = Math.round(Math.exp(Math.log(zone.frpScale) + gaussian(rand) * 0.7) * 100) / 100;
          const r = rand();
          const confidence = frp > 25 || r > 0.85 ? 'h' : r < 0.15 ? 'l' : 'n';
          const ti4 = (300 + frp * 1.5 + rand() * 20).toFixed(2);
          const ti5 = (285 + rand() * 15).toFixed(2);
          rows.push(
            [lat.toFixed(5), lon.toFixed(5), ti4, '0.42', '0.37', day, time, pass.sat, 'VIIRS', confidence, '2.0NRT', ti5, frp.toFixed(2), night ? 'N' : 'D'].join(','),
          );
        }
      }
    }
  }
  return rows.join('\n');
}

// --- Synthetic EONET ---------------------------------------------------------

function eonetEvents(now: number): RawEonetEvent[] {
  const ago = (hours: number) => new Date(now - hours * HOUR_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const point = (lon: number, lat: number, hoursAgo: number) => ({
    magnitudeValue: null, magnitudeUnit: null, date: ago(hoursAgo), type: 'Point' as const, coordinates: [lon, lat] as [number, number],
  });
  return [
    {
      id: 'DEMO_SANGAY', title: 'Sangay Volcano, Ecuador', description: null, closed: null,
      categories: [{ id: 'volcanoes', title: 'Volcanoes' }],
      sources: [{ id: 'SIVolcano', url: 'https://volcano.si.edu/volcano.cfm?vn=352090' }],
      geometry: [point(-78.341, -2.005, 24 * 40), point(-78.341, -2.005, 30)],
    },
    {
      id: 'DEMO_REVENTADOR', title: 'Reventador Volcano, Ecuador', description: null, closed: null,
      categories: [{ id: 'volcanoes', title: 'Volcanoes' }],
      sources: [{ id: 'SIVolcano', url: 'https://volcano.si.edu/volcano.cfm?vn=352010' }],
      geometry: [point(-77.656, -0.077, 24 * 90)],
    },
    {
      id: 'DEMO_CATAMAYO', title: 'Wildfire Catamayo, Loja, Ecuador', description: 'Demo event near Catamayo', closed: null,
      categories: [{ id: 'wildfires', title: 'Wildfires' }],
      sources: [{ id: 'DEMO', url: 'https://eonet.gsfc.nasa.gov' }],
      geometry: [{ ...point(-79.37, -3.99, 20), magnitudeValue: 1200, magnitudeUnit: 'acres' }],
    },
    {
      id: 'DEMO_LOSRIOS', title: 'Floods in Los Ríos, Ecuador', description: null, closed: ago(30),
      categories: [{ id: 'floods', title: 'Floods' }],
      sources: [{ id: 'DEMO', url: 'https://eonet.gsfc.nasa.gov' }],
      geometry: [point(-79.53, -1.55, 24 * 4)],
    },
    {
      id: 'DEMO_GALERAS', title: 'Galeras Volcano, Colombia', description: null, closed: null,
      categories: [{ id: 'volcanoes', title: 'Volcanoes' }],
      sources: [{ id: 'SIVolcano', url: 'https://volcano.si.edu/volcano.cfm?vn=351080' }],
      geometry: [point(-77.37, 1.22, 24 * 12)],
    },
  ];
}

// --- The fake fetch -----------------------------------------------------------

function parseFirmsUrl(url: URL) {
  // /api/area/csv/{key}/{source}/{w,s,e,n}/{range}[/{date}]
  const [, , , , , source = '', area = '', range = '1', date] = url.pathname.split('/');
  const bbox = area.split(',').map(Number) as unknown as BBox;
  return { source, bbox, range: Number(range), date };
}

export function createMockFetch(now: () => number = Date.now): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const t = now();

    if (url.hostname.startsWith('firms')) {
      const { source, bbox, range, date } = parseFirmsUrl(url);
      const startMs = date
        ? Date.parse(`${date}T00:00:00Z`)
        : Date.parse(`${new Date(t).toISOString().slice(0, 10)}T00:00:00Z`) - (range - 1) * DAY_MS;
      const days = Array.from({ length: range }, (_, i) => new Date(startMs + i * DAY_MS).toISOString().slice(0, 10));
      return new Response(firmsCsv(source, bbox, days, t), { headers: { 'content-type': 'text/csv' } });
    }

    if (url.hostname.startsWith('eonet')) {
      const status = url.searchParams.get('status') ?? 'open';
      const days = Number(url.searchParams.get('days') ?? '0');
      const [w, n, e, s] = (url.searchParams.get('bbox') ?? '-180,90,180,-90').split(',').map(Number) as [number, number, number, number];
      const events = eonetEvents(t).filter((ev) => {
        if (status === 'open' && ev.closed) return false;
        if (status === 'closed' && !ev.closed) return false;
        if (days && ev.closed && t - Date.parse(ev.closed) > days * DAY_MS) return false;
        return ev.geometry.some((g) => {
          const [lon, lat] = g.coordinates as [number, number];
          return inBBox(lon, lat, [w, s, e, n]);
        });
      });
      return Response.json({ title: 'EONET Events (demo)', events });
    }

    return new Response('Not found', { status: 404 });
  }) as typeof fetch;
}
