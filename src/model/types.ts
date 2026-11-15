import type { UnitSystem } from '../units';
import type { FoundationParams } from './foundation';

/**
 * A house is an ordered list of build steps. Each step owns its own editable
 * parameters (all lengths in mm). The 3D model is always rebuilt from the
 * steps, so editing any step can never leave the model out of sync.
 */
interface StepBase {
  id: string;
  label: string;
  /** Which floor this step belongs to, e.g. "Basement", "Garage". */
  level: string;
  visible: boolean;
  notes: string;
}

export interface FoundationStep extends StepBase {
  kind: 'foundation';
  params: FoundationParams;
}

export type Step = FoundationStep;
export type StepKind = Step['kind'];

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
