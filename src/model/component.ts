import type { Vec2 } from './geometry';

export type MaterialId = 'concrete' | 'concrete-footing' | 'slab';

/**
 * A built piece of the house: a vertical prism (plan outline extruded
 * between two elevations). All values in mm. Components are always derived
 * from steps, never edited directly.
 */
export interface Component {
  id: string;
  stepId: string;
  name: string;
  kind: 'foundation-wall' | 'footing' | 'slab';
  material: MaterialId;
  outline: Vec2[];
  bottom: number;
  top: number;
  /** Short size summary for the components list, e.g. length × thickness × height. */
  dims: { label: string; mm: number }[];
}
