import { describe, expect, it } from 'vitest';
import { describeMeasures, fmtFt, measureFromVectors, parseLevel, type Seg, type TextBox } from './measure';

// A small elevation drawn at 10 pt per foot, y down: grade (100'-0") at y = 500.
const PT = 10;
const Y = (ft: number) => 500 - (ft - 100) * PT;
const X = (ft: number) => 200 + ft * PT;
const seg = (x1: number, y1: number, x2: number, y2: number): Seg => ({ x1, y1, x2, y2 });
const label = (str: string, x: number, y: number): TextBox => ({ str, x0: x, x1: x + 30, y0: y - 3, y1: y + 3 });

function sheet(): { texts: TextBox[]; segs: Seg[] } {
  const texts: TextBox[] = [];
  const segs: Seg[] = [];
  // Level lines on both sides, each label sitting above or below its line, as drawn on real sheets.
  for (const [str, ft, side] of [
    [`100'-0"`, 100, -5],
    [`109'-0"`, 109, 5],
    [`118'-0"`, 118, -5],
  ] as const) {
    segs.push(seg(X(-8), Y(ft), X(-1), Y(ft)), seg(X(31), Y(ft), X(38), Y(ft)));
    texts.push(label(str, X(-8), Y(ft) + side), label(str, X(34), Y(ft) - side));
  }
  // Decoy lines near the labels that are not their level lines.
  segs.push(seg(X(-8), Y(109) + 9, X(-1), Y(109) + 9));
  // Walls 30 ft wide, 18 ft high, a hip roof peaking 8'-3" above the wall tops at 15 ft.
  segs.push(seg(X(0), Y(100), X(0), Y(118)), seg(X(30), Y(100), X(30), Y(118)), seg(X(0), Y(118), X(30), Y(118)), seg(X(0), Y(100), X(30), Y(100)));
  segs.push(seg(X(-1), Y(118), X(15), Y(126.25)), seg(X(31), Y(118), X(15), Y(126.25)));
  // Siding: 6 lines 4" apart.
  for (let k = 0; k < 6; k++) segs.push(seg(X(0), Y(104 + k / 3), X(30), Y(104 + k / 3)));
  // A note box above the roof, with text in it: not a peak.
  segs.push(seg(X(20), Y(129), X(22), Y(131)), seg(X(24), Y(129), X(22), Y(131)));
  texts.push({ str: 'NOTE', x0: X(20), x1: X(24), y0: Y(131), y1: Y(129) });
  return { texts, segs };
}

describe('measuring heights from a drawing', () => {
  it('reads written levels', () => {
    expect(parseLevel(`119'-7"`)).toBeCloseTo(119.5833, 3);
    expect(parseLevel(`95'-5 1/2"`)).toBeCloseTo(95.4583, 3);
    expect(parseLevel(`7'-7"`)).toBeNull(); // a dimension, not a level
    expect(parseLevel('1/4" = 1\'-0"')).toBeNull();
    expect(fmtFt(126.25)).toBe(`126' 3"`);
  });

  it('uses the written levels as the ruler and finds the roof peak', () => {
    const { texts, segs } = sheet();
    const m = measureFromVectors(texts, segs)!;
    expect(m.ftPerPt).toBeCloseTo(1 / PT, 6);
    expect(m.peaks).toHaveLength(1);
    expect(m.peaks[0].height).toBeCloseTo(126.25, 2);
    expect(m.peaks[0].at).toBeCloseTo(15, 2);
  });

  it('lists edges, with siding as one entry', () => {
    const { texts, segs } = sheet();
    const m = measureFromVectors(texts, segs)!;
    const text = describeMeasures('Front', m);
    expect(text).toContain(`118' 0" (from 0' 0" to 30' 0")`);
    expect(text).toContain(`6 evenly spaced lines (siding or courses) from 105' 8" down to 104' 0"`);
    expect(text).toContain(`126' 3" at 15' 0"`);
  });

  it('measures nothing without three written levels', () => {
    const { texts, segs } = sheet();
    expect(measureFromVectors(texts.filter((t) => !t.str.startsWith('109')), segs)).toBeNull();
  });
});
