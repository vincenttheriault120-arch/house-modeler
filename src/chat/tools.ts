import type Anthropic from '@anthropic-ai/sdk';
import { applyFoundationType, defaultFoundation, type FoundationParams, type FoundationType } from '../model/foundation';
import type { Direction, Run } from '../model/geometry';
import { defaultFloor, floorLevels, type FloorParams } from '../model/floor';
import type { Level, LevelKind } from '../model/levels';
import { newId, reducer, supportOf } from '../model/project';
import type { Project } from '../model/types';
import { formatLength, parseLength, type UnitSystem } from '../units';
import { facetLengths, measures as draftMeasures, placeOpening, removePart, roofFacets, setDim, type CornerLengths } from '../draft/model';
import type { Block, Dim, Face, OpeningKind, RoofType } from '../draft/types';

const FACETS = {
  type: 'array',
  description:
    "Folded roofs: every flat region the roof plan draws inside this roof's outline, together covering the whole roof. Corners in order around each region: across = from the volume's left wall, back = from its front wall, height = above the top of its walls (0 at the lowest roof edge). Lengths are strings with units.",
  items: {
    type: 'object',
    properties: {
      corners: {
        type: 'array',
        items: {
          type: 'object',
          properties: { across: { type: 'string' }, back: { type: 'string' }, height: { type: 'string' } },
          required: ['across', 'back', 'height'],
          additionalProperties: false,
        },
      },
    },
    required: ['corners'],
    additionalProperties: false,
  },
};

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
  top_level_id: { type: 'string', description: 'Make the top follow this level (its elevation replaces top_elevation). "" to unlink.' },
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
  level_id: { type: 'string', description: 'The level this floor should finish at (top of subfloor); the app warns on a mismatch. "" for none.' },
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
    name: 'set_levels',
    description:
      'Replace the list of levels: the key heights of the house relative to finished grade = 0 (top of foundation, garage slab, each finished floor, ceilings, eave, ridge). Keep the level_id of levels that stay, so steps following them stay linked.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        levels: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              level_id: { type: 'string', description: 'Existing id to keep; omit for a new level.' },
              name: { type: 'string' },
              kind: { type: 'string', enum: ['foundation-top', 'garage-slab', 'floor', 'ceiling', 'eave', 'ridge', 'other'] },
              elevation: LENGTH,
            },
            required: ['name', 'kind', 'elevation'],
            additionalProperties: false,
          },
        },
      },
      required: ['levels'],
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
  {
    name: 'set_draft_values',
    description:
      'Change measurements of the Phase 1 exterior draft, by measurement id (from exterior_draft.measurements). The new value becomes the person\'s own (black) and counts as checked.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, value: LENGTH },
            required: ['id', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['changes'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_draft_volume',
    description: 'Change a volume of the exterior draft: its name or its roof shape. Use set_draft_values for its measurements.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        volume_id: { type: 'string' },
        name: { type: 'string' },
        roof_type: {
          type: 'string',
          enum: ['flat', 'parapet', 'shed', 'gable', 'hip', 'folded'],
          description:
            'parapet = flat-topped walls all around with one roof plane inside sloping down toward low_side. folded = a roof made of several flat facets (e.g. a rectangle that dips along valley lines toward drains); give roof_facets with it.',
        },
        roof_facets: FACETS,
        ridge_along: { type: 'string', enum: ['width', 'depth'], description: 'Gable or hip: the direction the ridge runs.' },
        low_side: { type: 'string', enum: ['front', 'back', 'left', 'right'], description: 'Shed or parapet: the side the roof slopes down toward.' },
      },
      required: ['volume_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_draft_volume',
    description:
      'Add a box-shaped volume to the exterior draft (x from the house\'s leftmost wall, y back from its frontmost wall, heights above grade). Volumes must not overlap; to replace one, remove it first. Its values show in red until the person checks them.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        x: LENGTH,
        y: LENGTH,
        width: LENGTH,
        depth: LENGTH,
        base: { ...LENGTH, description: 'Bottom of the volume above grade. ' + LENGTH.description },
        wall_height: { ...LENGTH, description: 'Bottom of the volume to the top of its walls (shed/parapet: to the low edge of the roof). ' + LENGTH.description },
        roof_type: { type: 'string', enum: ['flat', 'parapet', 'shed', 'gable', 'hip', 'folded'] },
        roof_facets: FACETS,
        rise: { ...LENGTH, description: 'Ridge, high side or parapet top above the top of the walls; flat: roof thickness. ' + LENGTH.description },
        overhang: LENGTH,
        ridge_along: { type: 'string', enum: ['width', 'depth'] },
        low_side: { type: 'string', enum: ['front', 'back', 'left', 'right'] },
      },
      required: ['name', 'x', 'y', 'width', 'depth', 'base', 'wall_height', 'roof_type', 'rise'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_draft_opening',
    description:
      'Add a door or window to the exterior draft, placed as seen on an elevation drawing: from_left = from the left end of the house as drawn on that elevation, bottom = above grade. It goes on the wall nearest the viewer at that spot.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        elevation: { type: 'string', enum: ['front', 'back', 'left', 'right'] },
        kind: { type: 'string', enum: ['window', 'door', 'patio-door', 'garage-door'] },
        from_left: LENGTH,
        bottom: LENGTH,
        width: LENGTH,
        height: LENGTH,
      },
      required: ['elevation', 'kind', 'from_left', 'bottom', 'width', 'height'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_draft_part',
    description: 'Remove a volume (with its doors and windows) or a single door or window from the exterior draft, by its id.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { part_id: { type: 'string' } },
      required: ['part_id'],
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
  if (typeof input.top_level_id === 'string') {
    if (input.top_level_id === '') delete p.topLevelId;
    else p.topLevelId = input.top_level_id;
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
  if (typeof input.level_id === 'string') {
    if (input.level_id === '') delete p.levelId;
    else if (!project.levels.some((l) => l.id === input.level_id)) throw new ToolInputError(`No level with id "${input.level_id}"`);
    else p.levelId = input.level_id;
  }
  for (const [key, field] of FLOOR_MAP) {
    if (input[key] !== undefined) (p[field] as number) = len(input[key], key);
  }
  return p;
}

/** Apply one tool call to the project. Never throws: errors come back as text for Claude. */
export function runTool(project: Project, name: string, input: Input): { project: Project; result: string; isError: boolean } {
  try {
    const step = typeof input.step_id === 'string' ? project.steps.find((s) => s.id === input.step_id) : undefined;
    if (name === 'set_levels') {
      if (!Array.isArray(input.levels)) throw new ToolInputError('levels must be a list');
      const kinds = ['foundation-top', 'garage-slab', 'floor', 'ceiling', 'eave', 'ridge', 'other'];
      const levels: Level[] = input.levels.map((raw: unknown, i: number) => {
        const l = raw as Input;
        if (typeof l.name !== 'string' || !kinds.includes(l.kind as string)) throw new ToolInputError(`levels[${i}] needs a name and a valid kind`);
        const keep = typeof l.level_id === 'string' && project.levels.some((x) => x.id === l.level_id);
        return { id: keep ? (l.level_id as string) : newId(), name: l.name, kind: l.kind as LevelKind, elevation: len(l.elevation, `levels[${i}].elevation`), source: 'Set in chat' };
      });
      return { project: reducer(project, { type: 'set-levels', levels }), result: `Levels set: ${levels.map((l) => `${l.name}=${l.id}`).join(', ')}.`, isError: false };
    }
    if (typeof input.top_level_id === 'string' && input.top_level_id !== '' && !project.levels.some((l) => l.id === input.top_level_id))
      throw new ToolInputError(`No level with id "${input.top_level_id}"`);
    if (name !== 'add_foundation_step' && name !== 'add_floor_step' && !name.includes('draft') && !step) throw new ToolInputError(`No step with id "${input.step_id}"`);

    if (name.includes('draft')) return { ...runDraftTool(project, name, input), isError: false };

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

const ROOFS: RoofType[] = ['flat', 'parapet', 'shed', 'gable', 'hip', 'folded'];
const FACES: Face[] = ['front', 'back', 'left', 'right'];

function rid() {
  return Math.random().toString(36).slice(2, 8);
}

/** Applies roof_facets from a tool call; a folded roof needs them. */
function withFacets(b: Block, raw: unknown): Block {
  if (raw === undefined) {
    if (b.roof.type === 'folded' && !b.roof.facets?.length) throw new ToolInputError('A folded roof needs roof_facets.');
    return b;
  }
  if (!Array.isArray(raw)) throw new ToolInputError('roof_facets must be a list');
  const f = roofFacets(raw as { corners: CornerLengths[] }[], b.width.mm, b.roof.rise.mm, b.depth.mm, (s) =>
    typeof s === 'string' ? parseLength(s, 'metric') : null,
  );
  if (!f) throw new ToolInputError('roof_facets: no facet could be read. Each needs 3 or more corners with across, back and height lengths.');
  return { ...b, roof: { ...b.roof, type: 'folded', facets: f.facets, rise: { ...b.roof.rise, mm: f.rise, source: 'ai', ref: 'Set in chat' } } };
}

/** The exterior draft tools. Throws ToolInputError on bad input. */
function runDraftTool(project: Project, name: string, input: Input): { project: Project; result: string } {
  let draft = project.exterior;
  if (!draft) throw new ToolInputError('There is no exterior draft yet. The person can make one in Phase 1 (Draft the exterior).');
  const ai = (mm: number): Dim => ({ mm, source: 'ai', ref: 'Set in chat' });
  switch (name) {
    case 'set_draft_values': {
      if (!Array.isArray(input.changes)) throw new ToolInputError('changes must be a list');
      const ids = new Set(draftMeasures(draft).map((m) => m.id));
      for (const [i, c] of (input.changes as Input[]).entries()) {
        if (typeof c.id !== 'string' || !ids.has(c.id)) throw new ToolInputError(`changes[${i}]: no measurement with id "${c.id}"`);
        draft = setDim(draft, c.id, { mm: len(c.value, `changes[${i}].value`) });
      }
      return { project: { ...project, exterior: draft }, result: `Changed ${(input.changes as unknown[]).length} measurement(s).` };
    }
    case 'update_draft_volume': {
      const b = draft.blocks.find((x) => x.id === input.volume_id);
      if (!b) throw new ToolInputError(`No volume with id "${input.volume_id}"`);
      if (input.roof_type !== undefined && !ROOFS.includes(input.roof_type as RoofType)) throw new ToolInputError('roof_type is invalid');
      if (input.low_side !== undefined && !FACES.includes(input.low_side as Face)) throw new ToolInputError('low_side is invalid');
      const roof = {
        ...b.roof,
        ...(input.roof_type ? { type: input.roof_type as RoofType } : {}),
        ...(input.ridge_along ? { ridge: input.ridge_along === 'width' ? ('x' as const) : ('y' as const) } : {}),
        ...(input.low_side ? { low: input.low_side as Face } : {}),
      };
      let next: Block = { ...b, roof, ...(typeof input.name === 'string' ? { name: input.name } : {}) };
      next = withFacets(next, input.roof_facets);
      return { project: { ...project, exterior: { ...draft, blocks: draft.blocks.map((x) => (x.id === b.id ? next : x)) } }, result: 'Updated.' };
    }
    case 'add_draft_volume': {
      if (!ROOFS.includes(input.roof_type as RoofType)) throw new ToolInputError('roof_type is invalid');
      const b: Block = {
        id: `vol-${rid()}`,
        name: String(input.name),
        x: ai(len(input.x, 'x')),
        y: ai(len(input.y, 'y')),
        width: ai(len(input.width, 'width')),
        depth: ai(len(input.depth, 'depth')),
        base: ai(len(input.base, 'base')),
        height: ai(len(input.wall_height, 'wall_height')),
        roof: {
          type: input.roof_type as RoofType,
          rise: ai(len(input.rise, 'rise')),
          overhang: ai(input.overhang === undefined ? 0 : len(input.overhang, 'overhang')),
          ridge: input.ridge_along === 'width' ? 'x' : 'y',
          low: FACES.includes(input.low_side as Face) ? (input.low_side as Face) : 'left',
        },
      };
      const added = withFacets(b, input.roof_facets);
      return { project: { ...project, exterior: { ...draft, blocks: [...draft.blocks, added] } }, result: `Added volume ${added.id}.` };
    }
    case 'add_draft_opening': {
      if (!FACES.includes(input.elevation as Face)) throw new ToolInputError('elevation is invalid');
      const width = len(input.width, 'width');
      const at = placeOpening(draft, input.elevation as Face, len(input.from_left, 'from_left'), len(input.bottom, 'bottom'), width);
      if (!at) throw new ToolInputError('That spot is not on any wall of the draft on that elevation.');
      const o = {
        id: `op-${rid()}`,
        blockId: at.blockId,
        face: input.elevation as Face,
        kind: (['window', 'door', 'patio-door', 'garage-door'].includes(input.kind as string) ? input.kind : 'window') as OpeningKind,
        offset: ai(at.offset),
        sill: ai(at.sill),
        width: ai(width),
        height: ai(len(input.height, 'height')),
      };
      return { project: { ...project, exterior: { ...draft, openings: [...draft.openings, o] } }, result: `Added opening ${o.id} on volume ${at.blockId}.` };
    }
    case 'remove_draft_part': {
      const id = String(input.part_id);
      if (!draft.blocks.some((b) => b.id === id) && !draft.openings.some((o) => o.id === id)) throw new ToolInputError(`No volume or opening with id "${id}"`);
      return { project: { ...project, exterior: removePart(draft, id) }, result: 'Removed.' };
    }
    default:
      throw new ToolInputError(`Unknown tool ${name}`);
  }
}

/** The exterior draft as Claude sees it. */
function describeDraft(project: Project, units: UnitSystem) {
  const d = project.exterior;
  if (!d) return undefined;
  const f = (mm: number) => formatLength(mm, units);
  return {
    volumes: d.blocks.map((b) => ({
      volume_id: b.id,
      name: b.name,
      roof_type: b.roof.type,
      ridge_along: b.roof.ridge === 'x' ? 'width' : 'depth',
      low_side: b.roof.low,
      ...(b.roof.type === 'folded' ? { roof_facets: facetLengths(b, f) } : {}),
    })),
    openings: d.openings.map((o) => ({ opening_id: o.id, volume_id: o.blockId, face: o.face, kind: o.kind })),
    measurements: draftMeasures(d).map((m) => ({
      id: m.id,
      part: m.partName,
      label: m.label,
      value: f(m.dim.mm),
      source: m.dim.source === 'plan' ? 'from plans' : m.dim.source === 'ai' ? 'inferred (red)' : 'set by the person',
      checked: !!m.dim.ok,
    })),
  };
}

/** The project as Claude sees it, with lengths written in the person's units. */
export function describeProject(project: Project, units: UnitSystem): string {
  const f = (mm: number) => formatLength(mm, units);
  return JSON.stringify(
    {
      name: project.name,
      phase: project.phase ?? 1,
      exterior_draft: describeDraft(project, units),
      levels: project.levels.map((l) => ({ level_id: l.id, name: l.name, kind: l.kind, elevation: f(l.elevation) })),
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
            level_id: p.levelId,
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
          top_level_id: s.params.topLevelId,
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
