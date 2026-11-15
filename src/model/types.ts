import type { UnitSystem } from '../units';
import type { FloorParams } from './floor';
import type { FoundationParams } from './foundation';
import type { Level } from './levels';

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

export interface FloorStep extends StepBase {
  kind: 'floor';
  params: FloorParams;
}

export type Step = FoundationStep | FloorStep;
export type StepKind = Step['kind'];

export interface Project {
  version: 1;
  name: string;
  /** Key heights from the elevations; steps can follow them. */
  levels: Level[];
  steps: Step[];
}

export interface ViewSettings {
  units: UnitSystem;
  /** Grid cell size in mm. */
  gridSpacing: number;
  /** Hide subfloors so the joists underneath can be seen. */
  showSubfloor: boolean;
}

export function emptyProject(): Project {
  return { version: 1, name: 'My house', levels: [], steps: [] };
}
