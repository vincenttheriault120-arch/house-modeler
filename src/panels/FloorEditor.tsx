import { TriangleAlert } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Segmented } from '@/components/Segmented';
import { LengthInput } from '../LengthInput';
import { Button } from '@/components/ui/button';
import { floorLevels, validateFloor, type FloorParams } from '../model/floor';
import { LEVEL_TOLERANCE, sortLevels } from '../model/levels';
import { supportOf } from '../model/project';
import type { FloorStep, Project } from '../model/types';
import { formatLength, type UnitSystem } from '../units';

interface Props {
  project: Project;
  step: FloorStep;
  units: UnitSystem;
  onChange: (params: FloorParams) => void;
  /** Move the foundation's top by this much (to make the floor meet its level). */
  onRaiseSupport: (byMm: number) => void;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-2 gap-3">{children}</div>;

export function FloorEditor({ project, step, units, onChange, onRaiseSupport }: Props) {
  const p = step.params;
  const set = (patch: Partial<FloorParams>) => onChange({ ...p, ...patch });
  const support = supportOf(project, step);
  const foundations = project.steps.filter((s) => s.kind === 'foundation');
  const errors = validateFloor(p, support);
  const lv = support ? floorLevels(p, support) : null;
  const f = (mm: number) => formatLength(mm, units);
  const target = project.levels.find((l) => l.id === p.levelId);
  const supportStep = project.steps.find((s) => s.id === p.supportId);
  const supportLevel =
    supportStep?.kind === 'foundation' ? project.levels.find((l) => l.id === supportStep.params.topLevelId) : undefined;
  const diff = target && lv ? target.elevation - lv.floorTop : 0;
  const off = Math.abs(diff) > LEVEL_TOLERANCE;

  return (
    <div className="grid gap-5">
      <Section title="Sits on">
        <Select value={support ? p.supportId : ''} onValueChange={(v) => set({ supportId: v })}>
          <SelectTrigger className="w-full" aria-label="Foundation this floor sits on">
            <SelectValue placeholder="Pick a foundation" />
          </SelectTrigger>
          <SelectContent>
            {foundations.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {lv && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-lg bg-muted px-3 py-2 text-xs tabular-nums">
            <dt className="text-muted-foreground">Top of foundation wall</dt>
            <dd>{f(lv.sillBottom)}</dd>
            <dt className="text-muted-foreground">Underside of joists</dt>
            <dd>{f(lv.joistBottom)}</dd>
            <dt className="font-medium">Top of subfloor (ground floor)</dt>
            <dd className="font-medium">{f(lv.floorTop)}</dd>
          </dl>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          The floor takes its outline and height from the foundation. Elevations are from finished grade (0).
        </p>
        {project.levels.length > 0 && (
          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Should finish at level</span>
            <Select value={target?.id ?? 'none'} onValueChange={(v) => set({ levelId: v === 'none' ? undefined : v })}>
              <SelectTrigger size="sm" className="w-full" aria-label="Level this floor should finish at">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No check</SelectItem>
                {sortLevels(project.levels).map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name} · {f(l.elevation)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {target && lv && !off && <p className="text-xs text-success">Matches “{target.name}”.</p>}
            {target && lv && off && (
              <div className="grid gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
                <p className="flex gap-2">
                  <TriangleAlert className="size-4 shrink-0" />
                  <span>
                    This floor finishes at {f(lv.floorTop)}, but “{target.name}” is at {f(target.elevation)} (
                    {f(Math.abs(diff))} {diff > 0 ? 'higher' : 'lower'}). Check the joist depth, the foundation top, or the level.
                  </span>
                </p>
                <Button size="sm" variant="outline" className="h-auto justify-self-start py-1.5 text-left whitespace-normal" onClick={() => onRaiseSupport(diff)}>
                  {diff > 0 ? 'Raise' : 'Lower'} {supportLevel ? `the “${supportLevel.name}” level` : 'the foundation'} by {f(Math.abs(diff))}
                </Button>
              </div>
            )}
          </div>
        )}
      </Section>

      <Separator />

      <Section title="Joists" hint="Untick “Show subfloors” under View (left) to see them.">
        <Segmented<'x' | 'y'>
          label="Joist direction"
          className="w-full"
          value={p.joistDirection}
          onChange={(d) => set({ joistDirection: d })}
          options={[
            { value: 'y', label: '↕ Front to back' },
            { value: 'x', label: '↔ Left to right' },
          ]}
        />
        <Grid>
          <LengthInput label="Depth" hint={'2x10 = 9 1/4"'} valueMm={p.joistDepth} units={units} min={1} onChange={(mm) => set({ joistDepth: mm })} />
          <LengthInput label="Width" valueMm={p.joistWidth} units={units} min={1} onChange={(mm) => set({ joistWidth: mm })} />
          <LengthInput label="Spacing (c/c)" valueMm={p.joistSpacing} units={units} min={1} onChange={(mm) => set({ joistSpacing: mm })} />
          <LengthInput label="Rim thickness" valueMm={p.rimThickness} units={units} min={0} onChange={(mm) => set({ rimThickness: mm })} />
        </Grid>
      </Section>

      <Separator />

      <Section title="Beam and posts" hint="A dropped beam under the joists, across the middle of the span, on steel posts. Basement only.">
        <Segmented<'yes' | 'no'>
          label="Beam"
          className="w-full"
          value={p.beam ? 'yes' : 'no'}
          onChange={(v) => set({ beam: v === 'yes' })}
          options={[
            { value: 'yes', label: 'Beam' },
            { value: 'no', label: 'No beam' },
          ]}
        />
        {p.beam && (
          <Grid>
            <LengthInput label="Width" hint={'3-ply 2x10 = 4 1/2"'} valueMm={p.beamWidth} units={units} min={1} onChange={(mm) => set({ beamWidth: mm })} />
            <LengthInput label="Depth" valueMm={p.beamDepth} units={units} min={1} onChange={(mm) => set({ beamDepth: mm })} />
            <LengthInput label="Position" hint="From outside face; 0 = middle" valueMm={p.beamOffset} units={units} min={0} onChange={(mm) => set({ beamOffset: mm })} />
            <LengthInput label="Post spacing" hint="0 = no posts" valueMm={p.postSpacing} units={units} min={0} onChange={(mm) => set({ postSpacing: mm })} />
            <LengthInput label="Post size" valueMm={p.postSize} units={units} min={1} onChange={(mm) => set({ postSize: mm })} />
          </Grid>
        )}
      </Section>

      <Separator />

      <Section title="Sill plate and subfloor">
        <Grid>
          <LengthInput label="Sill width" hint={'2x6 = 5 1/2"'} valueMm={p.sillWidth} units={units} min={0} onChange={(mm) => set({ sillWidth: mm })} />
          <LengthInput label="Sill thickness" valueMm={p.sillThickness} units={units} min={0} onChange={(mm) => set({ sillThickness: mm })} />
          <LengthInput label="Subfloor" hint={'3/4" plywood'} valueMm={p.subfloorThickness} units={units} min={0} onChange={(mm) => set({ subfloorThickness: mm })} />
        </Grid>
      </Section>

      {errors.length > 0 && (
        <div className="grid gap-1 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
          {errors.map((e) => (
            <p key={e} className="flex items-center gap-1.5">
              <TriangleAlert className="size-3.5" /> {e}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
