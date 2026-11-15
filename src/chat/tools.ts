import type Anthropic from '@anthropic-ai/sdk';
import { applyFoundationType, defaultFoundation, type FoundationParams, type FoundationType } from '../model/foundation';
import type { Direction, Run } from '../model/geometry';
import { defaultFloor, floorLevels, type FloorParams } from '../model/floor';
import { newId, reducer, supportOf } from '../model/project';
import type { Project } from '../model/types';
import { formatLength, parseLength, type UnitSystem } from '../units';

const LENGTH = {
  type: 'string',
  description: `A length with units, e.g. "21' 1 1/2\\"", "8\\"", "2400 mm", "2.4 m". Negative allowed for elevations.`,
} as const;

const FOUNDATION_FIELDS = {
  type: { type: 'string', enum: ['basement', 'slab-on-grade'] },
  origin_x: { ...LENGTH, description: 'Plan X of the outline start point (right is +). ' + LENGTH.description },
  origin_y: { ...LENGTH, description: 'Plan Y of the outline start point (up the page / toward the back is +). ' + LENGTH.description },
  runs: {
    type: 'array',
    description: 'The outline, walked side by side along the OUTSIDE face of the walls, starting at the origin. Must return to the start.',
    items: {
      type: 'object',
      properties: { dir: { type: 'string', enum: ['right', 'up', 'left', 'down'] }, length: LENGTH },
      required: ['dir', 'length'],
      additionalProperties: false,
    },
  },
  wall_thickness: LENGTH,
  wall_height: { ...LENGTH, description: 'Basement wall height, or frost wall depth for slab-on-grade (0 = none). ' + LENGTH.description },
  top_elevation: { ...LENGTH, description: 'Top of wall (basement) or top of slab (slab-on-grade), relative to finished grade = 0. ' + LENGTH.description },
  footing_width: LENGTH,
  footing_thickness: LENGTH,
  slab_thickness: LENGTH,
} as const;

const FLOOR_FIELDS = {
  joist_depth: { ...LENGTH, description: 'Joist depth, e.g. 9 1/4" for 2x10, 11 7/8" for I-joists. ' + LENGTH.description },
  joist_width: LENGTH,
  joist_spacing: { ...LENGTH, description: 'Centre to centre, e.g. 16". ' + LENGTH.description },
  joist_direction: { type: 'string', enum: ['x', 'y'], description: "'y' = joists run front to back (plan Y), 'x' = left to right." },
  rim_thickness: LENGTH,
  sill_thickness: LENGTH,
  sill_width: LENGTH,
  beam: { type: 'boolean', description: 'Dropped beam under the joists (basement only).' },
  beam_width: LENGTH,
  beam_depth: LENGTH,
  beam_offset: { ...LENGTH, description: 'Beam centre from the outside face of the foundation; "0" = middle. ' + LENGTH.description },
  post_spacing: { ...LENGTH, description: 'Max spacing of posts under the beam; "0" = no posts. ' + LENGTH.description },
  post_size: LENGTH,
  subfloor_thickness: LENGTH,
} as const;

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'add_foundation_step',
    description:
      'Add a new foundation step (basement or slab-on-grade) at the end of the step list. Omitted fields use sensible defaults. Returns the new step id.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        level: { type: 'string', description: 'e.g. "Basement", "Garage"' },
        ...FOUNDATION_FIELDS,
      },
      required: ['label', 'runs'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_foundation_step',
    description:
      'Change measurements of an existing foundation step. Only the fields you pass change. Passing runs replaces the whole outline.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { step_id: { type: 'string' }, ...FOUNDATION_FIELDS },
      required: ['step_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_floor_step',
    description:
      'Add a floor system (sill plate, rim, joists, optional beam and posts, subfloor) on top of an existing foundation step. It takes the outline and top of wall from that foundation. Omitted fields use typical values.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        support_step_id: { type: 'string', description: 'The foundation step it sits on.' },
        label: { type: 'string' },
        level: { type: 'string' },
        ...FLOOR_FIELDS,
      },
      required: ['support_step_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_floor_step',
    description: 'Change measurements of an existing floor step. Only the fields you pass change.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { step_id: { type: 'string' }, support_step_id: { type: 'string' }, ...FLOOR_FIELDS },
      required: ['step_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_step_info',
    description: "Rename a step, change its level label, notes, or whether it's visible.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        step_id: { type: 'string' },
        label: { type: 'string' },
        level: { type: 'string' },
        notes: { type: 'string' },
        visible: { type: 'boolean' },
      },
      required: ['step_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_step',
    description: 'Delete a step. Only do this when the person clearly asked for it.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { step_id: { type: 'string' } },
      required: ['step_id'],
      additionalProperties: false,
    },
  },
];

