import { describe, expect, it } from 'vitest';
import type { SheetMeasures } from '../plans/measure';
import { applyMeasuredEaves, findDatum } from './eaves';
import { top } from './model';
import { dim, type Block, type ExteriorDraft } from './types';

const IN = 25.4;
const FT = 304.8;
const ft = (f: number, i = 0) => f * FT + i * IN;

function hipHouse(): ExteriorDraft {
  const block: Block = {
    id: 'b1',
    name: 'Existing house',
    x: dim(0),
    y: dim(0),
    width: dim(ft(21, 1)),
    depth: dim(ft(26, 1)),
    base: dim(ft(1, 7)),
    height: dim(ft(18), 'plan', 'First floor ceiling 119\'-7" minus top of foundation 101\'-7"'),
    roof: { type: 'hip', rise: dim(ft(6, 8), 'ai'), overhang: dim(ft(0, 10), 'ai'), ridge: 'x', low: 'left' },
  };
  return {
    summary: 'Draft.',
    createdAt: 0,
    levels: [
      { id: 'g', name: 'Grade', elevation: dim(0) },
      { id: 'f', name: 'Ground floor', elevation: dim(ft(2, 7)) },
      { id: 'c', name: 'First floor ceiling', elevation: dim(ft(19, 7)) },
    ],
    blocks: [block],
    openings: [],
  };
}

// As measured on 311 Gardenville's front elevation.
const front: SheetMeasures = {
  ftPerPt: 0.0556,
  levels: [`100'-0"`, `102'-7"`, `111'-0"`, `112'-0"`, `119'-7"`, `101'-7"`],
  peaks: [
    { height: 126.257, at: 10.6, eave: { height: 118.628, from: -0.83, to: 21.96 } },
    { height: 111.63, at: 18.1, eave: { height: 110.46, from: 15, to: 21.2 } },
  ],
  edges: [],
};

describe('measured eaves', () => {
  it('finds the drawings\' datum from the draft levels', () => {
    expect(findDatum(hipHouse(), [{ m: front }])).toBeCloseTo(100, 6);
  });

  it('lowers a hip roof resting on the ceiling level to the measured eave, keeping the peak', () => {
    const before = hipHouse();
    const peakBefore = top(before.blocks[0]) + before.blocks[0].roof.rise.mm;
    const after = applyMeasuredEaves(before, [{ title: 'Front Elevation', m: front }]);
    const b = after.blocks[0];
    expect(top(b)).toBeCloseTo(ft(18, 7.5), -1); // 118'-7 1/2" in the drawing's levels
    expect(top(b) + b.roof.rise.mm).toBeCloseTo(peakBefore, -1);
    expect(b.height.source).toBe('ai');
    expect(b.height.ref).toContain('Front Elevation');
    expect(b.height.ref).toContain(`11 1/2" below`);
    expect(after.summary).toContain('roof eave moved');
  });

  it('leaves roofs alone when no measured peak matches', () => {
    const d = hipHouse();
    d.blocks[0].roof.rise = dim(ft(9));
    expect(applyMeasuredEaves(d, [{ title: 'Front', m: front }])).toBe(d);
  });
});
