import { useMemo, useState } from 'react';
import { LengthInput } from '../LengthInput';
import type { FoundationParams } from '../model/foundation';
import type { FoundationStep, Project } from '../model/types';
import { OutlinePreview } from '../panels/OutlinePreview';
import { formatLength, type UnitSystem } from '../units';
import type { PlanKind, PlanMeta } from './store';
import { ReviewRow, SuggestFrame } from './SuggestFrame';
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
  const [suggestion, setSuggestion] = useState<FoundationSuggestion | null>(null);
  const [draft, setDraft] = useState<FoundationParams>(step.params);
  const [include, setInclude] = useState<Record<string, boolean>>({});

  async function run(picked: PlanMeta[], signal: AbortSignal) {
    const s = await suggestFoundation({ apiKey, plans: picked, project, step, units, signal });
    const { params: next, include: inc } = suggestionToDraft(s, step.params, units);
    setSuggestion(s);
    setDraft(next);
    setInclude(inc);
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
    <SuggestFrame
      title={`Suggest “${step.label}” from plans`}
      plans={plans}
      relevant={RELEVANT}
      onRun={run}
      count={count}
      onApply={apply}
      onClose={onClose}
      review={
        suggestion && (
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
        )
      }
    />
  );
}
