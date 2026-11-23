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

  it('measures the eave where the roof slopes end, even below a written ceiling level', () => {
    const { texts, segs } = sheet();
    // A second house to the right: ceiling level 118'-0" written, but its hip roof is drawn from
    // 117'-1" (11" lower), in two pieces per side, with a steeper hatch line carrying on below it.
    const x0 = 60;
    segs.push(seg(X(x0 - 1), Y(117 + 1 / 12), X(x0 + 4.5), Y(117 + 1 / 12 + 3.5)), seg(X(x0 + 4.5), Y(117 + 1 / 12 + 3.5), X(x0 + 10), Y(124 + 1 / 12)));
    segs.push(seg(X(x0 + 21), Y(117 + 1 / 12), X(x0 + 10), Y(124 + 1 / 12)));
    segs.push(seg(X(x0 - 1), Y(117 + 1 / 12), X(x0 - 3), Y(112)));
    segs.push(seg(X(x0), Y(100), X(x0), Y(117)), seg(X(x0 + 20), Y(100), X(x0 + 20), Y(117)));
    for (const [str, ft] of [[`100'-0"`, 100], [`109'-0"`, 109], [`118'-0"`, 118]] as const) {
      segs.push(seg(X(x0 + 31), Y(ft), X(x0 + 38), Y(ft)));
      texts.push(label(str, X(x0 + 34), Y(ft) + 5));
    }
    const m = measureFromVectors(texts, segs)!;
    const hip = m.peaks.find((p) => Math.abs(p.height - (124 + 1 / 12)) < 0.05)!;
    expect(hip.eave!.height).toBeCloseTo(117 + 1 / 12, 2);
    expect(hip.eave!.from).toBeCloseTo(x0 - 1, 1);
    const main = m.peaks.find((p) => Math.abs(p.height - 126.25) < 0.05)!;
    expect(main.eave!.height).toBeCloseTo(118, 2);
    expect(describeMeasures('Front', m)).toContain(`under the 124' 1" peak, 117' 1"`);
    expect(fmtFt(118.625)).toBe(`118' 7 1/2"`);
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
