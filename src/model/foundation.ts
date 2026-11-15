import type { Component } from './component';
import { bandSegments, edgeLength, offsetPolygon, outlineWithSources, runsToPolygon, signedArea, type Run, type Vec2 } from './geometry';

export type FoundationType = 'basement' | 'slab-on-grade';

/** Inputs for a foundation step. All lengths in mm. */
export interface FoundationParams {
  /**
   * basement: tall walls, slab poured at the bottom.
   * slab-on-grade: slab at the top, with a perimeter frost wall below it.
   */
  type: FoundationType;
  /** Where the outline starts, in plan coordinates. */
  origin: Vec2;
  /** Outer face of the foundation walls, walked side by side. */
  runs: Run[];
  wallThickness: number;
  /** Top of the foundation wall, relative to finished grade (0). */
  topElevation: number;
  /** When set, topElevation follows this level. */
  topLevelId?: string;
  /** Basement wall height, or frost wall depth for slab on grade. */
  wallHeight: number;
  footingWidth: number;
  footingThickness: number;
  /** 0 for no slab. */
  slabThickness: number;
}

const FT = 304.8;
const IN = 25.4;

export function defaultFoundation(): FoundationParams {
  return {
    type: 'basement',
    origin: { x: 0, y: 0 },
    runs: [
      { dir: 'right', length: 30 * FT },
      { dir: 'up', length: 24 * FT },
      { dir: 'left', length: 30 * FT },
      { dir: 'down', length: 24 * FT },
    ],
    wallThickness: 8 * IN,
    topElevation: 1 * FT,
    wallHeight: 8 * FT,
    footingWidth: 20 * IN,
    footingThickness: 8 * IN,
    slabThickness: 4 * IN,
  };
}

/** Typical starting values when switching type. The outline is kept. */
export function applyFoundationType(p: FoundationParams, type: FoundationType): FoundationParams {
  if (type === p.type) return p;
  if (type === 'slab-on-grade') {
    return { ...p, type, topElevation: 4 * IN, wallHeight: 4 * FT, slabThickness: 5 * IN };
  }
  return { ...p, type, topElevation: 1 * FT, wallHeight: 8 * FT, slabThickness: 4 * IN };
}

/** Problems that stop the foundation from being built. */
export function validateFoundation(p: FoundationParams): string[] {
  const errors: string[] = [];
  const outer = runsToPolygon(p.runs, p.origin);
  if (outer.length < 3) errors.push('The outline needs at least 3 corners.');
  if (p.wallThickness <= 0) errors.push('Wall thickness must be more than zero.');
  if (p.wallHeight < 0) errors.push('Wall height cannot be negative.');
  if (p.footingWidth > 0 && p.footingWidth < p.wallThickness)
    errors.push('The footing should be at least as wide as the wall.');
  return errors;
}

/** The foundation's outer outline (outside face), with which run each edge came from. */
export function buildFoundationOutline(p: FoundationParams) {
  return outlineWithSources(p.runs, p.origin);
}

