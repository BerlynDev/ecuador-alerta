import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { EventCategory, Region, SnapshotQuery } from '@ea/shared';
import { isEventCategory, TIME_WINDOWS } from '@ea/shared';
import type { DataService } from '../services/dataService.js';
import type { AiService } from '../ai/aiService.js';
import type { ProvinceLocator } from '../domain/provinces.js';

/**
 * Query validation: every input from the browser is parsed with zod into a
 * typed `SnapshotQuery`. Invalid input → 400 with a clear message, never a
 * half-applied filter.
 */
const listParam = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean)));

export function makeQuerySchema(provinces: string[]) {
  return z.object({
    hours: z.coerce
      .number()
      .refine((h): h is (typeof TIME_WINDOWS)[number] => (TIME_WINDOWS as number[]).includes(h), {
        message: `hours must be one of ${TIME_WINDOWS.join(', ')}`,
      })
      .default(24),
    regions: listParam
      .refine((r) => !r || r.every((x) => x === 'continental' || x === 'galapagos'), 'invalid region')
      .transform((r) => (r?.length ? r : ['continental']) as Region[]),
    categories: listParam
      .refine((c) => !c || c.every(isEventCategory), 'invalid category')
      .transform((c) => (c?.length ? (c as EventCategory[]) : null)),
    province: z
      .string()
      .optional()
      .refine((p) => !p || provinces.includes(p), 'unknown province')
      .transform((p) => p || null),
    hotspots: z
      .enum(['1', '0', 'true', 'false'])
      .optional()
      .transform((v) => v !== '0' && v !== 'false'),
  });
}

export interface ApiDeps {
  data: DataService;
  ai: AiService;
  locator: ProvinceLocator;
  aiRateLimit: number;
  mode: 'live' | 'mock';
  cacheTtlMinutes: number;
}

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();
  const querySchema = makeQuerySchema(deps.locator.names);

  const parseQuery = (input: unknown): SnapshotQuery => {
    const q = querySchema.parse(input ?? {});
    return { hours: q.hours, regions: q.regions, categories: q.categories, province: q.province, includeHotspots: q.hotspots };
  };

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', mode: deps.mode, ai: deps.ai.provider, cacheTtlMinutes: deps.cacheTtlMinutes });
  });

  router.get('/provinces', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(deps.locator.collection);
  });

  router.get('/snapshot', async (req, res) => {
    const snapshot = await deps.data.getSnapshot(parseQuery(req.query));
    // Browsers/CDNs may reuse it briefly; the server cache does the heavy lifting.
    res.set('Cache-Control', 'public, max-age=300');
    res.json(snapshot);
  });

  // AI endpoints cost money: rate-limit per IP so a public demo can't drain the key.
  const aiLimiter = rateLimit({
    windowMs: 10 * 60_000,
    limit: deps.aiRateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes de IA. Intenta de nuevo en unos minutos.' },
  });

  router.post('/ai/summary', aiLimiter, async (req: Request, res) => {
    const snapshot = await deps.data.getSnapshot(parseQuery(req.body));
    res.json(await deps.ai.dailySummary(snapshot));
  });

  router.post('/ai/explain/:id', aiLimiter, async (req, res) => {
    const event = await deps.data.findEvent(String(req.params.id));
    if (!event) {
      res.status(404).json({ error: 'Evento no encontrado' });
      return;
    }
    res.json(await deps.ai.explainEvent(event, deps.mode === 'mock'));
  });

  return router;
}
