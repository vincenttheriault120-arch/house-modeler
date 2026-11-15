import type { Component } from './component';
import { buildFoundation, defaultFoundation, type FoundationParams } from './foundation';
import { emptyProject, type FoundationStep, type Project, type Step } from './types';

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

export type Action =
  | { type: 'add-foundation'; id: string }
  | { type: 'update-step'; id: string; patch: Partial<Omit<Step, 'id' | 'kind' | 'params'>> }
  | { type: 'update-foundation'; id: string; params: FoundationParams }
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
  }
  return out;
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
    steps: data.steps.map((s: Partial<Step>) => ({ visible: true, notes: '', level: '', ...s }) as Step),
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
