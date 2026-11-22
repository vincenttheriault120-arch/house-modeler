import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { MODEL } from '../chat/claude';
import { getPlanData, PLAN_KINDS, type PlanMeta } from '../plans/store';
import { parseLength, type UnitSystem } from '../units';
import type { Block, Dim, DraftLevel, ExteriorDraft, Face, Opening, OpeningKind, RoofType } from './types';

const Value = z.object({
  value: z.string().describe('Length with units, e.g. "20\' 1\\"", "10\' 5\\"", "6 1/4\\"" or "2400 mm".'),
  from_plans: z
    .boolean()
    .describe('true only if this exact number is written on a drawing (a dimension, or the difference between two written levels). false if you scaled it, assumed it or inferred it.'),
  ref: z.string().describe('Where it came from: drawing and label (e.g. "Ground floor plan, top chain: 18\'-1\\""), or why you inferred it (e.g. "Not dimensioned; scaled from the front elevation").'),
});

const FACES = ['front', 'back', 'left', 'right'] as const;

export const DraftSchema = z.object({
  summary: z.string().describe('Two to four plain sentences: what the house is made of, and the inferred values most worth checking.'),
  levels: z
    .array(z.object({ name: z.string().describe('e.g. "Ground floor", "First floor", "First floor ceiling", "Low roof", "Roof top", "Basement slab"'), elevation: Value }))
    .describe('Every level marked on the elevations, converted to height above average grade (grade = 0; may be negative).'),
  volumes: z
    .array(
      z.object({
        name: z.string().describe('Short name the homeowner recognises, e.g. "Original house", "Garage and living room", "Upper addition".'),
        x: Value.describe("Left edge, measured from the house's leftmost outside wall (seen from the front)."),
        y: Value.describe("Front face, measured back from the house's frontmost outside wall."),
        width: Value.describe('Outside width, left to right as seen from the front.'),
        depth: Value.describe('Outside depth, front to back.'),
        base: Value.describe('Bottom of this volume above grade (0 if it starts at the ground; the floor height if it sits on another volume or cantilevers).'),
        wall_height: Value.describe('From the bottom of the volume to the top of its walls, where the roof starts.'),
        roof: z.object({
          type: z.enum(['flat', 'shed', 'gable', 'hip']),
          rise: Value.describe('Top of walls to ridge (gable, hip) or to the high side (shed). For a flat roof: roof thickness or parapet height.'),
          overhang: Value.describe('How far the roof extends past the walls. 0 if flush.'),
          ridge_along: z.enum(['width', 'depth']).describe('Gable or hip: the direction the ridge runs.'),
          low_side: z.enum(FACES).describe('Shed: the side the roof slopes down toward.'),
        }),
      }),
    )
    .describe('The house as non-overlapping boxes, bottom to top. Split it wherever the outline, height or roof changes (an addition, a garage, an upper storey that cantilevers).'),
  openings: z.array(
    z.object({
      volume: z.string().describe('The name of the volume whose wall it is in, exactly as above.'),
      face: z.enum(FACES).describe('Which side of the house it is on.'),
      kind: z.enum(['window', 'door', 'patio-door', 'garage-door']),
      offset: Value.describe("From the left end of that volume's wall, as seen standing outside facing that wall, to the left edge of the opening."),
      sill: Value.describe("Bottom of the opening above the bottom of the volume (0 for a door at the volume's floor)."),
      width: Value,
      height: Value,
    }),
  ),
});
export type DraftAnswer = z.infer<typeof DraftSchema>;

