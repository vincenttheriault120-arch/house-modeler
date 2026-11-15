import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { MODEL } from '../chat/claude';
import { describeProject } from '../chat/tools';
import type { FoundationStep, Project } from '../model/types';
import type { FoundationParams } from '../model/foundation';
import type { Run } from '../model/geometry';
import { parseLength, type UnitSystem } from '../units';
import { getPlanData, PLAN_KINDS, type PlanMeta } from './store';

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

export async function suggestFoundation(opts: {
  apiKey: string;
  plans: PlanMeta[];
  project: Project;
  step: FoundationStep;
  units: UnitSystem;
  signal?: AbortSignal;
}): Promise<FoundationSuggestion> {
  const { apiKey, plans, project, step, units, signal } = opts;
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

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
  content.push({
    type: 'text',
    text: `Units: ${units === 'imperial' ? 'feet-inches' : 'millimetres'}.

Current project:
${describeProject(project, units)}

Propose the measurements for the foundation step "${step.label}" (step_id ${step.id}, level "${step.level}") from the attached plans.`,
  });

  const response = await client.beta.messages.parse(
    {
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: betaZodOutputFormat(FoundationSuggestion) },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content }],
    },
    { signal },
  );

  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read these plans.');
  if (response.stop_reason === 'max_tokens') throw new Error('The answer was cut off. Try again with fewer plans selected.');
  if (!response.parsed_output) throw new Error("Claude's answer couldn't be read. Try again.");
  return response.parsed_output;
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
