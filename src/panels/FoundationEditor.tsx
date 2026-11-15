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
    <div className="editor">
      <section>
        <h3>Type</h3>
        <div className="segmented full" role="group" aria-label="Foundation type">
          {(
            [
              ['basement', 'Basement'],
              ['slab-on-grade', 'Slab on grade'],
            ] as [FoundationType, string][]
          ).map(([t, label]) => (
            <button key={t} className={p.type === t ? 'active' : undefined} aria-pressed={p.type === t} onClick={() => onChange(applyFoundationType(p, t))}>
              {label}
            </button>
          ))}
        </div>
        <p className="help">
          {isSlab
            ? 'Concrete slab at ground level with a frost wall around the edge (no basement), e.g. a garage. Set depth to 0 for no frost wall.'
            : 'Full-height walls with the floor slab poured at the bottom.'}
        </p>
      </section>

      <section>
        <h3>Outline (outside face of walls)</h3>
        <p className="help">
          Walk around the outside of the foundation, one side at a time, like reading the plan's
          dimensions. Start at the black dot.
        </p>
        <OutlinePreview runs={p.runs} origin={p.origin} />
        <ol className="runs">
          {p.runs.map((r, i) => (
            <li key={i}>
              <span className="run-num">{i + 1}</span>
              <select value={r.dir} onChange={(e) => setRun(i, { dir: e.target.value as Direction })} aria-label={`Side ${i + 1} direction`}>
                {DIRS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              <LengthInput label="" ariaLabel={`Side ${i + 1} length`} valueMm={r.length} units={units} min={1} onChange={(mm) => setRun(i, { length: mm })} />
              <button
                className="icon"
                title="Remove this side"
                aria-label={`Remove side ${i + 1}`}
                onClick={() => set({ runs: p.runs.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
        <div className="row">
          <button onClick={addRun}>+ Add side</button>
          {isOpen && <button onClick={closeOutline}>Close the outline</button>}
        </div>
        {isOpen ? (
          <p className="warn">
            The outline doesn't close: it's off by {formatLength(Math.abs(gap.x), units)} sideways and{' '}
            {formatLength(Math.abs(gap.y), units)} up/down. It's drawn closed anyway (red dashed line).
          </p>
        ) : (
          <p className="ok">✓ Outline closes.</p>
        )}
        <details>
          <summary>Position on site</summary>
          <div className="grid2">
            <LengthInput label="Start X (right)" valueMm={p.origin.x} units={units} onChange={(x) => set({ origin: { ...p.origin, x } })} />
            <LengthInput label="Start Y (up)" valueMm={p.origin.y} units={units} onChange={(y) => set({ origin: { ...p.origin, y } })} />
          </div>
        </details>
      </section>

      <section>
        <h3>{isSlab ? 'Frost walls' : 'Walls'}</h3>
        <div className="grid2">
          <LengthInput label="Thickness" valueMm={p.wallThickness} units={units} min={1} onChange={(v) => set({ wallThickness: v })} />
          <LengthInput label={isSlab ? 'Depth (0 = none)' : 'Height'} valueMm={p.wallHeight} units={units} min={0} onChange={(v) => set({ wallHeight: v })} />
          <LengthInput label={isSlab ? 'Top of slab (grade = 0)' : 'Top elevation (grade = 0)'} valueMm={p.topElevation} units={units} onChange={(v) => set({ topElevation: v })} />
          <div className="field">
            <span className="field-label">Bottom elevation</span>
            <span className="readout">{formatLength(p.topElevation - p.wallHeight, units)}</span>
          </div>
        </div>
      </section>

      <section>
        <h3>Footing</h3>
        <div className="grid2">
          <LengthInput label="Width (0 = none)" valueMm={p.footingWidth} units={units} min={0} onChange={(v) => set({ footingWidth: v })} />
          <LengthInput label="Thickness" valueMm={p.footingThickness} units={units} min={0} onChange={(v) => set({ footingThickness: v })} />
        </div>
      </section>

      <section>
        <h3>Floor slab</h3>
        <LengthInput label="Thickness (0 = no slab)" valueMm={p.slabThickness} units={units} min={0} onChange={(v) => set({ slabThickness: v })} />
      </section>

      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
