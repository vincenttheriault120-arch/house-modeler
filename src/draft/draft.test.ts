import { describe, expect, it } from 'vitest';
import { answerToDraft, draftProblems, placeOpening, type DraftAnswer } from './generate';
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
      roof: { type: 'hip', rise: v("7' 8\"", false), overhang: v('6"'), ridge_along: 'depth', low_side: 'left', facets: [] },
    },
    {
      name: 'Upper',
      x: v("20' 1\""),
      y: v("6' 0\""),
      width: v("18' 1\""),
      depth: v("39' 3\""),
      base: v("10' 9\""),
      wall_height: v("7' 10\""),
      roof: { type: 'shed', rise: v("3' 9\""), overhang: v('0"', false), ridge_along: 'depth', low_side: 'left', facets: [] },
    },
  ],
  foundations: [],
  openings: [
    { elevation: 'front', kind: 'door', from_left: v("15' 9\"", false), bottom: v("2' 7\""), width: v("3' 0\""), height: v("7' 0\"") },
    { elevation: 'front', kind: 'window', from_left: v("100' 0\""), bottom: v('0"'), width: v('1"'), height: v('1"') },
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

  it('places an opening read on an elevation on the wall nearest the viewer', () => {
    const door = d.openings[0];
    expect(door.blockId).toBe(d.blocks[0].id);
    expect(door.offset.mm).toBeCloseTo(15 * FT + 9 * 25.4);
    // Seen from the right, 10' from the left end (the front): the upper volume's right wall, 4' from its own front.
    const r = placeOpening(d, 'right', 10 * FT, 12 * FT, 3 * FT)!;
    expect(r.blockId).toBe(d.blocks[1].id);
    expect(r.offset).toBeCloseTo(4 * FT);
    expect(r.sill).toBeCloseTo(12 * FT - (10 * FT + 9 * 25.4));
    // Seen from the back, the left end is the house's right side.
    const b = placeOpening(d, 'back', 2 * FT, 12 * FT, 3 * FT)!;
    expect(b.blockId).toBe(d.blocks[1].id);
    expect(b.offset).toBeCloseTo(2 * FT);
    // Seen from the left, at grade near the front: the main house.
    const l = placeOpening(d, 'left', 40 * FT, 3 * FT, 3 * FT)!;
    expect(l.blockId).toBe(d.blocks[0].id);
  });

  it('leaves out an opening with no wall at its height instead of floating it', () => {
    expect(placeOpening(d, 'front', 2 * FT, 60 * FT, 3 * FT)).toBeNull();
    expect(placeOpening(d, 'front', 2 * FT, 5 * FT, 3 * FT)).not.toBeNull();
  });

  it('reports what cannot be right', () => {
    const p = draftProblems(d, answer);
    expect(p.some((x) => /don't land/.test(x))).toBe(true);
    const overlap = { ...d, blocks: [d.blocks[0], { ...d.blocks[0], id: 'copy', name: 'Copy' }] };
    expect(draftProblems(overlap).some((x) => /overlap/.test(x))).toBe(true);
  });

  it('draws a roof behind parapets', () => {
    const b = { ...d.blocks[1], roof: { ...d.blocks[1].roof, type: 'parapet' as const } };
    const m = draftMeshes({ ...d, blocks: [b], openings: [] });
    const roof = m.find((x) => x.kind === 'roof')!;
    const zs = roof.positions.filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBeCloseTo(10 * FT + 9 * 25.4 + 7 * FT + 10 * 25.4 + 3 * FT + 9 * 25.4);
  });

  it('builds a roof that dips along valley lines from its facets', () => {
    const c = (across: string, back: string, height: string) => ({ across, back, height });
    const folded: DraftAnswer = {
      ...answer,
      openings: [],
      volumes: [
        {
          ...answer.volumes[1],
          roof: {
            ...answer.volumes[1].roof,
            type: 'folded',
            rise: v("3' 0\""),
            facets: [
              // Back strip slopes toward the front, down to a fold 14' from the back.
              { corners: [c('0"', "25' 3\"", '0"'), c("5' 0\"", "25' 3\"", '0"'), c("18' 1\"", "39' 3\"", "3' 9\""), c('0"', "39' 3\"", "3' 9\"")] },
              // Right part slopes toward the left, down to a valley 5' from the left wall.
              { corners: [c("5' 0\"", "25' 3\"", '0"'), c("5' 0\"", '0"', '0"'), c("18' 1\"", '0"', "3' 9\""), c("18' 1\"", "39' 3\"", "3' 9\"")] },
              // Low strip with the drains.
              { corners: [c('0"', '0"', '0"'), c("5' 0\"", '0"', '0"'), c("5' 0\"", "25' 3\"", '0"'), c('0"', "25' 3\"", '0"')] },
            ],
          },
        },
      ],
    };
    const fd = answerToDraft(folded, 'imperial');
    const b = fd.blocks[0];
    expect(b.roof.type).toBe('folded');
    expect(b.roof.facets).toHaveLength(3);
    // The rise follows the highest corner even though Claude wrote 3' 0".
    expect(b.roof.rise.mm).toBeCloseTo(3 * FT + 9 * 25.4);
    const roof = draftMeshes(fd).find((x) => x.kind === 'roof')!;
    const zs = roof.positions.filter((_, i) => i % 3 === 2);
    const wallTop = b.base.mm + b.height.mm;
    expect(Math.min(...zs)).toBeCloseTo(wallTop);
    expect(Math.max(...zs)).toBeCloseTo(wallTop + b.roof.rise.mm);
    // The left wall rises to meet the sloping back strip.
    const leftWall = [];
    for (let i = 0; i < roof.positions.length; i += 9) {
      const xs = [0, 3, 6].map((k) => roof.positions[i + k]);
      if (xs.every((x) => Math.abs(x - b.x.mm) < 1)) leftWall.push(i);
    }
    expect(leftWall.length).toBeGreaterThan(0);
    expect(measures(fd).find((m) => m.id.endsWith(':roof.rise'))!.label).toBe('Highest roof edge above the lowest');
  });

  it('adds a basement and a slab on grade below grade', () => {
    const fd = answerToDraft(
      {
        ...answer,
        openings: [],
        foundations: [
          {
            name: 'Basement',
            type: 'basement',
            x: v('0"'),
            y: v('0"'),
            width: v("21' 1 1/2\""),
            depth: v("26' 1\""),
            bottom: v("-4' 7\""),
            top: v('0"'),
            wall_thickness: v('8"', false),
            slab_thickness: v('4"', false),
          },
          {
            name: 'Garage slab',
            type: 'slab-on-grade',
            x: v("20' 1\""),
            y: v('0"'),
            width: v("18' 1\""),
            depth: v("39' 1 1/2\""),
            bottom: v("-4' 0\"", false),
            top: v('4"'),
            wall_thickness: v('8"', false),
            slab_thickness: v('4"', false),
          },
        ],
      },
      'imperial',
    );
    const [bsmt, slab] = fd.blocks.filter((b) => b.foundation);
    expect(bsmt.foundation!.type).toBe('basement');
    expect(bsmt.base.mm).toBeCloseTo(-(4 * FT + 7 * 25.4));
    expect(bsmt.height.mm).toBeCloseTo(4 * FT + 7 * 25.4);
    expect(bsmt.height.source).toBe('plan');
    expect(slab.foundation!.type).toBe('slab');
    expect(slab.height.source).toBe('ai');
    // Foundations show on the foundation plan, not on the floor plans or the roof.
    const plan = measuresFor(fd, 'basement').map((m) => m.id);
    expect(plan).toContain(`${bsmt.id}.width`);
    expect(plan).toContain(`${bsmt.id}:foundation.wall`);
    expect(measuresFor(fd, 'top').some((m) => m.part === bsmt.id)).toBe(false);
    expect(blocksOnFloor(fd, 'ground').some((b) => b.foundation)).toBe(false);
    const mesh = draftMeshes(fd).find((m) => m.part === bsmt.id)!;
    expect(mesh.kind).toBe('foundation');
    const zs = mesh.positions.filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBeCloseTo(bsmt.base.mm);
    // Thickness is editable like any other measurement.
    const edited = setDim(fd, `${bsmt.id}:foundation.wall`, { mm: 254 });
    expect(edited.blocks.find((b) => b.id === bsmt.id)!.foundation!.wall).toMatchObject({ mm: 254, source: 'user' });
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
