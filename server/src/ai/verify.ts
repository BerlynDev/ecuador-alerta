/**
 * Guardrail: reject LLM output that contains numbers not present in the facts.
 *
 * A prompt that says "don't invent numbers" reduces hallucinations; it does
 * not eliminate them. So we check mechanically: collect every number in the
 * facts (including digits inside dates and labels such as "NOAA-20"), allow
 * common roundings, and verify each number the model wrote is in that set.
 * If anything doesn't match, the caller falls back to a deterministic text.
 *
 * Trade-off: this is intentionally strict and may occasionally reject a
 * harmless sentence. For a hazard monitor, a false "fallback" is much cheaper
 * than a confidently wrong number.
 */

function collectNumbers(value: unknown, out: Set<number>): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(value);
    out.add(Math.round(value));
    out.add(Math.round(value * 10) / 10);
  } else if (typeof value === 'string') {
    for (const m of value.match(/\d+(?:\.\d+)?/g) ?? []) collectNumbers(Number(m), out);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectNumbers(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectNumbers(v, out));
  }
}

/** All readings of a number token as written in Spanish or English text. */
function readings(token: string): number[] {
  const results = new Set<number>();
  // "1.200" / "1,200" may be thousands separators.
  if (/^\d{1,3}([.,]\d{3})+$/.test(token)) results.add(Number(token.replace(/[.,]/g, '')));
  // "12,5" (Spanish decimal) or "12.5".
  results.add(Number(token.replace(',', '.')));
  return [...results].filter(Number.isFinite);
}

export function findUnsupportedNumbers(text: string, facts: unknown, extraAllowed: number[] = []): string[] {
  const allowed = new Set<number>(extraAllowed);
  collectNumbers(facts, allowed);
  const tokens = text.match(/\d+(?:[.,]\d+)*/g) ?? [];
  return tokens.filter((t) => !readings(t).some((n) => allowed.has(n)));
}
