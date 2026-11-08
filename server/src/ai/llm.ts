/**
 * Provider-agnostic LLM client.
 *
 * The rest of the app depends only on the `LlmClient` interface, so the
 * provider is a deployment decision (env var), not a code change:
 *   - anthropic → Claude Messages API
 *   - openai    → any OpenAI-compatible /chat/completions endpoint
 *                 (OpenAI, Groq, OpenRouter, a local Ollama...)
 *
 * Plain `fetch` instead of SDKs: two small HTTP calls don't justify two
 * dependencies, and the request/response shape stays visible in the code.
 */
export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface LlmClient {
  readonly name: string;
  complete(req: CompletionRequest): Promise<string>;
}

const TIMEOUT_MS = 30_000;

export class AnthropicClient implements LlmClient {
  readonly name: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.name = `anthropic:${model}`;
  }

  async complete({ system, user, maxTokens }: CompletionRequest): Promise<string> {
    const res = await this.fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        temperature: 0.2,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Anthropic API: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = json.content?.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    if (!text) throw new Error('Anthropic API: empty response');
    return text;
  }
}

export class OpenAiCompatibleClient implements LlmClient {
  readonly name: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.name = `openai-compatible:${model}`;
  }

  async complete({ system, user, maxTokens }: CompletionRequest): Promise<string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`LLM API: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('LLM API: empty response');
    return text;
  }
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';
