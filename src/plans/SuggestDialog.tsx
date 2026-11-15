import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Loader2, Sparkles, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { explainError } from '../chat/claude';
import { LengthInput } from '../LengthInput';
import type { FoundationParams } from '../model/foundation';
import type { FoundationStep, Project } from '../model/types';
import { OutlinePreview } from '../panels/OutlinePreview';
import { formatLength, type UnitSystem } from '../units';
import { PLAN_KINDS, type PlanKind, type PlanMeta } from './store';
import { LENGTH_ROWS, suggestFoundation, suggestionToDraft, type FoundationSuggestion, type LengthKey } from './suggest';

interface Props {
  apiKey: string;
  plans: PlanMeta[];
  project: Project;
  step: FoundationStep;
  units: UnitSystem;
  onApply: (params: FoundationParams) => void;
  onClose: () => void;
}

const RELEVANT: PlanKind[] = ['basement', 'section'];

interface Row {
  id: string;
  label: string;
  current: string;
  include: boolean;
  source: string;
  confident: boolean;
}

/** Ask Claude for foundation measurements from the plans, then review them before applying. */
export function SuggestDialog({ apiKey, plans, project, step, units, onApply, onClose }: Props) {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(plans.filter((p) => RELEVANT.includes(p.kind)).map((p) => p.id)),
  );
  const [phase, setPhase] = useState<'pick' | 'loading' | 'review'>('pick');
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<FoundationSuggestion | null>(null);
  const [draft, setDraft] = useState<FoundationParams>(step.params);
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function run() {
    setPhase('loading');
    setError(null);
    abort.current = new AbortController();
    try {
      const s = await suggestFoundation({
        apiKey,
        plans: plans.filter((p) => picked.has(p.id)),
        project,
        step,
        units,
        signal: abort.current.signal,
      });
      const { params: next, include: inc } = suggestionToDraft(s, step.params, units);
      setSuggestion(s);
      setDraft(next);
      setInclude(inc);
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error && !(e as { status?: number }).status ? e.message : explainError(e));
      setPhase('pick');
    }
  }

  function apply() {
    const p = step.params;
    const out: FoundationParams = { ...p, origin: { ...p.origin } };
    if (include.type) out.type = draft.type;
    if (include.runs) out.runs = draft.runs;
    if (include.origin_x) out.origin.x = draft.origin.x;
    if (include.origin_y) out.origin.y = draft.origin.y;
    for (const row of LENGTH_ROWS) if (include[row.key]) out[row.key] = draft[row.key];
    onApply(out);
    onClose();
  }

  const lengthRows: Row[] = useMemo(() => {
    if (!suggestion) return [];
    return LENGTH_ROWS.map((r) => {
      const v = suggestion[r.field] as FoundationSuggestion['wall_thickness'];
      return {
        id: r.key,
        label: r.label,
        current: formatLength(step.params[r.key], units),
        include: !!include[r.key],
        source: v.source,
        confident: v.confident,
      };
    });
  }, [suggestion, include, step.params, units]);

  const count = Object.values(include).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Suggest from plans">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Sparkles className="size-4" />
          <span className="font-semibold">Suggest “{step.label}” from plans</span>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" className="size-8" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {phase === 'pick' && (
            <div className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                Pick the plans Claude should read. Nothing changes until you review and accept the suggestions.
              </p>
              <ul className="grid gap-1.5">
                {plans.map((p) => (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 hover:bg-accent">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={picked.has(p.id)}
                        onChange={(e) => {
                          const s = new Set(picked);
                          if (e.target.checked) s.add(p.id);
                          else s.delete(p.id);
                          setPicked(s);
                        }}
                      />
                      <FileText className="size-4 text-muted-foreground" />
                      <span className="text-sm">{p.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{PLAN_KINDS.find((k) => k.value === p.kind)?.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            </div>
          )}

          {phase === 'loading' && (
            <div className="grid place-items-center gap-3 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
              Claude is reading {picked.size} plan{picked.size === 1 ? '' : 's'}… this can take a minute.
            </div>
          )}

          {phase === 'review' && suggestion && (
            <div className="grid gap-4">
              <p className="rounded-md bg-muted px-3 py-2 text-sm leading-relaxed">{suggestion.summary}</p>

              <ReviewRow
                label="Type"
                current={step.params.type === 'basement' ? 'Basement' : 'Slab on grade'}
                include={!!include.type}
                onInclude={(v) => setInclude({ ...include, type: v })}
                source={suggestion.type_source}
                confident
              >
                <span className="text-sm">{draft.type === 'basement' ? 'Basement' : 'Slab on grade'}</span>
              </ReviewRow>

              <ReviewRow
                label="Outline"
                current={`${step.params.runs.length} sides`}
                include={!!include.runs}
                onInclude={(v) => setInclude({ ...include, runs: v })}
                source={suggestion.runs_source}
                confident={suggestion.runs_confident}
              >
                <div className="grid gap-2">
                  <OutlinePreview runs={draft.runs} origin={{ x: 0, y: 0 }} />
                  <ol className="grid gap-0.5 text-xs tabular-nums text-muted-foreground">
                    {draft.runs.map((r, i) => (
                      <li key={i}>
                        {i + 1}. {r.dir} {formatLength(r.length, units)}
                      </li>
                    ))}
                  </ol>
                </div>
              </ReviewRow>

              {(['x', 'y'] as const).map((axis) => {
                const field = axis === 'x' ? 'origin_x' : 'origin_y';
                return (
                  <ReviewRow
                    key={axis}
                    label={axis === 'x' ? 'Start X' : 'Start Y'}
                    current={formatLength(step.params.origin[axis], units)}
                    include={!!include[field]}
                    onInclude={(v) => setInclude({ ...include, [field]: v })}
                    source={suggestion[field].source}
                    confident={suggestion[field].confident}
                  >
                    <LengthInput
                      label=""
                      ariaLabel={`Suggested start ${axis}`}
                      valueMm={draft.origin[axis]}
                      units={units}
                      onChange={(mm) => setDraft({ ...draft, origin: { ...draft.origin, [axis]: mm } })}
                    />
                  </ReviewRow>
                );
              })}

              {lengthRows.map((r) => (
                <ReviewRow
                  key={r.id}
                  label={r.label}
                  current={r.current}
                  include={r.include}
                  onInclude={(v) => setInclude({ ...include, [r.id]: v })}
                  source={r.source}
                  confident={r.confident}
                >
                  <LengthInput
                    label=""
                    ariaLabel={`Suggested ${r.label}`}
                    valueMm={draft[r.id as LengthKey]}
                    units={units}
                    onChange={(mm) => setDraft({ ...draft, [r.id]: mm })}
                  />
                </ReviewRow>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t px-4 py-3">
          {phase === 'review' && <span className="text-xs text-muted-foreground">{count} change{count === 1 ? '' : 's'} selected</span>}
          <div className="flex-1" />
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {phase === 'pick' && (
            <Button onClick={run} disabled={picked.size === 0}>
              <Sparkles /> Suggest
            </Button>
          )}
          {phase === 'review' && (
            <Button onClick={apply} disabled={count === 0}>
              Apply selected
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  current,
  include,
  onInclude,
  source,
  confident,
  children,
}: {
  label: string;
  current: string;
  include: boolean;
  onInclude: (v: boolean) => void;
  source: string;
  confident: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('grid gap-2 rounded-lg border p-3 sm:grid-cols-[1.25rem_8rem_1fr]', !include && 'opacity-70')}>
      <input
        type="checkbox"
        className="mt-1 size-4 accent-primary"
        checked={include}
        onChange={(e) => onInclude(e.target.checked)}
        aria-label={`Apply ${label}`}
      />
      <div className="grid content-start gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">Now: {current}</span>
      </div>
      <div className="grid gap-1.5">
        {children}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant={confident ? 'secondary' : 'outline'}>{confident ? 'From plan' : 'Estimate'}</Badge>
          <span>{source}</span>
        </div>
      </div>
    </div>
  );
}
