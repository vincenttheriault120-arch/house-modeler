/**
 * Anthropic list prices, in US dollars per million tokens (Claude API, standard speed).
 * Cache writes: 1.25x input for the 5-minute cache, 2x for the 1-hour cache.
 * Prices checked 2026-11-23. Update this table when Anthropic changes its prices.
 */
export interface ModelPrice {
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  /** Haiku 5.5 charges more when the whole prompt is over 100K tokens. */
  long?: { above: number; input: number; output: number; cacheRead: number };
}

export const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-2': { label: 'Fable 5.2', input: 8, output: 40, cacheRead: 0.2 },
  'claude-fable-5-1': { label: 'Fable 5.1', input: 10, output: 50, cacheRead: 0.25 },
  'claude-fable-5': { label: 'Fable 5', input: 10, output: 50, cacheRead: 1 },
  'claude-opus-5-5': { label: 'Opus 5.5', input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { label: 'Opus 5', input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { label: 'Opus 4.8', input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-7': { label: 'Opus 4.7', input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-6': { label: 'Opus 4.6', input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', input: 2, output: 10, cacheRead: 0.1 },
  'claude-sonnet-5': { label: 'Sonnet 5', input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-4-6': { label: 'Sonnet 4.6', input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-5-5': {
    label: 'Haiku 5.5',
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    long: { above: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 },
  },
  'claude-haiku-4-5': { label: 'Haiku 4.5', input: 1, output: 5, cacheRead: 0.1 },
};

/** Token counts for one model's part of a call. */
export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  /** Written to the 5-minute cache. */
  cacheWrite5m: number;
  /** Written to the 1-hour cache. */
  cacheWrite1h: number;
}

/** Strip a date suffix or platform prefix so "claude-opus-5-5-20260101" still finds its price. */
export function priceFor(model: string): ModelPrice | null {
  if (PRICES[model]) return PRICES[model];
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.includes(k));
  return key ? PRICES[key] : null;
}

export function modelLabel(model: string): string {
  return priceFor(model)?.label ?? model;
}

/** Dollars for these tokens on this model, or null if the model's price isn't known. */
export function costOf(model: string, t: Tokens): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const prompt = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
  const r = p.long && prompt > p.long.above ? p.long : p;
  return (
    (t.input * r.input + t.cacheWrite5m * r.input * 1.25 + t.cacheWrite1h * r.input * 2 + t.cacheRead * r.cacheRead + t.output * r.output) /
    1_000_000
  );
}
