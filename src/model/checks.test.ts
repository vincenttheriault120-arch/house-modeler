import { describe, expect, it } from 'vitest';
import { defaultFoundation } from './foundation';
import { measureState, measures, summarize, type Check } from './checks';
import { reducer } from './project';
import { emptyProject, type Project } from './types';

const FT = 304.8;

function house(): Project {
  return {
    ...emptyProject(),
    levels: [
      { id: 'g', name: 'Ground floor', kind: 'floor', elevation: 2 * FT },
      { id: 'f', name: 'Top of foundation', kind: 'foundation-top', elevation: FT },
    ],
    steps: [{ id: 'b', kind: 'foundation', label: 'Basement', level: '', visible: true, notes: '', params: defaultFoundation() }],
  };
}

describe('measures', () => {
  it('lists each footprint side by the face it is on, then the levels lowest first', () => {
    const list = measures(house());
    expect(list.map((m) => m.label)).toEqual([
      'Basement · front',
      'Basement · right',
      'Basement · back',
      'Basement · left',
      'Top of foundation',
      'Ground floor',
    ]);
    expect(Math.round(list[0].value / FT)).toBe(30);
    expect(list[4].id).toBe('level:f');
  });

  it('numbers sides that share a face', () => {
    const p = house();
    const step = p.steps[0];
    if (step.kind !== 'foundation') throw new Error();
    // An L: the front steps back, so it has two front sides.
    step.params = {
      ...step.params,
      runs: [
        { dir: 'right', length: 10 * FT },
        { dir: 'up', length: 4 * FT },
        { dir: 'right', length: 10 * FT },
        { dir: 'up', length: 20 * FT },
        { dir: 'left', length: 20 * FT },
        { dir: 'down', length: 24 * FT },
      ],
    };
    const labels = measures(p).filter((m) => m.group === 'footprint').map((m) => m.label);
    expect(labels).toContain('Basement · front 1');
    expect(labels).toContain('Basement · front 2');
    expect(labels).toContain('Basement · right 1');
  });
});

describe('checks', () => {
  const m = measures(house())[0];
  const ok: Check = { status: 'matches', model: m.value, at: 0 };

  it('holds while the model keeps the value it was checked at', () => {
    expect(measureState(m, undefined)).toBe('unchecked');
    expect(measureState(m, ok)).toBe('matches');
    expect(measureState({ ...m, value: m.value + 1 }, ok)).toBe('matches');
    expect(measureState({ ...m, value: m.value + 50 }, ok)).toBe('changed');
  });

  it('counts changed measurements as still open', () => {
    const list = measures(house());
    const s = summarize(list, {
      [list[0].id]: ok,
      [list[1].id]: { status: 'differs', model: list[1].value, plan: list[1].value + 100, at: 0 },
      [list[2].id]: { status: 'matches', model: 1, at: 0 },
    });
    expect(s).toEqual({ total: 6, matches: 1, differs: 1, open: 4 });
  });

  it('is saved on the project and can be cleared', () => {
    let p = reducer(house(), { type: 'set-check', id: m.id, check: ok });
    expect(p.checks?.[m.id]?.status).toBe('matches');
    p = reducer(p, { type: 'set-check', id: m.id, check: null });
    expect(p.checks).toEqual({});
  });
});
