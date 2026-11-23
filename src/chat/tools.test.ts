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

describe('exterior draft tools', () => {
  const FT = 304.8;
  const base = {
    ...emptyProject(),
    exterior: {
      summary: '',
      createdAt: 0,
      levels: [],
      openings: [],
      blocks: [
        {
          id: 'main',
          name: 'Main',
          x: { mm: 0, source: 'plan' as const },
          y: { mm: 0, source: 'plan' as const },
          width: { mm: 20 * FT, source: 'plan' as const },
          depth: { mm: 26 * FT, source: 'plan' as const },
          base: { mm: 0, source: 'ai' as const },
          height: { mm: 19 * FT, source: 'plan' as const },
          roof: { type: 'hip' as const, rise: { mm: 7 * FT, source: 'ai' as const }, overhang: { mm: 150, source: 'plan' as const }, ridge: 'y' as const, low: 'left' as const },
        },
      ],
    },
  };

  it('changes values, roofs, and adds and removes parts', () => {
    let r = runTool(base, 'set_draft_values', { changes: [{ id: 'main:roof.rise', value: `8' 0"` }] });
    expect(r.isError).toBe(false);
    expect(r.project.exterior!.blocks[0].roof.rise).toMatchObject({ mm: 8 * FT, source: 'user' });
    r = runTool(r.project, 'update_draft_volume', { volume_id: 'main', roof_type: 'parapet', low_side: 'left' });
    expect(r.project.exterior!.blocks[0].roof.type).toBe('parapet');
    r = runTool(r.project, 'add_draft_opening', { elevation: 'front', kind: 'door', from_left: `5' 0"`, bottom: '0"', width: `3' 0"`, height: `7' 0"` });
    expect(r.project.exterior!.openings).toHaveLength(1);
    expect(r.project.exterior!.openings[0].offset.mm).toBeCloseTo(5 * FT);
    const opId = r.project.exterior!.openings[0].id;
    expect(describeProject(r.project, 'imperial')).toContain('main:roof.rise');
    r = runTool(r.project, 'remove_draft_part', { part_id: opId });
    expect(r.project.exterior!.openings).toHaveLength(0);
    expect(runTool(base, 'set_draft_values', { changes: [{ id: 'nope', value: '1"' }] }).isError).toBe(true);
  });
});
