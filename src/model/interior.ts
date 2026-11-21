import type { Component } from './component';
import { bounds, ensureCCW, outlineWithSources, offsetPolygon, signedArea, type Vec2 } from './geometry';
import { sortLevels } from './levels';
import type { PlanKind } from '../plans/store';
import type { Project } from './types';

/**
 * Phase 2: what is inside the exterior walls, one storey at a time.
 *
 * Interior walls are straight segments along their centre line with a
 * thickness. Rooms are named outlines traced along the inside faces of the
 * walls, so their area and sizes are the clear inside ones. All in mm, in
 * plan coordinates (x right, y up the page, front of the house at y = min).
 */

export type StoreyId = 'basement' | 'ground-floor' | 'first-floor';

export interface InteriorWall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
}

export interface Room {
  id: string;
  name: string;
  outline: Vec2[];
}

/** A door or a plain opening cut in an interior wall. */
export interface Door {
  id: string;
  wallId: string;
  kind: 'door' | 'opening';
  /** From the wall's start to the middle of the opening, along its centre line. */
  at: number;
  /** Rough opening width (a 32" door needs about 34"). */
  width: number;
  height: number;
  /** Which side the door swings to (1: left of the wall's direction, -1: right) and which jamb holds the hinges. */
  swing?: 1 | -1;
  hinge?: 'start' | 'end';
}

export type Heading = 'up' | 'down' | 'left' | 'right';

/** A straight stair climbing from this storey to the next one. */
export interface Stair {
  id: string;
  /** Corner of the stair's footprint with the smallest x and y. */
  x: number;
  y: number;
  /** Footprint size along x and y. */
  sx: number;
  sy: number;
  /** Which way you walk going up (on the plan). */
  heading: Heading;
  /** Number of risers; left out, it is worked out from the rise. */
  risers?: number;
}

export interface StoreyLayout {
  walls: InteriorWall[];
  rooms: Room[];
  doors?: Door[];
  stairs?: Stair[];
  /** Ticked once the person has checked this storey against its plan. */
  verified?: boolean;
}

export const STOREYS: { id: StoreyId; name: string; plan: PlanKind }[] = [
  { id: 'basement', name: 'Basement', plan: 'basement' },
  { id: 'ground-floor', name: 'Ground floor', plan: 'ground-floor' },
  { id: 'first-floor', name: 'First floor', plan: 'first-floor' },
];

/** A 2x4 partition with drywall both sides. */
export const DEFAULT_WALL = 4.5 * 25.4;
const FT = 304.8;
const IN = 25.4;
export const DOOR_DEFAULT = { door: { width: 34 * IN, height: 82.5 * IN }, opening: { width: 36 * IN, height: 82.5 * IN } };
/** National Building Code, private stairs: rise at most 200 mm, run at least 210 mm (255 mm is comfortable). */
export const MAX_RISE = 200;
export const MIN_RUN = 210;
/** Floor framing assumed above a storey when the next floor's own isn't modelled. */
const FLOOR_DEPTH = 12 * 25.4;

export function emptyLayout(): StoreyLayout {
  return { walls: [], rooms: [] };
}

export function layoutOf(project: Project, storey: StoreyId): StoreyLayout {
  return project.interior?.[storey] ?? emptyLayout();
}

/**
 * Where a storey's interior walls stand: from its floor to just under the
 * floor above (or 8' when there's nothing above yet), mm above grade.
 */
export function storeyHeights(project: Project, storey: StoreyId): { bottom: number; top: number } {
  const floors = sortLevels(project.levels).filter((l) => l.kind === 'floor');
  const above = floors.filter((l) => l.elevation > 0);
  const basement = project.steps.find((s) => s.kind === 'foundation' && s.params.type === 'basement');
  const basementFloor =
    basement?.kind === 'foundation'
      ? basement.params.topElevation - basement.params.wallHeight + basement.params.slabThickness
      : (floors.find((l) => l.elevation < 0)?.elevation ?? -7 * FT);
  const bottom = storey === 'basement' ? basementFloor : storey === 'ground-floor' ? (above[0]?.elevation ?? FT) : (above[1]?.elevation ?? (above[0]?.elevation ?? FT) + 9 * FT);
  const next = storey === 'basement' ? above[0] : storey === 'ground-floor' ? above[1] : above[2];
  const ceiling = sortLevels(project.levels).find((l) => l.kind === 'ceiling' && l.elevation > bottom + 1500 && (!next || l.elevation < next.elevation));
  const top = ceiling ? ceiling.elevation : next ? next.elevation - FLOOR_DEPTH : bottom + 8 * FT;
  return { bottom, top };
}

