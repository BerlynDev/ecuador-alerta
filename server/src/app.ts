import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { AiService } from './ai/aiService.js';
import { AnthropicClient, DEFAULT_ANTHROPIC_MODEL, OpenAiCompatibleClient, type LlmClient } from './ai/llm.js';
import { ProvinceLocator } from './domain/provinces.js';
import { createApiRouter } from './routes/api.js';
import { DataService } from './services/dataService.js';
import { EonetClient } from './sources/eonet.js';
import { FirmsClient } from './sources/firms.js';
import { createMockFetch } from './sources/mock.js';

export interface AppOptions {
  config: Config;
  /** Directory containing data/ and (in production) ../client/dist. */
  serverRoot: string;
  /** Injected in tests; defaults to global fetch (live) or the mock fetch. */
  fetchFn?: typeof fetch;
  llm?: LlmClient | null;
  now?: () => number;
}

function createLlm(config: Config): LlmClient | null {
  switch (config.LLM_PROVIDER) {
    case 'anthropic':
      return new AnthropicClient(config.ANTHROPIC_API_KEY, config.LLM_MODEL || DEFAULT_ANTHROPIC_MODEL);
    case 'openai':
      return new OpenAiCompatibleClient(config.OPENAI_API_KEY, config.LLM_MODEL, config.OPENAI_BASE_URL);
    default:
      return null;
  }
}

/**
 * Composition root: the only place that knows about concrete classes.
 * Everything else receives its dependencies through constructors, which is
 * what makes the services testable with fakes (mock fetch, fake LLM, fixed clock).
 */
export function createApp({ config, serverRoot, fetchFn, llm, now }: AppOptions) {
  const fetchImpl = fetchFn ?? (config.DATA_MODE === 'mock' ? createMockFetch(now) : fetch);
  const ttlMs = config.CACHE_TTL_MINUTES * 60_000;

  const locator = ProvinceLocator.fromFile(join(serverRoot, 'data/provinces.geojson'));
  const data = new DataService({
    firms: new FirmsClient({ mapKey: config.FIRMS_MAP_KEY || 'DEMO_KEY', maxDayRange: config.FIRMS_MAX_DAY_RANGE, fetchFn: fetchImpl }),
    eonet: new EonetClient({ fetchFn: fetchImpl }),
    locator,
    firmsSources: config.FIRMS_SOURCES,
    cacheTtlMs: ttlMs,
    mode: config.DATA_MODE,
    now,
  });
  const ai = new AiService(llm === undefined ? createLlm(config) : llm, ttlMs);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.use(
    '/api',
    createApiRouter({
      data,
      ai,
      locator,
      aiRateLimit: config.AI_RATE_LIMIT,
      mode: config.DATA_MODE,
      cacheTtlMinutes: config.CACHE_TTL_MINUTES,
    }),
  );

  // Production: one service serves both the API and the built React app,
  // so there is a single URL, no CORS, and keys never leave the server.
  const clientDist = join(serverRoot, '../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(clientDist, 'index.html')));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'Parámetros inválidos', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
      return;
    }
    console.error('[api]', err);
    res.status(502).json({ error: 'No se pudieron obtener datos de la NASA en este momento.' });
  };
  app.use(onError);

  return { app, data, ai };
}
