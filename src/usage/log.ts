import { useSyncExternalStore } from 'react';
import { costOf, type Tokens } from './pricing';

/** What in the app made the call. */
export type Feature = 'Redraft' | 'Ask Claude' | 'Suggest foundation' | 'Suggest floor' | 'Suggest levels' | 'Label plan';

export type CallStatus = 'done' | 'stopped' | 'error' | 'refused' | 'cut off';

/** One request to the Claude API, as the app logged it. */
export interface UsageRecord {
  id: string;
  /** ISO time the call started. */
  at: string;
  feature: Feature;
  /** A sub-step, e.g. Redraft's "inventory" / "draft" / "check", or "turn 2 · call 1" in a chat. */
  stage?: string;
  project: string;
  /** The model the app asked for. */
  requested: string;
  /** The model that answered (differs when Claude falls back to another model). */
  model: string;
  status: CallStatus;
  durationMs: number;
  tokens: Tokens;
  /** Output tokens spent on thinking (already included in tokens.output). */
  thinking?: number;
  /** US dollars, or null when the model's price isn't known. */
  cost: number | null;
  /** Per-model parts when a fallback model answered part of the call. */
  parts?: { model: string; tokens: Tokens; cost: number | null }[];
}

const STORAGE_KEY = 'house-modeler:api-usage';
const BUDGET_KEY = 'house-modeler:api-budget';
/** Oldest calls are dropped past this, to stay well inside browser storage. */
export const MAX_RECORDS = 3000;

let cache: UsageRecord[] | null = null;
let budgetCache: number | null | undefined;
const listeners = new Set<() => void>();

function read(): UsageRecord[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    cache = Array.isArray(parsed) ? (parsed as UsageRecord[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(records: UsageRecord[]) {
  cache = records;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Storage full or blocked: keep the log for this visit only.
  }
  listeners.forEach((l) => l());
}

export function usageRecords(): UsageRecord[] {
  return read();
}

export function addUsage(r: Omit<UsageRecord, 'id' | 'cost'> & { cost?: number | null }) {
  const record: UsageRecord = {
    ...r,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    cost: r.cost !== undefined ? r.cost : costOf(r.model, r.tokens),
  };
  write([...read(), record].slice(-MAX_RECORDS));
}

export function clearUsage() {
  write([]);
}

export function loadBudget(): number | null {
  if (budgetCache !== undefined) return budgetCache;
  try {
    const v = Number(localStorage.getItem(BUDGET_KEY));
    budgetCache = Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    budgetCache = null;
  }
  return budgetCache;
}

export function saveBudget(dollars: number | null) {
  budgetCache = dollars && dollars > 0 ? dollars : null;
  try {
    if (budgetCache) localStorage.setItem(BUDGET_KEY, String(budgetCache));
    else localStorage.removeItem(BUDGET_KEY);
  } catch {
    // Kept for this visit.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  // Another tab of the app logged a call.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cache = null;
    if (e.key === BUDGET_KEY) budgetCache = undefined;
    if (e.key === STORAGE_KEY || e.key === BUDGET_KEY) l();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

export function useUsage(): UsageRecord[] {
  return useSyncExternalStore(subscribe, read, () => []);
}

export function useBudget(): number | null {
  return useSyncExternalStore(subscribe, loadBudget, () => null);
}

// ---------------------------------------------------------------------------
// Totals

export interface Totals {
  calls: number;
  cost: number;
  /** Calls whose model has no known price. */
  unpriced: number;
  tokens: Tokens;
}

export function emptyTotals(): Totals {
  return { calls: 0, cost: 0, unpriced: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } };
}

export function totals(records: UsageRecord[]): Totals {
  const t = emptyTotals();
  for (const r of records) {
    t.calls++;
    if (r.cost === null) t.unpriced++;
    else t.cost += r.cost;
    t.tokens.input += r.tokens.input;
    t.tokens.output += r.tokens.output;
    t.tokens.cacheRead += r.tokens.cacheRead;
    t.tokens.cacheWrite5m += r.tokens.cacheWrite5m;
    t.tokens.cacheWrite1h += r.tokens.cacheWrite1h;
  }
  return t;
}

export function groupBy(records: UsageRecord[], key: (r: UsageRecord) => string): { key: string; totals: Totals }[] {
  const groups = new Map<string, UsageRecord[]>();
  for (const r of records) {
    const k = key(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups].map(([k, rs]) => ({ key: k, totals: totals(rs) })).sort((a, b) => b.totals.cost - a.totals.cost);
}

/** Calls made since the start of today / this month, in local time. */
export function since(records: UsageRecord[], start: Date): UsageRecord[] {
  const t = start.getTime();
  return records.filter((r) => new Date(r.at).getTime() >= t);
}

export function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function startOfMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function formatCost(dollars: number | null): string {
  if (dollars === null) return '?';
  if (dollars === 0) return '$0.00';
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`;
  if (dollars < 10) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toFixed(2)}`;
}

const CSV_COLUMNS = [
  'time',
  'feature',
  'stage',
  'project',
  'model',
  'requested_model',
  'status',
  'duration_s',
  'input_tokens',
  'cache_write_5m_tokens',
  'cache_write_1h_tokens',
  'cache_read_tokens',
  'output_tokens',
  'thinking_tokens',
  'cost_usd',
];

function csvCell(v: string | number | undefined | null): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function usageCsv(records: UsageRecord[]): string {
  const rows = records.map((r) =>
    [
      r.at,
      r.feature,
      r.stage,
      r.project,
      r.model,
      r.requested,
      r.status,
      (r.durationMs / 1000).toFixed(1),
      r.tokens.input,
      r.tokens.cacheWrite5m,
      r.tokens.cacheWrite1h,
      r.tokens.cacheRead,
      r.tokens.output,
      r.thinking,
      r.cost === null ? '' : r.cost.toFixed(6),
    ]
      .map(csvCell)
      .join(','),
  );
  return [CSV_COLUMNS.join(','), ...rows].join('\n') + '\n';
}
