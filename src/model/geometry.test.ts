import { describe, expect, it } from 'vitest';
import { closingGap, offsetPolygon, runsToPolygon, signedArea, type Run } from './geometry';
import { buildFoundation, defaultFoundation } from './foundation';

const rect: Run[] = [
  { dir: 'right', length: 1000 },
  { dir: 'up', length: 500 },
  { dir: 'left', length: 1000 },
  { dir: 'down', length: 500 },
];

describe('outline', () => {
  it('builds a closed CCW rectangle', () => {
    const poly = runsToPolygon(rect);
    expect(poly).toHaveLength(4);
    expect(signedArea(poly)).toBeCloseTo(500000);
    expect(closingGap(rect)).toEqual({ x: -0, y: -0 });
  });
  it('reports a gap when sides are missing', () => {
    expect(closingGap(rect.slice(0, 3))).toEqual({ x: -0, y: -500 });
  });
  it('builds an L shape', () => {
    const L: Run[] = [
      { dir: 'right', length: 2000 },
      { dir: 'up', length: 2000 },
      { dir: 'left', length: 1000 },
      { dir: 'down', length: 1000 },
      { dir: 'left', length: 1000 },
      { dir: 'down', length: 1000 },
    ];
    const poly = runsToPolygon(L);
    expect(poly).toHaveLength(6);
    expect(signedArea(poly)).toBeCloseTo(3_000_000);
    const inner = offsetPolygon(poly, 100);
    expect(signedArea(inner)).toBeCloseTo(1800 * 1800 - 1000 * 1000);
  });
  it('offsets inward and outward', () => {
    const poly = runsToPolygon(rect);
    expect(signedArea(offsetPolygon(poly, 100))).toBeCloseTo(800 * 300);
    expect(signedArea(offsetPolygon(poly, -100))).toBeCloseTo(1200 * 700);
  });
});

describe('foundation', () => {
  it('makes 4 walls, 4 footings and a slab for a rectangle', () => {
    const parts = buildFoundation('s1', 'Foundation', defaultFoundation());
    expect(parts.filter((c) => c.kind === 'foundation-wall')).toHaveLength(4);
    expect(parts.filter((c) => c.kind === 'footing')).toHaveLength(4);
    expect(parts.filter((c) => c.kind === 'slab')).toHaveLength(1);
  });
  it('works when the outline is walked clockwise', () => {
    const p = defaultFoundation();
    p.runs = [
      { dir: 'up', length: 3000 },
      { dir: 'right', length: 3000 },
      { dir: 'down', length: 3000 },
      { dir: 'left', length: 3000 },
    ];
    const slab = buildFoundation('s', 'F', p).find((c) => c.kind === 'slab')!;
    expect(Math.abs(signedArea(slab.outline))).toBeCloseTo((3000 - 2 * p.wallThickness) ** 2);
    const wall1 = buildFoundation('s', 'F', p).find((c) => c.id === 's:wall:0')!;
    expect(wall1.dims[0].mm).toBeCloseTo(3000);
    expect(Math.min(...wall1.outline.map((v) => v.x))).toBeCloseTo(0);
  });
});