/** The exterior walls a storey sits in: each visible foundation's outside outline and its inside face. */
export function shellOutlines(project: Project): { id: string; outside: Vec2[]; inside: Vec2[] }[] {
  return project.steps.flatMap((s) => {
    if (s.kind !== 'foundation' || !s.visible) return [];
    const poly = outlineWithSources(s.params.runs, s.params.origin).poly;
    if (poly.length < 3) return [];
    const outside = ensureCCW(poly);
    return [{ id: s.id, outside, inside: offsetPolygon(outside, s.params.wallThickness) }];
  });
}

export function wallLength(w: Pick<InteriorWall, 'a' | 'b'>): number {
  return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
}

/** The wall as a rectangle in plan: its centre line widened by half its thickness each side. */
export function wallOutline(w: InteriorWall): Vec2[] {
  const len = wallLength(w) || 1;
  const nx = (-(w.b.y - w.a.y) / len) * (w.thickness / 2);
  const ny = ((w.b.x - w.a.x) / len) * (w.thickness / 2);
  return [
    { x: w.a.x - nx, y: w.a.y - ny },
    { x: w.b.x - nx, y: w.b.y - ny },
    { x: w.b.x + nx, y: w.b.y + ny },
    { x: w.a.x + nx, y: w.a.y + ny },
  ];
}

/** Move a wall's far end so it has this length, keeping its start and direction. */
export function withLength(w: InteriorWall, mm: number): InteriorWall {
  const len = wallLength(w);
  if (len < 1 || mm <= 0) return w;
  const k = mm / len;
  return { ...w, b: { x: w.a.x + (w.b.x - w.a.x) * k, y: w.a.y + (w.b.y - w.a.y) * k } };
}

export function roomArea(r: Pick<Room, 'outline'>): number {
  return Math.abs(signedArea(r.outline));
}

/** Clear width (left to right) and depth (front to back) of a room, mm. */
export function roomSize(r: Pick<Room, 'outline'>): { width: number; depth: number } {
  const b = bounds(r.outline);
  return { width: b.maxX - b.minX, depth: b.maxY - b.minY };
}

/** Area for display: square feet in imperial, square metres in metric. */
export function formatArea(mm2: number, units: 'imperial' | 'metric'): string {
  return units === 'imperial' ? `${(mm2 / (FT * FT)).toFixed(1)} sq ft` : `${(mm2 / 1e6).toFixed(2)} m²`;
}

/** The storey above, which a stair climbs to. */
export function storeyAbove(storey: StoreyId): StoreyId | null {
  const i = STOREYS.findIndex((s) => s.id === storey);
  return STOREYS[i + 1]?.id ?? null;
}

/** Doors in a wall, with their start and end along it, clamped to the wall and sorted. */
export function wallGaps(w: InteriorWall, doors: Door[] = []): { from: number; to: number; door: Door }[] {
  const len = wallLength(w);
  return doors
    .filter((d) => d.wallId === w.id)
    .map((d) => ({ from: Math.max(0, d.at - d.width / 2), to: Math.min(len, d.at + d.width / 2), door: d }))
    .filter((g) => g.to - g.from > 1)
    .sort((a, b) => a.from - b.from);
}

/** A piece of a wall between two distances along it, as a plan rectangle. */
export function wallPiece(w: InteriorWall, from: number, to: number): Vec2[] {
  const len = wallLength(w) || 1;
  const ux = (w.b.x - w.a.x) / len;
  const uy = (w.b.y - w.a.y) / len;
  return wallOutline({ ...w, a: { x: w.a.x + ux * from, y: w.a.y + uy * from }, b: { x: w.a.x + ux * to, y: w.a.y + uy * to } });
}

/** The solid lengths of a wall once its doors are cut out. */
export function wallSolids(w: InteriorWall, doors: Door[] = []): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const g of wallGaps(w, doors)) {
    if (g.from > at + 1) out.push([at, g.from]);
    at = Math.max(at, g.to);
  }
  const len = wallLength(w);
  if (len > at + 1) out.push([at, len]);
  return out;
}