type Input = Record<string, unknown>;

class ToolInputError extends Error {}

function len(v: unknown, field: string): number {
  if (typeof v !== 'string' && typeof v !== 'number') throw new ToolInputError(`${field} must be a length string`);
  const mm = parseLength(String(v), 'metric');
  if (mm === null) throw new ToolInputError(`Could not read ${field}: "${v}"`);
  return mm;
}

function foundationPatch(base: FoundationParams, input: Input): FoundationParams {
  let p = { ...base };
  if (input.type !== undefined) {
    if (input.type !== 'basement' && input.type !== 'slab-on-grade') throw new ToolInputError('type must be basement or slab-on-grade');
    p = applyFoundationType(p, input.type as FoundationType);
  }
  if (input.runs !== undefined) {
    if (!Array.isArray(input.runs)) throw new ToolInputError('runs must be a list');
    p.runs = input.runs.map((r: unknown, i: number): Run => {
      const run = r as Input;
      if (!['right', 'up', 'left', 'down'].includes(run?.dir as string)) throw new ToolInputError(`runs[${i}].dir is invalid`);
      return { dir: run.dir as Direction, length: len(run.length, `runs[${i}].length`) };
    });
  }
  const origin = { ...p.origin };
  if (input.origin_x !== undefined) origin.x = len(input.origin_x, 'origin_x');
  if (input.origin_y !== undefined) origin.y = len(input.origin_y, 'origin_y');
  p.origin = origin;
  const map: [string, keyof FoundationParams][] = [
    ['wall_thickness', 'wallThickness'],
    ['wall_height', 'wallHeight'],
    ['top_elevation', 'topElevation'],
    ['footing_width', 'footingWidth'],
    ['footing_thickness', 'footingThickness'],
    ['slab_thickness', 'slabThickness'],
  ];
  for (const [key, field] of map) {
    if (input[key] !== undefined) (p[field] as number) = len(input[key], key);
  }
  return p;
}

const FLOOR_MAP: [string, keyof FloorParams][] = [
  ['joist_depth', 'joistDepth'],
  ['joist_width', 'joistWidth'],
  ['joist_spacing', 'joistSpacing'],
  ['rim_thickness', 'rimThickness'],
  ['sill_thickness', 'sillThickness'],
  ['sill_width', 'sillWidth'],
  ['beam_width', 'beamWidth'],
  ['beam_depth', 'beamDepth'],
  ['beam_offset', 'beamOffset'],
  ['post_spacing', 'postSpacing'],
  ['post_size', 'postSize'],
  ['subfloor_thickness', 'subfloorThickness'],
];

function floorPatch(project: Project, base: FloorParams, input: Input): FloorParams {
  const p = { ...base };
  if (input.support_step_id !== undefined) {
    const s = project.steps.find((x) => x.id === input.support_step_id);
    if (!s || s.kind !== 'foundation') throw new ToolInputError('support_step_id must be a foundation step');
    p.supportId = s.id;
  }
  if (input.joist_direction !== undefined) {
    if (input.joist_direction !== 'x' && input.joist_direction !== 'y') throw new ToolInputError("joist_direction must be 'x' or 'y'");
    p.joistDirection = input.joist_direction;
  }
  if (input.beam !== undefined) p.beam = !!input.beam;
  for (const [key, field] of FLOOR_MAP) {
    if (input[key] !== undefined) (p[field] as number) = len(input[key], key);
  }
  return p;
}

