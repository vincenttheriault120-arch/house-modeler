import type { Component } from './component';
import { buildFoundationOutline, type FoundationParams } from './foundation';
import { bandSegments, bounds, edgeLength, offsetPolygon, rect, scanIntervals, signedArea, type Vec2 } from './geometry';

/**
 * A floor system built on top of a foundation step: sill plate, rim joist,
 * joists, an optional dropped beam with posts, and the subfloor.
 * All lengths in mm.
 */
export interface FloorParams {
  /** The foundation step this floor sits on. Its outline and top elevation are used. */
  supportId: string;
  sillThickness: number;
  sillWidth: number;
  rimThickness: number;
  joistDepth: number;
  joistWidth: number;
  /** Centre to centre. */
  joistSpacing: number;
  /** 'y': joists run front to back (along plan Y). 'x': joists run left to right. */
  joistDirection: 'x' | 'y';
  /** Dropped beam under the joists, running across them. */
  beam: boolean;
  beamWidth: number;
  beamDepth: number;
  /** Beam centre, measured from the outside face of the foundation (left side for 'y' joists, front side for 'x' joists). 0 = middle. */
  beamOffset: number;
  /** Posts (steel columns) under the beam, centre to centre. 0 = no posts. */
  postSpacing: number;
  postSize: number;
  subfloorThickness: number;
  /** The level this floor should finish at (top of subfloor); a mismatch shows a warning. */
  levelId?: string;
}

const IN = 25.4;
const FT = 304.8;

/**
 * Typical starting values. With the foundation given, joists span the
 * shorter way across it, as they usually do.
 */
export function defaultFloor(supportId: string, support?: FoundationParams): FloorParams {
  let joistDirection: 'x' | 'y' = 'y';
  if (support) {
    const b = bounds(buildFoundationOutline(support).poly);
    if (b.maxX - b.minX < b.maxY - b.minY) joistDirection = 'x';
  }
  return {
    supportId,
    sillThickness: 1.5 * IN,
    sillWidth: 5.5 * IN,
    rimThickness: 1.5 * IN,
    joistDepth: 9.25 * IN,
    joistWidth: 1.5 * IN,
    joistSpacing: 16 * IN,
    joistDirection,
    beam: true,
    beamWidth: 4.5 * IN,
    beamDepth: 9.25 * IN,
    beamOffset: 0,
    postSpacing: 8 * FT,
    postSize: 3.5 * IN,
    subfloorThickness: 0.75 * IN,
  };
}

/** Elevations of the floor's layers, from the foundation it sits on. */
export function floorLevels(p: FloorParams, support: FoundationParams) {
  const sillBottom = support.topElevation;
  const joistBottom = sillBottom + p.sillThickness;
  const joistTop = joistBottom + p.joistDepth;
  const floorTop = joistTop + p.subfloorThickness;
  const basementFloor =
    support.type === 'basement' ? support.topElevation - support.wallHeight + support.slabThickness : support.topElevation;
  return { sillBottom, joistBottom, joistTop, floorTop, basementFloor };
}

export function validateFloor(p: FloorParams, support: FoundationParams | undefined): string[] {
  const errors: string[] = [];
  if (!support) errors.push('Pick the foundation this floor sits on.');
  if (p.joistSpacing < p.joistWidth + 1) errors.push('Joist spacing must be larger than the joist width.');
  if (p.joistDepth <= 0 || p.joistWidth <= 0) errors.push('Joist size must be more than zero.');
  if (p.rimThickness < 0 || p.sillThickness < 0 || p.subfloorThickness < 0) errors.push('Thicknesses cannot be negative.');
  return errors;
}

