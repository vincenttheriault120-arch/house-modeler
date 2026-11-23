import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CircleDollarSign, Download, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { downloadBlob } from '../download';
import {
  clearUsage,
  formatCost,
  groupBy,
  saveBudget,
  since,
  startOfMonth,
  startOfToday,
  totals,
  usageCsv,
  useBudget,
  useUsage,
  type Totals,
  type UsageRecord,
} from './log';
import { modelLabel, PRICES } from './pricing';

/** Budget use for this month: 'ok', 'near' (80% or more) or 'over'. */
function budgetState(spent: number, budget: number | null): 'ok' | 'near' | 'over' {
  if (!budget) return 'ok';
  if (spent >= budget) return 'over';
  return spent >= budget * 0.8 ? 'near' : 'ok';
}

/** The top-bar button: this month's spend, which opens the cost dashboard. */
export function CostButton() {
  const records = useUsage();
  const budget = useBudget();
  const [open, setOpen] = useState(false);
  const month = useMemo(() => totals(since(records, startOfMonth())).cost, [records]);
  const state = budgetState(month, budget);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn(state === 'near' && 'text-amber-600 dark:text-amber-400', state === 'over' && 'text-destructive')}
        title="Claude API costs: this month, estimated from list prices"
      >
        {state === 'ok' ? <CircleDollarSign /> : <AlertTriangle />}
        API costs · {formatCost(month)}
      </Button>
      {open && <CostDashboard onClose={() => setOpen(false)} />}
    </>
  );
}

type Period = 'today' | 'month' | 'all';
const PAGE = 100;

const selectClass =
  'h-8 rounded-md border border-input bg-background px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

function dollars(v: number): string {
  return '$' + v.toFixed(2);
}

function n(v: number): string {
  return v.toLocaleString();
}

