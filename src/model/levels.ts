import type { Project } from './types';

/**
 * Key heights of the house, read from the elevations and sections, all
 * relative to finished grade (0). Steps can follow a level: change the level
 * and every step built on it moves with it.
 */
export type LevelKind = 'foundation-top' | 'garage-slab' | 'floor' | 'ceiling' | 'eave' | 'ridge' | 'other';

export interface Level {
  id: string;
  name: string;
  kind: LevelKind;
  /** mm above finished grade (negative below). */
  elevation: number;
  /** Where the value came from, e.g. "Front elevation: T/FDN 1'-0"". */
  source?: string;
}

export const LEVEL_KINDS: { value: LevelKind; label: string }[] = [
  { value: 'foundation-top', label: 'Top of foundation' },
  { value: 'garage-slab', label: 'Garage slab' },
  { value: 'floor', label: 'Finished floor' },
  { value: 'ceiling', label: 'Ceiling / top of wall' },
  { value: 'eave', label: 'Eave / roof edge' },
  { value: 'ridge', label: 'Roof ridge' },
  { value: 'other', label: 'Other' },
];

const IN = 25.4;
const FT = 304.8;

/** A typical starting set, to edit or replace with Claude's suggestion. */
export function typicalLevels(newId: () => string): Level[] {
  return [
    { id: newId(), name: 'Top of foundation', kind: 'foundation-top', elevation: 1 * FT },
    { id: newId(), name: 'Garage slab', kind: 'garage-slab', elevation: 4 * IN },
    { id: newId(), name: 'Ground floor', kind: 'floor', elevation: 1 * FT + 12 * IN },
    { id: newId(), name: 'First floor', kind: 'floor', elevation: 11 * FT },
    { id: newId(), name: 'Roof ridge', kind: 'ridge', elevation: 28 * FT },
  ];
}

export function sortLevels(levels: Level[]): Level[] {
  return [...levels].sort((a, b) => a.elevation - b.elevation);
}

export function findLevel(project: Project, id: string | undefined): Level | undefined {
  return id ? project.levels.find((l) => l.id === id) : undefined;
}

/** Differences smaller than this are treated as matching (1/8"). */
export const LEVEL_TOLERANCE = 3;
