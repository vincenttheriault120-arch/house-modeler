import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { MODEL } from '../chat/claude';
import { describeProject } from '../chat/tools';
import type { FloorParams } from '../model/floor';
import type { FloorStep, FoundationStep, Project, Step } from '../model/types';
import type { FoundationParams } from '../model/foundation';
import type { Run } from '../model/geometry';
import { parseLength, type UnitSystem } from '../units';
import { getPlanData, PLAN_KINDS, type PlanKind, type PlanMeta } from './store';
import type { Level, LevelKind } from '../model/levels';

const Length = z.object({
  value: z.string().nullable().describe('Length with units, e.g. "26\' 1\\"" or "8\\"". null if it cannot be determined at all.'),
  source: z
    .string()
    .describe('Where it came from: the dimension text and drawing (e.g. "26\'-1\\" on the basement plan, left side"), or "not shown; typical value" if estimated.'),
  confident: z.boolean().describe('true only if the value was read directly from a dimension on the plans.'),
});

export const FoundationSuggestion = z.object({
  summary: z.string().describe('Two or three plain sentences: what was found, and anything the person should double-check.'),
  type: z.enum(['basement', 'slab-on-grade']),
  type_source: z.string(),
  origin_x: Length,
  origin_y: Length,
  runs: z
    .array(z.object({ dir: z.enum(['right', 'up', 'left', 'down']), length: z.string() }))
    .describe('Outline along the OUTSIDE face of the walls, starting at the origin, going counter-clockwise (first run to the right), closing back on the start.'),
  runs_source: z.string(),
  runs_confident: z.boolean(),
  wall_thickness: Length,
  wall_height: Length,
  top_elevation: Length,
  footing_width: Length,
  footing_thickness: Length,
  slab_thickness: Length,
});
export type FoundationSuggestion = z.infer<typeof FoundationSuggestion>;

const SYSTEM = `You read residential architectural drawings (often printed PDFs, possibly in French: "sous-sol" = basement, "fondation" = foundation, "semelle" = footing, "dalle" = slab, "garage", "coupe" = section, "élévation" = elevation) and propose measurements for one build step of a house model.

Model conventions:
- Plan coordinates: X to the right, Y up the page. Finished grade is elevation 0.
- A foundation outline is walked along the OUTSIDE face of the foundation walls, starting at the step's origin, counter-clockwise, and must close.
- "basement": walls of wall_height whose top is at top_elevation; slab at the bottom inside the walls.
- "slab-on-grade": slab whose top is at top_elevation over the whole outline, on a perimeter frost wall of depth wall_height.
- If the house has several foundation parts (e.g. a basement and a garage slab), only describe the part named in the request. Use the other steps' positions so this part lines up with them.

Rules:
- Read dimension strings exactly (e.g. 21'-1 1/2" → "21' 1 1/2\\""). Prefer written dimensions over scaling the drawing.
- Mark a value confident only if it was read from a dimension. For anything not shown, give a typical value for the region and say so in its source.
- Write every length in the person's unit system.`;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function planDocuments(plans: PlanMeta[]): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const plan of plans) {
    const data = await getPlanData(plan.id);
    if (!data) continue;
    const kind = PLAN_KINDS.find((k) => k.value === plan.kind)?.label ?? plan.kind;
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: toBase64(data) },
      title: `${plan.name} (${kind})`,
    });
  }
  return content;
}

async function ask<T extends z.ZodType>(opts: {
  apiKey: string;
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  schema: T;
  signal?: AbortSignal;
}): Promise<z.infer<T>> {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const response = await client.beta.messages.parse(
    {
      model: MODEL,
      max_tokens: 16000,
      system: opts.system,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: betaZodOutputFormat(opts.schema) },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: opts.content }],
    },
    { signal: opts.signal },
  );
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read these plans.');
  if (response.stop_reason === 'max_tokens') throw new Error('The answer was cut off. Try again with fewer plans selected.');
  if (!response.parsed_output) throw new Error("Claude's answer couldn't be read. Try again.");
  return response.parsed_output as z.infer<T>;
}

function request(project: Project, step: Step, units: UnitSystem, what: string): Anthropic.Beta.BetaContentBlockParam {
  return {
    type: 'text',
    text: `Units: ${units === 'imperial' ? 'feet-inches' : 'millimetres'}.

Current project:
${describeProject(project, units)}

Propose the measurements for the ${what} step "${step.label}" (step_id ${step.id}, level "${step.level}") from the attached plans.`,
  };
}

