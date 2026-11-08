import { describe, expect, it } from 'vitest';
import { AnthropicClient, OpenAiCompatibleClient } from '../src/ai/llm.js';
import { loadConfig } from '../src/config.js';

/** Captures the outgoing request and replies with a canned body. */
function recorder(reply: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe('AnthropicClient', () => {
  it('sends a Messages API request and joins text blocks', async () => {
    const { calls, fetchFn } = recorder({ content: [{ type: 'text', text: 'Hola ' }, { type: 'text', text: 'Ecuador' }] });
    const client = new AnthropicClient('sk-test', 'claude-haiku-5-5', fetchFn);
    expect(await client.complete({ system: 'S', user: 'U', maxTokens: 50 })).toBe('Hola Ecuador');

    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 50,
      system: 'S',
      messages: [{ role: 'user', content: 'U' }],
    });
  });

  it('throws on HTTP errors', async () => {
    const { fetchFn } = recorder({ error: 'nope' }, 401);
    await expect(new AnthropicClient('bad', 'm', fetchFn).complete({ system: '', user: '', maxTokens: 1 })).rejects.toThrow(/401/);
  });
});

describe('OpenAiCompatibleClient', () => {
  it('works with any base URL (Groq, OpenRouter, Ollama...)', async () => {
    const { calls, fetchFn } = recorder({ choices: [{ message: { content: ' texto ' } }] });
    const client = new OpenAiCompatibleClient('key', 'some-model', 'http://localhost:11434/v1/', fetchFn);
    expect(await client.complete({ system: 'S', user: 'U', maxTokens: 10 })).toBe('texto');
    expect(calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(JSON.parse(calls[0]!.init.body as string).messages[0]).toEqual({ role: 'system', content: 'S' });
  });
});

describe('loadConfig', () => {
  it('defaults to demo mode without keys', () => {
    expect(loadConfig({})).toMatchObject({ DATA_MODE: 'mock', LLM_PROVIDER: 'none', CACHE_TTL_MINUTES: 45 });
  });

  it('fails fast when live mode has no FIRMS key', () => {
    expect(() => loadConfig({ DATA_MODE: 'live' })).toThrow(/FIRMS_MAP_KEY/);
  });

  it('parses comma-separated sources and ignores empty values', () => {
    const c = loadConfig({ FIRMS_SOURCES: 'VIIRS_NOAA20_NRT, MODIS_NRT', PORT: '' });
    expect(c.FIRMS_SOURCES).toEqual(['VIIRS_NOAA20_NRT', 'MODIS_NRT']);
    expect(c.PORT).toBe(8787);
  });
});