export function CostDashboard({ onClose }: { onClose: () => void }) {
  const records = useUsage();
  const budget = useBudget();
  const [period, setPeriod] = useState<Period>('month');
  const [project, setProject] = useState('');
  const [feature, setFeature] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [budgetText, setBudgetText] = useState(budget ? String(budget) : '');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const today = useMemo(() => totals(since(records, startOfToday())), [records]);
  const month = useMemo(() => totals(since(records, startOfMonth())), [records]);
  const all = useMemo(() => totals(records), [records]);
  const state = budgetState(month.cost, budget);

  const projects = useMemo(() => [...new Set(records.map((r) => r.project || 'No project'))].sort(), [records]);
  const features = useMemo(() => [...new Set(records.map((r) => r.feature))].sort(), [records]);

  const filtered = useMemo(() => {
    const start = period === 'today' ? startOfToday() : period === 'month' ? startOfMonth() : null;
    return (start ? since(records, start) : records).filter(
      (r) => (!project || (r.project || 'No project') === project) && (!feature || r.feature === feature),
    );
  }, [records, period, project, feature]);
  const sel = useMemo(() => totals(filtered), [filtered]);
  const byFeature = useMemo(() => groupBy(filtered, (r) => r.feature), [filtered]);
  const byProject = useMemo(() => groupBy(filtered, (r) => r.project || 'No project'), [filtered]);
  const byModel = useMemo(() => groupBy(filtered, (r) => modelLabel(r.model)), [filtered]);
  const newest = useMemo(() => [...filtered].reverse(), [filtered]);

  const periodLabel = period === 'today' ? 'today' : period === 'month' ? 'this month' : 'all time';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="API costs">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <CircleDollarSign className="size-5" />
        <h2 className="text-sm font-semibold">Claude API costs</h2>
        <span className="hidden text-xs text-muted-foreground sm:inline">Estimated from Anthropic list prices · calls made in this browser</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => downloadBlob(new Blob([usageCsv(filtered)], { type: 'text/csv' }), `api-costs-${new Date().toISOString().slice(0, 10)}.csv`)} disabled={!filtered.length}>
          <Download /> Export CSV
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4">
          {state !== 'ok' && budget && (
            <div
              role="alert"
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                state === 'over' ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300',
              )}
            >
              <AlertTriangle className="size-4 shrink-0" />
              {state === 'over'
                ? `This month's estimated spend (${formatCost(month.cost)}) is over your ${dollars(budget)} budget.`
                : `This month's estimated spend (${formatCost(month.cost)}) is at ${Math.round((month.cost / budget) * 100)}% of your ${dollars(budget)} budget.`}
            </div>
          )}

          {/* Headline numbers */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Today" value={formatCost(today.cost)} sub={`${n(today.calls)} calls`} />
            <Tile
              label="This month"
              value={formatCost(month.cost)}
              sub={budget ? `of ${dollars(budget)} budget` : `${n(month.calls)} calls`}
              meter={budget ? Math.min(1, month.cost / budget) : undefined}
              tone={state}
            />
            <Tile label="All time" value={formatCost(all.cost)} sub={`${n(all.calls)} calls`} />
            <div className="flex flex-col gap-1.5 rounded-lg border p-3">
              <Label htmlFor="budget" className="text-xs font-normal text-muted-foreground">
                Monthly budget (US$)
              </Label>
              <form
                className="flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = parseFloat(budgetText.replace(/[$,\s]/g, ''));
                  saveBudget(Number.isFinite(v) && v > 0 ? v : null);
                }}
              >
                <Input id="budget" className="h-8" inputMode="decimal" placeholder="e.g. 20" value={budgetText} onChange={(e) => setBudgetText(e.target.value)} />
                <Button type="submit" size="sm" variant="outline">
                  Set
                </Button>
              </form>
              <span className="text-xs text-muted-foreground">Warns at 80% and when over.</span>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            <Filter label="Period">
              <select className={selectClass} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                <option value="today">Today</option>
                <option value="month">This month</option>
                <option value="all">All time</option>
              </select>
            </Filter>
            <Filter label="Project">
              <select className={selectClass} value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Filter>
            <Filter label="Feature">
              <select className={selectClass} value={feature} onChange={(e) => setFeature(e.target.value)}>
                <option value="">All features</option>
                {features.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Filter>
            <div className="ml-auto text-sm text-muted-foreground">
              {n(sel.calls)} calls {periodLabel} · <span className="font-medium text-foreground">{formatCost(sel.cost)}</span>
              {sel.calls > 0 && <> · {formatCost(sel.cost / sel.calls)} per call</>}
            </div>
          </div>

          {records.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No Claude calls logged yet. Every Redraft, Ask Claude message, Suggest and plan label will show up here with its tokens and cost.
            </p>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                <Breakdown title="By feature" rows={byFeature} total={sel.cost} />
                <Breakdown title="By project" rows={byProject} total={sel.cost} />
                <Breakdown title="By model" rows={byModel} total={sel.cost} />
              </div>

              <TokenSummary t={sel} />

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Every call {periodLabel}</h3>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-medium">When</th>
                        <th className="px-3 py-2 font-medium">Feature</th>
                        <th className="px-3 py-2 font-medium">Project</th>
                        <th className="px-3 py-2 font-medium">Model</th>
                        <th className="px-3 py-2 text-right font-medium">Time</th>
                        <th className="px-3 py-2 text-right font-medium">Input</th>
                        <th className="px-3 py-2 text-right font-medium">Cache write</th>
                        <th className="px-3 py-2 text-right font-medium">Cache read</th>
                        <th className="px-3 py-2 text-right font-medium" title="Output tokens, with the part spent on thinking in brackets">
                          Output (thinking)
                        </th>
                        <th className="px-3 py-2 text-right font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {newest.slice(0, shown).map((r) => (
                        <CallRow key={r.id} r={r} />
                      ))}
                    </tbody>
                  </table>
                </div>
                {newest.length > shown && (
                  <Button variant="outline" size="sm" className="self-center" onClick={() => setShown((s) => s + PAGE)}>
                    Show {Math.min(PAGE, newest.length - shown)} more
                  </Button>
                )}
              </section>
            </>
          )}

          <footer className="flex flex-wrap items-center gap-3 border-t pt-4 text-xs text-muted-foreground">
            <p className="flex-1">
              Prices per million tokens: {['claude-opus-5-5', 'claude-haiku-5-5'].map((m) => `${PRICES[m].label} $${PRICES[m].input} in / $${PRICES[m].output} out`).join(' · ')}. Cache writes cost 1.25x input, cache reads much less. Thinking is billed as output. Check
              your Anthropic Console for the actual bill.
            </p>
            {records.length > 0 &&
              (confirmClear ? (
                <span className="flex items-center gap-2">
                  Delete all {n(records.length)} logged calls?
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      clearUsage();
                      setConfirmClear(false);
                    }}
                  >
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
                  <Trash2 /> Clear log
                </Button>
              ))}
          </footer>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, meter, tone = 'ok' }: { label: string; value: string; sub: string; meter?: number; tone?: 'ok' | 'near' | 'over' }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {meter !== undefined && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className={cn('h-full rounded-full', tone === 'over' ? 'bg-destructive' : tone === 'near' ? 'bg-amber-500' : 'bg-primary')}
            style={{ width: `${meter * 100}%` }}
          />
        </div>
      )}
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function Breakdown({ title, rows, total }: { title: string; rows: { key: string; totals: Totals }[]; total: number }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">No calls.</p>}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{r.key}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {n(r.totals.calls)} · avg {formatCost(r.totals.calls ? r.totals.cost / r.totals.calls : 0)}
              </span>
              <span className="w-16 text-right font-medium tabular-nums">{formatCost(r.totals.cost)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="h-full rounded-full bg-primary" style={{ width: `${total > 0 ? (r.totals.cost / total) * 100 : 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TokenSummary({ t }: { t: Totals }) {
  const items = [
    ['Input', t.tokens.input],
    ['Cache write', t.tokens.cacheWrite5m + t.tokens.cacheWrite1h],
    ['Cache read', t.tokens.cacheRead],
    ['Output', t.tokens.output],
  ] as const;
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <span className="text-muted-foreground">Tokens:</span>
      {items.map(([k, v]) => (
        <span key={k}>
          <span className="text-muted-foreground">{k}</span> <span className="tabular-nums">{n(v)}</span>
        </span>
      ))}
      {t.unpriced > 0 && <span className="text-amber-600">{t.unpriced} calls used a model with no known price (shown as ?).</span>}
    </div>
  );
}

const STATUS_TEXT: Record<UsageRecord['status'], string> = {
  done: '',
  stopped: 'Stopped',
  error: 'Failed',
  refused: 'Declined',
  'cut off': 'Cut off',
};

function CallRow({ r }: { r: UsageRecord }) {
  const at = new Date(r.at);
  const fallback = r.model !== r.requested && !r.model.startsWith(r.requested);
  return (
    <tr className="border-t align-top">
      <td className="px-3 py-1.5 whitespace-nowrap tabular-nums" title={at.toString()}>
        {at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} {at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
      </td>
      <td className="px-3 py-1.5">
        <div className="whitespace-nowrap">{r.feature}</div>
        {(r.stage || r.status !== 'done') && (
          <div className="text-xs text-muted-foreground">
            {[r.stage, STATUS_TEXT[r.status]].filter(Boolean).join(' · ')}
          </div>
        )}
      </td>
      <td className="max-w-40 truncate px-3 py-1.5" title={r.project}>
        {r.project || '—'}
      </td>
      <td className="px-3 py-1.5 whitespace-nowrap" title={r.parts ? r.parts.map((p) => `${modelLabel(p.model)}: ${formatCost(p.cost)}`).join(', ') : r.model}>
        {modelLabel(r.model)}
        {fallback && <div className="text-xs text-muted-foreground">fallback from {modelLabel(r.requested)}</div>}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{(r.durationMs / 1000).toFixed(1)}s</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{n(r.tokens.input)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{n(r.tokens.cacheWrite5m + r.tokens.cacheWrite1h)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{n(r.tokens.cacheRead)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
        {n(r.tokens.output)}
        {r.thinking ? <span className="text-muted-foreground"> ({n(r.thinking)})</span> : null}
      </td>
      <td className="px-3 py-1.5 text-right font-medium tabular-nums">{formatCost(r.cost)}</td>
    </tr>
  );
}
