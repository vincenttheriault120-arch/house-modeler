import { describe, expect, it } from 'vitest';
import { defaultFoundation } from './foundation';
import {
  interiorComponents,
  roomArea,
  roomSize,
  shellOutlines,
  snap,
  storeyHeights,
  wallLength,
  wallOutline,
  withLength,
  type InteriorWall,
} from './interior';
import { reducer } from './project';
import { emptyProject, type Project } from './types';

const FT = 304.8;
const IN = 25.4;

function house(): Project {
  return {
    ...emptyProject(),
    levels: [
      { id: 'g', name: 'Ground floor', kind: 'floor', elevation: 2 * FT },
      { id: 'f', name: 'First floor', kind: 'floor', elevation: 11 * FT },
    ],
    steps: [{ id: 'b', kind: 'foundation', label: 'Basement', level: '', visible: true, notes: '', params: defaultFoundation() }],
  };
}

const wall: InteriorWall = { id: 'w', a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, thickness: 4.5 * IN };

describe('interior walls', () => {
  it('are a rectangle around their centre line', () => {
    const o = wallOutline(wall);
    expect(o.map((p) => p.y)).toEqual([-wall.thickness / 2, -wall.thickness / 2, wall.thickness / 2, wall.thickness / 2]);
    expect(wallLength(wall)).toBe(3000);
  });

  it('change length from their start', () => {
    const w = withLength({ ...wall, b: { x: 0, y: 2000 } }, 3000);
    expect(w.a).toEqual({ x: 0, y: 0 });
    expect(w.b.y).toBeCloseTo(3000);
  });

  it('stand from each storey floor to under the next floor', () => {
    const p = house();
    // Basement: default foundation top 1', 8' walls, 4" slab.
    expect(storeyHeights(p, 'basement')).toEqual({ bottom: FT - 8 * FT + 4 * IN, top: 2 * FT - 12 * IN });
    expect(storeyHeights(p, 'ground-floor')).toEqual({ bottom: 2 * FT, top: 11 * FT - 12 * IN });
    const first = storeyHeights(p, 'first-floor');
    expect(first.bottom).toBe(11 * FT);
    expect(first.top).toBeCloseTo(19 * FT);
  });

  it('become 3D pieces on their storey', () => {
    const p = reducer(house(), { type: 'set-interior', storey: 'ground-floor', layout: { walls: [wall], rooms: [] } });
    const [c] = interiorComponents(p);
    expect(c.kind).toBe('interior-wall');
    expect(c.bottom).toBe(2 * FT);
    expect(c.outline).toHaveLength(4);
  });
});

describe('rooms', () => {
  it('measure their area and clear sizes', () => {
    const r = { outline: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }] };
    expect(roomArea(r)).toBe(12e6);
    expect(roomSize(r)).toEqual({ width: 4000, depth: 3000 });
  });
});

describe('the shell', () => {
  it('gives the inside face of the foundation walls', () => {
    const [s] = shellOutlines(house());
    const xs = s.inside.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(8 * IN);
  });
});

describe('snapping', () => {
  const targets = { points: [{ x: 0, y: 0 }], segments: [[{ x: 0, y: 0 }, { x: 0, y: 5000 }]] as [{ x: number; y: number }, { x: number; y: number }][] };

  it('prefers a nearby corner', () => {
    expect(snap({ x: 40, y: -30 }, targets, 100, null)).toEqual({ p: { x: 0, y: 0 }, kind: 'corner' });
  });

  it('keeps lines square to the last point', () => {
    const s = snap({ x: 2003, y: 1060 }, targets, 100, { x: 1000, y: 1000 });
    expect(s.kind).toBe('square');
    expect(s.p.y).toBe(1000);
    expect(s.p.x - 1000).toBeCloseTo(Math.round(1003 / IN) * IN);
  });

  it('lands on a nearby face, staying square', () => {
    const s = snap({ x: 60, y: 1010 }, targets, 100, { x: 2000, y: 1000 });
    expect(s).toEqual({ p: { x: 0, y: 1000 }, kind: 'face' });
  });

  it('otherwise rounds to the inch', () => {
    const s = snap({ x: 1000, y: 3000 }, targets, 100, null);
    expect(s.kind).toBe('grid');
    expect(s.p.x / IN).toBeCloseTo(Math.round(1000 / IN));
  });
});