/** Where a click along a wall puts a door: its middle, kept inside the wall, to the inch. */
export function doorAt(w: InteriorWall, p: Vec2, width: number): number {
  const len = wallLength(w);
  const t = ((p.x - w.a.x) * (w.b.x - w.a.x) + (p.y - w.a.y) * (w.b.y - w.a.y)) / (len || 1);
  const half = Math.min(width / 2, len / 2);
  return Math.max(half, Math.min(len - half, Math.round(t / IN) * IN));
}

export interface StairFit {
  rise: number;
  risers: number;
  /** Height of each step. */
  riserHeight: number;
  /** Depth of each tread (going), along the length of the stair. */
  tread: number;
  length: number;
  width: number;
  ok: boolean;
  problems: string[];
}

/** How a stair climbs between two storeys, and whether it meets the code. */
export function stairFit(project: Project, storey: StoreyId, st: Stair): StairFit {
  const above = storeyAbove(storey);
  const bottom = storeyHeights(project, storey).bottom;
  const top = above ? storeyHeights(project, above).bottom : bottom + 9 * FT;
  const rise = Math.max(0, top - bottom);
  const along = st.heading === 'up' || st.heading === 'down';
  const length = along ? st.sy : st.sx;
  const width = along ? st.sx : st.sy;
  const risers = Math.max(2, st.risers ?? Math.ceil(rise / MAX_RISE - 1e-9));
  const riserHeight = rise / risers;
  const tread = length / (risers - 1);
  const problems: string[] = [];
  if (riserHeight > MAX_RISE + 0.5) problems.push(`Steps are too tall: ${Math.round(riserHeight)} mm, the code allows 200 mm (7 7/8").`);
  if (tread < MIN_RUN - 0.5) problems.push(`Treads are too shallow: ${Math.round(tread)} mm, the code asks for 210 mm (8 1/4") or more.`);
  if (width < 860 - 0.5) problems.push('Narrower than the 860 mm (2\' 10") the code asks for.');
  return { rise, risers, riserHeight, tread, length, width, ok: problems.length === 0, problems };
}

/** The stair's footprint corners on the plan. */
export function stairOutline(st: Stair): Vec2[] {
  return [
    { x: st.x, y: st.y },
    { x: st.x + st.sx, y: st.y },
    { x: st.x + st.sx, y: st.y + st.sy },
    { x: st.x, y: st.y + st.sy },
  ];
}

/** Each tread's footprint, bottom step first. */
export function stairTreads(st: Stair, count: number): Vec2[][] {
  const out: Vec2[][] = [];
  for (let i = 0; i < count; i++) {
    const f0 = i / count;
    const f1 = (i + 1) / count;
    let x0 = st.x, x1 = st.x + st.sx, y0 = st.y, y1 = st.y + st.sy;
    if (st.heading === 'up') (y0 = st.y + st.sy * f0), (y1 = st.y + st.sy * f1);
    if (st.heading === 'down') (y1 = st.y + st.sy * (1 - f0)), (y0 = st.y + st.sy * (1 - f1));
    if (st.heading === 'right') (x0 = st.x + st.sx * f0), (x1 = st.x + st.sx * f1);
    if (st.heading === 'left') (x1 = st.x + st.sx * (1 - f0)), (x0 = st.x + st.sx * (1 - f1));
    out.push([
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ]);
  }
  return out;
}

