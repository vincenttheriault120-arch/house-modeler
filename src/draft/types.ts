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

export type RoofType = 'flat' | 'shed' | 'gable' | 'hip';

export interface Roof {
  type: RoofType;
  /** Height from the top of the walls to the ridge (or the high side of a shed roof). */
  rise: Dim;
  /** How far the roof sticks out past the walls. */
  overhang: Dim;
  /** Gable and hip roofs: which way the ridge runs. */
  ridge: 'x' | 'y';
  /** Shed roofs: the side the roof slopes down to. */
  low: Face;
}

/** A box-shaped part of the house: a storey, a wing, a garage. */
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
export type ViewId = 'front' | 'back' | 'left' | 'right' | 'top' | 'ground' | 'first';

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
  shed: 'Shed roof',
  gable: 'Gable roof',
  hip: 'Hip roof',
};

export function dim(mm: number, source: Source = 'user', ref?: string): Dim {
  return ref ? { mm, source, ref } : { mm, source };
}
