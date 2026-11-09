# Ecuador Alerta

Near-real-time monitor of **fire hotspots and natural events in Ecuador**, built on NASA satellite data (FIRMS + EONET), with **AI-generated plain-language summaries that are grounded in, and mechanically checked against, the real data**.

> 🇪🇸 [Leer en español](README.es.md) · Design decisions (Spanish): [docs/DECISIONES.md](docs/DECISIONES.md)

## What it does

- **Interactive map** of mainland Ecuador (Galápagos as an optional layer) with:
  - FIRMS VIIRS fire hotspots, coloured by fire radiative power (FRP) or detection confidence
  - EONET natural events (volcanoes, wildfires, floods, landslides, storms…) with category icons
  - Province boundaries; each hotspot is assigned to one of the 24 provinces
- **Filters**: last 24 h / 48 h / 7 days, event type, province, Galápagos on/off
- **Side panel**: key figures, 7-day trend, lists of events / fire clusters / strongest hotspots, and a detail view
- **"Resumen del día"**: an LLM writes a short Spanish bulletin from computed facts
- **"Explicar este evento"**: a plain-language explanation of what an event is and why it matters
- **Fire clustering** (DBSCAN) to spot large fires among scattered detections
- **Demo mode**: runs with realistic synthetic data and no API keys, so anyone can clone and try it

## Architecture

```
Browser (React + Leaflet)
   │  /api/*  (same origin; no keys in the browser)
   ▼
Express API ──► DataService ──► TtlCache (45 min, coalescing, stale-if-error)
   │                 │
   │                 ├─► FirmsClient  ─► NASA FIRMS area API (CSV)
   │                 ├─► EonetClient  ─► NASA EONET v3 (JSON)
   │                 └─► ProvinceLocator (point-in-polygon) + DBSCAN clustering
   │
   └─► AiService: facts (computed in code) → prompt → LLM → number check → text
                                                   ↘ fallback: deterministic template
```

Monorepo with npm workspaces:

| Package | Contents |
| --- | --- |
| `shared/` | Domain model (types + constants) used by both sides |
| `server/` | Express 5 + TypeScript API, data clients, cache, AI layer, tests |
| `client/` | React 19 + Vite + Leaflet UI |
| `scripts/` | Reproducible build of the province boundaries file |

## Quick start

Requirements: Node.js 22.9+.

```bash
npm install
npm run dev          # API on :8787 + web on :5173, demo data, no keys needed
```

Open http://localhost:5173.

### Use real NASA data

1. Get a free FIRMS MAP_KEY: https://firms.modaps.eosdis.nasa.gov/api/map_key/
2. `cp server/.env.example server/.env` and set:

```ini
DATA_MODE=live
FIRMS_MAP_KEY=your_key
```

### Enable AI summaries (optional)

```ini
# Claude
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
# or any OpenAI-compatible API (OpenAI, Groq, OpenRouter, local Ollama)
LLM_PROVIDER=openai
OPENAI_BASE_URL=https://api.groq.com/openai/v1
OPENAI_API_KEY=...
LLM_MODEL=...
```

Without an LLM the app still produces summaries from deterministic templates (this is the default, and it costs nothing). `server/.env.example` has ready-to-uncomment presets for Groq and Gemini (free tiers), a local Ollama, and Claude.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATA_MODE` | `mock` | `live` calls NASA; `mock` uses synthetic data |
| `CACHE_TTL_MINUTES` | `45` | How long NASA data is reused |
| `FIRMS_MAP_KEY` | – | Required in `live` mode |
| `FIRMS_SOURCES` | `VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT` | Suomi-NPP stopped delivering new data on 2026-11-02 |
| `FIRMS_MAX_DAY_RANGE` | `5` | Longer windows are split into several requests |
| `LLM_PROVIDER` | `none` | `anthropic`, `openai` or `none` |
| `LLM_MODEL` | `claude-haiku-5-5` for Anthropic | Required for `openai` |
| `AI_RATE_LIMIT` | `20` | AI requests per IP per 10 minutes |
| `TRUST_PROXY` | `0` | Reverse proxies in front of the app. Set to `1` on Render so rate limiting sees each visitor's real IP |

All variables are validated at startup with zod; misconfiguration fails fast with a clear message.

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Mode, AI provider, cache TTL |
| GET | `/api/provinces` | Province boundaries (GeoJSON) |
| GET | `/api/snapshot?hours=24\|48\|168&regions=continental,galapagos&categories=volcanoes&province=Loja&hotspots=0` | Filtered hotspots, events, clusters, daily trend, metadata |
| POST | `/api/ai/summary` | Body: same params as `/snapshot`. Returns `{ text, origin: "llm" \| "template", note? }` |
| POST | `/api/ai/explain/:eventId` | Plain-language explanation of one event |

## How the AI is kept honest

1. **The model never sees raw data or does arithmetic.** Counts, rankings, percentages and clusters are computed in TypeScript (`server/src/ai/facts.ts`).
2. **Constrained prompt** (`server/src/ai/prompts.ts`): use only the data block, never invent figures, say so explicitly when there is no data.
3. **Mechanical verification** (`server/src/ai/verify.ts`): every number in the LLM output must exist in the facts. If not, the response is discarded and a deterministic text is shown.
4. **Transparent UI**: each text says whether it was written by the AI or generated automatically.
5. **Cost control**: results are cached by a hash of the facts, and AI endpoints are rate-limited.

## Tests

```bash
npm test             # 52 tests (vitest + supertest)
npm run typecheck
```

Covered: FIRMS URL building and request chunking, CSV parsing (VIIRS and MODIS), confidence mapping, EONET bbox order and normalization, point-in-polygon against real province data, cache coalescing / TTL / stale-if-error, DBSCAN, number verification, LLM clients' request format, and the HTTP API end to end in demo mode with a frozen clock.

## Deployment

`render.yaml` deploys a single free web service on Render that serves both the API and the built front end (`npm run build && npm start`). Set `FIRMS_MAP_KEY` (and an LLM key if you want AI) in the dashboard. On the free plan the service sleeps when idle, so the first request after a pause is slow; the server warms the cache on startup.

## Data sources and credits

- **NASA FIRMS**: NRT VIIRS 375 m active fire detections (NOAA-20, NOAA-21). https://firms.modaps.eosdis.nasa.gov
- **NASA EONET v3**: natural event metadata. https://eonet.gsfc.nasa.gov
- **geoBoundaries** (gbOpen ECU ADM1, CC0 1.0): province boundaries. https://www.geoboundaries.org
- Basemap © OpenStreetMap contributors © CARTO

A hotspot is a satellite-detected thermal anomaly: it may be a wildfire, an agricultural burn or an industrial heat source (e.g. gas flaring), not necessarily a confirmed fire. This is an educational project, not an official alert system; follow Ecuador's Secretaría Nacional de Gestión de Riesgos for official warnings.

## License

MIT © Bernardo López Falconi
