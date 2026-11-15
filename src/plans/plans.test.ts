import { describe, expect, it } from 'vitest';
import { defaultFoundation } from '../model/foundation';
import { withNext } from '../panels/GuidedSteps';
import { guessKind } from './store';
import { suggestionToDraft, type FoundationSuggestion } from './suggest';

const L = (value: string | null, confident = true) => ({ value, source: 'test', confident });

function suggestion(over: Partial<FoundationSuggestion> = {}): FoundationSuggestion {
  return {
    summary: 'ok',
    type: 'basement',
    type_source: 'plan',
    origin_x: L('0'),
    origin_y: L('0'),
    runs: [
      { dir: 'right', length: "21' 1 1/2\"" },
      { dir: 'up', length: "26' 1\"" },
      { dir: 'left', length: "21' 1 1/2\"" },
      { dir: 'down', length: "26' 1\"" },
    ],
    runs_source: 'plan',
    runs_confident: true,
    wall_thickness: L('8"'),
    wall_height: L("8'"),
    top_elevation: L('1\''),
    footing_width: L('20"', false),
    footing_thickness: L('8"', false),
    slab_thickness: L('4"', false),
    ...over,
  };
}

describe('guessKind', () => {
  it('reads English and French file names', () => {
    expect(guessKind('Basement plan.pdf')).toBe('basement');
    expect(guessKind('Plan sous-sol.pdf')).toBe('basement');
    expect(guessKind('Rez-de-chaussée.pdf')).toBe('ground-floor');
    expect(guessKind('Coupe A-A.pdf')).toBe('section');
    expect(guessKind('Façade avant.pdf')).toBe('elevation-front');
    expect(guessKind('scan001.pdf')).toBe('other');
  });
});

describe('suggestionToDraft', () => {
  it('converts lengths and pre-ticks only real changes', () => {
    const cur = defaultFoundation();
    const { params, include } = suggestionToDraft(suggestion(), cur, 'imperial');
    expect(params.runs.map((r) => Math.round(r.length))).toEqual([6439, 7950, 6439, 7950]);
    expect(include.runs).toBe(true);
    expect(include.type).toBe(false);
    expect(include.wallThickness).toBe(false); // same 8" as before
    expect(include.origin_x).toBe(false);
  });

  it('accepts metric strings while the app is in imperial', () => {
    const { params, include } = suggestionToDraft(suggestion({ slab_thickness: L('127 mm') }), defaultFoundation(), 'imperial');
    expect(params.slabThickness).toBe(127);
    expect(include.slabThickness).toBe(true);
  });

  it('keeps current values when a suggestion cannot be read', () => {
    const cur = defaultFoundation();
    const s = suggestion({
      runs: [{ dir: 'right', length: 'about thirty feet' }, ...suggestion().runs.slice(1)],
      wall_height: L(null),
    });
    const { params, include } = suggestionToDraft(s, cur, 'imperial');
    expect(params.runs).toEqual(cur.runs);
    expect(include.runs).toBe(false);
    expect(params.wallHeight).toBe(cur.wallHeight);
    expect(include.wallHeight).toBe(false);
  });
});

describe('withNext', () => {
  it('marks the first open step as next and skips coming-soon ones', () => {
    const g = withNext(
      [
        { id: 'a', title: 'A', detail: '' },
        { id: 'b', title: 'B', detail: '' },
        { id: 'c', title: 'C', detail: '' },
        { id: 'd', title: 'D', detail: '' },
      ],
      { a: true, b: false, c: false, d: 'soon' },
    );
    expect(g.map((x) => x.status)).toEqual(['done', 'next', 'todo', 'soon']);
  });
});
