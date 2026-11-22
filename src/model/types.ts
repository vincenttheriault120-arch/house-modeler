import type { UnitSystem } from '../units';
import type { Check } from './checks';
import type { StoreyId, StoreyLayout } from './interior';
import type { FloorParams } from './floor';
import type { FoundationParams } from './foundation';
import type { Level } from './levels';
import type { ExteriorDraft } from '../draft/types';

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
  address?: string;
  /** How the project began: from 2D plans or from a blank footprint. */
  start?: 'plans' | 'scratch';
  /** The phase the person is working in (1 = exterior shell). */
  phase?: 1 | 2 | 3 | 4 | 5;
  /** Storeys above grade, as given when the project was created. */
  storeys?: number;
  /** Key heights from the elevations; steps can follow them. */
  levels: Level[];
  steps: Step[];
  /** Measurements checked against the plans, by measurement id. */
  checks?: Record<string, Check>;
  /** Phase 2: interior walls and rooms, per storey. */
  interior?: Partial<Record<StoreyId, StoreyLayout>>;
  /** Phase 1: the whole exterior, drafted from the plans and checked view by view. */
  exterior?: ExteriorDraft;
}

export interface ViewSettings {
  units: UnitSystem;
  /** Grid cell size in mm. */
  gridSpacing: number;
  /** Hide subfloors so the joists underneath can be seen. */
  showSubfloor: boolean;
  /** Clay mode: matte grey model with crisp outlines, for checking shape and sizes. */
  clay: boolean;
  /** Draw lengths and levels on the model. */
  showDimensions: boolean;
}

export function emptyProject(): Project {
  return { version: 1, name: 'My house', levels: [], steps: [] };
}
