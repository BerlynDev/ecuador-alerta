import type { EventCategory } from '@ea/shared';

/**
 * 16×16 glyphs for EONET categories, as SVG path data. Used both inside
 * Leaflet divIcons (HTML strings) and in React lists, so they are plain strings.
 */
const PATHS: Partial<Record<EventCategory, string>> = {
  volcanoes: 'M1 14 L6 6 H10 L15 14 Z M6.5 4.5 C6 3 7.5 2 8 1 C8.5 2 10 3 9.5 4.5 Z',
  wildfires: 'M8 1 C9 4 13 6 13 10 A5 5 0 0 1 3 10 C3 7.5 5 6.5 5.5 4.5 C6.5 6 7 6.5 7.5 6.5 C8 5 7.5 3 8 1 Z',
  floods: 'M1 6 Q4 3.5 8 6 T15 6 V8 Q12 10.5 8 8 T1 8 Z M1 11 Q4 8.5 8 11 T15 11 V13 Q12 15.5 8 13 T1 13 Z',
  landslides: 'M1 15 V3 L5 7 L8 6 L15 15 Z',
  severeStorms: 'M4 8 A4 4 0 0 1 12 6 A3 3 0 0 1 12 12 H4 A2 2 0 0 1 4 8 Z M8 12 L6.5 15.5 L9.5 13.5 Z',
  earthquakes: 'M1 8 H4 L5.5 3 L8 13 L10 5 L11.5 8 H15 V9.5 H10.5 L10 8 L8 15.5 L5.5 6 L5 9.5 H1 Z',
};

const FALLBACK = 'M8 2 A6 6 0 1 1 7.99 2 Z';

export function categoryPath(c: EventCategory): string {
  return PATHS[c] ?? FALLBACK;
}

export function categorySvg(c: EventCategory, size = 16, fill = 'currentColor'): string {
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true"><path d="${categoryPath(c)}" fill="${fill}"/></svg>`;
}
