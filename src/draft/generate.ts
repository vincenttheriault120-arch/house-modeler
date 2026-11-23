import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { MODEL } from '../chat/claude';
import { getPlanData, PLAN_KINDS, type PlanMeta } from '../plans/store';
import { parseLength, type UnitSystem } from '../units';
import { draftProblems, placeOpening } from './model';
export { draftProblems, placeOpening };
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
        wall_height: Value.describe(
          'From the bottom of the volume to the top of its walls where the roof starts (for shed and parapet roofs: up to the LOW edge of the roof surface).',
        ),
        roof: z.object({
          type: z
            .enum(['flat', 'parapet', 'shed', 'gable', 'hip'])
            .describe(
              'parapet = the outline on the elevations is a flat-topped box, but the roof surface inside it slopes down (a depression behind parapet walls). Use it instead of shed when the elevations show a flat top line with a sloping roof line drawn inside it.',
            ),
          rise: Value.describe(
            'Top of walls to ridge (gable, hip), to the high side (shed), or to the top of the parapet (parapet). For a flat roof: roof thickness.',
          ),
          overhang: Value.describe('How far the roof extends past the walls. 0 if flush.'),
          ridge_along: z.enum(['width', 'depth']).describe('Gable or hip: the direction the ridge runs.'),
          low_side: z.enum(FACES).describe('Shed or parapet: the side the roof surface slopes down toward.'),
        }),
      }),
    )
    .describe('The house as non-overlapping boxes, bottom to top. Split it wherever the outline, height or roof changes (an addition, a garage, an upper storey that cantilevers).'),
  openings: z
    .array(
      z.object({
        elevation: z.enum(FACES).describe('The elevation drawing it is seen on (front, back, left or right).'),
        kind: z.enum(['window', 'door', 'patio-door', 'garage-door']),
        from_left: Value.describe(
          "Measured ON THAT ELEVATION SHEET, as drawn: from the left end of the whole house's outline on that sheet to the left edge of the opening.",
        ),
        bottom: Value.describe('Bottom of the opening above average GRADE (not above a floor).'),
        width: Value,
        height: Value,
      }),
    )
    .describe('Every door, window, patio door and garage door visible on the four elevations, placed as drawn on each elevation.'),
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

How to work, in this order:
1. Footprints (x, y, width, depth) from the roof plan and the floor plans, using the written chain dimensions. A storey that sticks out past the one below (a cantilever) or is set back is its own volume.
2. Heights from the elevations and sections: convert every level to grade = 0, then base and wall_height of each volume.
3. Cross-check every volume on EVERY elevation where it shows. Where an elevation draws one continuous wall (one rectangle, one cladding), the volumes behind it must line up exactly there (same x or y edge, same top). Fix the numbers until each elevation's outline matches the drawing.
4. Roofs: read their shape on the elevations AND the roof plan (arrows show slope direction). A flat-topped outline with a sloping line inside is a parapet roof, not a shed roof.

Openings: list every door, window, patio door and garage door visible on the four elevations, placed exactly as you see them on that elevation sheet: from_left = distance from the left end of the house's outline on that sheet, bottom = height above grade. Use the window and door sizes written on plans (e.g. "36\"x84\"" = 36" wide by 84" high) when given; otherwise scale them from the elevation using its written dimensions.

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
/** The plan PDFs as document blocks, the last one marked for caching so follow-up calls reuse them. */
export async function planDocumentBlocks(plans: PlanMeta[]): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
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
  const last = content.at(-1);
  if (last && last.type === 'document') last.cache_control = { type: 'ephemeral' };
  return content;
}

/** Ask Claude to draft the exterior from all the plans at once, then check its own draft once. */
export async function generateDraft(opts: {
  apiKey: string;
  plans: PlanMeta[];
  units: UnitSystem;
  signal?: AbortSignal;
  onProgress?: (chars: number, stage: 'draft' | 'check') => void;
}): Promise<ExteriorDraft> {
  const content = await planDocumentBlocks(opts.plans);
  if (content.length === 0) throw new Error('No plan PDFs could be read from this project.');
  content.push({
    type: 'text',
    text: `Units: ${opts.units === 'imperial' ? 'feet-inches' : 'millimetres'}.\n\nDraft the whole exterior of this house from the attached drawings.`,
  });
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content }];
  let answer = await draftCall(client, messages, opts, 'draft');
  let draft = answerToDraft(answer, opts.units);
  const problems = draftProblems(draft, answer);
  if (problems.length) {
    // One correction pass: show Claude what doesn't add up, with the plans still attached.
    messages.push(
      { role: 'assistant', content: [{ type: 'text', text: JSON.stringify(answer) }] },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Checking your draft against itself found these problems:\n- ${problems.join('\n- ')}\n\nLook at the drawings again, fix these and anything else you now see is off (especially where an elevation shows one continuous wall), and return the complete corrected draft.`,
          },
        ],
      },
    );
    try {
      answer = await draftCall(client, messages, opts, 'check');
      draft = answerToDraft(answer, opts.units);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      // Keep the first draft if the correction fails.
    }
  }
  return draft;
}

async function draftCall(
  client: Anthropic,
  messages: Anthropic.Beta.BetaMessageParam[],
  opts: { signal?: AbortSignal; onProgress?: (chars: number, stage: 'draft' | 'check') => void },
  stage: 'draft' | 'check',
): Promise<DraftAnswer> {
  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: betaZodOutputFormat(DraftSchema) },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages,
    },
    { signal: opts.signal },
  );
  let chars = 0;
  stream.on('streamEvent', (e) => {
    if (e.type === 'content_block_delta') {
      chars += e.delta.type === 'text_delta' ? e.delta.text.length : e.delta.type === 'thinking_delta' ? e.delta.thinking.length : 0;
      opts.onProgress?.(chars, stage);
    }
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read these plans.');
  if (response.stop_reason === 'max_tokens') throw new Error('The draft was cut off. Try again.');
  if (!response.parsed_output) throw new Error("Claude's draft couldn't be read. Try again.");
  return response.parsed_output as DraftAnswer;
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
  const base = normalize({ summary: a.summary, createdAt: Date.now(), levels, blocks, openings: [] });
  const openings: Opening[] = [];
  a.openings.forEach((o, i) => {
    const width = d(o.width, 1);
    const fromLeft = d(o.from_left, 0);
    const bottom = d(o.bottom);
    const at = placeOpening(base, o.elevation as Face, fromLeft.mm, bottom.mm, width.mm);
    if (!at) return;
    openings.push({
      id: id('op', i),
      blockId: at.blockId,
      face: o.elevation as Face,
      kind: o.kind as OpeningKind,
      offset: { ...fromLeft, mm: at.offset },
      sill: { ...bottom, mm: at.sill },
      width,
      height: d(o.height, 1),
    });
  });
  return { ...base, openings };
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