export async function suggestFoundation(opts: {
  apiKey: string;
  plans: PlanMeta[];
  project: Project;
  step: FoundationStep;
  units: UnitSystem;
  signal?: AbortSignal;
}): Promise<FoundationSuggestion> {
  const content = await planDocuments(opts.plans);
  content.push(request(opts.project, opts.step, opts.units, 'foundation'));
  return ask({ apiKey: opts.apiKey, system: SYSTEM, content, schema: FoundationSuggestion, signal: opts.signal });
}

export const FloorSuggestion = z.object({
  summary: z.string().describe('Two or three plain sentences: what was found, and anything the person should double-check.'),
  joist_direction: z.enum(['x', 'y']).describe("'y' = joists run front to back (up the page), 'x' = left to right."),
  joist_direction_source: z.string(),
  beam: z.boolean().describe('Whether there is a dropped beam (poutre) under the joists.'),
  beam_source: z.string(),
  joist_depth: Length,
  joist_width: Length,
  joist_spacing: Length,
  rim_thickness: Length,
  sill_width: Length,
  sill_thickness: Length,
  beam_width: Length,
  beam_depth: Length,
  beam_offset: Length.describe('Beam centre measured from the outside face of the foundation (left side for front-to-back joists, front side for left-to-right joists). "0" = middle.'),
  post_spacing: Length,
  post_size: Length,
  subfloor_thickness: Length,
});
export type FloorSuggestion = z.infer<typeof FloorSuggestion>;

const FLOOR_SYSTEM = `${SYSTEM}

This request is for a FLOOR step: the floor system sitting on top of a foundation (sill plate on the wall, rim joist, joists, optional dropped beam with steel posts, subfloor). Look for it on sections ("coupe"), the foundation plan, and notes: "solives" = joists (e.g. "solives 2x10 @ 16\" c/c"), "poutre" = beam (e.g. "3-2x10"), "colonne" / "poteau" = post, "lisse" / "lisse d'assise" = sill plate, "solive de rive" = rim joist, "contreplaqué" / "sous-plancher" = subfloor. Nominal lumber: 2x10 is 1 1/2" x 9 1/4", 2x8 is 1 1/2" x 7 1/4", 2x12 is 1 1/2" x 11 1/4", 2x6 sill is 5 1/2" wide. Joists run in the direction they span, usually across the shorter dimension, bearing on the beam.`;

export async function suggestFloor(opts: {
  apiKey: string;
  plans: PlanMeta[];
  project: Project;
  step: FloorStep;
  units: UnitSystem;
  signal?: AbortSignal;
}): Promise<FloorSuggestion> {
  const content = await planDocuments(opts.plans);
  content.push(request(opts.project, opts.step, opts.units, 'floor'));
  return ask({ apiKey: opts.apiKey, system: FLOOR_SYSTEM, content, schema: FloorSuggestion, signal: opts.signal });
}

export const FLOOR_ROWS: { key: Exclude<keyof FloorParams, 'supportId' | 'joistDirection' | 'beam' | 'levelId'>; field: keyof FloorSuggestion; label: string }[] = [
  { key: 'joistDepth', field: 'joist_depth', label: 'Joist depth' },
  { key: 'joistWidth', field: 'joist_width', label: 'Joist width' },
  { key: 'joistSpacing', field: 'joist_spacing', label: 'Joist spacing (c/c)' },
  { key: 'rimThickness', field: 'rim_thickness', label: 'Rim thickness' },
  { key: 'sillWidth', field: 'sill_width', label: 'Sill width' },
  { key: 'sillThickness', field: 'sill_thickness', label: 'Sill thickness' },
  { key: 'beamWidth', field: 'beam_width', label: 'Beam width' },
  { key: 'beamDepth', field: 'beam_depth', label: 'Beam depth' },
  { key: 'beamOffset', field: 'beam_offset', label: 'Beam position (0 = middle)' },
  { key: 'postSpacing', field: 'post_spacing', label: 'Post spacing' },
  { key: 'postSize', field: 'post_size', label: 'Post size' },
  { key: 'subfloorThickness', field: 'subfloor_thickness', label: 'Subfloor' },
];

