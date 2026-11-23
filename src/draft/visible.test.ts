import { describe, expect, it } from 'vitest';
import { measures } from './model';
import { visibleMeasures } from './DraftViewport';
import type { Block, ExteriorDraft } from './types';

const dim = (mm: number) => ({ mm, source: 'plan' as const });
const block = (id: string, base: number, height: number): Block => ({
  id,
  name: id,
  x: dim(0),
  y: dim(0),
  width: dim(6000),
  depth: dim(8000),
  base: dim(base),
  height: dim(height),
  roof: { type: 'flat', rise: dim(0), overhang: dim(0), ridge: 'x', low: 'back' },
});
const draft: ExteriorDraft = { summary: '', createdAt: 0, levels: [], openings: [], blocks: [block('ground', 0, 3000), block('upper', 3000, 2500)] };
const all = measures(draft);
const none = { activePart: null, activeMeasure: null, hoverMeasure: null };

describe('which measurements are drawn', () => {
  it('3D: nothing until a part is picked, then only that part', () => {
    expect(visibleMeasures(all, { in3d: true, ...none })).toEqual([]);
    const shown = visibleMeasures(all, { in3d: true, ...none, activePart: 'upper' });
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((m) => m.part === 'upper' || m.part === 'upper:roof')).toBe(true);
  });

  it('3D: a hovered row shows its line even with nothing picked', () => {
    expect(visibleMeasures(all, { in3d: true, ...none, hoverMeasure: 'ground.width' }).map((m) => m.id)).toEqual(['ground.width']);
  });

  it('drawings: a width shared by two storeys is drawn once', () => {
    const shown = visibleMeasures(all, { in3d: false, ...none });
    const widths = shown.filter((m) => m.id.endsWith('.width'));
    expect(widths).toHaveLength(1);
    expect(widths[0].same).toEqual(['upper']);
  });

  it('3D lines hug their own part', () => {
    const w = all.find((m) => m.id === 'upper.width')!;
    expect(w.near!.a.z).toBe(3000);
  });
});
