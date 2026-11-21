import { describe, expect, it } from 'vitest';
import { defaultFoundation } from './foundation';
import { DIM_OFFSET, LEVEL_GAP, lengthDimensions, levelMarks } from './dimensions';
import { emptyProject, type Project } from './types';

const FT = 304.8;

function withFoundation(over: Partial<ReturnType<typeof defaultFoundation>> = {}, visible = true): Project {
  return {
    ...emptyProject(),
    steps: [{ id: 'b', kind: 'foundation', label: 'Basement', level: '', visible, notes: '', params: { ...defaultFoundation(), ...over } }],
  };
}

describe('length dimensions', () => {
  it('measures each side, just outside the wall, at the top of the wall', () => {
    const dims = lengthDimensions(withFoundation());
    expect(dims.map((d) => Math.round(d.mm / FT))).toEqual([30, 24, 30, 24]);
    const front = dims[0];
    // The front side runs along y = 0, so its dimension sits in front of it (negative y).
    expect(front.a.y).toBeCloseTo(-DIM_OFFSET);
    expect(front.a.z).toBe(FT);
    expect(front.runIndex).toBe(0);
  });

  it('puts the line outside whichever way the outline was walked', () => {
    const cw = withFoundation({
      runs: [
        { dir: 'up', length: 24 * FT },
        { dir: 'right', length: 30 * FT },
        { dir: 'down', length: 24 * FT },
        { dir: 'left', length: 30 * FT },
      ],
    });
    const left = lengthDimensions(cw)[0]; // walking up the left side
    expect(left.a.x).toBeCloseTo(-DIM_OFFSET);
  });

  it('leaves out a side shared with a neighbouring foundation', () => {
    const p = withFoundation();
    const [base] = p.steps;
    if (base.kind !== 'foundation') throw new Error('expected a foundation');
    p.steps.push({ ...base, id: 'g', params: { ...defaultFoundation(), origin: { x: 30 * FT, y: 0 } } });
    const dims = lengthDimensions(p);
    // 4 sides each, minus the shared wall seen from both sides.
    expect(dims).toHaveLength(6);
    expect(dims.some((d) => d.stepId === 'b' && d.runIndex === 1)).toBe(false);
    expect(dims.some((d) => d.stepId === 'g' && d.runIndex === 3)).toBe(false);
  });

  it('skips hidden steps', () => {
    expect(lengthDimensions(withFoundation({}, false))).toEqual([]);
  });
});

describe('level marks', () => {
  it('adds grade and sorts the levels, beside the front-left corner', () => {
    const p: Project = {
      ...withFoundation(),
      levels: [
        { id: 'r', name: 'Roof top', kind: 'ridge', elevation: 22 * FT },
        { id: 'f', name: 'Ground floor', kind: 'floor', elevation: 2 * FT },
      ],
    };
    const marks = levelMarks(p);
    expect(marks.map((m) => m.name)).toEqual(['Grade', 'Ground floor', 'Roof top']);
    expect(marks[0].at).toEqual({ x: -LEVEL_GAP, y: 0, z: 0 });
  });
});