/** Floor suggestion → draft params and pre-ticked changes (nothing applied). */
export function floorSuggestionToDraft(
  s: FloorSuggestion,
  current: FloorParams,
  units: UnitSystem,
): { params: FloorParams; include: Record<string, boolean> } {
  const params: FloorParams = { ...current, joistDirection: s.joist_direction, beam: s.beam };
  const include: Record<string, boolean> = {
    joistDirection: s.joist_direction !== current.joistDirection,
    beam: s.beam !== current.beam,
  };
  for (const row of FLOOR_ROWS) {
    let mm = toMm((s[row.field] as FloorSuggestion['joist_depth']).value, units);
    if (mm !== null && mm < 0) mm = null;
    if (mm !== null) params[row.key] = mm;
    include[row.key] = mm !== null && Math.abs(mm - current[row.key]) > 0.5;
  }
  return { params, include };
}

export type LengthKey = 'wallThickness' | 'wallHeight' | 'topElevation' | 'footingWidth' | 'footingThickness' | 'slabThickness';
export const LENGTH_ROWS: { key: LengthKey; field: keyof FoundationSuggestion; label: string }[] = [
  { key: 'wallThickness', field: 'wall_thickness', label: 'Wall thickness' },
  { key: 'wallHeight', field: 'wall_height', label: 'Wall height / frost depth' },
  { key: 'topElevation', field: 'top_elevation', label: 'Top elevation' },
  { key: 'footingWidth', field: 'footing_width', label: 'Footing width' },
  { key: 'footingThickness', field: 'footing_thickness', label: 'Footing thickness' },
  { key: 'slabThickness', field: 'slab_thickness', label: 'Slab thickness' },
];

function toMm(v: string | null, units: UnitSystem): number | null {
  if (!v) return null;
  const mm = parseLength(v, units) ?? parseLength(v, units === 'metric' ? 'imperial' : 'metric');
  return mm !== null && Number.isFinite(mm) ? mm : null;
}

/**
 * Turn Claude's suggestion into a draft of the step's parameters, plus which
 * changes are pre-ticked for review. Unreadable values keep the current value
 * and stay unticked. Nothing is applied here.
 */
export function suggestionToDraft(
  s: FoundationSuggestion,
  current: FoundationParams,
  units: UnitSystem,
): { params: FoundationParams; include: Record<string, boolean> } {
  const params: FoundationParams = { ...current, origin: { ...current.origin } };
  const include: Record<string, boolean> = {};

  params.type = s.type;
  include.type = s.type !== current.type;

  const runs: Run[] = [];
  let runsOk = s.runs.length >= 3;
  for (const r of s.runs) {
    const mm = toMm(r.length, units);
    if (mm === null || mm <= 0) runsOk = false;
    else runs.push({ dir: r.dir, length: mm });
  }
  if (runsOk) params.runs = runs;
  include.runs = runsOk;

  for (const [axis, field] of [
    ['x', 'origin_x'],
    ['y', 'origin_y'],
  ] as const) {
    const mm = toMm(s[field].value, units);
    if (mm !== null) params.origin[axis] = mm;
    include[field] = mm !== null && Math.abs(mm - current.origin[axis]) > 0.5;
  }

  for (const row of LENGTH_ROWS) {
    let mm = toMm((s[row.field] as FoundationSuggestion['wall_thickness']).value, units);
    // Only the top elevation may be zero or negative.
    if (mm !== null && row.key !== 'topElevation' && mm <= 0) mm = null;
    if (mm !== null) params[row.key] = mm;
    include[row.key] = mm !== null && Math.abs(mm - current[row.key]) > 0.5;
  }
  return { params, include };
}

// ---------------------------------------------------------------------------
// Labeling a PDF

const KIND_VALUES = PLAN_KINDS.map((k) => k.value) as [PlanKind, ...PlanKind[]];

export const PlanLabel = z.object({
  kind: z.enum(KIND_VALUES).describe('The main drawing in this PDF.'),
  also_contains: z.array(z.enum(KIND_VALUES)).describe('Other drawings on other sheets of the same PDF, if any.'),
  title: z.string().describe('The drawing title as written on the sheet, e.g. "PLAN DU SOUS-SOL".'),
});
export type PlanLabel = z.infer<typeof PlanLabel>;

