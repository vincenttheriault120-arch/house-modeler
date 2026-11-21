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
  return outlineWithSources(runs, start).poly;
}

/**
 * Polygon corners plus, for each side (corner i → corner i+1), which run it
 * came from. A side is `null` when it is the automatic closing side or when
 * several runs merged into one straight side.
 */
export function outlineWithSources(runs: Run[], start: Vec2 = { x: 0, y: 0 }): { poly: Vec2[]; edgeRun: (number | null)[] } {
  let poly = runsToPoints(runs, start);
  let edgeRun: (number | null)[] = runs.map((_, i) => i);
  const last = poly[poly.length - 1];
  if (poly.length > 1 && Math.hypot(last.x - start.x, last.y - start.y) < 0.5) {
    poly.pop();
  } else {
    edgeRun.push(null); // closing side
  }
  // Drop zero-length sides and corners that sit on a straight line.
  let changed = true;
  while (changed && poly.length > 3) {
    changed = false;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[(i - 1 + n) % n];
      const b = poly[i];
      const c = poly[(i + 1) % n];
      const prevEdge = (i - 1 + n) % n;
      const zeroPrev = Math.hypot(b.x - a.x, b.y - a.y) < 1e-6;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (zeroPrev || Math.abs(cross) < 1e-6) {
        // Merge side prevEdge (a→b) and side i (b→c) into a→c.
        const merged = zeroPrev ? edgeRun[i] : edgeRun[prevEdge] === edgeRun[i] ? edgeRun[i] : null;
        edgeRun = edgeRun.slice();
        edgeRun[prevEdge] = merged;
        edgeRun.splice(i, 1);
        poly = poly.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return { poly, edgeRun };
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

/**
 * Where a straight line crosses a polygon: for the line `axis = c`
 * (axis 'x' means the vertical line x = c), the [from, to] intervals along the
 * other axis that lie inside the polygon, in increasing order.
 */
export function scanIntervals(poly: Vec2[], axis: 'x' | 'y', c: number): [number, number][] {
  const other = axis === 'x' ? 'y' : 'x';
  const hits: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    // Half-open rule so a line through a vertex is counted once.
    if ((a[axis] <= c && b[axis] > c) || (b[axis] <= c && a[axis] > c)) {
      const t = (c - a[axis]) / (b[axis] - a[axis]);
      hits.push(a[other] + t * (b[other] - a[other]));
    }
  }
  hits.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < hits.length; i += 2) if (hits[i + 1] - hits[i] > 1e-6) out.push([hits[i], hits[i + 1]]);
  return out;
}

/** Axis-aligned bounds of a polygon. */
export function bounds(poly: Vec2[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** A rectangle as a counter-clockwise outline. */
export function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Whether a point is strictly inside a polygon (even-odd rule). */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
