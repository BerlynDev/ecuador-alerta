import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
// Both src/index.ts (dev) and dist/index.js (prod) sit one level below server/.
const serverRoot = fileURLToPath(new URL('..', import.meta.url));

const { app, ai, data } = createApp({ config, serverRoot });

app.listen(config.PORT, () => {
  console.log(`Ecuador Alerta API on http://localhost:${config.PORT}`);
  console.log(`  data: ${config.DATA_MODE} | sources: ${config.FIRMS_SOURCES.join(', ')} | cache: ${config.CACHE_TTL_MINUTES} min | ai: ${ai.provider}`);
  // Warm the cache so the first visitor doesn't wait for NASA.
  data.getDataset().catch((err) => console.warn('[warmup] failed:', err instanceof Error ? err.message : err));
});
