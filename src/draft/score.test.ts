import { describe, expect, it } from 'vitest';
import { parseAnswerSheet, scoreDraft, type AnswerSheet } from './score';
import { dim, type Block, type ExteriorDraft } from './types';

function block(id: string, x: number, y: number, w: number, d: number, base: number, h: number, extra: Partial<Block> = {}): Block {
  return {
    id,
    name: id,
    x: dim(x, 'plan'),
    y: dim(y, 'plan'),
    width: dim(w, 'plan'),
    depth: dim(d, 'plan'),
    base: dim(base, 'plan'),
    height: dim(h, 'plan'),
    roof: { type: 'flat', rise: dim(0), overhang: dim(0), ridge: 'x', low: 'back' },
    ...extra,
  };
}

const draft: ExteriorDraft = {
  summary: '',
  createdAt: 0,
  levels: [],
  openings: [],
  blocks: [
    block('Main', 0, 0, 6440, 7950, 0, 5969, { roof: { type: 'hip', rise: dim(2000), overhang: dim(300), ridge: 'y', low: 'back' } }),
    block('Wing', 6121, 0, 5512, 12000, 0, 3277),
    block('Shed', 1000, 20000, 1000, 1000, 0, 2000),
    block('Basement', 0, 0, 6440, 7950, -1397, 1880, { foundation: { type: 'basement', wall: dim(203), slab: dim(102) } }),
  ],
};

const sheet: AnswerSheet = {
  name: 'Test house',
  overall: { width: 11633 },
  parts: [
    { id: 'main', name: 'Main house', kind: 'volume', x: 0, y: 0, width: 6439, depth: 7950, top: 5969, roofTop: { mm: 8010, tol: 150 }, roofType: 'hip' },
    { id: 'wing', name: 'Addition', kind: 'volume', width: 5512, depth: 12179, top: 3277 },
    { id: 'base', name: 'Basement', kind: 'foundation', foundation: 'basement', base: -1397, top: 483 },
    { id: 'slab', name: 'Slab on grade', kind: 'foundation', foundation: 'slab', x: 6121, width: 5512, depth: 12179 },
  ],
};

describe('scoring a draft against an answer sheet', () => {
  const s = scoreDraft(draft, sheet);
  const row = (part: string, label: string) => s.rows.find((r) => r.part.startsWith(part) && r.label === label);

  it('matches parts by overlap, whatever Claude named them', () => {
    expect(row('Main house', 'Width')?.got).toBe('6440 mm');
    expect(row('Addition', 'Depth')?.part).toContain('"Wing"');
  });

  it('grades each value right, close or wrong', () => {
    expect(row('Main house', 'Width')?.verdict).toBe('right');
    expect(row('Addition', 'Depth')?.verdict).toBe('wrong'); // 179 mm short
    expect(row('Main house', 'Highest point of roof')?.verdict).toBe('right'); // 7969 within its own 150 mm
    expect(row('Main house', 'Roof shape')?.verdict).toBe('right');
    expect(row('Basement', 'Top of walls')?.verdict).toBe('right');
    expect(row('Whole house', 'Overall width')?.verdict).toBe('right');
  });

  it('reports missing parts and extra blocks', () => {
    expect(row('Slab on grade', 'Foundation')?.verdict).toBe('missing');
    expect(s.extra).toEqual(['Shed']);
    expect(s.counts.missing).toBe(1);
  });

  it('rejects files that are not answer sheets', () => {
    expect(() => parseAnswerSheet('nope')).toThrow(/not valid JSON/);
    expect(() => parseAnswerSheet('{"parts":[{"id":"a"}]}')).toThrow(/kind/);
    expect(parseAnswerSheet(JSON.stringify(sheet)).parts).toHaveLength(4);
  });
});