/** Interior walls (with their doors cut out and a header over each door) and stairs, as 3D pieces. */
export function interiorComponents(project: Project): Component[] {
  const out: Component[] = [];
  for (const s of STOREYS) {
    const layout = project.interior?.[s.id];
    if (!layout) continue;
    const { bottom, top } = storeyHeights(project, s.id);
    const stepId = `interior:${s.id}`;
    layout.walls.forEach((w, i) => {
      const len = wallLength(w);
      if (len < 1) return;
      const name = `${s.name} wall ${i + 1}`;
      const dims = [
        { label: 'Length', mm: len },
        { label: 'Thickness', mm: w.thickness },
        { label: 'Height', mm: top - bottom },
      ];
      wallSolids(w, layout.doors).forEach(([from, to], k) => {
        out.push({ id: `${stepId}:${w.id}:${k}`, stepId, name, kind: 'interior-wall', material: 'drywall', outline: wallPiece(w, from, to), bottom, top, dims });
      });
      for (const g of wallGaps(w, layout.doors)) {
        const head = bottom + g.door.height;
        if (head < top - 1) {
          out.push({ id: `${stepId}:${w.id}:${g.door.id}:head`, stepId, name: `${name}, over the ${g.door.kind}`, kind: 'interior-wall', material: 'drywall', outline: wallPiece(w, g.from, g.to), bottom: head, top, dims });
        }
      }
    });
    for (const st of layout.stairs ?? []) {
      const fit = stairFit(project, s.id, st);
      // The top riser lands on the floor above, so there is one tread fewer than risers.
      stairTreads(st, fit.risers - 1).forEach((tread, k) => {
        out.push({
          id: `${stepId}:${st.id}:${k}`,
          stepId,
          name: `${s.name} stair, step ${k + 1}`,
          kind: 'stair',
          material: 'lumber',
          outline: tread,
          bottom,
          top: bottom + fit.riserHeight * (k + 1),
          dims: [
            { label: 'Rise', mm: fit.riserHeight },
            { label: 'Tread', mm: fit.tread },
            { label: 'Width', mm: fit.width },
          ],
        });
      });
    }
  }
  return out;
}

// ----- Snapping while drawing -----

export interface Snap {
  p: Vec2;
  /** What it snapped to, shown next to the cursor. */
  kind: 'corner' | 'face' | 'end' | 'grid' | 'square';
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Lines worth snapping to: the shell's faces and both faces of every interior wall. */
export function snapTargets(project: Project, layout: StoreyLayout, mode: 'centre' | 'face') {
  const points: Vec2[] = [];
  const segments: [Vec2, Vec2][] = [];
  const ring = (poly: Vec2[]) => poly.forEach((p, i) => (points.push(p), segments.push([p, poly[(i + 1) % poly.length]])));
  for (const s of shellOutlines(project)) {
    ring(s.inside);
    ring(s.outside);
  }
  for (const w of layout.walls) {
    if (mode === 'centre') {
      points.push(w.a, w.b);
      segments.push([w.a, w.b]);
    } else ring(wallOutline(w));
  }
  for (const r of layout.rooms) points.push(...r.outline);
  return { points, segments };
}

/**
 * Where a click lands: a nearby corner first, then square to the previous
 * point, then onto a nearby face, else the nearest whole inch (or 10 mm).
 */
export function snap(
  raw: Vec2,
  targets: { points: Vec2[]; segments: [Vec2, Vec2][] },
  tolerance: number,
  from: Vec2 | null,
  step = 25.4,
): Snap {
  let best: Vec2 | null = null;
  let bestD = tolerance;
  for (const p of targets.points) {
    const d = dist(raw, p);
    if (d < bestD) (best = p), (bestD = d);
  }
  if (best) return { p: best, kind: 'corner' };

  let p = raw;
  let kind: Snap['kind'] = 'grid';
  if (from) {
    // Lock to horizontal or vertical when close to it.
    const dx = raw.x - from.x;
    const dy = raw.y - from.y;
    if (Math.abs(dy) < Math.abs(dx) * 0.14) (p = { x: raw.x, y: from.y }), (kind = 'square');
    else if (Math.abs(dx) < Math.abs(dy) * 0.14) (p = { x: from.x, y: raw.y }), (kind = 'square');
  }
  // Onto a face: keep the square lock by sliding along it to the face.
  let face: Vec2 | null = null;
  let faceD = tolerance;
  for (const [a, b] of targets.segments) {
    const q = closestOnSegment(p, a, b);
    const d = dist(p, q);
    if (d < faceD) {
      faceD = d;
      if (kind === 'square' && from) {
        const horizontal = p.y === from.y;
        const vertical = Math.abs(b.x - a.x) < 1;
        const flat = Math.abs(b.y - a.y) < 1;
        if (horizontal && vertical) face = { x: a.x, y: p.y };
        else if (!horizontal && flat) face = { x: p.x, y: a.y };
        else face = q;
      } else face = q;
    }
  }
  if (face) return { p: face, kind: 'face' };
  const r = (v: number) => Math.round(v / step) * step;
  if (kind === 'square' && from) return { p: p.y === from.y ? { x: from.x + r(p.x - from.x), y: from.y } : { x: from.x, y: from.y + r(p.y - from.y) }, kind };
  return { p: { x: r(p.x), y: r(p.y) }, kind: 'grid' };
}
