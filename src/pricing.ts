// Per-model token pricing for GenAI cost tracking.
//
// Cost is computed at log time and stored on the usage_events row (cost_usd), so
// historical rows stay accurate even if these rates change later.
//
// Rates are USD per 1,000,000 tokens. Claude rates verified against the Claude
// API reference (Opus 4.8 $5/$25, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5, Fable 5
// $10/$50). Gemini rates are a TODO — confirm against Google's current pricing
// before relying on them; until then costFor() returns null for those models so
// the spend shows as "unpriced" rather than a misleading $0.

export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

export const PRICING: Record<string, ModelPrice> = {
  // Anthropic (Claude) — verified.
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5": { input: 10, output: 50 },

  // Google (Gemini) — TODO: confirm against current Google pricing before trusting.
  // "gemini-2.5-pro": { input: 0, output: 0 },
  // "gemini-2.5-flash": { input: 0, output: 0 },
};

/**
 * Compute the USD cost of a call. Returns null for unknown/unpriced models so
 * the caller can record the usage without inventing a $0 cost.
 */
export function costFor(model: string, inputTokens: number, outputTokens: number): number | null {
  const p = PRICING[model];
  if (!p) return null;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}
