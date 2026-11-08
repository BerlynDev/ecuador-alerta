#!/usr/bin/env node
/**
 * Builds server/data/provinces.geojson from geoBoundaries (gbOpen, ECU ADM1,
 * simplified). License: CC0 1.0 (public domain).
 *
 * Why a script instead of committing a random file? So the data pipeline is
 * reproducible and the cleanup steps are explicit and reviewable:
 *   - restore Spanish accents missing in the source ("Manabi" -> "Manabí")
 *   - fix ISO 3166-2 codes (source has Cotopaxi and Chimborazo both as EC-H)
 *   - round coordinates to 4 decimals (~11 m), which is far below the
 *     375 m VIIRS pixel size, and roughly halves the file size
 *
 * Usage:
 *   node scripts/build-provinces.mjs            # downloads the source
 *   node scripts/build-provinces.mjs local.geojson
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL =
  'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/ECU/ADM1/geoBoundaries-ECU-ADM1_simplified.geojson';

const NAME_FIXES = { Manabi: 'Manabí', Sucumbios: 'Sucumbíos' };

// Official ISO 3166-2:EC codes.
const ISO = {
  Azuay: 'EC-A', Bolívar: 'EC-B', Cañar: 'EC-F', Carchi: 'EC-C', Chimborazo: 'EC-H',
  Cotopaxi: 'EC-X', 'El Oro': 'EC-O', Esmeraldas: 'EC-E', Galápagos: 'EC-W', Guayas: 'EC-G',
  Imbabura: 'EC-I', Loja: 'EC-L', 'Los Ríos': 'EC-R', Manabí: 'EC-M', 'Morona Santiago': 'EC-S',
  Napo: 'EC-N', Orellana: 'EC-D', Pastaza: 'EC-Y', Pichincha: 'EC-P', 'Santa Elena': 'EC-SE',
  'Santo Domingo de los Tsáchilas': 'EC-SD', Sucumbíos: 'EC-U', Tungurahua: 'EC-T',
  'Zamora Chinchipe': 'EC-Z',
};

const round = (n) => Math.round(n * 1e4) / 1e4;
const roundDeep = (c) => (typeof c[0] === 'number' ? c.map(round) : c.map(roundDeep));

async function loadSource(path) {
  if (path) return JSON.parse(await readFile(path, 'utf8'));
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  return res.json();
}

const source = await loadSource(process.argv[2]);

const features = source.features.map((f) => {
  const raw = f.properties.shapeName;
  const name = NAME_FIXES[raw] ?? raw;
  if (!ISO[name]) throw new Error(`Unknown province name: ${raw}`);
  return {
    type: 'Feature',
    properties: { name, iso: ISO[name] },
    geometry: { type: f.geometry.type, coordinates: roundDeep(f.geometry.coordinates) },
  };
});

if (features.length !== 24) throw new Error(`Expected 24 provinces, got ${features.length}`);
features.sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'es'));

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../server/data/provinces.geojson');
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  JSON.stringify({
    type: 'FeatureCollection',
    attribution: 'geoBoundaries (gbOpen ECU ADM1), CC0 1.0 — https://www.geoboundaries.org',
    features,
  }),
);
console.log(`Wrote ${features.length} provinces to ${out}`);
