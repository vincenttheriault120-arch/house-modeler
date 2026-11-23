/**
 * Measuring heights straight from a PDF elevation or section.
 *
 * Plans are usually vector drawings, so the exact position of every line and
 * label is in the file. Claude reads drawings well but measures them by eye,
 * which can be off by feet on an undimensioned roof peak. Here the app uses
 * the sheet's own written levels (e.g. 100'-0", 119'-7") as the ruler and
 * reports the heights of the drawing's peaks and long horizontal edges.
 *
 * Only absolute levels in feet and inches (e.g. 95'-5" to 130'-0") are used
 * as the ruler; a sheet without at least two of them is not measured.
 */

/** A straight piece of a drawn line, in screen points (y down). */
export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A piece of text and its box, in screen points (y down). */
export interface TextBox {
  str: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface SheetMeasures {
  /** Feet per screen point, from the written levels. */
  ftPerPt: number;
  levels: string[];
  /**
   * Highest points where two sloping lines meet: height in feet (drawing's level system), position in feet from the left wall.
   * eave: where the roof's sloping lines from that peak end at the bottom (the lowest edge of the roof), and how far it runs.
   */
  peaks: { height: number; at: number; eave?: { height: number; from: number; to: number } }[];
  /** Long horizontal edges (or evenly spaced courses such as siding, from height down to bottom), and where they run, in feet from the left wall. */
  edges: { height: number; bottom?: number; courses?: number; from: number; to: number }[];
}

/** Feet from a written absolute level like 119'-7" or 95'-5 1/2". Null for anything else. */
export function parseLevel(text: string): number | null {
  const m = text.trim().match(/^(\d{2,3})'\s*-?\s*(\d{1,2})(?:\s+(\d+)\/(\d+))?\s*(?:"|'')$/);
  if (!m) return null;
  const ft = Number(m[1]) + (Number(m[2]) + (m[3] ? Number(m[3]) / Number(m[4]) : 0)) / 12;
  return ft >= 50 ? ft : null;
}

/** 126.25 → 126' 3", 118.625 → 118' 7 1/2" (to the nearest half inch). */
export function fmtFt(ft: number): string {
  const sign = ft < 0 ? '-' : '';
  const halves = Math.round(Math.abs(ft) * 24);
  const f = Math.floor(halves / 24);
  const h = halves - f * 24;
  return `${sign}${f}' ${Math.floor(h / 2)}${h % 2 ? ' 1/2' : ''}"`;
}

const len = (s: Seg) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const horizontal = (s: Seg) => Math.abs(s.y2 - s.y1) < 0.6 && Math.abs(s.x2 - s.x1) > 0.6;
const vertical = (s: Seg) => Math.abs(s.x2 - s.x1) < 0.6 && Math.abs(s.y2 - s.y1) > 0.6;

/** Least-squares line value = a + b * y. */
function fit(pts: { y: number; v: number }[]) {
  const n = pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  const mv = pts.reduce((s, p) => s + p.v, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const b = pts.reduce((s, p) => s + (p.y - my) * (p.v - mv), 0) / sxx;
  return { a: mv - b * my, b };
}

export function measureFromVectors(texts: TextBox[], segs: Seg[]): SheetMeasures | null {
  // 1. The ruler. Each written level sits just above or below the line it labels, so each
  // label has a few candidate lines. The ruler is the straight line (height against y) that
  // passes through a candidate of the most labels; labels that fit none (another drawing at
  // another scale, a stray number) are left out.
  const labels: { v: number; x: number; str: string; ys: number[] }[] = [];
  for (const t of texts) {
    const v = parseLevel(t.str);
    if (v === null) continue;
    const cy = (t.y0 + t.y1) / 2;
    const ys: number[] = [];
    for (const s of segs) {
      if (!horizontal(s) || len(s) < 15) continue;
      const gap = Math.max(0, Math.min(s.x1, s.x2) - t.x1, t.x0 - Math.max(s.x1, s.x2));
      if (gap > 150 || Math.abs(s.y1 - cy) > 12) continue;
      if (!ys.some((y) => Math.abs(y - s.y1) < 0.2)) ys.push(s.y1);
    }
    if (ys.length) labels.push({ v, x: (t.x0 + t.x1) / 2, str: t.str.trim(), ys });
  }
  const TOL = 0.75; // pt
  let best: { y: number; v: number; x: number; str: string }[] = [];
  let bestErr = Infinity;
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const A = labels[i];
      const B = labels[j];
      if (Math.abs(A.v - B.v) < 1) continue;
      for (const ya of A.ys) {
        for (const yb of B.ys) {
          const b = (B.v - A.v) / (yb - ya);
          if (!(b < 0) || -b > 1 || -b < 0.005) continue;
          const yOf = (v: number) => ya + (v - A.v) / b;
          const fits: { y: number; v: number; x: number; str: string }[] = [];
          let err = 0;
          for (const L of labels) {
            const want = yOf(L.v);
            const y = L.ys.reduce((q, c) => (Math.abs(c - want) < Math.abs(q - want) ? c : q));
            if (Math.abs(y - want) <= TOL) {
              fits.push({ y, v: L.v, x: L.x, str: L.str });
              err += Math.abs(y - want);
            }
          }
          const distinct = new Set(fits.map((p) => Math.round(p.v * 12))).size;
          const bestDistinct = new Set(best.map((p) => Math.round(p.v * 12))).size;
          if (distinct > bestDistinct || (distinct === bestDistinct && err < bestErr)) {
            best = fits;
            bestErr = err;
          }
        }
      }
    }
  }
  const pts = best;
  // At least three distinct levels must agree, so a chance fit of two labels is never used.
  if (new Set(pts.map((p) => Math.round(p.v * 12))).size < 3) return null;
  const line = fit(pts);
  const H = (y: number) => line.a + line.b * y;
  const ftPerPt = -line.b;

  // 2. The drawing: between the level labels, from a little below the lowest level to well above the highest.
  const xs = pts.map((p) => p.x);
  const vMin = Math.min(...pts.map((p) => p.v));
  const vMax = Math.max(...pts.map((p) => p.v));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const inside = (x: number, y: number) => x > xMin + 10 && x < xMax - 10 && H(y) > vMin - 3 && H(y) < vMax + 20;
  // Lines around and under text (note boxes, labels, leaders) are not part of the house.
  const nearText = (x: number, y: number) => texts.some((t) => x > t.x0 - 14 && x < t.x1 + 14 && y > t.y0 - 14 && y < t.y1 + 14);
  const drawn = segs.filter((s) => inside(s.x1, s.y1) && inside(s.x2, s.y2) && !nearText((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2));
  if (!drawn.length) return null;

  // The left wall: the leftmost long vertical line of the drawing.
  const walls = drawn.filter((s) => vertical(s) && len(s) * ftPerPt > 3);
  const left = walls.length ? Math.min(...walls.map((s) => s.x1)) : Math.min(...drawn.map((s) => Math.min(s.x1, s.x2)));
  const X = (x: number) => (x - left) * ftPerPt;

  // 3. Peaks: points where a line rising from the left meets a line rising from the right.
  const ends = new Map<string, { x: number; y: number; dirs: Set<'l' | 'r'> }>();
  for (const s of drawn) {
    const l = len(s) * ftPerPt;
    if (l < 1) continue;
    const slope = Math.abs((s.y2 - s.y1) / (s.x2 - s.x1 || 1e-9));
    if (slope < 0.15 || slope > 6) continue;
    const [hi, lo] = s.y1 < s.y2 ? [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }] : [{ x: s.x2, y: s.y2 }, { x: s.x1, y: s.y1 }];
    const key = `${Math.round(hi.x * 2)},${Math.round(hi.y * 2)}`;
    if (!ends.has(key)) ends.set(key, { x: hi.x, y: hi.y, dirs: new Set() });
    ends.get(key)!.dirs.add(lo.x < hi.x ? 'l' : 'r');
  }
  // The eave of a peak: follow each sloping line down from the peak, through any line that
  // carries on in the same direction from where the last one ended, to where the slope stops.
  // That is the bottom edge of the roof, measured from the drawing rather than assumed to sit
  // on a written floor or ceiling level (a roof often bears below or above the ceiling).
  const sloped = drawn
    .filter((s) => !horizontal(s) && !vertical(s) && len(s) * ftPerPt >= 1)
    .map((s) => (s.y1 < s.y2 ? { hx: s.x1, hy: s.y1, lx: s.x2, ly: s.y2 } : { hx: s.x2, hy: s.y2, lx: s.x1, ly: s.y1 }));
  const near = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) < 1 && Math.abs(ay - by) < 1;
  function slopeEnd(px: number, py: number, side: 'l' | 'r'): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let cur = { x: px, y: py };
    let slope = 0; // set by the first line: later pieces must carry on at the same slope
    for (let step = 0; step < 20; step++) {
      const next = sloped
        .filter((s) => {
          if (!near(s.hx, s.hy, cur.x, cur.y) || (side === 'l' ? s.lx >= s.hx : s.lx <= s.hx) || s.ly <= cur.y + 0.5) return false;
          const k = (s.ly - s.hy) / Math.abs(s.lx - s.hx);
          return !slope || Math.abs(k - slope) < 0.05 * slope;
        })
        .sort((a, b) => b.ly - a.ly)[0];
      if (!next) break;
      if (!slope) slope = (next.ly - next.hy) / Math.abs(next.lx - next.hx);
      cur = { x: next.lx, y: next.ly };
      best = cur;
    }
    return best;
  }
  const peaks: SheetMeasures['peaks'] = [];
  for (const e of [...ends.values()].filter((e) => e.dirs.size === 2).sort((a, b) => a.y - b.y)) {
    const p: SheetMeasures['peaks'][number] = { height: H(e.y), at: X(e.x) };
    const l = slopeEnd(e.x, e.y, 'l');
    const r = slopeEnd(e.x, e.y, 'r');
    // Both sides end at the same height on a symmetric roof; otherwise the lower end is the eave.
    if (l && r) p.eave = { height: H(Math.max(l.y, r.y)), from: X(l.x), to: X(r.x) };
    if (peaks.some((q) => Math.abs(q.at - p.at) < 2)) continue;
    peaks.push(p);
    if (peaks.length === 8) break;
  }

  // 4. Long horizontal edges, merged by height (within an inch).
  const rows: { height: number; from: number; to: number; total: number }[] = [];
  for (const s of drawn) {
    if (!horizontal(s)) continue;
    const l = len(s) * ftPerPt;
    if (l < 1) continue;
    const h = H(s.y1);
    const from = X(Math.min(s.x1, s.x2));
    const to = X(Math.max(s.x1, s.x2));
    const r = rows.find((q) => Math.abs(q.height - h) < 1 / 12);
    if (r) {
      r.from = Math.min(r.from, from);
      r.to = Math.max(r.to, to);
      r.total += l;
    } else rows.push({ height: h, from, to, total: l });
  }
  // Doubled lines (a fascia, a sill) within 1.5" are one edge.
  const long = rows.filter((r) => r.total >= 2).sort((a, b) => b.height - a.height);
  const merged: { height: number; bottom: number; from: number; to: number; total: number }[] = [];
  for (const r of long) {
    const g = merged[merged.length - 1];
    if (g && g.bottom - r.height <= 1.5 / 12) {
      g.bottom = r.height;
      g.from = Math.min(g.from, r.from);
      g.to = Math.max(g.to, r.to);
      g.total = Math.max(g.total, r.total);
    } else merged.push({ height: r.height, bottom: r.height, from: r.from, to: r.to, total: r.total });
  }
  // Siding and other courses: 4 or more evenly spaced lines under 8" apart become one entry.
  const edges: SheetMeasures['edges'] = [];
  const score: number[] = [];
  for (let i = 0; i < merged.length; ) {
    let j = i + 1;
    const gap = j < merged.length ? merged[i].height - merged[j].height : 0;
    while (j < merged.length && gap <= 8 / 12 && Math.abs(merged[j - 1].height - merged[j].height - gap) <= 0.75 / 12) j++;
    const run = merged.slice(i, j);
    if (run.length >= 4) {
      edges.push({ height: run[0].height, bottom: run[run.length - 1].height, courses: run.length, from: Math.min(...run.map((r) => r.from)), to: Math.max(...run.map((r) => r.to)) });
      score.push(Infinity);
      i = j;
    } else {
      const r = merged[i];
      edges.push({ height: r.height, from: r.from, to: r.to });
      score.push(r.total);
      i++;
    }
  }
  const keep = new Set([...score.keys()].sort((x, y) => score[y] - score[x]).slice(0, 16));
  const kept = edges.filter((_, k) => keep.has(k));
  edges.length = 0;
  edges.push(...kept);

  return { ftPerPt, levels: [...new Set(pts.map((p) => p.str))], peaks, edges };
}

