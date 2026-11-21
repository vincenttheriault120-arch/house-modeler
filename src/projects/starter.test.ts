import { describe, expect, it } from 'vitest';
import { closingGap, runsToPolygon, signedArea } from '../model/geometry';
import { buildFoundation } from '../model/foundation';
import { parseProject } from '../model/project';
import { SHAPES, shapeRuns, starterProject, type StarterOptions } from './starter';

const FT = 304.8;
const opts = (o: Partial<StarterOptions> = {}): StarterOptions => ({
  name: 'Cottage',
  address: '',
  start: 'scratch',
  shape: 'rectangle',
  width: 40 * FT,
  depth: 30 * FT,
  storeys: 2,
  basement: true,
  ...o,
});

describe('footprint shapes', () => {
  it.each(SHAPES.map((s) => s.value))('%s closes and has the expected area', (shape) => {
    const runs = shapeRuns(shape, 40 * FT, 30 * FT);
    const gap = closingGap(runs);
    expect(Math.hypot(gap.x, gap.y)).toBeLessThan(1e-6);
    const area = Math.abs(signedArea(runsToPolygon(runs))) / (FT * FT);
    expect(area).toBeCloseTo(shape === 'rectangle' ? 1200 : shape === 'l-shape' ? 900 : 900, 3);
  });
});

describe('starter project', () => {
  it('from scratch, the footprint becomes the first foundation and builds', () => {
    const p = starterProject(opts({ shape: 'l-shape', basement: false }));
    expect(p).toMatchObject({ name: 'Cottage', start: 'scratch', phase: 1, storeys: 2 });
    expect(p.steps).toHaveLength(1);
    const step = p.steps[0];
    expect(step.kind === 'foundation' && step.params.type).toBe('slab-on-grade');
    expect(step.kind === 'foundation' && buildFoundation(step.id, step.label, step.params).length).toBeGreaterThan(0);
  });

  it('from plans, it starts empty and survives a save and reload', () => {
    const p = starterProject(opts({ start: 'plans', name: '  ', address: '311 Gardenville' }));
    expect(p.steps).toEqual([]);
    expect(p.name).toBe('My house');
    expect(parseProject(JSON.stringify(p))).toMatchObject({ address: '311 Gardenville', start: 'plans', phase: 1 });
  });
});