export function buildFloor(stepId: string, label: string, p: FloorParams, support: FoundationParams | undefined): Component[] {
  if (!support || validateFloor(p, support).length) return [];
  const { poly: outer, edgeRun } = buildFoundationOutline(support);
  if (outer.length < 3) return [];
  const inward = signedArea(outer) > 0 ? 1 : -1;
  const lv = floorLevels(p, support);
  const parts: Component[] = [];
  const name = (s: string) => `${label} · ${s}`;

  // Sill plate, flush with the outside face of the foundation.
  if (p.sillThickness > 0 && p.sillWidth > 0) {
    const sillInner = offsetPolygon(outer, inward * p.sillWidth);
    bandSegments(outer, sillInner).forEach((quad, i) => {
      const run = edgeRun[i];
      parts.push({
        id: `${stepId}:sill:${i}`,
        stepId,
        name: name(`Sill plate ${run === null ? `${i + 1}*` : run + 1}`),
        kind: 'sill',
        material: 'lumber-treated',
        outline: quad,
        bottom: lv.sillBottom,
        top: lv.joistBottom,
        runIndex: run,
        dims: [
          { label: 'Length', mm: edgeLength(quad[0], quad[1]) },
          { label: 'Width', mm: p.sillWidth },
          { label: 'Thick', mm: p.sillThickness },
        ],
      });
    });
  }

  // Rim joist all around.
  const rimInner = p.rimThickness > 0 ? offsetPolygon(outer, inward * p.rimThickness) : outer;
  if (p.rimThickness > 0) {
    bandSegments(outer, rimInner).forEach((quad, i) => {
      const run = edgeRun[i];
      parts.push({
        id: `${stepId}:rim:${i}`,
        stepId,
        name: name(`Rim joist ${run === null ? `${i + 1}*` : run + 1}`),
        kind: 'rim-joist',
        material: 'lumber',
        outline: quad,
        bottom: lv.joistBottom,
        top: lv.joistTop,
        runIndex: run,
        dims: [
          { label: 'Length', mm: edgeLength(quad[0], quad[1]) },
          { label: 'Thick', mm: p.rimThickness },
          { label: 'Depth', mm: p.joistDepth },
        ],
      });
    });
  }

  // Joists: lines across the span direction, every joistSpacing, clipped to inside the rim.
  // 'y' joists run along Y, so they are laid out along X.
  const layoutAxis = p.joistDirection === 'y' ? 'x' : 'y';
  const b = bounds(rimInner);
  const lo = layoutAxis === 'x' ? b.minX : b.minY;
  const hi = layoutAxis === 'x' ? b.maxX : b.maxY;
  const outerB = bounds(outer);
  const start = layoutAxis === 'x' ? outerB.minX : outerB.minY;
  const half = p.joistWidth / 2;
  let n = 0;
  for (let c = start + p.joistSpacing; c + half < hi - 1; c += p.joistSpacing) {
    if (c - half < lo) continue;
    for (const [a, z] of scanIntervals(rimInner, layoutAxis, c)) {
      n++;
      parts.push({
        id: `${stepId}:joist:${n}`,
        stepId,
        name: name(`Joist ${n}`),
        kind: 'joist',
        material: 'lumber',
        outline: layoutAxis === 'x' ? rect(c - half, a, c + half, z) : rect(a, c - half, z, c + half),
        bottom: lv.joistBottom,
        top: lv.joistTop,
        dims: [
          { label: 'Span', mm: z - a },
          { label: 'Size', mm: p.joistDepth },
          { label: 'Spacing', mm: p.joistSpacing },
        ],
      });
    }
  }

  // Dropped beam across the joists, bearing on the foundation walls, with posts.
  if (p.beam && p.beamWidth > 0 && p.beamDepth > 0 && support.type === 'basement') {
    const wallInner = offsetPolygon(outer, inward * support.wallThickness);
    // The beam runs along the joist layout axis, at a fixed position on the span axis.
    const spanAxis = p.joistDirection === 'y' ? 'y' : 'x';
    const sMin = spanAxis === 'x' ? outerB.minX : outerB.minY;
    const sMax = spanAxis === 'x' ? outerB.maxX : outerB.maxY;
    const pos = p.beamOffset > 0 ? sMin + p.beamOffset : (sMin + sMax) / 2;
    const bh = p.beamWidth / 2;
    const beamBottom = lv.joistBottom - p.beamDepth;
    // Bear on the walls: extend into the wall by its thickness (beam pocket).
    scanIntervals(wallInner, spanAxis, pos).forEach(([a0, z0], i) => {
      const a = a0 - support.wallThickness / 2;
      const z = z0 + support.wallThickness / 2;
      parts.push({
        id: `${stepId}:beam:${i}`,
        stepId,
        name: name(`Beam${i ? ` ${i + 1}` : ''}`),
        kind: 'beam',
        material: 'lumber',
        outline: spanAxis === 'y' ? rect(a, pos - bh, z, pos + bh) : rect(pos - bh, a, pos + bh, z),
        bottom: beamBottom,
        top: lv.joistBottom,
        dims: [
          { label: 'Length', mm: z - a },
          { label: 'Width', mm: p.beamWidth },
          { label: 'Depth', mm: p.beamDepth },
        ],
      });
      if (p.postSpacing > 0 && p.postSize > 0 && beamBottom > lv.basementFloor) {
        const clear = z0 - a0;
        const count = Math.max(0, Math.ceil(clear / p.postSpacing) - 1);
        const step = clear / (count + 1);
        const ph = p.postSize / 2;
        for (let k = 1; k <= count; k++) {
          const at = a0 + k * step;
          parts.push({
            id: `${stepId}:post:${i}:${k}`,
            stepId,
            name: name(`Post ${k}`),
            kind: 'post',
            material: 'steel',
            outline: spanAxis === 'y' ? rect(at - ph, pos - ph, at + ph, pos + ph) : rect(pos - ph, at - ph, pos + ph, at + ph),
            bottom: lv.basementFloor,
            top: beamBottom,
            dims: [
              { label: 'Height', mm: beamBottom - lv.basementFloor },
              { label: 'Size', mm: p.postSize },
            ],
          });
        }
      }
    });
  }

  if (p.subfloorThickness > 0) {
    parts.push({
      id: `${stepId}:subfloor`,
      stepId,
      name: name('Subfloor'),
      kind: 'subfloor',
      material: 'osb',
      outline: outer,
      bottom: lv.joistTop,
      top: lv.floorTop,
      runIndex: null,
      dims: [
        { label: 'Thick', mm: p.subfloorThickness },
        { label: 'Floor elev.', mm: lv.floorTop },
      ],
    });
  }
  return parts;
}

