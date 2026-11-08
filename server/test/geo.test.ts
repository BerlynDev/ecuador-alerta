import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { haversineKm, pointInPolygon, type Ring } from '../src/lib/geo.js';
import { ProvinceLocator, regionOf } from '../src/domain/provinces.js';
import { dailyCounts, localDay } from '../src/domain/time.js';

const square: Ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
const hole: Ring = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];

describe('pointInPolygon', () => {
  it('detects inside, outside and holes', () => {
    expect(pointInPolygon(5, 2, [square])).toBe(true);
    expect(pointInPolygon(11, 2, [square])).toBe(false);
    expect(pointInPolygon(5, 5, [square, hole])).toBe(false);
  });
});

describe('haversineKm', () => {
  it('Quito → Guayaquil is about 270 km', () => {
    expect(haversineKm(-0.1807, -78.4678, -2.1962, -79.8862)).toBeGreaterThan(260);
    expect(haversineKm(-0.1807, -78.4678, -2.1962, -79.8862)).toBeLessThan(280);
  });
});

describe('ProvinceLocator (real geoBoundaries data)', () => {
  const locator = ProvinceLocator.fromFile(join(__dirname, '../data/provinces.geojson'));

  it.each([
    ['Quito', -78.4678, -0.1807, 'Pichincha'],
    ['Guayaquil', -79.8862, -2.1962, 'Guayas'],
    ['Cuenca', -79.0045, -2.9006, 'Azuay'],
    ['Ibarra', -78.1223, 0.3517, 'Imbabura'],
    ['Puerto Ayora', -90.3134, -0.7431, 'Galápagos'],
  ])('%s is in %s', (_city, lon, lat, province) => {
    expect(locator.locate(lon, lat)).toBe(province);
  });

  it('returns null for points in Peru or at sea', () => {
    expect(locator.locate(-80.6, -4.9)).toBeNull(); // Peru (inside the bbox)
    expect(locator.locate(-84.0, -1.0)).toBeNull(); // Pacific
  });

  it('knows all 24 provinces', () => {
    expect(locator.names).toHaveLength(24);
  });

  it('assigns regions', () => {
    expect(regionOf(-90.3, -0.7, 'Galápagos')).toBe('galapagos');
    expect(regionOf(-77.37, 1.22, null)).toBe('continental'); // across the border, still in bbox
    expect(regionOf(-60, 0, null)).toBeNull();
  });
});

describe('Ecuador local time', () => {
  it('uses UTC-5', () => {
    expect(localDay('2026-11-08T04:59:00Z')).toBe('2026-11-07');
    expect(localDay('2026-11-08T05:00:00Z')).toBe('2026-11-08');
  });

  it('zero-fills daily counts', () => {
    const now = Date.parse('2026-11-08T15:00:00Z');
    const daily = dailyCounts(['2026-11-08T12:00:00Z', '2026-11-08T13:00:00Z', '2026-11-06T12:00:00Z'], now, 3);
    expect(daily).toEqual([
      { date: '2026-11-06', count: 1 },
      { date: '2026-11-07', count: 0 },
      { date: '2026-11-08', count: 2 },
    ]);
  });
});
