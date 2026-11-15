import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LengthInput } from '../LengthInput';
import { sortLevels, typicalLevels, type Level } from '../model/levels';
import { newId } from '../model/project';
import type { Project } from '../model/types';
import type { UnitSystem } from '../units';

interface Props {
  project: Project;
  units: UnitSystem;
  onChange: (levels: Level[]) => void;
  onSuggest: () => void;
}

/** Count the steps that follow a level. */
function usage(project: Project, id: string): number {
  return project.steps.filter(
    (s) => (s.kind === 'foundation' && s.params.topLevelId === id) || (s.kind === 'floor' && s.params.levelId === id),
  ).length;
}

/** The house's key heights (grade = 0). Steps can follow them. */
export function LevelsSection({ project, units, onChange, onSuggest }: Props) {
  const levels = sortLevels(project.levels);
  const set = (id: string, patch: Partial<Level>) =>
    onChange(project.levels.map((l) => (l.id === id ? { ...l, ...patch, source: patch.elevation !== undefined ? 'Edited by you' : l.source } : l)));

  return (
    <div className="grid gap-2">
      {levels.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          The key heights of the house, from the elevations: top of foundation, each floor, the roof ridge. Set them
          first so every step starts at the right height.
        </p>
      ) : (
        <ol className="grid gap-1.5">
          {[...levels].reverse().map((l) => {
            const used = usage(project, l.id);
            return (
              <li key={l.id} className="grid grid-cols-[1fr_5.75rem_auto] items-start gap-1.5">
                <div className="grid min-w-0 gap-0.5">
                  <Input
                    className="h-8 text-sm"
                    value={l.name}
                    aria-label="Level name"
                    onChange={(e) => set(l.id, { name: e.target.value })}
                  />
                  {(l.source || used > 0) && (
                    <span className="truncate px-1 text-[11px] text-muted-foreground" title={l.source}>
                      {used > 0 && `${used} step${used > 1 ? 's' : ''} follow${used > 1 ? '' : 's'} this`}
                      {used > 0 && l.source && ' · '}
                      {l.source}
                    </span>
                  )}
                </div>
                <LengthInput label="" ariaLabel={`${l.name} elevation`} valueMm={l.elevation} units={units} onChange={(mm) => set(l.id, { elevation: mm })} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${l.name}`}
                  onClick={() => onChange(project.levels.filter((x) => x.id !== l.id))}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onSuggest}>
          <Sparkles /> Suggest from elevations
        </Button>
        {levels.length === 0 ? (
          <Button variant="ghost" size="sm" onClick={() => onChange(typicalLevels(newId))}>
            Start with typical
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange([...project.levels, { id: newId(), name: 'New level', kind: 'other', elevation: (levels.at(-1)?.elevation ?? 0) + 2438.4 }])
            }
          >
            <Plus /> Add level
          </Button>
        )}
      </div>
    </div>
  );
}
