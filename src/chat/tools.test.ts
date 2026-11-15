import { describe, expect, it } from 'vitest';
import { emptyProject } from '../model/types';
import { describeProject, runTool } from './tools';

describe('chat tools', () => {
  it('adds a slab-on-grade garage from imperial strings', () => {
    const r = runTool(emptyProject(), 'add_foundation_step', {
      label: 'Garage',
      level: 'Garage',
      type: 'slab-on-grade',
      origin_x: `20' 1"`,
      runs: [
        { dir: 'right', length: `18' 1"` },
        { dir: 'up', length: `39' 1 1/2"` },
        { dir: 'left', length: `18' 1"` },
        { dir: 'down', length: `39' 1 1/2"` },
      ],
    });
    expect(r.isError).toBe(false);
    const s = r.project.steps[0];
    if (s.kind !== 'foundation') throw new Error('expected foundation');
    expect(s.label).toBe('Garage');
    expect(s.params.type).toBe('slab-on-grade');
    expect(s.params.origin.x).toBeCloseTo(20 * 304.8 + 25.4);
    expect(describeProject(r.project, 'imperial')).toContain(`39' 1 1/2\\"`);
  });
  it('reports bad input instead of changing the project', () => {
    const p = runTool(emptyProject(), 'add_foundation_step', { label: 'F', runs: [{ dir: 'right', length: '10' }] }).project;
    const id = p.steps[0].id;
    const r = runTool(p, 'update_foundation_step', { step_id: id, wall_thickness: 'thick' });
    expect(r.isError).toBe(true);
    expect(r.project).toBe(p);
    expect(runTool(p, 'delete_step', { step_id: 'nope' }).isError).toBe(true);
  });
});
