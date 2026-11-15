import { describe, expect, it } from 'vitest';
import { runTool } from '../chat/tools';
import { coveredKinds, type PlanMeta } from '../plans/store';
import { levelsSuggestionToDraft } from '../plans/suggest';
import { buildComponents, parseProject, reducer } from './project';
import { emptyProject, type Project } from './types';

const FT = 304.8;

function withBasement(): Project {
  let p = reducer(emptyProject(), { type: 'set-levels', levels: [{ id: 'tf', name: 'Top of foundation', kind: 'foundation-top', elevation: 2 * FT }] });
  p = reducer(p, { type: 'add-foundation', id: 'b' });
  const b = p.steps[0];
  if (b.kind !== 'foundation') throw new Error();
  return reducer(p, { type: 'update-foundation', id: 'b', params: { ...b.params, topLevelId: 'tf' } });
}

describe('levels', () => {
  it('a linked foundation takes its top from the level', () => {
    const p = withBasement();
    const b = p.steps[0];
    expect(b.kind === 'foundation' && b.params.topElevation).toBeCloseTo(2 * FT);
  });

  it('changing a level moves the foundation and the floor above it', () => {
    let p = reducer(withBasement(), { type: 'add-floor', id: 'f', supportId: 'b' });
    const before = buildComponents(p).find((c) => c.id === 'f:subfloor')!.top;
    p = reducer(p, { type: 'set-levels', levels: [{ ...p.levels[0], elevation: 2 * FT + 100 }] });
    expect(buildComponents(p).find((c) => c.id === 'f:subfloor')!.top).toBeCloseTo(before + 100);
  });

  it('deleting a level unlinks steps and keeps their height', () => {
    const p = reducer(withBasement(), { type: 'set-levels', levels: [] });
    const b = p.steps[0];
    if (b.kind !== 'foundation') throw new Error();
    expect(b.params.topLevelId).toBeUndefined();
    expect(b.params.topElevation).toBeCloseTo(2 * FT);
  });

  it('old project files load with no levels', () => {
    expect(parseProject(JSON.stringify({ version: 1, name: 'x', steps: [] })).levels).toEqual([]);
  });

  it('chat can set levels and link a foundation to one', () => {
    const p0 = reducer(emptyProject(), { type: 'add-foundation', id: 'b' });
    const r = runTool(p0, 'set_levels', { levels: [{ name: 'Top of foundation', kind: 'foundation-top', elevation: `1' 6"` }] });
    expect(r.isError).toBe(false);
    const id = r.project.levels[0].id;
    const r2 = runTool(r.project, 'update_foundation_step', { step_id: 'b', top_level_id: id });
    const b = r2.project.steps[0];
    expect(b.kind === 'foundation' && b.params.topElevation).toBeCloseTo(1.5 * FT);
    expect(runTool(r.project, 'update_foundation_step', { step_id: 'b', top_level_id: 'nope' }).isError).toBe(true);
  });
});

describe('levels suggestion', () => {
  it('updates matching levels and adds new ones', () => {
    let n = 0;
    const current = [{ id: 'g', name: 'Ground floor', kind: 'floor' as const, elevation: 2 * FT }];
    const rows = levelsSuggestionToDraft(
      {
        summary: '',
        levels: [
          { name: 'Ground floor', kind: 'floor', elevation: `2' 0"`, source: 'A', confident: true },
          { name: 'Roof ridge', kind: 'ridge', elevation: `27' 6"`, source: 'B', confident: true },
          { name: 'Eave', kind: 'eave', elevation: null, source: 'C', confident: false },
        ],
      },
      current,
      'imperial',
      () => `new${n++}`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].existing?.id).toBe('g');
    expect(rows[0].include).toBe(false); // same value
    expect(rows[1].level.id).toBe('new0');
    expect(rows[1].level.elevation).toBeCloseTo(27.5 * FT);
  });
});

describe('plans checklist', () => {
  it('counts drawings on multi-sheet PDFs', () => {
    const plans: PlanMeta[] = [{ id: '1', name: 'set', kind: 'basement', size: 1, addedAt: 1, contains: ['elevation-front', 'section'] }];
    const c = coveredKinds(plans);
    expect(c.has('basement') && c.has('elevation-front') && c.has('section')).toBe(true);
    expect(c.has('elevation-back')).toBe(false);
  });
});
