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

export interface StoreyLayout {
  walls: InteriorWall[];
  rooms: Room[];
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

/** Interior walls as 3D pieces, standing on each storey's floor. */
export function interiorComponents(project: Project): Component[] {
  const out: Component[] = [];
  for (const s of STOREYS) {
    const layout = project.interior?.[s.id];
    if (!layout?.walls.length) continue;
    const { bottom, top } = storeyHeights(project, s.id);
    layout.walls.forEach((w, i) => {
      if (wallLength(w) < 1) return;
      out.push({
        id: `interior:${s.id}:${w.id}`,
        stepId: `interior:${s.id}`,
        name: `${s.name} wall ${i + 1}`,
        kind: 'interior-wall',
        material: 'drywall',
        outline: wallOutline(w),
        bottom,
        top,
        dims: [
          { label: 'Length', mm: wallLength(w) },
          { label: 'Thickness', mm: w.thickness },
          { label: 'Height', mm: top - bottom },
        ],
      });
    });
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
