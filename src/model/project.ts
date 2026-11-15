import type { Component } from './component';
import { buildFloor, defaultFloor, type FloorParams } from './floor';
import { buildFoundation, defaultFoundation, type FoundationParams } from './foundation';
import { emptyProject, type FloorStep, type FoundationStep, type Project, type Step } from './types';

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

export type Action =
  | { type: 'add-foundation'; id: string }
  | { type: 'update-step'; id: string; patch: Partial<Omit<Step, 'id' | 'kind' | 'params'>> }
  | { type: 'update-foundation'; id: string; params: FoundationParams }
  | { type: 'add-floor'; id: string; supportId: string }
  | { type: 'update-floor'; id: string; params: FloorParams }
  | { type: 'delete-step'; id: string }
  | { type: 'move-step'; id: string; by: -1 | 1 }
  | { type: 'rename-project'; name: string }
  | { type: 'replace'; project: Project };

export function reducer(state: Project, action: Action): Project {
  switch (action.type) {
    case 'add-foundation': {
      const n = state.steps.filter((s) => s.kind === 'foundation').length;
      const step: FoundationStep = {
        id: action.id,
        kind: 'foundation',
        label: n === 0 ? 'Foundation' : `Foundation ${n + 1}`,
        level: 'Basement',
        visible: true,
        notes: '',
        params: defaultFoundation(),
      };
      return { ...state, steps: [...state.steps, step] };
    }
    case 'add-floor': {
      const support = state.steps.find((s) => s.id === action.supportId);
      const step: FloorStep = {
        id: action.id,
        kind: 'floor',
        label: support ? `Floor over ${support.label.toLowerCase()}` : 'Floor',
        level: 'Ground floor',
        visible: true,
        notes: '',
        params: defaultFloor(action.supportId, support?.kind === 'foundation' ? support.params : undefined),
      };
      // Insert right after the foundation it sits on, so the order reads bottom to top.
      const i = state.steps.findIndex((s) => s.id === action.supportId);
      const steps = [...state.steps];
      steps.splice(i < 0 ? steps.length : i + 1, 0, step);
      return { ...state, steps };
    }
    case 'update-floor':
      return {
        ...state,
        steps: state.steps.map((s) => (s.id === action.id && s.kind === 'floor' ? { ...s, params: action.params } : s)),
      };
    case 'update-step':
      return {
        ...state,
        steps: state.steps.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)),
      };
    case 'update-foundation':
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.id === action.id && s.kind === 'foundation' ? { ...s, params: action.params } : s,
        ),
      };
    case 'delete-step':
      return { ...state, steps: state.steps.filter((s) => s.id !== action.id) };
    case 'move-step': {
      const i = state.steps.findIndex((s) => s.id === action.id);
      const j = i + action.by;
      if (i < 0 || j < 0 || j >= state.steps.length) return state;
      const steps = [...state.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...state, steps };
    }
    case 'rename-project':
      return { ...state, name: action.name };
    case 'replace':
      return action.project;
  }
}

/** Rebuild every component from the steps, in order. */
export function buildComponents(project: Project): Component[] {
  const out: Component[] = [];
  for (const step of project.steps) {
    if (step.kind === 'foundation') out.push(...buildFoundation(step.id, step.label, step.params));
    else if (step.kind === 'floor') out.push(...buildFloor(step.id, step.label, step.params, supportOf(project, step)));
  }
  return out;
}

/** The foundation parameters a floor sits on, if that step still exists. */
export function supportOf(project: Project, step: FloorStep): FoundationParams | undefined {
  const s = project.steps.find((x) => x.id === step.params.supportId);
  return s && s.kind === 'foundation' ? s.params : undefined;
}

/** Parse a saved project file. Throws with a readable message if it isn't one. */
export function parseProject(json: string): Project {
  const data = JSON.parse(json);
  if (!data || data.version !== 1 || !Array.isArray(data.steps)) {
    throw new Error("This doesn't look like a House Modeler project file.");
  }
  const base = emptyProject();
  return {
    ...base,
    ...data,
    steps: data.steps.map((s: Partial<Step>) => {
      const step = { visible: true, notes: '', level: '', ...s } as Step;
      if (step.kind === 'foundation') step.params = { ...step.params, type: step.params.type ?? 'basement' };
      if (step.kind === 'floor') step.params = { ...defaultFloor(step.params.supportId), ...step.params };
      return step;
    }),
  };
}

const AUTOSAVE_KEY = 'house-modeler:project';

export function loadAutosave(): Project {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) return parseProject(raw);
  } catch {
    // Missing or unreadable: start fresh.
  }
  return emptyProject();
}

export function saveAutosave(project: Project) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  } catch {
    // Storage blocked: the person can still use Save to file.
  }
}
