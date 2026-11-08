import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { join } from 'node:path';
import type { AiText, Snapshot } from '@ea/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { LlmClient } from '../src/ai/llm.js';

/**
 * End-to-end through the HTTP layer, with the network replaced by the demo
 * fetch and a frozen clock. Same code path as production, deterministic data.
 */
const NOW = Date.parse('2026-11-08T15:30:00Z');
const serverRoot = join(__dirname, '..');

function setup(llm: LlmClient | null = null) {
  const config = loadConfig({ DATA_MODE: 'mock', LLM_PROVIDER: 'none' });
  return createApp({ config, serverRoot, llm, now: () => NOW }).app;
}

const fakeLlm = (reply: string): LlmClient => ({ name: 'fake', complete: async () => reply });

describe('GET /api/snapshot', () => {
  it('returns normalized, geolocated data for Ecuador only', async () => {
    const res = await request(setup()).get('/api/snapshot?hours=168&regions=continental,galapagos');
    expect(res.status).toBe(200);
    const snap = res.body as Snapshot;

    expect(snap.meta.mode).toBe('mock');
    expect(snap.hotspots.length).toBeGreaterThan(50);
    expect(snap.hotspots.every((h) => h.province)).toBe(true);
    expect(snap.meta.discardedOutsideEcuador).toBeGreaterThan(0); // Peru/Colombia zones in the demo
    expect(snap.daily).toHaveLength(7);
    expect(snap.clusters.length).toBeGreaterThan(0);

    const sangay = snap.events.find((e) => e.id === 'DEMO_SANGAY');
    expect(sangay).toMatchObject({ category: 'volcanoes', province: 'Morona Santiago', status: 'open' });
    const galeras = snap.events.find((e) => e.id === 'DEMO_GALERAS');
    expect(galeras?.province).toBeNull(); // Colombian volcano kept as border event
  });

  it('applies the time window in memory', async () => {
    const app = setup();
    const week = (await request(app).get('/api/snapshot?hours=168')).body as Snapshot;
    const day = (await request(app).get('/api/snapshot?hours=24')).body as Snapshot;
    expect(day.hotspots.length).toBeLessThan(week.hotspots.length);
    const from = Date.parse(day.window.from);
    expect(day.hotspots.every((h) => Date.parse(h.acquiredAt) >= from)).toBe(true);
    // Closed flood (closed 30 h ago) is visible in 48 h / 7 d but not in 24 h.
    expect(week.events.some((e) => e.id === 'DEMO_LOSRIOS')).toBe(true);
    expect(day.events.some((e) => e.id === 'DEMO_LOSRIOS')).toBe(false);
  });

  it('filters by province and category', async () => {
    const res = await request(setup()).get('/api/snapshot?hours=168&province=Loja&categories=wildfires');
    const snap = res.body as Snapshot;
    expect(snap.hotspots.every((h) => h.province === 'Loja')).toBe(true);
    expect(snap.events.map((e) => e.id)).toEqual(['DEMO_CATAMAYO']);
  });

  it('rejects invalid parameters with 400', async () => {
    expect((await request(setup()).get('/api/snapshot?hours=12')).status).toBe(400);
    expect((await request(setup()).get('/api/snapshot?province=Narnia')).status).toBe(400);
    expect((await request(setup()).get('/api/snapshot?categories=aliens')).status).toBe(400);
  });
});

describe('AI endpoints', () => {
  it('falls back to a deterministic summary without an LLM', async () => {
    const res = await request(setup()).post('/api/ai/summary').send({ hours: 24 });
    const body = res.body as AiText;
    expect(body.origin).toBe('template');
    expect(body.text).toMatch(/^Datos de demostración:/);
    expect(body.text).toMatch(/focos de calor/);
  });

  it('accepts LLM text whose numbers are all grounded', async () => {
    const app = setup(fakeLlm('Datos de demostración: durante las últimas 24 horas hubo actividad en Loja.'));
    const body = (await request(app).post('/api/ai/summary').send({ hours: 24 })).body as AiText;
    expect(body.origin).toBe('llm');
  });

  it('rejects LLM text with invented numbers', async () => {
    const app = setup(fakeLlm('Hubo 9999 focos y 12345 evacuados.'));
    const body = (await request(app).post('/api/ai/summary').send({ hours: 24 })).body as AiText;
    expect(body.origin).toBe('template');
    expect(body.note).toMatch(/cifras no verificables/);
  });

  it('falls back when the LLM fails', async () => {
    const failing: LlmClient = { name: 'down', complete: async () => Promise.reject(new Error('timeout')) };
    const body = (await request(setup(failing)).post('/api/ai/summary').send({})).body as AiText;
    expect(body.origin).toBe('template');
  });

  it('explains an event, 404 for unknown ids', async () => {
    const app = setup();
    const ok = await request(app).post('/api/ai/explain/DEMO_SANGAY');
    expect(ok.status).toBe(200);
    expect(ok.body.text).toMatch(/volcán/i);
    expect(ok.body.text).toMatch(/IG-EPN/);
    expect((await request(app).post('/api/ai/explain/NOPE')).status).toBe(404);
  });
});
