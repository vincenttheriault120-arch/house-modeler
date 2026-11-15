/**
 * Plan geometry. Plan coordinates are in mm: X to the right, Y up the page
 * (towards the back of the house when the front is at the bottom).
 */

export interface Vec2 {
  x: number;
  y: number;
}

export type Direction = 'right' | 'up' | 'left' | 'down';

/** One side of an outline, as read off a plan: "go 21' 1 1/2" to the right". */
export interface Run {
  dir: Direction;
  length: number;
}

const DIR_VEC: Record<Direction, Vec2> = {
  right: { x: 1, y: 0 },
  up: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  down: { x: 0, y: -1 },
};

/** Walk the runs from `start`. Returns every corner, starting point first (not repeated at the end). */
export function runsToPoints(runs: Run[], start: Vec2 = { x: 0, y: 0 }): Vec2[] {
  const pts: Vec2[] = [{ ...start }];
  let p = { ...start };
  for (const r of runs) {
    const d = DIR_VEC[r.dir];
    p = { x: p.x + d.x * r.length, y: p.y + d.y * r.length };
    pts.push(p);
  }
  return pts;
}

/**
 * The gap between where the runs end and where they started. Zero when the
 * outline closes exactly.
 */
export function closingGap(runs: Run[]): Vec2 {
  const pts = runsToPoints(runs);
  const end = pts[pts.length - 1];
  return { x: -end.x, y: -end.y };
}

/** Polygon corners from runs. If the runs end on the start point, that duplicate is dropped. */
export function runsToPolygon(runs: Run[], start: Vec2 = { x: 0, y: 0 }): Vec2[] {
  const pts = runsToPoints(runs, start);
  const last = pts[pts.length - 1];
  if (pts.length > 1 && Math.hypot(last.x - start.x, last.y - start.y) < 0.5) pts.pop();
  return removeCollinear(pts);
}

/** Positive when the corners go counter-clockwise. */
export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function ensureCCW(poly: Vec2[]): Vec2[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

function removeCollinear(poly: Vec2[]): Vec2[] {
  if (poly.length < 4) return poly;
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[(i - 1 + poly.length) % poly.length];
    const b = poly[i];
    const c = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dup = Math.hypot(b.x - a.x, b.y - a.y) < 1e-6;
    if (Math.abs(cross) > 1e-6 && !dup) out.push(b);
  }
  return out;
}

/**
 * Offset a counter-clockwise polygon. Positive `d` moves edges inward,
 * negative outward. Corners are mitred (correct for the square corners of
 * a house outline).
 */
export function offsetPolygon(poly: Vec2[], d: number): Vec2[] {
  const n = poly.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const n1 = inwardNormal(prev, cur);
    const n2 = inwardNormal(cur, next);
    // Intersect the two offset edge lines.
    const p1 = { x: prev.x + n1.x * d, y: prev.y + n1.y * d };
    const d1 = { x: cur.x - prev.x, y: cur.y - prev.y };
    const p2 = { x: cur.x + n2.x * d, y: cur.y + n2.y * d };
    const d2 = { x: next.x - cur.x, y: next.y - cur.y };
    const denom = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(denom) < 1e-9) {
      out.push({ x: cur.x + n1.x * d, y: cur.y + n1.y * d });
      continue;
    }
    const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
    out.push({ x: p1.x + d1.x * t, y: p1.y + d1.y * t });
  }
  return out;
}

/** Left-hand normal of edge a→b, which points inside a CCW polygon. */
function inwardNormal(a: Vec2, b: Vec2): Vec2 {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

export function edgeLength(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Split a band between an outer and inner polygon (same corner count) into
 * one quad per side, with mitred corners. Used for walls and footings.
 */
export function bandSegments(outer: Vec2[], inner: Vec2[]): Vec2[][] {
  const n = outer.length;
  const segs: Vec2[][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    segs.push([outer[i], outer[j], inner[j], inner[i]]);
  }
  return segs;
}
