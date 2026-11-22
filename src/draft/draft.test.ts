import { describe, expect, it } from 'vitest';
import { answerToDraft, type DraftAnswer } from './generate';
import { blocksOnFloor, confirmView, draftMeshes, measures, measuresFor, removePart, setDim, viewProgress } from './model';
import { draftFromSteps } from './fromSteps';
import { emptyProject } from '../model/types';

const FT = 304.8;
const v = (value: string, from_plans = true) => ({ value, from_plans, ref: from_plans ? 'plan' : 'scaled' });

const answer: DraftAnswer = {
  summary: 'Two volumes.',
  levels: [
    { name: 'Ground floor', elevation: v("2' 7\"") },
    { name: 'First floor', elevation: v("12' 0\"") },
  ],
  volumes: [
    {
      name: 'Main',
      x: v('0"'),
      y: v('0"'),
      width: v("20' 1\""),
      depth: v("26' 1\""),
      base: v('0"', false),
      wall_height: v("19' 7\""),
      roof: { type: 'hip', rise: v("7' 8\"", false), overhang: v('6"'), ridge_along: 'depth', low_side: 'left' },
    },
    {
      name: 'Upper',
      x: v("20' 1\""),
      y: v("6' 0\""),
      width: v("18' 1\""),
      depth: v("39' 3\""),
      base: v("10' 9\""),
      wall_height: v("7' 10\""),
      roof: { type: 'shed', rise: v("3' 9\""), overhang: v('0"', false), ridge_along: 'depth', low_side: 'left' },
    },
  ],
  openings: [
    { volume: 'Main', face: 'front', kind: 'door', offset: v("15' 9\"", false), sill: v("2' 7\""), width: v("3' 0\""), height: v("7' 0\"") },
    { volume: 'Nowhere', face: 'front', kind: 'window', offset: v('0"'), sill: v('0"'), width: v('1"'), height: v('1"') },
  ],
};

describe('exterior draft', () => {
  const d = answerToDraft(answer, 'imperial');

  it('keeps where each number came from', () => {
    expect(d.blocks).toHaveLength(2);
    expect(d.blocks[0].width.mm).toBeCloseTo(20 * FT + 25.4);
    expect(d.blocks[0].width.source).toBe('plan');
    expect(d.blocks[0].roof.rise.source).toBe('ai');
    expect(d.blocks[1].roof.low).toBe('left');
    // Openings on a volume that doesn't exist are dropped.
    expect(d.openings).toHaveLength(1);
  });

  it('lists each measurement on the views that show it', () => {
    const front = measuresFor(d, 'front').map((m) => m.id);
    const left = measuresFor(d, 'left').map((m) => m.id);
    const main = d.blocks[0].id;
    expect(front).toContain(`${main}.width`);
    expect(front).not.toContain(`${main}.depth`);
    expect(left).toContain(`${main}.depth`);
    expect(front.some((id) => id.startsWith(d.openings[0].id))).toBe(true);
    expect(left.some((id) => id.startsWith(d.openings[0].id))).toBe(false);
    // The upper volume is set back 6' from the front.
    const upperY = measures(d).find((m) => m.id === `${d.blocks[1].id}.y`)!;
    expect(upperY.dim.mm).toBeCloseTo(6 * FT);
  });

  it('cuts floor plans at the right volumes', () => {
    expect(blocksOnFloor(d, 'ground').map((b) => b.name)).toEqual(['Main']);
    expect(blocksOnFloor(d, 'first').map((b) => b.name)).toEqual(['Main', 'Upper']);
  });

  it('confirms or changes a value, which then becomes yours', () => {
    const id = `${d.blocks[0].id}.width`;
    const ok = setDim(d, id, { ok: true });
    expect(ok.blocks[0].width).toMatchObject({ source: 'plan', ok: true });
    const changed = setDim(d, `${d.blocks[0].id}:roof.rise`, { mm: 8 * FT });
    expect(changed.blocks[0].roof.rise).toMatchObject({ mm: 8 * FT, source: 'user', ok: true });
    const level = setDim(d, `${d.levels[0].id}.elevation`, { mm: 0 });
    expect(level.levels[0].elevation.mm).toBe(0);
  });

  it('tracks progress per view', () => {
    expect(viewProgress(d, 'front').done).toBe(false);
    const all = confirmView(d, 'front');
    const p = viewProgress(all, 'front');
    expect(p.done).toBe(true);
    expect(p.ok).toBe(p.total);
  });

  it('builds closed clay pieces without gaps in the numbers', () => {
    const meshes = draftMeshes(d);
    expect(meshes.map((m) => m.kind)).toEqual(['wall', 'roof', 'wall', 'roof', 'opening']);
    for (const m of meshes) {
      expect(m.positions.length % 9).toBe(0);
      expect(m.positions.every(Number.isFinite)).toBe(true);
    }
  });

  it('removes a volume with its openings', () => {
    const r = removePart(d, d.blocks[0].id);
    expect(r.blocks).toHaveLength(1);
    expect(r.openings).toHaveLength(0);
  });

  it('starts a draft from a scratch footprint', () => {
    const p = draftFromSteps({ ...emptyProject(), storeys: 2 });
    expect(p.blocks).toHaveLength(1);
    expect(p.blocks[0].height.source).toBe('user');
  });
});
