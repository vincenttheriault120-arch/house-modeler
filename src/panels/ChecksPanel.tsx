import { useState } from 'react';
import { Check as CheckIcon, Circle, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { LengthInput } from '../LengthInput';
import { measureState, summarize, type Check, type Measure, type MeasureGroup, type MeasureState } from '../model/checks';
import type { PlanMeta } from '../plans/store';
import { formatLength, type UnitSystem } from '../units';

interface Props {
  measures: Measure[];
  checks: Record<string, Check>;
  plans: PlanMeta[];
  units: UnitSystem;
  /** The measurement being checked, also highlighted on the model. */
  activeId: string | null;
  /** The plan laid over the model right now, offered as the source. */
  comparePlanId: string | null;
  onActivate: (id: string | null) => void;
  onCheck: (id: string, check: Check | null) => void;
}

const GROUPS: { id: MeasureGroup; title: string; empty: string }[] = [
  { id: 'footprint', title: 'Footprint', empty: 'Add a foundation outline to check its sides.' },
  { id: 'levels', title: 'Levels', empty: 'Set the levels to check them.' },
];

export function value(m: Measure, units: UnitSystem) {
  if (m.group === 'footprint') return formatLength(m.value, units);
  return `${m.value > 0 ? '+' : m.value < 0 ? '−' : ''}${formatLength(Math.abs(m.value), units)}`;
}

export const STATE_LABEL: Record<MeasureState, string> = {
  matches: 'Matches',
  differs: 'Differs',
  changed: 'Changed since checked',
  unchecked: 'Not checked',
};

export function StateIcon({ state, className }: { state: MeasureState; className?: string }) {
  if (state === 'matches') return <CheckIcon className={cn('size-4 text-success', className)} aria-label="Matches" />;
  if (state === 'differs') return <X className={cn('size-4 text-destructive', className)} aria-label="Differs" />;
  if (state === 'changed') return <RefreshCw className={cn('size-3.5 text-amber-600', className)} aria-label="Changed since checked" />;
  return <Circle className={cn('size-4 text-muted-foreground', className)} aria-label="Not checked" />;
}

/** Every measurement of the exterior, each marked against the plans. */
export function ChecksPanel(props: Props) {
  const { measures, checks, units, activeId, onActivate } = props;
  const total = summarize(measures, checks);
  return (
    <div className="grid gap-3">
      <p className="text-xs leading-snug text-muted-foreground">
        {total.total === 0
          ? 'Nothing to check yet.'
          : `${total.matches + total.differs} of ${total.total} checked${total.differs ? ` · ${total.differs} differ${total.differs === 1 ? 's' : ''}` : ''}. Click a measurement, here or on the model, to mark it.`}
      </p>
      {total.total > 0 && (
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="bg-success" style={{ width: `${(100 * total.matches) / total.total}%` }} />
          <div className="bg-destructive" style={{ width: `${(100 * total.differs) / total.total}%` }} />
        </div>
      )}
      {GROUPS.map((g) => {
        const list = measures.filter((m) => m.group === g.id);
        const s = summarize(list, checks);
        return (
          <div key={g.id} className="grid gap-1">
            <div className="flex items-baseline justify-between text-xs font-medium">
              <span>{g.title}</span>
              {list.length > 0 && (
                <span className={cn('tabular-nums', s.open === 0 && s.differs === 0 ? 'text-success' : 'text-muted-foreground')}>
                  {s.matches + s.differs}/{s.total}
                </span>
              )}
            </div>
            {list.length === 0 ? (
              <p className="text-xs text-muted-foreground">{g.empty}</p>
            ) : (
              <ul className="grid">
                {list.map((m) => {
                  const state = measureState(m, checks[m.id]);
                  const active = m.id === activeId;
                  return (
                    <li key={m.id} className={cn('rounded-md', active && 'bg-accent')}>
                      <button
                        className="grid w-full grid-cols-[1rem_1fr_auto] items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
                        aria-expanded={active}
                        onClick={() => onActivate(active ? null : m.id)}
                      >
                        <StateIcon state={state} />
                        <span className="truncate">{m.label}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{value(m, units)}</span>
                      </button>
                      {active && <CheckEditor key={m.id} measure={m} state={state} {...props} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CheckEditor({ measure: m, state, checks, plans, units, comparePlanId, onCheck }: Props & { measure: Measure; state: MeasureState }) {
  const check = checks[m.id];
  const [planValue, setPlanValue] = useState(check?.plan ?? m.value);
  const [planId, setPlanId] = useState(check?.planId ?? comparePlanId ?? '');
  const [note, setNote] = useState(check?.note ?? '');
  const diff = planValue - m.value;

  function save(status: Check['status']) {
    onCheck(m.id, {
      status,
      model: m.value,
      ...(status === 'differs' ? { plan: planValue } : {}),
      ...(planId ? { planId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      at: Date.now(),
    });
  }

  return (
    <div className="grid gap-2 px-2 pt-1 pb-3 text-xs">
      <p className="text-muted-foreground">
        Model: <span className="font-medium text-foreground tabular-nums">{value(m, units)}</span>
        {state === 'changed' && check && (
          <>
            {' '}
            · was {formatLength(check.model, units)} when you checked it, so check it again.
          </>
        )}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" variant={state === 'matches' ? 'default' : 'outline'} onClick={() => save('matches')}>
          <CheckIcon /> Matches
        </Button>
        <Button
          size="sm"
          variant={state === 'differs' ? 'destructive' : 'outline'}
          onClick={() => save('differs')}
          disabled={Math.abs(diff) < 1}
          title={Math.abs(diff) < 1 ? 'Type the value on the plan first.' : undefined}
        >
          <X /> Differs
        </Button>
      </div>
      <LengthInput
        label={m.group === 'levels' ? 'On the plan (above grade)' : 'On the plan'}
        valueMm={planValue}
        units={units}
        onChange={(mm) => {
          setPlanValue(mm);
          // Already marked as differing: keep the saved plan value up to date.
          if (state === 'differs' && check && Math.abs(mm - m.value) >= 1) onCheck(m.id, { ...check, plan: mm, at: Date.now() });
        }}
        min={m.group === 'levels' ? undefined : 0}
        hint={Math.abs(diff) >= 1 ? `${diff > 0 ? 'Plan is longer by' : 'Plan is shorter by'} ${formatLength(Math.abs(diff), units)}` : 'Same as the model.'}
      />
      {plans.length > 0 && (
        <label className="grid gap-1">
          <span className="text-muted-foreground">Read on</span>
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          >
            <option value="">No plan named</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <Input className="h-8 text-sm" placeholder="Note (optional)" value={note} aria-label="Note" onChange={(e) => setNote(e.target.value)} />
      {check && (
        <button className="justify-self-start text-muted-foreground underline-offset-2 hover:underline" onClick={() => onCheck(m.id, null)}>
          Clear this check
        </button>
      )}
    </div>
  );
}