/** Apply one tool call to the project. Never throws: errors come back as text for Claude. */
export function runTool(project: Project, name: string, input: Input): { project: Project; result: string; isError: boolean } {
  try {
    const step = typeof input.step_id === 'string' ? project.steps.find((s) => s.id === input.step_id) : undefined;
    if (name !== 'add_foundation_step' && name !== 'add_floor_step' && !step) throw new ToolInputError(`No step with id "${input.step_id}"`);

    switch (name) {
      case 'add_foundation_step': {
        const id = newId();
        let next = reducer(project, { type: 'add-foundation', id });
        const params = foundationPatch(defaultFoundation(), input);
        next = reducer(next, { type: 'update-foundation', id, params });
        next = reducer(next, {
          type: 'update-step',
          id,
          patch: {
            ...(typeof input.label === 'string' ? { label: input.label } : {}),
            ...(typeof input.level === 'string' ? { level: input.level } : {}),
          },
        });
        return { project: next, result: `Added step ${id}.`, isError: false };
      }
      case 'update_foundation_step': {
        if (step!.kind !== 'foundation') throw new ToolInputError('That step is not a foundation.');
        const params = foundationPatch(step!.params, input);
        return { project: reducer(project, { type: 'update-foundation', id: step!.id, params }), result: 'Updated.', isError: false };
      }
      case 'add_floor_step': {
        const support = project.steps.find((x) => x.id === input.support_step_id);
        if (!support || support.kind !== 'foundation') throw new ToolInputError('support_step_id must be a foundation step');
        const id = newId();
        const params = floorPatch(project, defaultFloor(support.id, support.params), input);
        let next = reducer(project, { type: 'add-floor', id, supportId: support.id });
        next = reducer(next, { type: 'update-floor', id, params });
        next = reducer(next, {
          type: 'update-step',
          id,
          patch: {
            ...(typeof input.label === 'string' ? { label: input.label } : {}),
            ...(typeof input.level === 'string' ? { level: input.level } : {}),
          },
        });
        return { project: next, result: `Added step ${id}.`, isError: false };
      }
      case 'update_floor_step': {
        if (step!.kind !== 'floor') throw new ToolInputError('That step is not a floor.');
        const params = floorPatch(project, step!.params, input);
        return { project: reducer(project, { type: 'update-floor', id: step!.id, params }), result: 'Updated.', isError: false };
      }
      case 'update_step_info': {
        const patch: Record<string, unknown> = {};
        for (const k of ['label', 'level', 'notes'] as const) if (typeof input[k] === 'string') patch[k] = input[k];
        if (typeof input.visible === 'boolean') patch.visible = input.visible;
        return { project: reducer(project, { type: 'update-step', id: step!.id, patch }), result: 'Updated.', isError: false };
      }
      case 'delete_step':
        return { project: reducer(project, { type: 'delete-step', id: step!.id }), result: 'Deleted.', isError: false };
      default:
        throw new ToolInputError(`Unknown tool ${name}`);
    }
  } catch (e) {
    if (e instanceof ToolInputError) return { project, result: e.message, isError: true };
    throw e;
  }
}

/** The project as Claude sees it, with lengths written in the person's units. */
export function describeProject(project: Project, units: UnitSystem): string {
  const f = (mm: number) => formatLength(mm, units);
  return JSON.stringify(
    {
      name: project.name,
      steps: project.steps.map((s, i) => {
        const base = {
          order: i + 1,
          step_id: s.id,
          kind: s.kind,
          label: s.label,
          level: s.level,
          visible: s.visible,
          notes: s.notes || undefined,
        };
        if (s.kind === 'floor') {
          const p = s.params;
          const support = supportOf(project, s);
          const out: Record<string, unknown> = {
            ...base,
            support_step_id: p.supportId,
            joist_direction: p.joistDirection,
            beam: p.beam,
            finished_floor_elevation: support ? f(floorLevels(p, support).floorTop) : 'support missing',
          };
          for (const [key, field] of FLOOR_MAP) out[key] = f(p[field] as number);
          return out;
        }
        return {
          ...base,
          type: s.params.type,
          origin_x: f(s.params.origin.x),
          origin_y: f(s.params.origin.y),
          runs: s.params.runs.map((r) => ({ dir: r.dir, length: f(r.length) })),
          wall_thickness: f(s.params.wallThickness),
          wall_height: f(s.params.wallHeight),
          top_elevation: f(s.params.topElevation),
          footing_width: f(s.params.footingWidth),
          footing_thickness: f(s.params.footingThickness),
          slab_thickness: f(s.params.slabThickness),
        };
      }),
    },
    null,
    1,
  );
}
