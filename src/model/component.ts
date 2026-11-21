import type { Vec2 } from './geometry';

export type MaterialId = 'drywall' | 'concrete' | 'concrete-footing' | 'slab' | 'lumber' | 'lumber-treated' | 'osb' | 'steel';

/**
 * A built piece of the house: a vertical prism (plan outline extruded
 * between two elevations). All values in mm. Components are always derived
 * from steps, never edited directly.
 */
export interface Component {
  id: string;
  stepId: string;
  name: string;
  kind: 'foundation-wall' | 'footing' | 'slab' | 'sill' | 'rim-joist' | 'joist' | 'beam' | 'post' | 'subfloor' | 'interior-wall';
  material: MaterialId;
  outline: Vec2[];
  bottom: number;
  top: number;
  /** Which outline side (run) this piece sits on, if any. */
  runIndex?: number | null;
  /** Short size summary for the components list, e.g. length × thickness × height. */
  dims: { label: string; mm: number }[];
}
