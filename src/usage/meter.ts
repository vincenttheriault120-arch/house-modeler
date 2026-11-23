import type Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageStream } from '@anthropic-ai/sdk/lib/BetaMessageStream';
import { addUsage, type CallStatus, type Feature } from './log';
import { costOf, type Tokens } from './pricing';

type Usage = Partial<Anthropic.Beta.BetaUsage>;

let currentProject = '';

/** The open project's name, attached to every call logged from now on. */
export function setUsageProject(name: string) {
  currentProject = name;
}

export interface CallInfo {
  feature: Feature;
  stage?: string;
  /** The model the request asked for. */
  model: string;
}

export function tokensOf(u: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: Anthropic.Beta.BetaCacheCreation | null;
}): Tokens {
  const write = u.cache_creation_input_tokens ?? 0;
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    // Without a breakdown, the app only uses the default 5-minute cache.
    cacheWrite5m: u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : write,
    cacheWrite1h: w1h,
  };
}

function add(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  };
}

/**
 * Turn an API usage object into a log entry's tokens and cost. When a fallback model
 * answered part of the call, `usage.iterations` says which model used which tokens,
 * and each part is priced at its own model's rates.
 */
export function priceUsage(model: string, usage: Usage) {
  const its = (usage.iterations ?? []).filter(
    (i): i is Anthropic.Beta.BetaMessageIterationUsage | Anthropic.Beta.BetaFallbackMessageIterationUsage =>
      (i.type === 'message' || i.type === 'fallback_message') && 'model' in i,
  );
  const models = new Set(its.map((i) => i.model ?? model));
  if (its.length > 1 && models.size > 1) {
    const parts = its.map((i) => {
      const m = i.model ?? model;
      const tokens = tokensOf(i);
      return { model: m, tokens, cost: costOf(m, tokens) };
    });
    const tokens = parts.reduce((t, p) => add(t, p.tokens), tokensOf({}));
    const cost = parts.some((p) => p.cost === null) ? null : parts.reduce((s, p) => s + (p.cost ?? 0), 0);
    return { tokens, cost, parts };
  }
  const tokens = tokensOf(usage);
  return { tokens, cost: costOf(model, tokens), parts: undefined };
}

function statusOf(stop: string | null | undefined): CallStatus {
  if (stop === 'refusal') return 'refused';
  if (stop === 'max_tokens') return 'cut off';
  return 'done';
}

/**
 * Log what a streamed call used, once it ends: finished, stopped by the person, or failed.
 * A stopped call is logged with the tokens it had used so far, since those are billed too.
 */
export function meterStream<S extends BetaMessageStream<unknown>>(stream: S, info: CallInfo): S {
  const started = Date.now();
  const at = new Date(started).toISOString();
  let usage: Usage | null = null;
  let model = info.model;
  let logged = false;

  const log = (status: CallStatus, final?: { model: string; usage: Usage }) => {
    if (logged) return;
    logged = true;
    const u = final?.usage ?? usage ?? {};
    const m = final?.model ?? model;
    const priced = priceUsage(m, u);
    addUsage({
      at,
      feature: info.feature,
      stage: info.stage,
      project: currentProject,
      requested: info.model,
      model: m,
      status,
      durationMs: Date.now() - started,
      tokens: priced.tokens,
      thinking: u.output_tokens_details?.thinking_tokens ?? undefined,
      // A call that failed before Claude started answering isn't billed.
      cost: usage || final ? priced.cost : 0,
      parts: priced.parts,
    });
  };

  stream.on('streamEvent', (e) => {
    if (e.type === 'message_start') {
      usage = { ...e.message.usage };
      model = e.message.model || model;
    } else if (e.type === 'message_delta') {
      // Delta usage counts are running totals.
      const next: Usage = { ...(usage ?? {}) };
      for (const [k, v] of Object.entries(e.usage)) if (v !== null && v !== undefined) (next as Record<string, unknown>)[k] = v;
      usage = next;
    }
  });
  stream.on('finalMessage', (m) => log(statusOf(m.stop_reason), { model: m.model || model, usage: m.usage }));
  stream.on('abort', () => log('stopped'));
  stream.on('error', () => log('error'));
  return stream;
}
