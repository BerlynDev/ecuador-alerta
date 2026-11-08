import type { DailyCount } from '@ea/shared';

/**
 * Continental Ecuador is UTC-5 all year (no daylight saving time), so a fixed
 * offset is correct and avoids timezone-database edge cases.
 * (Galápagos is UTC-6; daily charts use continental time for consistency.)
 */
export const ECUADOR_OFFSET_MS = -5 * 3_600_000;
const DAY_MS = 86_400_000;

/** YYYY-MM-DD of the Ecuador-local calendar day for a UTC instant. */
export function localDay(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  return new Date(ms + ECUADOR_OFFSET_MS).toISOString().slice(0, 10);
}

/** Counts per local day for the last `days` days (oldest first), zero-filled. */
export function dailyCounts(timestamps: string[], now: number, days = 7): DailyCount[] {
  const counts = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) counts.set(localDay(now - i * DAY_MS), 0);
  for (const t of timestamps) {
    const d = localDay(t);
    if (counts.has(d)) counts.set(d, counts.get(d)! + 1);
  }
  return [...counts.entries()].map(([date, count]) => ({ date, count }));
}