/** The measurements as plain text for Claude. */
export function describeMeasures(title: string, m: SheetMeasures): string {
  const lines = [
    `"${title}": heights in the drawing's own level system (the same as its written levels), measured with its written levels ${m.levels.join(', ')} as the ruler, about ±1". Positions are feet from the leftmost wall line on the sheet.`,
  ];
  if (m.peaks.length) lines.push(`- Peaks where two sloping lines meet: ${m.peaks.map((p) => `${fmtFt(p.height)} at ${fmtFt(p.at)}`).join('; ')}.`);
  const eaves = m.peaks.filter((p) => p.eave);
  if (eaves.length)
    lines.push(
      `- Roof eaves, where the sloping lines down from each peak end (the bottom edge of that roof, as drawn): ${eaves
        .map((p) => `under the ${fmtFt(p.height)} peak, ${fmtFt(p.eave!.height)} (from ${fmtFt(p.eave!.from)} to ${fmtFt(p.eave!.to)})`)
        .join('; ')}.`,
    );
  if (m.edges.length)
    lines.push(`- Long horizontal edges: ${m.edges
        .map((e) => `${e.courses ? `${e.courses} evenly spaced lines (siding or courses) from ${fmtFt(e.height)} down to ${fmtFt(e.bottom!)}` : fmtFt(e.height)} (from ${fmtFt(e.from)} to ${fmtFt(e.to)})`)
        .join('; ')}.`);
  return lines.join('\n');
}

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** Minimal shape of a pdf.js page, so this runs in the browser and in tests. */
export interface PdfPageLike {
  getViewport(o: { scale: number }): { transform: number[] };
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
}

