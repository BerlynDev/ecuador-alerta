import type { Hotspot, HotspotCluster } from '@ea/shared';
import { haversineKm } from '../lib/geo.js';

/**
 * DBSCAN clustering of hotspots.
 *
 * Why DBSCAN and not k-means? We don't know how many fires there are (k is
 * unknown), fires have irregular shapes, and isolated detections should stay
 * as "noise" instead of being forced into a group. DBSCAN handles all three.
 *
 * - epsKm: max distance between neighbours. VIIRS pixels are ~375 m, so
 *   detections of one fire front are typically < 1–2 km apart.
 * - minPoints: neighbours needed to start a cluster.
 *
 * Neighbour search uses a uniform grid (cell = eps) so each point only checks
 * the 3×3 surrounding cells: ~O(n) instead of O(n²). Near the equator one
 * degree of longitude ≈ one degree of latitude, so square cells work well
 * for Ecuador.
 */
export interface ClusterOptions {
  epsKm?: number;
  minPoints?: number;
}

const KM_PER_DEG = 111.32;

export function clusterHotspots(hotspots: Hotspot[], { epsKm = 2, minPoints = 3 }: ClusterOptions = {}): HotspotCluster[] {
  const cell = epsKm / KM_PER_DEG;
  const key = (lat: number, lon: number) => `${Math.floor(lat / cell)}:${Math.floor(lon / cell)}`;

  const grid = new Map<string, number[]>();
  hotspots.forEach((h, i) => {
    const k = key(h.lat, h.lon);
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  });

  const neighbours = (i: number): number[] => {
    const h = hotspots[i]!;
    const cy = Math.floor(h.lat / cell);
    const cx = Math.floor(h.lon / cell);
    const result: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
          const o = hotspots[j]!;
          if (haversineKm(h.lat, h.lon, o.lat, o.lon) <= epsKm) result.push(j);
        }
      }
    }
    return result; // includes i itself
  };

  const UNVISITED = -2;
  const NOISE = -1;
  const label = new Array<number>(hotspots.length).fill(UNVISITED);
  let clusterCount = 0;

  for (let i = 0; i < hotspots.length; i++) {
    if (label[i] !== UNVISITED) continue;
    const seeds = neighbours(i);
    if (seeds.length < minPoints) {
      label[i] = NOISE;
      continue;
    }
    const c = clusterCount++;
    label[i] = c;
    const queue = [...seeds];
    while (queue.length) {
      const j = queue.pop()!;
      if (label[j] === NOISE) label[j] = c; // border point
      if (label[j] !== UNVISITED) continue;
      label[j] = c;
      const more = neighbours(j);
      if (more.length >= minPoints) queue.push(...more); // core point: keep expanding
    }
  }

  const groups = new Map<number, Hotspot[]>();
  label.forEach((c, i) => {
    if (c < 0) return;
    const g = groups.get(c);
    if (g) g.push(hotspots[i]!);
    else groups.set(c, [hotspots[i]!]);
  });

  return [...groups.values()]
    .map(summarize)
    .sort((a, b) => b.size - a.size || b.totalFrp - a.totalFrp)
    .map((c, idx) => ({ ...c, id: `C${idx + 1}` }));
}

function summarize(members: Hotspot[]): HotspotCluster {
  const frps = members.map((m) => m.frp ?? 0);
  const times = members.map((m) => m.acquiredAt).sort();
  const provinceVotes = new Map<string, number>();
  for (const m of members) provinceVotes.set(m.province, (provinceVotes.get(m.province) ?? 0) + 1);
  const province = [...provinceVotes.entries()].sort((a, b) => b[1] - a[1])[0]![0];

  return {
    id: '',
    size: members.length,
    lat: round(members.reduce((s, m) => s + m.lat, 0) / members.length, 4),
    lon: round(members.reduce((s, m) => s + m.lon, 0) / members.length, 4),
    province,
    totalFrp: round(frps.reduce((s, v) => s + v, 0), 1),
    maxFrp: round(Math.max(...frps), 1),
    firstSeen: times[0]!,
    lastSeen: times.at(-1)!,
    memberIds: members.map((m) => m.id),
  };
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
