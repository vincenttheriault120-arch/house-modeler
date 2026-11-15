import { useState } from 'react';
import { LengthInput } from '../LengthInput';
import { LEVEL_KINDS, type Level } from '../model/levels';
import { newId } from '../model/project';
import type { Project } from '../model/types';
import { formatLength, type UnitSystem } from '../units';
import type { PlanMeta } from './store';
import { levelsSuggestionToDraft, suggestLevels } from './suggest';
import { ReviewRow, SuggestFrame } from './SuggestFrame';

interface Props {
  apiKey: string;
  plans: PlanMeta[];
  project: Project;
  units: UnitSystem;
  onApply: (levels: Level[]) => void;
  onClose: () => void;
}

type Draft = ReturnType<typeof levelsSuggestionToDraft>;

/** Claude reads the elevations and sections and proposes the levels; you review them. */
export function LevelsSuggestDialog({ apiKey, plans, project, units, onApply, onClose }: Props) {
  const [summary, setSummary] = useState<string | null>(null);
  const [rows, setRows] = useState<Draft>([]);

  async function run(picked: PlanMeta[], signal: AbortSignal) {
    const s = await suggestLevels({ apiKey, plans: picked, project, units, signal });
    setRows(levelsSuggestionToDraft(s, project.levels, units, newId));
    setSummary(s.summary);
  }

  function apply() {
    const chosen = rows.filter((r) => r.include).map((r) => r.level);
    const ids = new Set(chosen.map((l) => l.id));
    onApply([...project.levels.filter((l) => !ids.has(l.id)), ...chosen]);
  }

  const update = (i: number, patch: Partial<Draft[number]>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const kindLabel = (k: string) => LEVEL_KINDS.find((x) => x.value === k)?.label ?? k;

  return (
    <SuggestFrame
      title="Suggest the levels from your elevations"
      plans={plans}
      relevant={['elevation-front', 'elevation-back', 'elevation-left', 'elevation-right', 'section']}
      onRun={run}
      count={rows.filter((r) => r.include).length}
      onApply={apply}
      onClose={onClose}
      review={
        summary !== null && (
          <div className="grid gap-4">
            <p className="rounded-md bg-muted px-3 py-2 text-sm leading-relaxed">{summary}</p>
            {rows.length === 0 && <p className="text-sm text-muted-foreground">No heights could be read from these drawings.</p>}
            {rows.map((r, i) => (
              <ReviewRow
                key={r.level.id}
                label={r.level.name}
                current={r.existing ? formatLength(r.existing.elevation, units) : `new · ${kindLabel(r.level.kind)}`}
                include={r.include}
                onInclude={(v) => update(i, { include: v })}
                source={r.source}
                confident={r.confident}
              >
                <LengthInput
                  label=""
                  ariaLabel={`Suggested ${r.level.name}`}
                  valueMm={r.level.elevation}
                  units={units}
                  onChange={(mm) => update(i, { level: { ...r.level, elevation: mm } })}
                />
              </ReviewRow>
            ))}
          </div>
        )
      }
    />
  );
}
