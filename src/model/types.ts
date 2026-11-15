import type { UnitSystem } from '../units';

/**
 * A house is an ordered list of build steps. Each step owns its own editable
 * parameters (all lengths in mm). The 3D model is always rebuilt from the
 * steps, so editing any step can never leave the model out of sync.
 */
export type StepKind = 'foundation' | 'walls' | 'floor';

export interface Step {
  id: string;
  kind: StepKind;
  label: string;
  /** Which floor this step belongs to, e.g. "Basement", "Ground floor". */
  level: string;
  params: Record<string, unknown>;
}

export interface Project {
  version: 1;
  name: string;
  steps: Step[];
}

export interface ViewSettings {
  units: UnitSystem;
  /** Grid cell size in mm. */
  gridSpacing: number;
}

export function emptyProject(): Project {
  return { version: 1, name: 'My house', steps: [] };
}
