import { describe, expect, it } from 'vitest';
import { runTool } from '../chat/tools';
import { buildFloor, defaultFloor, floorLevels } from './floor';
import { applyFoundationType, defaultFoundation } from './foundation';
import { scanIntervals } from './geometry';
import { buildComponents, reducer } from './project';
import { emptyProject } from './types';

const IN = 25.4;

describe('scanIntervals', () => {
  it('finds both legs of an L-shape', () => {
    // L: 0..20 wide at the bottom, 0..10 at the top.
    const L = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(scanIntervals(L, 'x', 5)).toEqual([[0, 20]]);
    expect(scanIntervals(L, 'x', 15)).toEqual([[0, 10]]);
    expect(scanIntervals(L, 'y', 15)).toEqual([[0, 10]]);
  });
});

describe('floor over a basement', () => {
  const base = defaultFoundation(); // 30' x 24', 8" walls, top at 1'
  const parts = buildFloor('f', 'Floor', defaultFloor('b'), base);
  const of = (k: string) => parts.filter((c) => c.kind === k);

  it('stacks sill, joists and subfloor on the wall top', () => {
    const lv = floorLevels(defaultFloor('b'), base);
    expect(lv.floorTop / IN).toBeCloseTo(12 + 1.5 + 9.25 + 0.75);
    expect(of('subfloor')[0].top).toBeCloseTo(lv.floorTop);
    expect(of('sill')).toHaveLength(4);
    expect(of('rim-joist')).toHaveLength(4);
  });

  it('lays joists front to back every 16"', () => {
    const joists = of('joist');
    expect(joists).toHaveLength(22);
    const xs = joists.map((j) => (j.outline[0].x + j.outline[1].x) / 2 / IN);
    expect(xs[0]).toBeCloseTo(16);
    expect(xs[1] - xs[0]).toBeCloseTo(16);
    // Span is inside the rims: 24' less two 1 1/2" rims.
    expect(joists[0].dims[0].mm / IN).toBeCloseTo(24 * 12 - 3);
  });

  it('puts a beam across the middle with posts on the slab', () => {
    const [beam] = of('beam');
    expect(beam.top).toBeCloseTo(floorLevels(defaultFloor('b'), base).joistBottom);
    expect(beam.dims[0].mm / IN).toBeCloseTo(30 * 12 - 8); // into each wall by half its thickness
    const posts = of('post');
    expect(posts).toHaveLength(3);
    expect(posts[0].bottom / IN).toBeCloseTo(12 - 96 + 4);
  });

  it('has no beam over a slab on grade', () => {
    const slab = applyFoundationType(base, 'slab-on-grade');
    expect(buildFloor('f', 'F', defaultFloor('b'), slab).some((c) => c.kind === 'beam')).toBe(false);
  });

  it('builds nothing without its foundation', () => {
    expect(buildFloor('f', 'F', defaultFloor('gone'), undefined)).toEqual([]);
  });
});

describe('floor steps in a project', () => {
  it('is inserted after its foundation and follows its changes', () => {
    let p = reducer(emptyProject(), { type: 'add-foundation', id: 'b' });
    p = reducer(p, { type: 'add-foundation', id: 'g' });
    p = reducer(p, { type: 'add-floor', id: 'f', supportId: 'b' });
    expect(p.steps.map((s) => s.id)).toEqual(['b', 'f', 'g']);
    const before = buildComponents(p).find((c) => c.id === 'f:subfloor')!.top;
    const b = p.steps[0];
    if (b.kind !== 'foundation') throw new Error();
    p = reducer(p, { type: 'update-foundation', id: 'b', params: { ...b.params, topElevation: b.params.topElevation + 100 } });
    expect(buildComponents(p).find((c) => c.id === 'f:subfloor')!.top).toBeCloseTo(before + 100);
  });

  it('can be added and changed by the chat tools', () => {
    const p0 = reducer(emptyProject(), { type: 'add-foundation', id: 'b' });
    const r = runTool(p0, 'add_floor_step', { support_step_id: 'b', joist_depth: '11 7/8"', joist_spacing: '19.2"' });
    expect(r.isError).toBe(false);
    const f = r.project.steps[1];
    if (f.kind !== 'floor') throw new Error();
    expect(f.params.joistDepth / IN).toBeCloseTo(11.875);
    const r2 = runTool(r.project, 'update_floor_step', { step_id: f.id, joist_direction: 'x', beam: false });
    const f2 = r2.project.steps[1];
    expect(f2.kind === 'floor' && f2.params.joistDirection).toBe('x');
    expect(runTool(p0, 'add_floor_step', { support_step_id: 'nope' }).isError).toBe(true);
  });
});