export function buildFoundation(stepId: string, label: string, p: FoundationParams): Component[] {
  if (validateFoundation(p).length) return [];
  const type = p.type ?? 'basement';
  const isSlab = type === 'slab-on-grade';
  const wallWord = isSlab ? 'Frost wall' : 'Wall';
  // Keep the person's walking order so "Wall 1" is side 1; flip the offset
  // direction instead when the outline was walked clockwise.
  const { poly: outer, edgeRun } = outlineWithSources(p.runs, p.origin);
  const inward = signedArea(outer) > 0 ? 1 : -1;
  const inner = offsetPolygon(outer, inward * p.wallThickness);
  const wallTop = p.topElevation;
  const wallBottom = p.topElevation - p.wallHeight;
  const parts: Component[] = [];

  if (p.wallHeight > 0) {
    bandSegments(outer, inner).forEach((quad, i) => {
      const run = edgeRun[i];
      parts.push({
        id: `${stepId}:wall:${i}`,
        stepId,
        name: `${label} · ${wallWord} ${run === null ? `${i + 1}*` : run + 1}`,
        kind: 'foundation-wall',
        material: 'concrete',
        outline: quad,
        bottom: wallBottom,
        // Under a slab on grade the frost wall stops at the slab's underside.
        top: isSlab ? wallTop - p.slabThickness : wallTop,
        runIndex: run,
        dims: [
          { label: 'Length', mm: edgeLength(quad[0], quad[1]) },
          { label: 'Thick', mm: p.wallThickness },
          { label: isSlab ? 'Depth' : 'Height', mm: p.wallHeight },
        ],
      });
    });
  }

  if (p.footingWidth > 0 && p.footingThickness > 0 && p.wallHeight > 0) {
    const overhang = (p.footingWidth - p.wallThickness) / 2;
    const fOuter = offsetPolygon(outer, -inward * overhang);
    const fInner = offsetPolygon(inner, inward * overhang);
    bandSegments(fOuter, fInner).forEach((quad, i) => {
      const run = edgeRun[i];
      parts.push({
        id: `${stepId}:footing:${i}`,
        stepId,
        name: `${label} · Footing ${run === null ? `${i + 1}*` : run + 1}`,
        kind: 'footing',
        material: 'concrete-footing',
        outline: quad,
        bottom: wallBottom - p.footingThickness,
        top: wallBottom,
        runIndex: run,
        dims: [
          { label: 'Length', mm: edgeLength(quad[0], quad[1]) },
          { label: 'Width', mm: p.footingWidth },
          { label: 'Thick', mm: p.footingThickness },
        ],
      });
    });
  }

  if (p.slabThickness > 0) {
    const slabTop = isSlab ? wallTop : wallBottom + p.slabThickness;
    parts.push({
      id: `${stepId}:slab`,
      stepId,
      name: `${label} · Slab`,
      kind: 'slab',
      material: 'slab',
      // A slab on grade covers the whole outline, on top of the frost walls.
      outline: isSlab ? outer : inner,
      bottom: slabTop - p.slabThickness,
      top: slabTop,
      runIndex: null,
      dims: [
        { label: 'Thick', mm: p.slabThickness },
        { label: 'Top elev.', mm: slabTop },
      ],
    });
  }

  return parts;
}

/** One editable measurement of a selected component, and how it maps back to the step. */
export interface ComponentField {
  label: string;
  mm: number;
  min?: number;
  /** Shown under the field, e.g. "Applies to all walls of this step". */
  scope?: string;
  apply: (p: FoundationParams, mm: number) => FoundationParams;
}

export function foundationFields(p: FoundationParams, c: Component): ComponentField[] {
  const isSlab = p.type === 'slab-on-grade';
  const allWalls = `All ${isSlab ? 'frost walls' : 'walls'} in this step`;
  const fields: ComponentField[] = [];
  const run = c.runIndex;

  if (c.kind === 'foundation-wall') {
    if (run !== null && run !== undefined && p.runs[run]) {
      fields.push({
        label: `Length (side ${run + 1}, outside face)`,
        mm: p.runs[run].length,
        min: 1,
        apply: (q, mm) => ({ ...q, runs: q.runs.map((r, i) => (i === run ? { ...r, length: mm } : r)) }),
      });
    }
    fields.push({ label: 'Thickness', mm: p.wallThickness, min: 1, scope: allWalls, apply: (q, mm) => ({ ...q, wallThickness: mm }) });
    fields.push({
      label: isSlab ? 'Depth' : 'Height',
      mm: p.wallHeight,
      min: 0,
      scope: allWalls,
      apply: (q, mm) => ({ ...q, wallHeight: mm }),
    });
    fields.push({ label: 'Top elevation', mm: p.topElevation, scope: allWalls, apply: (q, mm) => ({ ...q, topElevation: mm }) });
  } else if (c.kind === 'footing') {
    fields.push({ label: 'Width', mm: p.footingWidth, min: 0, scope: 'All footings in this step', apply: (q, mm) => ({ ...q, footingWidth: mm }) });
    fields.push({ label: 'Thickness', mm: p.footingThickness, min: 0, scope: 'All footings in this step', apply: (q, mm) => ({ ...q, footingThickness: mm }) });
  } else if (c.kind === 'slab') {
    fields.push({ label: 'Thickness', mm: p.slabThickness, min: 0, apply: (q, mm) => ({ ...q, slabThickness: mm }) });
    if (isSlab) {
      fields.push({ label: 'Top elevation', mm: p.topElevation, apply: (q, mm) => ({ ...q, topElevation: mm }) });
    }
  }
  return fields;
}
