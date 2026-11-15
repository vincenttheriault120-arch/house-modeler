import { useState } from 'react';
import { LengthInput } from '../LengthInput';
import type { FloorParams } from '../model/floor';
import type { FloorStep, Project } from '../model/types';
import { formatLength, type UnitSystem } from '../units';
import type { PlanMeta } from './store';
import { FLOOR_ROWS, floorSuggestionToDraft, suggestFloor, type FloorSuggestion } from './suggest';
import { ReviewRow, SuggestFrame } from './SuggestFrame';

interface Props {
  apiKey: string;
  plans: PlanMeta[];
  project: Project;
  step: FloorStep;
  units: UnitSystem;
  onApply: (params: FloorParams) => void;
  onClose: () => void;
}

const dirLabel = (d: 'x' | 'y') => (d === 'y' ? 'Front to back' : 'Left to right');

/** Ask Claude for the floor framing from the plans, then review before applying. */
export function FloorSuggestDialog({ apiKey, plans, project, step, units, onApply, onClose }: Props) {
  const [s, setS] = useState<FloorSuggestion | null>(null);
  const [draft, setDraft] = useState<FloorParams>(step.params);
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const cur = step.params;

  async function run(picked: PlanMeta[], signal: AbortSignal) {
    const out = await suggestFloor({ apiKey, plans: picked, project, step, units, signal });
    const d = floorSuggestionToDraft(out, cur, units);
    setS(out);
    setDraft(d.params);
    setInclude(d.include);
  }

  function apply() {
    const out: FloorParams = { ...cur };
    if (include.joistDirection) out.joistDirection = draft.joistDirection;
    if (include.beam) out.beam = draft.beam;
    for (const r of FLOOR_ROWS) if (include[r.key]) out[r.key] = draft[r.key];
    onApply(out);
  }

  const tick = (k: string) => (v: boolean) => setInclude({ ...include, [k]: v });

  return (
    <SuggestFrame
      title={`Suggest “${step.label}” from plans`}
      plans={plans}
      relevant={['section', 'basement', 'ground-floor']}
      onRun={run}
      count={Object.values(include).filter(Boolean).length}
      onApply={apply}
      onClose={onClose}
      review={
        s && (
          <div className="grid gap-4">
            <p className="rounded-md bg-muted px-3 py-2 text-sm leading-relaxed">{s.summary}</p>
            <ReviewRow
              label="Joist direction"
              current={dirLabel(cur.joistDirection)}
              include={!!include.joistDirection}
              onInclude={tick('joistDirection')}
              source={s.joist_direction_source}
              confident
            >
              <span className="text-sm">{dirLabel(draft.joistDirection)}</span>
            </ReviewRow>
            <ReviewRow
              label="Beam"
              current={cur.beam ? 'Yes' : 'No'}
              include={!!include.beam}
              onInclude={tick('beam')}
              source={s.beam_source}
              confident
            >
              <span className="text-sm">{draft.beam ? 'Yes' : 'No'}</span>
            </ReviewRow>
            {FLOOR_ROWS.map((r) => {
              const v = s[r.field] as FloorSuggestion['joist_depth'];
              return (
                <ReviewRow
                  key={r.key}
                  label={r.label}
                  current={formatLength(cur[r.key], units)}
                  include={!!include[r.key]}
                  onInclude={tick(r.key)}
                  source={v.source}
                  confident={v.confident}
                >
                  <LengthInput
                    label=""
                    ariaLabel={`Suggested ${r.label}`}
                    valueMm={draft[r.key]}
                    units={units}
                    onChange={(mm) => setDraft({ ...draft, [r.key]: mm })}
                  />
                </ReviewRow>
              );
            })}
          </div>
        )
      }
    />
  );
}
