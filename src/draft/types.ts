/**
 * The exterior draft: the whole outside of the house as simple volumes,
 * roofs and openings, drafted in one go from the plans. Every measurement
 * remembers where it came from, so the person can see which numbers were
 * read off the plans (black) and which Claude had to infer (red), and
 * confirm or change each one.
 *
 * Plan coordinates, in mm: x to the right along the front of the house,
 * y from the front face toward the back, z up from average grade (0).
 */

/** plan: read from a dimension on the plans. ai: inferred by Claude. user: typed by the person. */
export type Source = 'plan' | 'ai' | 'user';

export interface Dim {
  mm: number;
  source: Source;
  /** Where it was read or how it was inferred, e.g. "Front elevation: 10'-5\"". */
  ref?: string;
  /** Confirmed against the plans by the person. */
  ok?: boolean;
}

export type Face = 'front' | 'back' | 'left' | 'right';

/**
 * parapet: a flat-looking roof hidden behind walls that rise all around it, with the roof inside sloping down (a depression).
 * folded: any roof made of flat facets drawn as regions on the roof plan, e.g. a rectangle that dips along valley lines.
 */
export type RoofType = 'flat' | 'parapet' | 'shed' | 'gable' | 'hip' | 'folded';

/**
 * A corner of a folded roof facet, relative to its volume so the shape follows edits:
 * u across the width (0 = left wall, 1 = right wall), v back from the front (0 = front wall, 1 = back wall),
 * t up from the top of the walls (0) to the roof's rise (1).
 */
export interface RoofPoint {
  u: number;
  v: number;
  t: number;
}

export interface Roof {
  type: RoofType;
  /** Height from the top of the walls to the ridge, the high side of a shed roof, or the top of a parapet. */
  rise: Dim;
  /** How far the roof sticks out past the walls. */
  overhang: Dim;
  /** Gable and hip roofs: which way the ridge runs. */
  ridge: 'x' | 'y';
  /** Shed and parapet roofs: the side the roof slopes down to. */
  low: Face;
  /** Folded roofs: the flat facets, each a polygon of corners in order. */
  facets?: RoofPoint[][];
}

/**
 * A foundation under part of the house. basement: walls down to a slab at the bottom.
 * slab: a slab on grade, its top at the top of the walls, on a perimeter frost wall.
 */
export interface Foundation {
  type: 'basement' | 'slab';
  /** Thickness of the foundation walls. */
  wall: Dim;
  /** Thickness of the concrete slab. */
  slab: Dim;
}

/**
 * A box-shaped part of the house: a storey, a wing, a garage, or (with `foundation`)
 * a foundation below it, whose base is the bottom of its walls and whose top is the top of its walls.
 */
export interface Block {
  id: string;
  name: string;
  /** Front-left corner. */
  x: Dim;
  y: Dim;
  width: Dim;
  depth: Dim;
  /** Bottom of the walls, above grade. */
  base: Dim;
  /** Wall height, from the base to the top of the walls (where the roof starts). */
  height: Dim;
  roof: Roof;
  foundation?: Foundation;
}

export type OpeningKind = 'window' | 'door' | 'patio-door' | 'garage-door';

export interface Opening {
  id: string;
  blockId: string;
  face: Face;
  kind: OpeningKind;
  /** From the left end of the face, as seen from outside. */
  offset: Dim;
  /** Bottom of the opening above the block's base. */
  sill: Dim;
  width: Dim;
  height: Dim;
}

/** A named height (floor, ceiling, roof) as marked on the elevations, above grade. */
export interface DraftLevel {
  id: string;
  name: string;
  elevation: Dim;
}

/** The plan views the draft is checked against, one at a time. */
export type ViewId = 'front' | 'back' | 'left' | 'right' | 'top' | 'basement' | 'ground' | 'first';

export interface ExteriorDraft {
  /** Claude's short summary of what it drafted and what to double-check. */
  summary: string;
  createdAt: number;
  levels: DraftLevel[];
  blocks: Block[];
  openings: Opening[];
  /** Views the person has finished checking. */
  done?: Partial<Record<ViewId, boolean>>;
}

export const VIEWS: { id: ViewId; name: string; plan: string[] }[] = [
  { id: 'front', name: 'Front elevation', plan: ['elevation-front'] },
  { id: 'right', name: 'Right elevation', plan: ['elevation-right'] },
  { id: 'back', name: 'Back elevation', plan: ['elevation-back'] },
  { id: 'left', name: 'Left elevation', plan: ['elevation-left'] },
  { id: 'basement', name: 'Foundation plan', plan: ['basement'] },
  { id: 'ground', name: 'Ground floor plan', plan: ['ground-floor'] },
  { id: 'first', name: 'First floor plan', plan: ['first-floor'] },
  { id: 'top', name: 'Roof (top view)', plan: ['roof'] },
];

export const OPENING_NAMES: Record<OpeningKind, string> = {
  window: 'Window',
  door: 'Door',
  'patio-door': 'Patio door',
  'garage-door': 'Garage door',
};

export const ROOF_NAMES: Record<RoofType, string> = {
  flat: 'Flat roof',
  parapet: 'Flat roof behind parapets',
  shed: 'Shed roof',
  gable: 'Gable roof',
  hip: 'Hip roof',
  folded: 'Roof with a depression',
};

export const FOUNDATION_NAMES: Record<Foundation['type'], string> = {
  basement: 'Basement',
  slab: 'Slab on grade',
};

export function dim(mm: number, source: Source = 'user', ref?: string): Dim {
  return ref ? { mm, source, ref } : { mm, source };
}
