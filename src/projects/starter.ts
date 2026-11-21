import type { Run } from '../model/geometry';
import { applyFoundationType, defaultFoundation } from '../model/foundation';
import { emptyProject, type Project } from '../model/types';

export type Shape = 'rectangle' | 'l-shape' | 't-shape';

export const SHAPES: { value: Shape; label: string; path: string }[] = [
  { value: 'rectangle', label: 'Rectangle', path: 'M8 8h48v40H8z' },
  { value: 'l-shape', label: 'L-shape', path: 'M8 8h24v20h24v20H8z' },
  { value: 't-shape', label: 'T-shape', path: 'M8 8h48v18H42v22H22V26H8z' },
];

/**
 * The outside of a footprint, walked counter-clockwise from the front-left
 * corner (the same way the foundation outline is entered). Notches take half
 * the width and half the depth, and are meant to be adjusted in Phase 1.
 */
export function shapeRuns(shape: Shape, width: number, depth: number): Run[] {
  const w2 = width / 2;
  const d2 = depth / 2;
  switch (shape) {
    case 'rectangle':
      return [
        { dir: 'right', length: width },
        { dir: 'up', length: depth },
        { dir: 'left', length: width },
        { dir: 'down', length: depth },
      ];
    case 'l-shape':
      // Full width at the front, the back-right quarter cut away.
      return [
        { dir: 'right', length: width },
        { dir: 'up', length: d2 },
        { dir: 'left', length: w2 },
        { dir: 'up', length: d2 },
        { dir: 'left', length: w2 },
        { dir: 'down', length: depth },
      ];
    case 't-shape': {
      // A wide back wing and a centred front stem, half as wide.
      const side = width / 4;
      return [
        { dir: 'right', length: w2 },
        { dir: 'up', length: d2 },
        { dir: 'right', length: side },
        { dir: 'up', length: d2 },
        { dir: 'left', length: width },
        { dir: 'down', length: d2 },
        { dir: 'right', length: side },
        { dir: 'down', length: d2 },
      ];
    }
  }
}

export interface StarterOptions {
  name: string;
  address: string;
  start: 'plans' | 'scratch';
  shape: Shape;
  width: number;
  depth: number;
  storeys: number;
  basement: boolean;
}

/** A new project. From scratch, it starts with the footprint as its first foundation. */
export function starterProject(o: StarterOptions): Project {
  const base: Project = {
    ...emptyProject(),
    name: o.name.trim() || 'My house',
    address: o.address.trim() || undefined,
    start: o.start,
    phase: 1,
    storeys: o.start === 'scratch' ? o.storeys : undefined,
  };
  if (o.start === 'plans') return base;
  const foundation = { ...defaultFoundation(), runs: shapeRuns(o.shape, o.width, o.depth) };
  return {
    ...base,
    steps: [
      {
        id: 'footprint',
        kind: 'foundation',
        label: o.basement ? 'Basement' : 'Slab on grade',
        level: o.basement ? 'Basement' : 'Ground floor',
        visible: true,
        notes: '',
        params: o.basement ? foundation : applyFoundationType(foundation, 'slab-on-grade'),
      },
    ],
  };
}