/** Lines and text of one PDF page, in screen points (rotation applied). */
export async function pageVectors(
  page: PdfPageLike,
  OPS: { save: number; restore: number; transform: number; constructPath: number },
): Promise<{ texts: TextBox[]; segs: Seg[] }> {
  const vt = page.getViewport({ scale: 1 }).transform as Matrix;
  const texts: TextBox[] = [];
  for (const raw of (await page.getTextContent()).items) {
    const it = raw as { str?: string; transform?: number[]; width?: number };
    if (!it.str?.trim() || !it.transform) continue;
    const m = mul(vt, it.transform as Matrix);
    const w = (it.width ?? 0) / (Math.hypot(it.transform[0], it.transform[1]) || 1);
    const corners = [apply(m, 0, 0), apply(m, w, 0), apply(m, 0, 1), apply(m, w, 1)];
    texts.push({
      str: it.str,
      x0: Math.min(...corners.map((c) => c.x)),
      x1: Math.max(...corners.map((c) => c.x)),
      y0: Math.min(...corners.map((c) => c.y)),
      y1: Math.max(...corners.map((c) => c.y)),
    });
  }
  const ops = await page.getOperatorList();
  const segs: Seg[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i];
    const a = ops.argsArray[i];
    if (f === OPS.save) stack.push(ctm);
    else if (f === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (f === OPS.transform) ctm = mul(ctm, a as unknown as Matrix);
    else if (f === OPS.constructPath) {
      // pdf.js 5+: [op, [Float32Array of (code, coords...)], minMax]. Codes: 0 moveTo, 1 lineTo, 2 curveTo, 3 quadraticCurveTo, 4 closePath.
      const data = Object.values(((a?.[1] as unknown[]) ?? [])[0] ?? {}) as number[];
      const m = mul(vt, ctm);
      let cur: { x: number; y: number } | null = null;
      let start: { x: number; y: number } | null = null;
      let k = 0;
      while (k < data.length) {
        const code = data[k++];
        if (code === 0) {
          cur = start = apply(m, data[k], data[k + 1]);
          k += 2;
        } else if (code === 1) {
          const p = apply(m, data[k], data[k + 1]);
          if (cur) segs.push({ x1: cur.x, y1: cur.y, x2: p.x, y2: p.y });
          cur = p;
          k += 2;
        } else if (code === 2) {
          cur = apply(m, data[k + 4], data[k + 5]);
          k += 6;
        } else if (code === 3) {
          cur = apply(m, data[k + 2], data[k + 3]);
          k += 4;
        } else if (code === 4) {
          if (cur && start) segs.push({ x1: cur.x, y1: cur.y, x2: start.x, y2: start.y });
          cur = start;
        } else break;
      }
    }
  }
  return { texts, segs };
}
