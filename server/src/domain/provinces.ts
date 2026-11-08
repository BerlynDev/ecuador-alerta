import { readFileSync } from 'node:fs';
import type { BBox, Region } from '@ea/shared';
import { REGIONS } from '@ea/shared';
import { bboxOfPolygons, inBBox, pointInPolygon, type PolygonCoords } from '../lib/geo.js';

interface ProvinceFeature {
  type: 'Feature';
  properties: { name: string; iso: string };
  geometry: { type: 'Polygon'; coordinates: PolygonCoords } | { type: 'MultiPolygon'; coordinates: PolygonCoords[] };
}

export interface ProvinceCollection {
  type: 'FeatureCollection';
  attribution?: string;
  features: ProvinceFeature[];
}

interface IndexedProvince {
  name: string;
  bbox: BBox;
  polygons: PolygonCoords[];
}

/**
 * Assigns a point to one of Ecuador's 24 provinces.
 *
 * Each province is pre-indexed with its bounding box; the cheap bbox test
 * rejects ~90% of candidates before the more expensive ray-casting test runs.
 * This lets us tag thousands of hotspots in a few milliseconds.
 */
export class ProvinceLocator {
  private readonly provinces: IndexedProvince[];

  constructor(readonly collection: ProvinceCollection) {
    this.provinces = collection.features.map((f) => {
      const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      return { name: f.properties.name, polygons, bbox: bboxOfPolygons(polygons) };
    });
  }

  static fromFile(path: string): ProvinceLocator {
    return new ProvinceLocator(JSON.parse(readFileSync(path, 'utf8')) as ProvinceCollection);
  }

  get names(): string[] {
    return this.provinces.map((p) => p.name);
  }

  locate(lon: number, lat: number): string | null {
    for (const p of this.provinces) {
      if (inBBox(lon, lat, p.bbox) && p.polygons.some((poly) => pointInPolygon(lon, lat, poly))) {
        return p.name;
      }
    }
    return null;
  }
}

export const GALAPAGOS_PROVINCE = 'Galápagos';

export function regionOf(lon: number, lat: number, province: string | null): Region | null {
  if (province) return province === GALAPAGOS_PROVINCE ? 'galapagos' : 'continental';
  if (inBBox(lon, lat, REGIONS.galapagos.bbox)) return 'galapagos';
  if (inBBox(lon, lat, REGIONS.continental.bbox)) return 'continental';
  return null;
}
