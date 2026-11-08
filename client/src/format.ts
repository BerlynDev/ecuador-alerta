import type { Confidence, Hotspot } from '@ea/shared';

/** Thermal ramp shared by the map, legend and trend chart. */
export const HEAT = ['#F2C14E', '#EE8A2B', '#D23B22', '#7C1424'] as const;

export const FRP_BREAKS = [5, 20, 50]; // MW

export function frpColor(frp: number | null): string {
  const v = frp ?? 0;
  const i = FRP_BREAKS.findIndex((b) => v < b);
  return HEAT[i === -1 ? 3 : i]!;
}

export const CONFIDENCE_COLOR: Record<Confidence, string> = {
  low: HEAT[0],
  nominal: HEAT[1],
  high: HEAT[2],
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: 'Baja',
  nominal: 'Nominal',
  high: 'Alta',
};

export type ColorBy = 'frp' | 'confidence';

export function hotspotColor(h: Hotspot, by: ColorBy): string {
  return by === 'frp' ? frpColor(h.frp) : CONFIDENCE_COLOR[h.confidence];
}

const dateTime = new Intl.DateTimeFormat('es-EC', {
  timeZone: 'America/Guayaquil',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dayFmt = new Intl.DateTimeFormat('es-EC', { timeZone: 'UTC', weekday: 'short', day: 'numeric' });

export const fmtDateTime = (iso: string) => dateTime.format(new Date(iso));
/** For YYYY-MM-DD local days (already in Ecuador time). */
export const fmtDay = (ymd: string) => dayFmt.format(new Date(`${ymd}T12:00:00Z`));
export const fmtNumber = (n: number, digits = 0) =>
  n.toLocaleString('es-EC', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function relativeTime(iso: string, now = Date.now()): string {
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
