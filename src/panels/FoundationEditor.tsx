import { CheckCircle2, Plus, TriangleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Segmented } from '@/components/Segmented';
import { LengthInput } from '../LengthInput';
import { closingGap, type Direction, type Run } from '../model/geometry';
import { applyFoundationType, validateFoundation, type FoundationParams, type FoundationType } from '../model/foundation';
import type { FoundationStep } from '../model/types';
import { formatLength, type UnitSystem } from '../units';
import { OutlinePreview } from './OutlinePreview';

interface Props {
  step: FoundationStep;
  units: UnitSystem;
  onChange: (params: FoundationParams) => void;
}

const DIRS: { value: Direction; label: string }[] = [
  { value: 'right', label: '→ Right' },
  { value: 'up', label: '↑ Up' },
  { value: 'left', label: '← Left' },
  { value: 'down', label: '↓ Down' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

export function FoundationEditor({ step, units, onChange }: Props) {
  const p = step.params;
  const set = (patch: Partial<FoundationParams>) => onChange({ ...p, ...patch });
  const setRun = (i: number, patch: Partial<Run>) =>
    set({ runs: p.runs.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const isSlab = p.type === 'slab-on-grade';
  const gap = closingGap(p.runs);
  const isOpen = Math.hypot(gap.x, gap.y) > 0.5;
  const errors = validateFoundation(p);

  function closeOutline() {
    const extra: Run[] = [];
    if (Math.abs(gap.x) > 0.5) extra.push({ dir: gap.x > 0 ? 'right' : 'left', length: Math.abs(gap.x) });
    if (Math.abs(gap.y) > 0.5) extra.push({ dir: gap.y > 0 ? 'up' : 'down', length: Math.abs(gap.y) });
    set({ runs: [...p.runs, ...extra] });
  }

  function addRun() {
    const last = p.runs[p.runs.length - 1];
    const order: Direction[] = ['right', 'up', 'left', 'down'];
    const dir = last ? order[(order.indexOf(last.dir) + 1) % 4] : 'right';
    set({ runs: [...p.runs, { dir, length: 10 * 304.8 }] });
  }

  return (
    <div className="grid gap-5">
      <Section title="Type">
        <Segmented<FoundationType>
          label="Foundation type"
          className="w-full"
          value={p.type}
          onChange={(t) => onChange(applyFoundationType(p, t))}
          options={[
            { value: 'basement', label: 'Basement' },
            { value: 'slab-on-grade', label: 'Slab on grade' },
          ]}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {isSlab
            ? 'Concrete slab at ground level with a frost wall around the edge (no basement), e.g. a garage. Set depth to 0 for no frost wall.'
            : 'Full-height walls with the floor slab poured at the bottom.'}
        </p>
      </Section>

      <Separator />

      <Section title="Outline (outside face of walls)">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Walk around the outside of the foundation, one side at a time, like reading the plan's dimensions. Start at
          the black dot.
        </p>
        <OutlinePreview runs={p.runs} origin={p.origin} />
        <ol className="grid gap-2">
          {p.runs.map((r, i) => (
            <li key={i} className="grid grid-cols-[1.25rem_6.5rem_1fr_auto] items-start gap-2">
              <span className="pt-2 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              <Select value={r.dir} onValueChange={(v) => setRun(i, { dir: v as Direction })}>
                <SelectTrigger size="sm" className="w-full" aria-label={`Side ${i + 1} direction`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIRS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <LengthInput
                label=""
                ariaLabel={`Side ${i + 1} length`}
                valueMm={r.length}
                units={units}
                min={1}
                onChange={(mm) => setRun(i, { length: mm })}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Remove side ${i + 1}`}
                onClick={() => set({ runs: p.runs.filter((_, j) => j !== i) })}
              >
                <X />
              </Button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={addRun}>
            <Plus /> Add side
          </Button>
          {isOpen && (
            <Button variant="outline" size="sm" onClick={closeOutline}>
              Close the outline
            </Button>
          )}
        </div>
        {isOpen ? (
          <p className="flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
            <TriangleAlert className="size-4 shrink-0" />
            <span>
              The outline doesn't close: it's off by {formatLength(Math.abs(gap.x), units)} sideways and{' '}
              {formatLength(Math.abs(gap.y), units)} up/down. It's drawn closed anyway (red dashed line).
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 className="size-3.5" /> Outline closes.
          </p>
        )}
        <Collapsible>
          <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            Position on site…
          </CollapsibleTrigger>
          <CollapsibleContent className="grid grid-cols-2 gap-3 pt-3">
            <LengthInput label="Start X (right)" valueMm={p.origin.x} units={units} onChange={(x) => set({ origin: { ...p.origin, x } })} />
            <LengthInput label="Start Y (up)" valueMm={p.origin.y} units={units} onChange={(y) => set({ origin: { ...p.origin, y } })} />
          </CollapsibleContent>
        </Collapsible>
      </Section>

      <Separator />

      <Section title={isSlab ? 'Frost walls' : 'Walls'}>
        <div className="grid grid-cols-2 gap-3">
          <LengthInput label="Thickness" valueMm={p.wallThickness} units={units} min={1} onChange={(v) => set({ wallThickness: v })} />
          <LengthInput label={isSlab ? 'Depth (0 = none)' : 'Height'} valueMm={p.wallHeight} units={units} min={0} onChange={(v) => set({ wallHeight: v })} />
          <LengthInput label={isSlab ? 'Top of slab (grade = 0)' : 'Top elevation (grade = 0)'} valueMm={p.topElevation} units={units} onChange={(v) => set({ topElevation: v })} />
          <div className="grid gap-1.5">
            <span className="text-xs text-muted-foreground">Bottom elevation</span>
            <span className="flex h-8 items-center text-sm tabular-nums">{formatLength(p.topElevation - p.wallHeight, units)}</span>
          </div>
        </div>
      </Section>

      <Separator />

      <Section title="Footing">
        <div className="grid grid-cols-2 gap-3">
          <LengthInput label="Width (0 = none)" valueMm={p.footingWidth} units={units} min={0} onChange={(v) => set({ footingWidth: v })} />
          <LengthInput label="Thickness" valueMm={p.footingThickness} units={units} min={0} onChange={(v) => set({ footingThickness: v })} />
        </div>
      </Section>

      <Separator />

      <Section title="Floor slab">
        <LengthInput label="Thickness (0 = no slab)" valueMm={p.slabThickness} units={units} min={0} onChange={(v) => set({ slabThickness: v })} />
      </Section>

      {errors.length > 0 && (
        <ul className="grid gap-1 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
