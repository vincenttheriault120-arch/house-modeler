import { lengthDimensions, type LengthDimension } from './dimensions';
import { sortLevels } from './levels';
import type { Project } from './types';

/**
 * Checking the model against the plans, one measurement at a time.
 *
 * Every outside side of the footprint and every level is a measurement. The
 * person marks each one as matching the plans or differing from them, and
 * can note the plan's value and which drawing it came from. A check is tied
 * to the model's value when it was made: if the model changes afterwards,
 * the measurement goes back to "not checked".
 */

export type CheckStatus = 'matches' | 'differs';

export interface Check {
  status: CheckStatus;
  /** The model's value when it was checked, mm. */
  model: number;
  /** The value read on the plan, mm, when it differs. */
  plan?: number;
  /** The drawing it was read on (a plan id). */
  planId?: string;
  note?: string;
  at: number;
}

export type Side = 'front' | 'back' | 'left' | 'right';
export type MeasureGroup = 'footprint' | 'levels';

export interface Measure {
  id: string;
  group: MeasureGroup;
  /** e.g. "Basement · front" or "Ground floor". */
  label: string;
  /** The model's current value, mm (a length, or a height above grade). */
  value: number;
  /** The step it belongs to, for footprint sides. */
  stepId?: string;
  side?: Side;
}

export type MeasureState = 'matches' | 'differs' | 'changed' | 'unchecked';

/** A check still holds while the model is within this of the value checked. */
export const CHECK_TOLERANCE = 2;

/** Which face of the house a side is on, from the way it faces (front is the bottom of the plan). */
export function sideFacing(d: Pick<LengthDimension, 'a' | 'from'>): Side {
  const nx = d.a.x - d.from[0].x;
  const ny = d.a.y - d.from[0].y;
  if (Math.abs(ny) >= Math.abs(nx)) return ny < 0 ? 'front' : 'back';
  return nx < 0 ? 'left' : 'right';
}

/** Every measurement to check, footprint sides first, then levels lowest first. */
export function measures(project: Project): Measure[] {
  const names = new Map(project.steps.map((s) => [s.id, s.label || 'Outline']));
  const sides = lengthDimensions(project);
  const count = new Map<string, number>();
  const keyed = sides.map((d) => {
    const side = sideFacing(d);
    const key = `${d.stepId}:${side}`;
    count.set(key, (count.get(key) ?? 0) + 1);
    return { d, side, key, n: count.get(key)! };
  });
  const out: Measure[] = keyed.map(({ d, side, key, n }) => ({
    id: d.id,
    group: 'footprint',
    label: `${names.get(d.stepId)} · ${side}${count.get(key)! > 1 ? ` ${n}` : ''}`,
    value: d.mm,
    stepId: d.stepId,
    side,
  }));
  for (const l of sortLevels(project.levels)) {
    out.push({ id: `level:${l.id}`, group: 'levels', label: l.name, value: l.elevation });
  }
  return out;
}

export function measureState(m: Measure, check: Check | undefined): MeasureState {
  if (!check) return 'unchecked';
  if (Math.abs(check.model - m.value) > CHECK_TOLERANCE) return 'changed';
  return check.status;
}

export interface CheckSummary {
  total: number;
  matches: number;
  differs: number;
  /** Not checked yet, or changed since. */
  open: number;
}

export function summarize(list: Measure[], checks: Record<string, Check> = {}): CheckSummary {
  const s: CheckSummary = { total: list.length, matches: 0, differs: 0, open: 0 };
  for (const m of list) {
    const st = measureState(m, checks[m.id]);
    if (st === 'matches') s.matches++;
    else if (st === 'differs') s.differs++;
    else s.open++;
  }
  return s;
}

/** State of every measurement by id, for colouring the model's dimension labels. */
export function statesById(project: Project): Record<string, MeasureState> {
  const out: Record<string, MeasureState> = {};
  for (const m of measures(project)) out[m.id] = measureState(m, project.checks?.[m.id]);
  return out;
}
