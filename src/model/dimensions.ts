import { edgeLength, outlineWithSources, pointInPolygon, signedArea, type Vec2 } from './geometry';
import { sortLevels } from './levels';
import type { Project } from './types';

/**
 * Measurements drawn on the model in clay mode, like the dimensions on a
 * drawing. Everything in mm, in plan coordinates (x right, y up the page)
 * plus an elevation z above grade.
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** A length along one side of an outline, drawn just outside it. */
export interface LengthDimension {
  kind: 'length';
  id: string;
  stepId: string;
  /** The outline side (run) it measures, when it maps to one. */
  runIndex: number | null;
  /** Ends of the dimension line (offset outward from the side). */
  a: Point3;
  b: Point3;
  /** Ends of the side itself, where the extension lines start. */
  from: [Point3, Point3];
  mm: number;
}

/** One level on the vertical level marker beside the model. */
export interface LevelMark {
  kind: 'level';
  id: string;
  name: string;
  /** mm above grade. */
  elevation: number;
  at: Point3;
}

/** How far outside a wall the dimension line sits. */
export const DIM_OFFSET = 900;
/** Gap between the model and the level marker. */
export const LEVEL_GAP = 1500;

function outward(poly: Vec2[], i: number): Vec2 {
  const a = poly[i];
  const b = poly[(i + 1) % poly.length];
  const len = edgeLength(a, b) || 1;
  const s = signedArea(poly) > 0 ? 1 : -1; // counter-clockwise: outside is to the right of each edge
  return { x: (s * (b.y - a.y)) / len, y: (s * -(b.x - a.x)) / len };
}

/**
 * Lengths of every outside side of every visible foundation, at the top of
 * its walls. A side shared with another foundation (the wall between the
 * basement and the garage) would draw its line over the neighbour, so it is
 * left out.
 */
export function lengthDimensions(project: Project): LengthDimension[] {
  const out: LengthDimension[] = [];
  const outlines = project.steps.flatMap((step) =>
    step.kind === 'foundation' && step.visible ? [{ step, ...outlineWithSources(step.params.runs, step.params.origin) }] : [],
  );
  for (const { step, poly, edgeRun } of outlines) {
    if (poly.length < 3) continue;
    const others = outlines.filter((o) => o.step !== step && o.poly.length >= 3).map((o) => o.poly);
    const z = step.params.topElevation;
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const mm = edgeLength(a, b);
      if (mm < 1) return;
      const n = outward(poly, i);
      const probe = { x: (a.x + b.x) / 2 + n.x * DIM_OFFSET, y: (a.y + b.y) / 2 + n.y * DIM_OFFSET };
      if (others.some((o) => pointInPolygon(probe, o))) return;
      const off = (p: Vec2): Point3 => ({ x: p.x + n.x * DIM_OFFSET, y: p.y + n.y * DIM_OFFSET, z });
      out.push({
        kind: 'length',
        id: `${step.id}:side:${i}`,
        stepId: step.id,
        runIndex: edgeRun[i] ?? null,
        a: off(a),
        b: off(b),
        from: [
          { x: a.x, y: a.y, z },
          { x: b.x, y: b.y, z },
        ],
        mm,
      });
    });
  }
  return out;
}

/** The front-left corner of everything built so far, in plan. */
export function footprintCorner(project: Project): Vec2 | null {
  let minX = Infinity;
  let minY = Infinity;
  for (const step of project.steps) {
    if (step.kind !== 'foundation' || !step.visible) continue;
    for (const p of outlineWithSources(step.params.runs, step.params.origin).poly) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY } : null;
}

/** Grade plus every level, lowest first, on a marker just left of the model's front corner. */
export function levelMarks(project: Project): LevelMark[] {
  const corner = footprintCorner(project) ?? { x: 0, y: 0 };
  const at = (z: number): Point3 => ({ x: corner.x - LEVEL_GAP, y: corner.y, z });
  const levels = sortLevels(project.levels);
  const marks: LevelMark[] = levels.map((l) => ({ kind: 'level', id: l.id, name: l.name, elevation: l.elevation, at: at(l.elevation) }));
  if (!levels.some((l) => Math.abs(l.elevation) < 1)) {
    marks.push({ kind: 'level', id: 'grade', name: 'Grade', elevation: 0, at: at(0) });
  }
  return marks.sort((a, b) => a.elevation - b.elevation);
}
