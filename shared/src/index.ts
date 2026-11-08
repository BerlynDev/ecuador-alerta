/**
 * Shared domain model.
 *
 * Both upstream APIs (FIRMS = CSV rows, EONET = nested JSON) are normalized
 * into these two shapes on the server. The client only ever sees this model,
 * so swapping or adding a data source never touches the UI.
 */

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

/** [west, south, east, north] in decimal degrees (WGS84). */
export type BBox = readonly [number, number, number, number];

export type Region = 'continental' | 'galapagos';

export const REGIONS: Record<Region, { label: string; bbox: BBox }> = {
  continental: { label: 'Ecuador continental', bbox: [-81.1, -5.0, -75.2, 1.5] },
  galapagos: { label: 'Galápagos', bbox: [-92.0, -1.5, -89.0, 1.7] },
};

// ---------------------------------------------------------------------------
// FIRMS hotspots
// ---------------------------------------------------------------------------

export type Confidence = 'low' | 'nominal' | 'high';

export interface Hotspot {
  id: string;
  lat: number;
  lon: number;
  /** ISO-8601 UTC timestamp of the satellite overpass. */
  acquiredAt: string;
  satellite: string; // e.g. "NOAA-20"
  instrument: 'VIIRS' | 'MODIS';
  confidence: Confidence;
  /** Fire Radiative Power in megawatts. */
  frp: number | null;
  brightnessK: number | null;
  dayNight: 'D' | 'N';
  province: string;
  region: Region;
}

// ---------------------------------------------------------------------------
// EONET natural events
// ---------------------------------------------------------------------------

/** Category ids exactly as published by EONET v3 /categories. */
export const EVENT_CATEGORIES = {
  drought: 'Sequía',
  dustHaze: 'Polvo y bruma',
  earthquakes: 'Sismos',
  floods: 'Inundaciones',
  landslides: 'Deslizamientos',
  manmade: 'Origen humano',
  seaLakeIce: 'Hielo marino/lacustre',
  severeStorms: 'Tormentas severas',
  snow: 'Nieve',
  tempExtremes: 'Temperaturas extremas',
  volcanoes: 'Volcanes',
  waterColor: 'Color del agua',
  wildfires: 'Incendios forestales',
} as const;

export type EventCategory = keyof typeof EVENT_CATEGORIES;

export function isEventCategory(value: string): value is EventCategory {
  return Object.prototype.hasOwnProperty.call(EVENT_CATEGORIES, value);
}

export interface TrackPoint {
  lat: number;
  lon: number;
  date: string;
}

export interface NaturalEvent {
  id: string;
  title: string;
  description: string | null;
  category: EventCategory;
  status: 'open' | 'closed';
  closedAt: string | null;
  /** Most recent known position. */
  lat: number;
  lon: number;
  /** Date of the most recent geometry. */
  date: string;
  magnitude: { value: number; unit: string } | null;
  sources: { id: string; url: string }[];
  /** null when the event lies at sea or just across the border. */
  province: string | null;
  region: Region;
  track: TrackPoint[];
}

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------

export interface HotspotCluster {
  id: string;
  size: number;
  lat: number;
  lon: number;
  province: string;
  totalFrp: number;
  maxFrp: number;
  firstSeen: string;
  lastSeen: string;
  /** Hotspot ids belonging to this cluster. */
  memberIds: string[];
}

export interface DailyCount {
  /** Local calendar day in Ecuador (UTC-5), YYYY-MM-DD. */
  date: string;
  count: number;
}

export type TimeWindow = 24 | 48 | 168;
export const TIME_WINDOWS: TimeWindow[] = [24, 48, 168];

export interface SnapshotQuery {
  hours: TimeWindow;
  regions: Region[];
  categories: EventCategory[] | null; // null = all
  province: string | null;
  includeHotspots: boolean;
}

export interface SnapshotMeta {
  mode: 'live' | 'mock';
  fetchedAt: string;
  /** True when serving cached data because an upstream refresh failed. */
  stale: boolean;
  firmsSources: string[];
  /** Hotspots inside the bounding box but outside Ecuador's provinces. */
  discardedOutsideEcuador: number;
  warnings: string[];
}

export interface Snapshot {
  query: SnapshotQuery;
  window: { from: string; to: string };
  hotspots: Hotspot[];
  events: NaturalEvent[];
  clusters: HotspotCluster[];
  daily: DailyCount[];
  meta: SnapshotMeta;
}

// ---------------------------------------------------------------------------
// AI endpoints
// ---------------------------------------------------------------------------

export interface AiText {
  text: string;
  /** "llm" = written by the model and verified; "template" = deterministic fallback. */
  origin: 'llm' | 'template';
  /** Why the template was used, when it was. */
  note?: string;
  generatedAt: string;
}
