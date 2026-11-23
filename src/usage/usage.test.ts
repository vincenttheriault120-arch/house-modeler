import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addUsage, clearUsage, formatCost, groupBy, totals, usageCsv, usageRecords, type UsageRecord } from './log';
import { meterStream, priceUsage, setUsageProject, tokensOf } from './meter';
import { costOf } from './pricing';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };

describe('costOf', () => {
  it('prices Opus 5.5 input, output, cache reads and writes', () => {
    // 1M input $4, 1M output $20, 1M cache read $0.20, 1M 5-min write $5, 1M 1-hour write $8
    expect(costOf('claude-opus-5-5', { ...zero, input: 1e6 })).toBeCloseTo(4);
    expect(costOf('claude-opus-5-5', { ...zero, output: 1e6 })).toBeCloseTo(20);
    expect(costOf('claude-opus-5-5', { ...zero, cacheRead: 1e6 })).toBeCloseTo(0.2);
    expect(costOf('claude-opus-5-5', { ...zero, cacheWrite5m: 1e6 })).toBeCloseTo(5);
    expect(costOf('claude-opus-5-5', { ...zero, cacheWrite1h: 1e6 })).toBeCloseTo(8);
  });

  it('uses the higher Haiku 5.5 rates for prompts over 100K tokens', () => {
    expect(costOf('claude-haiku-5-5', { ...zero, input: 50_000, output: 1000 })).toBeCloseTo((50_000 * 0.1 + 1000 * 0.5) / 1e6);
    expect(costOf('claude-haiku-5-5', { ...zero, input: 150_000, output: 1000 })).toBeCloseTo((150_000 * 0.5 + 1000 * 2.5) / 1e6);
  });

  it('finds dated model ids and returns null for unknown models', () => {
    expect(costOf('claude-opus-5-5-20260101', { ...zero, input: 1e6 })).toBeCloseTo(4);
    expect(costOf('some-other-model', { ...zero, input: 1e6 })).toBeNull();
  });
});

describe('priceUsage', () => {
  it('reads cache writes by duration', () => {
    const t = tokensOf({ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 30, cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 10 } });
    expect(t).toEqual({ input: 10, output: 5, cacheRead: 0, cacheWrite5m: 20, cacheWrite1h: 10 });
  });

  it('prices each model separately when a fallback model answered', () => {
    const p = priceUsage('claude-opus-4-8', {
      input_tokens: 2000,
      output_tokens: 600,
      iterations: [
        { type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
        { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
      ],
    });
    expect(p.parts).toHaveLength(2);
    expect(p.tokens.input).toBe(2000);
    expect(p.cost).toBeCloseTo((1000 * 4 + 100 * 20 + 1000 * 5 + 500 * 25) / 1e6);
  });
});

/** Just enough of a message stream to drive meterStream. */
function fakeStream() {
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  return {
    on(e: string, f: (...a: unknown[]) => void) {
      (handlers[e] ??= []).push(f);
      return this;
    },
    emit(e: string, ...a: unknown[]) {
      handlers[e]?.forEach((f) => f(...a));
    },
  };
}

describe('meterStream', () => {
  beforeEach(() => {
    store.clear();
    clearUsage();
    setUsageProject('311 Gardenville');
  });

  it('logs a finished call with its project, model and cost', () => {
    const s = fakeStream();
    meterStream(s as never, { feature: 'Redraft', stage: 'draft', model: 'claude-opus-5-5' });
    s.emit('finalMessage', {
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 100_000, output_tokens: 20_000, output_tokens_details: { thinking_tokens: 15_000 } },
    });
    s.emit('end');
    const [r] = usageRecords();
    expect(r).toMatchObject({ feature: 'Redraft', stage: 'draft', project: '311 Gardenville', status: 'done', thinking: 15_000 });
    expect(r.cost).toBeCloseTo(0.4 + 0.4);
    expect(usageRecords()).toHaveLength(1);
  });

  it('logs a stopped call with the tokens used so far', () => {
    const s = fakeStream();
    meterStream(s as never, { feature: 'Ask Claude', model: 'claude-opus-5-5' });
    s.emit('streamEvent', { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 5000, output_tokens: 1 } } });
    s.emit('streamEvent', { type: 'message_delta', usage: { output_tokens: 3000, input_tokens: null } });
    s.emit('abort');
    const [r] = usageRecords();
    expect(r.status).toBe('stopped');
    expect(r.tokens.input).toBe(5000);
    expect(r.tokens.output).toBe(3000);
    expect(r.cost).toBeCloseTo((5000 * 4 + 3000 * 20) / 1e6);
  });

  it('logs a call that failed before answering at no cost', () => {
    const s = fakeStream();
    meterStream(s as never, { feature: 'Label plan', model: 'claude-haiku-5-5' });
    s.emit('error', new Error('credit balance too low'));
    expect(usageRecords()[0]).toMatchObject({ status: 'error', cost: 0 });
  });
});

describe('totals and export', () => {
  const rec = (feature: UsageRecord['feature'], cost: number | null): UsageRecord => ({
    id: Math.random().toString(),
    at: '2026-11-23T12:00:00.000Z',
    feature,
    project: 'A, "quoted"',
    requested: 'claude-opus-5-5',
    model: 'claude-opus-5-5',
    status: 'done',
    durationMs: 1500,
    tokens: { ...zero, input: 10 },
    cost,
  });

  it('adds up costs by feature and counts unpriced calls', () => {
    const rs = [rec('Redraft', 1), rec('Redraft', 0.5), rec('Ask Claude', 0.25), rec('Ask Claude', null)];
    expect(totals(rs)).toMatchObject({ calls: 4, cost: 1.75, unpriced: 1 });
    expect(groupBy(rs, (r) => r.feature).map((g) => [g.key, g.totals.cost])).toEqual([
      ['Redraft', 1.5],
      ['Ask Claude', 0.25],
    ]);
  });

  it('writes CSV with quoted cells', () => {
    const csv = usageCsv([rec('Redraft', 0.123456)]);
    expect(csv.split('\n')[1]).toContain('"A, ""quoted"""');
    expect(csv.split('\n')[1]).toContain('0.123456');
  });

  it('formats small and large costs', () => {
    expect(formatCost(0.0012)).toBe('$0.0012');
    expect(formatCost(1.2345)).toBe('$1.234');
    expect(formatCost(12.345)).toBe('$12.35');
    expect(formatCost(null)).toBe('?');
  });

  it('prices a call from its tokens when no cost is given', () => {
    clearUsage();
    addUsage({ ...rec('Redraft', 1), cost: undefined });
    expect(usageRecords()[0].cost).toBeCloseTo(10 * 4 / 1e6);
  });
});
