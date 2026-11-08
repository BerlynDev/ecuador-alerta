import { describe, expect, it } from 'vitest';
import { buildAreaUrl, FirmsClient, normalizeConfidence, normalizeFirmsRow, planRequests } from '../src/sources/firms.js';
import { normalizeEonetEvent, toEonetBBox, type RawEonetEvent } from '../src/sources/eonet.js';
import { parseCsv } from '../src/lib/csv.js';
import { REGIONS } from '@ea/shared';

const NOW = new Date('2026-11-08T15:30:00Z');

describe('FIRMS URL building', () => {
  it('follows /api/area/csv/{key}/{source}/{w,s,e,n}/{days}[/{date}]', () => {
    expect(buildAreaUrl('KEY', 'VIIRS_NOAA20_NRT', [-81.1, -5, -75.2, 1.5], { dayRange: 2 })).toBe(
      'https://firms.modaps.eosdis.nasa.gov/api/area/csv/KEY/VIIRS_NOAA20_NRT/-81.1,-5,-75.2,1.5/2',
    );
    expect(buildAreaUrl('KEY', 'MODIS_NRT', [0, 0, 1, 1], { dayRange: 5, date: '2026-11-01' })).toMatch(/\/5\/2026-11-01$/);
  });

  it('uses a single "most recent" request when the window fits', () => {
    expect(planRequests(5, 5, NOW)).toEqual([{ dayRange: 5 }]);
  });

  it('splits long windows into dated chunks that end today', () => {
    expect(planRequests(8, 5, NOW)).toEqual([
      { dayRange: 5, date: '2026-11-01' }, // Nov 1–5
      { dayRange: 3, date: '2026-11-06' }, // Nov 6–8
    ]);
  });
});

describe('FIRMS normalization', () => {
  it('maps VIIRS letters and MODIS percentages to one scale', () => {
    expect(normalizeConfidence('h')).toBe('high');
    expect(normalizeConfidence('n')).toBe('nominal');
    expect(normalizeConfidence('l')).toBe('low');
    expect(normalizeConfidence('85')).toBe('high');
    expect(normalizeConfidence('50')).toBe('nominal');
    expect(normalizeConfidence('10')).toBe('low');
  });

  it('parses a real-format VIIRS row', () => {
    const csv =
      'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n' +
      '-3.99012,-79.37011,345.12,0.42,0.37,2026-11-08,545,N20,VIIRS,n,2.0NRT,295.40,12.55,N\n';
    const [row] = parseCsv(csv);
    const h = normalizeFirmsRow(row!, 'VIIRS_NOAA20_NRT');
    expect(h).toMatchObject({
      lat: -3.99012,
      lon: -79.37011,
      acquiredAt: '2026-11-08T05:45:00Z', // "545" is padded to 05:45
      satellite: 'NOAA-20',
      instrument: 'VIIRS',
      confidence: 'nominal',
      frp: 12.55,
      brightnessK: 345.12,
      dayNight: 'N',
    });
  });

  it('parses a MODIS row (brightness + numeric confidence)', () => {
    const csv =
      'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight\n' +
      '-1.2,-80.3,320.5,1.1,1.0,2026-11-07,1530,Aqua,MODIS,82,6.1NRT,295,20.1,D';
    const h = normalizeFirmsRow(parseCsv(csv)[0]!, 'MODIS_NRT');
    expect(h).toMatchObject({ satellite: 'Aqua', instrument: 'MODIS', confidence: 'high', brightnessK: 320.5 });
  });

  it('treats a 200 response with a text error as a failure', async () => {
    const fetchFn = (async () => new Response('Invalid MAP_KEY.', { status: 200 })) as unknown as typeof fetch;
    const client = new FirmsClient({ mapKey: 'bad', maxDayRange: 5, fetchFn });
    await expect(client.fetchArea('VIIRS_NOAA20_NRT', REGIONS.continental.bbox, 1, NOW)).rejects.toThrow(/Invalid MAP_KEY/);
  });
});

describe('EONET', () => {
  it('converts [w,s,e,n] to EONET order (minLon, maxLat, maxLon, minLat)', () => {
    expect(toEonetBBox([-81.1, -5, -75.2, 1.5])).toBe('-81.1,1.5,-75.2,-5');
  });

  const storm: RawEonetEvent = {
    id: 'EONET_1',
    title: 'Tropical Storm X',
    description: null,
    closed: null,
    categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
    sources: [{ id: 'JTWC', url: 'https://example.org' }],
    geometry: [
      { magnitudeValue: 35, magnitudeUnit: 'kts', date: '2026-11-06T00:00:00Z', type: 'Point', coordinates: [-90.5, 0.5] },
      { magnitudeValue: 50, magnitudeUnit: 'kts', date: '2026-11-07T00:00:00Z', type: 'Point', coordinates: [-100, 5] },
    ],
  };

  it('uses the latest position inside the area of interest', () => {
    const e = normalizeEonetEvent(storm, [REGIONS.galapagos.bbox])!;
    expect([e.lon, e.lat]).toEqual([-90.5, 0.5]);
    expect(e.magnitude).toEqual({ value: 50, unit: 'kts' }); // magnitude from the latest geometry
    expect(e.track).toHaveLength(2);
    expect(e.status).toBe('open');
  });

  it('computes a representative point for polygons', () => {
    const e = normalizeEonetEvent(
      {
        ...storm,
        geometry: [{ magnitudeValue: null, magnitudeUnit: null, date: '2026-11-07T00:00:00Z', type: 'Polygon', coordinates: [[[-79, -2], [-78, -2], [-78, -1], [-79, -1]]] }],
      },
      [REGIONS.continental.bbox],
    )!;
    expect([e.lon, e.lat]).toEqual([-78.5, -1.5]);
  });

  it('drops events with unknown categories', () => {
    expect(normalizeEonetEvent({ ...storm, categories: [{ id: 'alienInvasion', title: '?' }] }, [])).toBeNull();
  });
});
