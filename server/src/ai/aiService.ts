import { createHash } from 'node:crypto';
import type { AiText, NaturalEvent, Snapshot } from '@ea/shared';
import { TtlCache } from '../lib/cache.js';
import { buildSummaryFacts, eventFacts } from './facts.js';
import type { LlmClient } from './llm.js';
import { EXPLAIN_SYSTEM, PROMPT_VERSION, SUMMARY_SYSTEM, userMessage } from './prompts.js';
import { templateExplanation, templateSummary } from './templates.js';
import { findUnsupportedNumbers } from './verify.js';

/**
 * Pipeline for every AI text:
 *
 *   facts (computed in code) → prompt → LLM → number verification → response
 *                                   ↘ (no LLM / error / failed check) → template
 *
 * Results are cached by a hash of the facts: identical data never triggers a
 * second LLM call, which keeps cost predictable on a public demo.
 */
export class AiService {
  private readonly cache: TtlCache<AiText>;

  constructor(
    private readonly llm: LlmClient | null,
    ttlMs: number,
    private readonly log: (msg: string) => void = console.warn,
  ) {
    this.cache = new TtlCache<AiText>(ttlMs);
  }

  get provider(): string {
    return this.llm?.name ?? 'none';
  }

  async dailySummary(snapshot: Snapshot): Promise<AiText> {
    const facts = buildSummaryFacts(snapshot);
    return this.generate('summary', facts, {
      system: SUMMARY_SYSTEM,
      task: 'Redacta el resumen de la situación actual con estos datos.',
      maxTokens: 400,
      fallback: () => templateSummary(facts),
    });
  }

  async explainEvent(event: NaturalEvent, demo: boolean): Promise<AiText> {
    const facts = { ...eventFacts(event), datosDeDemostracion: demo };
    return this.generate('explain', facts, {
      system: EXPLAIN_SYSTEM,
      task: 'Explica este evento en lenguaje sencillo.',
      maxTokens: 250,
      fallback: () => (demo ? 'Datos de demostración: ' : '') + templateExplanation(event),
    });
  }

  private async generate(
    kind: string,
    facts: unknown,
    opts: { system: string; task: string; maxTokens: number; fallback: () => string },
  ): Promise<AiText> {
    const key = createHash('sha256').update(`${kind}|${PROMPT_VERSION}|${this.provider}|${JSON.stringify(facts)}`).digest('hex');
    const template = (note: string): AiText => ({
      text: opts.fallback(),
      origin: 'template',
      note,
      generatedAt: new Date().toISOString(),
    });

    const llm = this.llm;
    if (!llm) return template('IA no configurada: texto generado automáticamente a partir de los datos.');

    try {
      const { value } = await this.cache.getOrLoad(key, async () => {
        const text = await llm.complete({
          system: opts.system,
          user: userMessage(facts, opts.task),
          maxTokens: opts.maxTokens,
        });
        const unsupported = findUnsupportedNumbers(text, facts);
        if (unsupported.length > 0) {
          // Cached on purpose: same facts → same rejection; don't pay to retry.
          this.log(`[ai] ${kind}: rejected LLM output, unsupported numbers: ${unsupported.join(', ')}`);
          return template('La respuesta de la IA incluía cifras no verificables; se muestra el texto automático.');
        }
        return { text, origin: 'llm', generatedAt: new Date().toISOString() };
      });
      return value;
    } catch (err) {
      // Not cached: a transient outage shouldn't pin the fallback for the whole TTL.
      this.log(`[ai] ${kind}: LLM error: ${err instanceof Error ? err.message : String(err)}`);
      return template('El servicio de IA no respondió; se muestra el texto automático.');
    }
  }
}
