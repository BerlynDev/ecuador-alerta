import { z } from 'zod';

/**
 * All configuration comes from environment variables and is validated once at
 * startup. A bad value fails fast with a readable message instead of
 * surfacing later as a confusing runtime error.
 */
const csv = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

const schema = z
  .object({
    PORT: z.coerce.number().int().positive().default(8787),
    // Number of reverse proxies in front of the app (Render = 1). Needed so
    // req.ip is the visitor's IP and per-IP rate limiting works. 0 = direct.
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    DATA_MODE: z.enum(['live', 'mock']).default('mock'),
    CACHE_TTL_MINUTES: z.coerce.number().min(1).max(24 * 60).default(45),

    FIRMS_MAP_KEY: z.string().default(''),
    FIRMS_SOURCES: csv.default(['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT']),
    FIRMS_MAX_DAY_RANGE: z.coerce.number().int().min(1).max(10).default(5),

    LLM_PROVIDER: z.enum(['anthropic', 'openai', 'none']).default('none'),
    LLM_MODEL: z.string().default(''),
    ANTHROPIC_API_KEY: z.string().default(''),
    OPENAI_API_KEY: z.string().default(''),
    OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
    AI_RATE_LIMIT: z.coerce.number().int().positive().default(20),
  })
  .superRefine((env, ctx) => {
    if (env.DATA_MODE === 'live' && !env.FIRMS_MAP_KEY) {
      ctx.addIssue({ code: 'custom', path: ['FIRMS_MAP_KEY'], message: 'required when DATA_MODE=live' });
    }
    if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'required when LLM_PROVIDER=anthropic' });
    }
    if (env.LLM_PROVIDER === 'openai' && !env.LLM_MODEL) {
      ctx.addIssue({ code: 'custom', path: ['LLM_MODEL'], message: 'required when LLM_PROVIDER=openai' });
    }
  });

export type Config = z.output<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings as "not set" so defaults apply (common with .env files).
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