/** One editable measurement of a selected floor piece. */
export interface FloorField {
  label: string;
  mm: number;
  min?: number;
  scope?: string;
  apply: (p: FloorParams, mm: number) => FloorParams;
}

export function floorFields(p: FloorParams, c: Component): FloorField[] {
  switch (c.kind) {
    case 'sill':
      return [
        { label: 'Width', mm: p.sillWidth, min: 0, scope: 'All sill plates', apply: (q, mm) => ({ ...q, sillWidth: mm }) },
        { label: 'Thickness', mm: p.sillThickness, min: 0, scope: 'All sill plates', apply: (q, mm) => ({ ...q, sillThickness: mm }) },
      ];
    case 'rim-joist':
      return [
        { label: 'Thickness', mm: p.rimThickness, min: 0, scope: 'All rim joists', apply: (q, mm) => ({ ...q, rimThickness: mm }) },
        { label: 'Depth', mm: p.joistDepth, min: 1, scope: 'Same as the joists', apply: (q, mm) => ({ ...q, joistDepth: mm }) },
      ];
    case 'joist':
      return [
        { label: 'Depth', mm: p.joistDepth, min: 1, scope: 'All joists', apply: (q, mm) => ({ ...q, joistDepth: mm }) },
        { label: 'Width', mm: p.joistWidth, min: 1, scope: 'All joists', apply: (q, mm) => ({ ...q, joistWidth: mm }) },
        { label: 'Spacing (centre to centre)', mm: p.joistSpacing, min: 1, apply: (q, mm) => ({ ...q, joistSpacing: mm }) },
      ];
    case 'beam':
      return [
        { label: 'Width', mm: p.beamWidth, min: 1, apply: (q, mm) => ({ ...q, beamWidth: mm }) },
        { label: 'Depth', mm: p.beamDepth, min: 1, apply: (q, mm) => ({ ...q, beamDepth: mm }) },
        { label: 'Position from outside face (0 = middle)', mm: p.beamOffset, min: 0, apply: (q, mm) => ({ ...q, beamOffset: mm }) },
      ];
    case 'post':
      return [
        { label: 'Size', mm: p.postSize, min: 1, scope: 'All posts', apply: (q, mm) => ({ ...q, postSize: mm }) },
        { label: 'Spacing (max)', mm: p.postSpacing, min: 0, scope: 'All posts', apply: (q, mm) => ({ ...q, postSpacing: mm }) },
      ];
    case 'subfloor':
      return [{ label: 'Thickness', mm: p.subfloorThickness, min: 0, apply: (q, mm) => ({ ...q, subfloorThickness: mm }) }];
    default:
      return [];
  }
}