/** Ask Claude which drawing a PDF is. Uses a small, fast model. */
export async function labelPlan(apiKey: string, plan: PlanMeta, signal?: AbortSignal): Promise<PlanLabel> {
  const content = await planDocuments([plan]);
  content.push({
    type: 'text',
    text: `Which drawing is this? Kinds: ${PLAN_KINDS.map((k) => `${k.value} (${k.label})`).join(', ')}. For elevations, "front" faces the street. French: "élévation avant/arrière/latérale gauche/droite", "plan du sous-sol", "rez-de-chaussée", "étage", "coupe", "toiture".`,
  });
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.beta.messages.parse(
    {
      model: LABEL_MODEL,
      max_tokens: 1024,
      output_config: { format: betaZodOutputFormat(PlanLabel) },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content }],
    },
    { signal },
  );
  if (!response.parsed_output) throw new Error("Couldn't label this plan.");
  return response.parsed_output;
}

/** Labeling is a simple look-up, so it uses the small model. */
export const LABEL_MODEL = 'claude-haiku-5-5';

// ---------------------------------------------------------------------------
// Levels

const LEVEL_KIND_VALUES: [LevelKind, ...LevelKind[]] = ['foundation-top', 'garage-slab', 'floor', 'ceiling', 'eave', 'ridge', 'other'];

export const LevelsSuggestion = z.object({
  summary: z.string().describe('Two or three plain sentences: what was found, the datum used, and what to double-check.'),
  levels: z.array(
    z.object({
      name: z.string().describe('Short name, e.g. "Ground floor", "First floor", "Top of foundation", "Roof ridge".'),
      kind: z.enum(LEVEL_KIND_VALUES),
      elevation: z.string().nullable().describe('Height above finished grade (grade = 0), with units. null if not found.'),
      source: z.string().describe('Which drawing and which label, e.g. "Front elevation: N.P.F. REZ 1\'-11 1/2\"".'),
      confident: z.boolean().describe('true only if read from a written elevation or dimension.'),
    }),
  ),
});
export type LevelsSuggestion = z.infer<typeof LevelsSuggestion>;

const LEVELS_SYSTEM = `${SYSTEM}

This request is for the LEVELS of the house: the key heights the rest of the model hangs on, read mostly from the elevations and sections. Give, when shown: top of foundation, garage slab, each finished floor (ground floor, first floor...), top of walls / ceiling of each storey, eave, and roof ridge. Also include any other key height that matters for this house (e.g. the green roof over the garage door).

All elevations are relative to FINISHED GRADE = 0. Drawings often use another datum (e.g. ground floor = 0'-0" or 100'-0", "niveau du sol", "N.P.F." = niveau plancher fini = finished floor, "T/FDN", "dessus fondation"). Convert to grade = 0 using the grade line on the elevations; if grade isn't shown, say so in the summary and mark those values not confident. Order the levels from lowest to highest.`;

export async function suggestLevels(opts: {
  apiKey: string;
  plans: PlanMeta[];
  project: Project;
  units: UnitSystem;
  signal?: AbortSignal;
}): Promise<LevelsSuggestion> {
  const content = await planDocuments(opts.plans);
  content.push({
    type: 'text',
    text: `Units: ${opts.units === 'imperial' ? 'feet-inches' : 'millimetres'}.

Current project:
${describeProject(opts.project, opts.units)}

Propose the house's levels from the attached drawings.`,
  });
  return ask({ apiKey: opts.apiKey, system: LEVELS_SYSTEM, content, schema: LevelsSuggestion, signal: opts.signal });
}

/**
 * Merge suggested levels into the current ones: a suggestion with the same
 * kind and name (case-insensitive) updates that level; others are added.
 * Returns one entry per suggestion, with the matched current level if any.
 */
export function levelsSuggestionToDraft(
  s: LevelsSuggestion,
  current: Level[],
  units: UnitSystem,
  newId: () => string,
): { level: Level; existing?: Level; include: boolean; source: string; confident: boolean }[] {
  const key = (l: { kind: string; name: string }) => `${l.kind}|${l.name.trim().toLowerCase()}`;
  const byKey = new Map(current.map((l) => [key(l), l]));
  const out = [];
  for (const sl of s.levels) {
    const mm = toMm(sl.elevation, units);
    if (mm === null) continue;
    const existing = byKey.get(key(sl));
    out.push({
      level: { id: existing?.id ?? newId(), name: sl.name, kind: sl.kind, elevation: mm, source: sl.source },
      existing,
      include: !existing || Math.abs(existing.elevation - mm) > 0.5,
      source: sl.source,
      confident: sl.confident,
    });
  }
  return out;
}