const SYSTEM = `You read a homeowner's residential architectural drawings (printed PDFs, often in French) and draft the WHOLE EXTERIOR of the house at once as a simple massing model: boxes ("volumes") with roofs, plus doors, windows and garage doors on the outside walls. The homeowner will then check every number against each drawing, so completeness and honest sourcing matter more than polish.

Coordinates (all views as the homeowner stands in front of the house):
- x runs left to right along the front, from the house's leftmost outside wall (x = 0).
- y runs from the house's frontmost outside wall (y = 0) toward the back. On floor plans the front is usually at the bottom of the sheet.
- Heights are above AVERAGE GRADE = 0. Drawings often use another datum (e.g. "niveau sol moyen 100'-0\\"" means grade = 100'-0"; then "plancher R.D.C. 102'-7\\"" is 2' 7" above grade). Convert every level and height.
- Left and right elevations: "élévation gauche" shows the left side; on it the FRONT of the house is at the RIGHT of the sheet. On the right elevation the front is at the LEFT of the sheet. On the back elevation the house's left side is at the right of the sheet.

Volumes:
- Use outside wall faces. Split into separate boxes where the footprint, the height or the roof changes. A storey that overhangs (cantilevers) the one below is its own box with its base at its floor level.
- Boxes must not overlap. A two-storey part with one roof is ONE box from its bottom to the top of its upper walls.
- Exclude decks, steps, terraces, foundations below grade and small canopies.
- Roof rise: for hip and gable roofs the ridge height is often not dimensioned; scale it from the elevations and say so.

Openings: list every door, window, patio door and garage door visible on the four elevations, on the volume and face it belongs to. Use the window and door sizes written on plans (e.g. "36\\"x84\\"" = 36" wide by 84" high, "84\\"x84\\"" a patio door) when given; otherwise scale them from the elevation.

Sourcing (this is shown to the homeowner in black or red):
- from_plans = true only when the number is written on a drawing or is the plain difference of two written levels or a sum of written chain dimensions.
- Anything you scaled from the drawing, assumed or inferred is from_plans = false, with a short reason in ref. Never leave a value out: infer a sensible one instead.
- Read dimension strings exactly (12'-1 1/2" → "12' 1 1/2\\""). Write every length in the requested unit system.`;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Ask Claude to draft the exterior from all the plans at once. */
export async function generateDraft(opts: {
  apiKey: string;
  plans: PlanMeta[];
  units: UnitSystem;
  signal?: AbortSignal;
  onProgress?: (chars: number) => void;
}): Promise<ExteriorDraft> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const plan of opts.plans) {
    const data = await getPlanData(plan.id);
    if (!data) continue;
    const kind = PLAN_KINDS.find((k) => k.value === plan.kind)?.label ?? plan.kind;
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: toBase64(data) },
      title: `${plan.name} (${kind})`,
    });
  }
  if (content.length === 0) throw new Error('No plan PDFs could be read from this project.');
  content.push({
    type: 'text',
    text: `Units: ${opts.units === 'imperial' ? 'feet-inches' : 'millimetres'}.\n\nDraft the whole exterior of this house from the attached drawings.`,
  });
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: betaZodOutputFormat(DraftSchema) },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content }],
    },
    { signal: opts.signal },
  );
  let chars = 0;
  stream.on('streamEvent', (e) => {
    if (e.type === 'content_block_delta') {
      chars += e.delta.type === 'text_delta' ? e.delta.text.length : e.delta.type === 'thinking_delta' ? e.delta.thinking.length : 0;
      opts.onProgress?.(chars);
    }
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read these plans.');
  if (response.stop_reason === 'max_tokens') throw new Error('The draft was cut off. Try again.');
  if (!response.parsed_output) throw new Error("Claude's draft couldn't be read. Try again.");
  return answerToDraft(response.parsed_output as DraftAnswer, opts.units);
}

function id(prefix: string, i: number) {
  return `${prefix}${i + 1}-${Math.random().toString(36).slice(2, 6)}`;
}

function toMm(v: string, units: UnitSystem): number | null {
  const mm = parseLength(v, units) ?? parseLength(v, units === 'metric' ? 'imperial' : 'metric');
  return mm !== null && Number.isFinite(mm) ? mm : null;
}

/** Turn Claude's answer into a draft. Unreadable numbers become 0 and are flagged as inferred. */
export function answerToDraft(a: DraftAnswer, units: UnitSystem): ExteriorDraft {
  const d = (v: z.infer<typeof Value>, min = -Infinity): Dim => {
    const mm = toMm(v.value, units);
    if (mm === null) return { mm: 0, source: 'ai', ref: `Couldn't read "${v.value}". ${v.ref}` };
    return { mm: Math.max(min, mm), source: v.from_plans ? 'plan' : 'ai', ref: v.ref };
  };
  const levels: DraftLevel[] = a.levels.map((l, i) => ({ id: id('lvl', i), name: l.name, elevation: d(l.elevation) }));
  const blocks: Block[] = a.volumes.map((v, i) => ({
    id: id('vol', i),
    name: v.name,
    x: d(v.x),
    y: d(v.y),
    width: d(v.width, 1),
    depth: d(v.depth, 1),
    base: d(v.base),
    height: d(v.wall_height, 1),
    roof: {
      type: v.roof.type as RoofType,
      rise: d(v.roof.rise, 0),
      overhang: d(v.roof.overhang, 0),
      ridge: v.roof.ridge_along === 'width' ? 'x' : 'y',
      low: v.roof.low_side as Face,
    },
  }));
  const byName = new Map(a.volumes.map((v, i) => [v.name.trim().toLowerCase(), blocks[i]]));
  const openings: Opening[] = [];
  a.openings.forEach((o, i) => {
    const b = byName.get(o.volume.trim().toLowerCase());
    if (!b) return;
    openings.push({
      id: id('op', i),
      blockId: b.id,
      face: o.face as Face,
      kind: o.kind as OpeningKind,
      offset: d(o.offset, 0),
      sill: d(o.sill, 0),
      width: d(o.width, 1),
      height: d(o.height, 1),
    });
  });
  return normalize({ summary: a.summary, createdAt: Date.now(), levels, blocks, openings });
}

/** Shift everything so the house's front-left corner sits at 0, 0. */
export function normalize(draft: ExteriorDraft): ExteriorDraft {
  if (!draft.blocks.length) return draft;
  const x0 = Math.min(...draft.blocks.map((b) => b.x.mm));
  const y0 = Math.min(...draft.blocks.map((b) => b.y.mm));
  if (Math.abs(x0) < 0.5 && Math.abs(y0) < 0.5) return draft;
  return {
    ...draft,
    blocks: draft.blocks.map((b) => ({ ...b, x: { ...b.x, mm: b.x.mm - x0 }, y: { ...b.y, mm: b.y.mm - y0 } })),
  };
}
