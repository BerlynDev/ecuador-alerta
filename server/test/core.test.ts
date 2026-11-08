import { describe, expect, it, vi } from 'vitest';
import type { Hotspot } from '@ea/shared';
import { TtlCache } from '../src/lib/cache.js';
import { clusterHotspots } from '../src/domain/clusters.js';
import { findUnsupportedNumbers } from '../src/ai/verify.js';

describe('TtlCache', () => {
  it('coalesces concurrent loads into one upstream call', async () => {
    const cache = new TtlCache<number>(1000);
    const loader = vi.fn(async () => 42);
    const results = await Promise.all([cache.getOrLoad('k', loader), cache.getOrLoad('k', loader), cache.getOrLoad('k', loader)]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.value)).toEqual([42, 42, 42]);
  });

  it('reloads after the TTL', async () => {
    let t = 0;
    const cache = new TtlCache<number>(1000, () => t);
    const loader = vi.fn(async () => t);
    await cache.getOrLoad('k', loader);
    t = 999;
    await cache.getOrLoad('k', loader);
    expect(loader).toHaveBeenCalledTimes(1);
    t = 1000;
    expect((await cache.getOrLoad('k', loader)).value).toBe(1000);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('serves stale data when a refresh fails', async () => {
    let t = 0;
    const cache = new TtlCache<string>(10, () => t);
    await cache.getOrLoad('k', async () => 'old');
    t = 50;
    const res = await cache.getOrLoad('k', async () => {
      throw new Error('NASA down');
    });
    expect(res).toMatchObject({ value: 'old', stale: true, error: 'NASA down' });
  });

  it('propagates errors when there is nothing cached', async () => {
    const cache = new TtlCache<string>(10);
    await expect(cache.getOrLoad('k', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });
});

const hs = (id: string, lat: number, lon: number, frp = 10): Hotspot => ({
  id, lat, lon, frp, acquiredAt: `2026-11-08T0${id.length}:00:00Z`, satellite: 'NOAA-20', instrument: 'VIIRS',
  confidence: 'nominal', brightnessK: 330, dayNight: 'D', province: lon < -79 ? 'Loja' : 'Sucumbíos', region: 'continental',
});

describe('clusterHotspots (DBSCAN)', () => {
  // ~0.005° ≈ 0.55 km apart
  const fireA = [0, 1, 2, 3, 4].map((i) => hs(`a${i}`, -4 + i * 0.005, -79.37));
  const fireB = [0, 1, 2].map((i) => hs(`b${i}`, -0.19, -76.65 + i * 0.005, 3));
  const lonely = [hs('x', -2, -78)];

  it('finds two fires and ignores isolated noise', () => {
    const clusters = clusterHotspots([...fireA, ...fireB, ...lonely]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({ id: 'C1', size: 5, province: 'Loja', totalFrp: 50, maxFrp: 10 });
    expect(clusters[1]).toMatchObject({ id: 'C2', size: 3, province: 'Sucumbíos' });
  });

  it('does not chain points farther apart than eps', () => {
    const spread = [0, 1, 2].map((i) => hs(`s${i}`, -1, -78 + i * 0.05)); // ~5.5 km apart
    expect(clusterHotspots(spread)).toHaveLength(0);
  });
});

describe('findUnsupportedNumbers', () => {
  const facts = { total: 37, frp: 45.37, provincia: 'Loja', fecha: '8 nov 2026, 14:30', magnitud: '1200 acres', sat: ['NOAA-20'] };

  it('accepts numbers present in the facts, including roundings and date parts', () => {
    const text = 'Se detectaron 37 focos; el más intenso tuvo 45,4 MW (8 nov 2026, 14:30). NOAA-20 reportó 1.200 acres.';
    expect(findUnsupportedNumbers(text, facts)).toEqual([]);
  });

  it('flags invented numbers', () => {
    expect(findUnsupportedNumbers('Hubo 40 focos y 3 evacuados.', facts)).toEqual(['40', '3']);
  });

  it('accepts text without numbers', () => {
    expect(findUnsupportedNumbers('No se registraron focos de calor.', { total: 0 })).toEqual([]);
  });
});
