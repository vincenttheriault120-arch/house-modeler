import type { PlanKind } from '../plans/store';
import type { Point3 } from './dimensions';
import { outlineWithSources } from './geometry';
import type { Project } from './types';

/**
 * Setting a plan's scale and placing it against the model.
 *
 * On each sheet the person clicks two points: A, a reference corner of the
 * house, then B, the other end of a dimension they trust measured from A,
 * and types that dimension. That gives the scale (mm per PDF unit) and ties
 * the sheet to the model:
 *
 * - floor plans and the top view: A is the front-left outside corner;
 * - elevations: A is the left end of the house on that drawing, at grade.
 *
 * Sheets are assumed square to the page (front of the house at the bottom of
 * a floor plan), which is how plans are drawn.
 */

/** A point on a PDF page, in PDF units at scale 1, from the top-left corner. */
export interface PagePoint {
  x: number;
  y: number;
}

export interface Calibration {
  page: number;
  a: PagePoint;
  b: PagePoint;
  /** The real length between A and B. */
  mm: number;
}

/** Which way the model is seen when this sheet is laid over it. */
export type SheetView = 'top' | 'front' | 'back' | 'left' | 'right';

export function viewForKind(kind: PlanKind): SheetView | null {
  switch (kind) {
    case 'basement':
    case 'ground-floor':
    case 'first-floor':
    case 'roof':
      return 'top';
    case 'elevation-front':
      return 'front';
    case 'elevation-back':
      return 'back';
    case 'elevation-left':
      return 'left';
    case 'elevation-right':
      return 'right';
    default:
      return null;
  }
}

/** What to click first, in plain words. */
export function anchorHint(view: SheetView): string {
  return view === 'top'
    ? 'Click the front-left outside corner of the house.'
    : 'Click the left end of the house on this drawing, at grade (finished ground).';
}

export function mmPerUnit(c: Calibration): number {
  const d = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
  return d > 0 ? c.mm / d : 0;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The plan extent of every visible foundation; a point at the origin when there are none. */
export function footprintBounds(project: Project): Bounds {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const s of project.steps) {
    if (s.kind !== 'foundation' || !s.visible) continue;
    for (const p of outlineWithSources(s.params.runs, s.params.origin).poly) {
      b.minX = Math.min(b.minX, p.x);
      b.maxX = Math.max(b.maxX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxY = Math.max(b.maxY, p.y);
    }
  }
  return Number.isFinite(b.minX) ? b : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
}

/** Where a point on the sheet lands in the model (mm; the axis the view looks along is left at the bounds' edge). */
export function sheetToModel(view: SheetView, c: Calibration, bounds: Bounds, p: PagePoint): Point3 {
  const k = mmPerUnit(c);
  const u = (p.x - c.a.x) * k; // to the right on the sheet
  const v = -(p.y - c.a.y) * k; // up the sheet
  switch (view) {
    case 'top':
      return { x: bounds.minX + u, y: bounds.minY + v, z: 0 };
    case 'front':
      return { x: bounds.minX + u, y: bounds.minY, z: v };
    case 'back':
      return { x: bounds.maxX - u, y: bounds.maxY, z: v };
    case 'left':
      return { x: bounds.minX, y: bounds.maxY - u, z: v };
    case 'right':
      return { x: bounds.maxX, y: bounds.minY + u, z: v };
  }
}

/** The whole sheet as a rectangle in the model: its centre and size in mm. */
export function sheetPlacement(view: SheetView, c: Calibration, bounds: Bounds, pageWidth: number, pageHeight: number) {
  const k = mmPerUnit(c);
  return {
    center: sheetToModel(view, c, bounds, { x: pageWidth / 2, y: pageHeight / 2 }),
    width: pageWidth * k,
    height: pageHeight * k,
  };
}
