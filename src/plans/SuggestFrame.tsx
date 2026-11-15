import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Sparkles, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { explainError } from '../chat/claude';
import { PLAN_KINDS, type PlanKind, type PlanMeta } from './store';

interface Props {
  title: string;
  plans: PlanMeta[];
  /** Plan kinds ticked by default. */
  relevant: PlanKind[];
  /** Ask Claude; resolves once the review content is ready. */
  onRun: (plans: PlanMeta[], signal: AbortSignal) => Promise<void>;
  /** Shown once onRun resolved. */
  review: React.ReactNode;
  count: number;
  onApply: () => void;
  onClose: () => void;
}

/** The shared window for "Suggest from plans": pick plans, wait, review, apply. */
export function SuggestFrame({ title, plans, relevant, onRun, review, count, onApply, onClose }: Props) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(plans.filter((p) => relevant.includes(p.kind)).map((p) => p.id)));
  const [phase, setPhase] = useState<'pick' | 'loading' | 'review'>('pick');
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function run() {
    setPhase('loading');
    setError(null);
    abort.current = new AbortController();
    try {
      await onRun(
        plans.filter((p) => picked.has(p.id)),
        abort.current.signal,
      );
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error && !(e as { status?: number }).status ? e.message : explainError(e));
      setPhase('pick');
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Suggest from plans">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Sparkles className="size-4" />
          <span className="font-semibold">{title}</span>
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

          {phase === 'review' && review}
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
            <Button
              onClick={() => {
                onApply();
                onClose();
              }}
              disabled={count === 0}
            >
              Apply selected
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReviewRow({
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
