import type { Component } from './component';
import { bandSegments, edgeLength, offsetPolygon, runsToPolygon, signedArea, type Run, type Vec2 } from './geometry';

/** Inputs for a foundation step. All lengths in mm. */
export interface FoundationParams {
  /** Where the outline starts, in plan coordinates. */
  origin: Vec2;
  /** Outer face of the foundation walls, walked side by side. */
  runs: Run[];
  wallThickness: number;
  /** Top of the foundation wall, relative to finished grade (0). */
  topElevation: number;
  wallHeight: number;
  footingWidth: number;
  footingThickness: number;
  /** 0 for no slab (e.g. crawl space or a garage poured later). */
  slabThickness: number;
}

const FT = 304.8;
const IN = 25.4;

export function defaultFoundation(): FoundationParams {
  return {
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

/** Problems that stop the foundation from being built. */
export function validateFoundation(p: FoundationParams): string[] {
  const errors: string[] = [];
  const outer = runsToPolygon(p.runs, p.origin);
  if (outer.length < 3) errors.push('The outline needs at least 3 corners.');
  if (p.wallThickness <= 0) errors.push('Wall thickness must be more than zero.');
  if (p.wallHeight <= 0) errors.push('Wall height must be more than zero.');
  if (p.footingWidth > 0 && p.footingWidth < p.wallThickness)
    errors.push('The footing should be at least as wide as the wall.');
  return errors;
}

export function buildFoundation(stepId: string, label: string, p: FoundationParams): Component[] {
  if (validateFoundation(p).length) return [];
  // Keep the person's walking order so "Wall 1" is side 1; flip the offset
  // direction instead when the outline was walked clockwise.
  const outer = runsToPolygon(p.runs, p.origin);
  const inward = signedArea(outer) > 0 ? 1 : -1;
  const inner = offsetPolygon(outer, inward * p.wallThickness);
  const wallTop = p.topElevation;
  const wallBottom = p.topElevation - p.wallHeight;
  const parts: Component[] = [];

  bandSegments(outer, inner).forEach((quad, i) => {
    parts.push({
      id: `${stepId}:wall:${i}`,
      stepId,
      name: `${label} · Wall ${i + 1}`,
      kind: 'foundation-wall',
      material: 'concrete',
      outline: quad,
      bottom: wallBottom,
      top: wallTop,
      dims: [
        { label: 'Length', mm: edgeLength(quad[0], quad[1]) },
        { label: 'Thick', mm: p.wallThickness },
        { label: 'Height', mm: p.wallHeight },
      ],
    });
  });

  if (p.footingWidth > 0 && p.footingThickness > 0) {
    const overhang = (p.footingWidth - p.wallThickness) / 2;
    const fOuter = offsetPolygon(outer, -inward * overhang);
    const fInner = offsetPolygon(inner, inward * overhang);
    bandSegments(fOuter, fInner).forEach((quad, i) => {
      parts.push({
        id: `${stepId}:footing:${i}`,
        stepId,
        name: `${label} · Footing ${i + 1}`,
        kind: 'footing',
        material: 'concrete-footing',
        outline: quad,
        bottom: wallBottom - p.footingThickness,
        top: wallBottom,
        dims: [
          { label: 'Length', mm: edgeLength(quad[0], quad[1]) },
          { label: 'Width', mm: p.footingWidth },
          { label: 'Thick', mm: p.footingThickness },
        ],
      });
    });
  }

  if (p.slabThickness > 0) {
    parts.push({
      id: `${stepId}:slab`,
      stepId,
      name: `${label} · Slab`,
      kind: 'slab',
      material: 'slab',
      outline: inner,
      bottom: wallBottom,
      top: wallBottom + p.slabThickness,
      dims: [{ label: 'Thick', mm: p.slabThickness }],
    });
  }

  return parts;
}
