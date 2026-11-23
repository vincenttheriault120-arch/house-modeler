import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import { MODEL } from '../chat/claude';
import { getPlanData, PLAN_KINDS, type PlanMeta } from '../plans/store';
import { parseLength, type UnitSystem } from '../units';
import { draftProblems, placeOpening, roofFacets } from './model';
export { draftProblems, placeOpening };
import type { Block, Dim, DraftLevel, ExteriorDraft, Face, Opening, OpeningKind, Roof, RoofType } from './types';
import { SKETCH_TITLES, sketchPng, type SketchView } from './sketch';
import { PLAN_READING } from './reading';

const Value = z.object({
  value: z.string().describe('Length with units, e.g. "20\' 1\\"", "10\' 5\\"", "6 1/4\\"" or "2400 mm".'),
  from_plans: z
    .boolean()
    .describe('true only if this exact number is written on a drawing (a dimension, or the difference between two written levels). false if you scaled it, assumed it or inferred it.'),
  ref: z.string().describe('Where it came from: drawing and label (e.g. "Ground floor plan, top chain: 18\'-1\\""), or why you inferred it (e.g. "Not dimensioned; scaled from the front elevation").'),
});

const FACES = ['front', 'back', 'left', 'right'] as const;

const Corner = z.object({
  across: z.string().describe("Length from this volume's LEFT outside wall (seen from the front), with units."),
  back: z.string().describe("Length back from this volume's FRONT outside wall."),
  height: z.string().describe('Height of the roof surface at this corner ABOVE THE TOP OF THE WALLS (wall_height). 0 at the lowest roof edge.'),
});

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
            .enum(['flat', 'parapet', 'shed', 'gable', 'hip', 'folded'])
            .describe(
              'folded = any roof the roof plan draws as several regions separated by lines (valleys, folds, ridges) that is not a plain gable or hip: e.g. a flat-looking rectangle that dips down along valley lines toward drains. Give its facets. parapet = flat-topped walls all around with ONE sloping roof plane hidden inside.',
            ),
          rise: Value.describe(
            'Top of walls to ridge (gable, hip), to the high side (shed), or to the top of the parapet (parapet). For a flat roof: roof thickness.',
          ),
          overhang: Value.describe('How far the roof extends past the walls. 0 if flush.'),
          ridge_along: z.enum(['width', 'depth']).describe('Gable or hip: the direction the ridge runs.'),
          low_side: z.enum(FACES).describe('Shed or parapet: the side the roof surface slopes down toward.'),
          facets: z
            .array(z.object({ corners: z.array(Corner).describe('The corners of this flat region, in order around it.') }))
            .describe(
              'folded only (empty otherwise): every region the roof plan draws between the lines inside this roof outline, each a flat facet. Together they cover the whole roof. Corners on the outside walls set the height of the wall top there, so the walls follow the roof.',
            ),
        }),
      }),
    )
    .describe('The house as non-overlapping boxes, bottom to top. Split it wherever the outline, height or roof changes (an addition, a garage, an upper storey that cantilevers).'),
  foundations: z
    .array(
      z.object({
        name: z.string().describe('e.g. "Basement under the original house", "Garage slab on grade".'),
        type: z.enum(['basement', 'slab-on-grade']),
        x: Value.describe("Left outside face of the foundation walls, from the house's leftmost outside wall (same frame as the volumes)."),
        y: Value.describe("Front outside face, back from the house's frontmost outside wall."),
        width: Value.describe('Outside width of the foundation walls, left to right.'),
        depth: Value.describe('Outside depth of the foundation walls, front to back.'),
        bottom: Value.describe(
          'Bottom of the foundation walls (top of the footings) relative to grade, usually NEGATIVE. Basement: the basement slab level. Slab on grade: the bottom of the frost wall.',
        ),
        top: Value.describe('Top of the foundation walls relative to grade, where the volume above starts. Slab on grade: the top of the slab.'),
        wall_thickness: Value.describe('Foundation wall thickness (e.g. 8" or 10").'),
        slab_thickness: Value.describe('Concrete slab thickness (e.g. 4").'),
      }),
    )
    .describe('Every foundation below the house: a basement, a crawl space (as a basement), or a slab on grade with its frost wall. Empty only if the drawings show none.'),
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
  conflicts: z
    .array(
      z.object({
        about: z.string().describe('The part and the value, e.g. "Addition depth" or "Front elevation scale".'),
        sheets_say: z.array(z.string()).describe('Each value as written, with its sheet, e.g. "Foundation plan: 39\'-11 1/2\\"".'),
        used: z.string().describe('The value used in this draft.'),
      }),
    )
    .describe('Every place two drawings give different values for the same thing, or a stated scale does not fit the written dimensions. Facts only. Empty if the drawings agree.'),
});
export type DraftAnswer = z.infer<typeof DraftSchema>;

export const InventorySchema = z.object({
  datum: z.string().describe('The level that is average grade on these drawings, as written, e.g. "niveau sol moyen 100\'-0\\"".'),
  sheets: z
    .array(
      z.object({
        title: z.string().describe('The attached document title.'),
        shows: z.enum(['foundation-plan', 'floor-plan', 'roof-plan', 'elevation', 'section', 'detail', 'other']),
        which: z
          .string()
          .describe('Which floor, which side (and where the front of the house is on the sheet), or where the cut runs and which way it looks.'),
        scale: z.string().describe('The scale the drawing is really at. If the title block and the label under the drawing differ, give both.'),
        levels: z.array(z.string()).describe('Every level written on the sheet, as written.'),
      }),
    )
    .describe('Every attached sheet.'),
  parts: z
    .array(
      z.object({
        name: z.string().describe('Short name the homeowner recognises.'),
        kind: z.enum(['volume', 'foundation', 'porch-or-canopy', 'deck-or-terrace', 'other']),
        sheets: z.array(z.string()).describe('Titles of every sheet that shows it, drawn or dashed.'),
        shape: z.string().describe('One short fact about its shape, e.g. "set back 6\' behind a green roof, overhangs the back wall". Empty if plain.'),
      }),
    )
    .describe('Every part of the house, from the roof down to the bottom of the foundations, everything below grade included.'),
});
export type Inventory = z.infer<typeof InventorySchema>;

export type DraftStage = 'inventory' | 'draft' | 'check';

const SYSTEM = `You read a homeowner's residential architectural drawings (printed PDFs, often in French) and draft the WHOLE EXTERIOR of the house as a simple massing model: boxes ("volumes") with roofs, the foundations below them, and the doors, windows and garage doors on the outside walls. The homeowner then checks every number against each drawing, so completeness and honest sourcing matter more than polish.

You work in steps, each asked for in turn: first an inventory of the sheets and of every part of the house, then the draft, then a review of the draft drawn back in 2D.

Coordinates (all views as the homeowner stands in front of the house):
- x runs left to right along the front, from the house's leftmost outside wall (x = 0).
- y runs from the house's frontmost outside wall (y = 0) toward the back. On floor plans the front is usually at the bottom of the sheet.
- Heights are above AVERAGE GRADE = 0. Drawings often use another datum (e.g. "niveau sol moyen 100'-0\\"" means grade = 100'-0"; then "plancher R.D.C. 102'-7\\"" is 2' 7" above grade). Convert every level and height.
- Left and right elevations: "élévation gauche" shows the left side; on it the FRONT of the house is at the RIGHT of the sheet. On the right elevation the front is at the LEFT of the sheet. On the back elevation the house's left side is at the right of the sheet.

${PLAN_READING}

The parts list runs from the roof down to the bottom of the foundations, with everything below grade (basements, crawl spaces, slabs on grade and their frost walls) on it from the start, the same as walls and roofs. Footings are not drafted for now: a foundation ends at the top of its footing.

Volumes:
- Outside wall faces. Split into separate boxes where the footprint, the height or the roof changes. A storey that overhangs (cantilevers) or is set back from the one below is its own box, with its base at its floor level.
- Boxes must not overlap. A two-storey part under one roof is ONE box from its bottom to the top of its upper walls. ONE roof outline over ONE continuous set of walls is ONE volume. Rooms, interior walls and changes of use (garage, living room, bedroom) are not reasons to split.
- Decks, steps, terraces and small canopies are not volumes. Foundations go in the foundations list, not in volumes.
- Roof types: hip and gable as usual; shed = one plane, the walls following it; parapet = flat-topped walls all around with one plane hidden inside; folded = any roof made of several flat facets that is not a plain hip or gable (give each facet's corners). For shed, parapet and folded roofs, wall_height runs to the LOWEST roof edge and rise to the HIGHEST point.

Foundations:
- One per part with its own footprint or type, in the same x/y frame as the volumes; footprints usually match the walls above.
- basement: bottom = the basement slab level; top = the top of the foundation wall, where the volume above starts.
- slab-on-grade: top = the top of the slab; bottom = the bottom of the perimeter frost wall.
- Wall and slab thickness from the plans and sections; otherwise typical values (8" walls, 4" slab), marked as inferred.
- A volume's base and the top of its foundation are the same height, and they must not overlap.

Openings: every door, window, patio door and garage door on the four elevations, placed as seen on that elevation sheet: from_left = from the left end of the house's outline on that sheet, bottom = above grade. Use sizes written on the plans (e.g. "36\\"x84\\"" = 36" wide by 84" high) when given.

Sourcing (shown to the homeowner in black or red):
- from_plans = true only when the number is written on a drawing, or is a plain sum or difference of written numbers.
- Anything worked out another way, scaled or assumed is from_plans = false, with a short reason in ref. Never leave a value out: infer a sensible one instead.
- Read dimension strings exactly (12'-1 1/2" → "12' 1 1/2\\""). Write every length in the requested unit system.

French drawing terms: élévation avant/arrière/gauche/droite = front/back/left/right elevation; plan de toiture = roof plan; coupe = section; niveau = level; plancher = floor; plafond = ceiling; R.D.C. = ground floor; étage = upper floor; sous-sol = basement; dalle = slab; fondation = foundation; semelle = footing; sol moyen = average grade; haut/bas du toit = top/bottom of the roof; toit vert = green roof; fenêtre = window; porte = door; porte patio = patio door; porte de garage = garage door; existant = existing; nouveau/ajout = new/addition; échelle = scale.`;

const INVENTORY_ASK = `Step 1, inventory. List every attached sheet: what it shows, which floor or side or where it cuts, its real scale, and the levels written on it. Then list every part of the house, from the roof down to the foundations, with the sheets that show each one. No numbers beyond what is written yet.`;

const DRAFT_ASK = `Step 2, draft. Using your inventory, draft the whole exterior: for each part on your list, read its footprint, heights and shape from the sheets that show it, check it against every one of those sheets, and only then write its numbers. List every place the drawings disagree in conflicts.`;

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
  onProgress?: (chars: number, stage: DraftStage) => void;
}): Promise<ExteriorDraft> {
  const content = await planDocumentBlocks(opts.plans);
  if (content.length === 0) throw new Error('No plan PDFs could be read from this project.');
  content.push({ type: 'text', text: `Units: ${opts.units === 'imperial' ? 'feet-inches' : 'millimetres'}.\n\n${INVENTORY_ASK}` });
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content }];
  // Step 1: what each sheet is and every part of the house, before any numbers.
  const inventory = await structuredCall(client, messages, InventorySchema, opts, 'inventory');
  messages.push({ role: 'assistant', content: [{ type: 'text', text: JSON.stringify(inventory) }] }, { role: 'user', content: DRAFT_ASK });
  // Step 2: the draft, part by part, checked across the sheets.
  let answer = await structuredCall(client, messages, DraftSchema, opts, 'draft');
  let draft = answerToDraft(answer, opts.units);
  // One review pass: draw the draft from every side, put it next to the drawings, and let Claude correct it.
  const review = reviewContent(draft, draftProblems(draft, answer));
  if (review.length) {
    messages.push({ role: 'assistant', content: [{ type: 'text', text: JSON.stringify(answer) }] }, { role: 'user', content: review });
    try {
      answer = await structuredCall(client, messages, DraftSchema, opts, 'check');
      draft = answerToDraft(answer, opts.units);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      // Keep the first draft if the review fails.
    }
  }
  return draft;
}

const SKETCH_VIEWS: SketchView[] = ['front', 'right', 'back', 'left', 'top', 'section'];

/** The review request: the draft drawn from each side, plus any problems found in it. Empty if there is nothing to show. */
export function reviewContent(draft: ExteriorDraft, problems: string[]): Anthropic.Beta.BetaContentBlockParam[] {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const view of SKETCH_VIEWS) {
    const png = sketchPng(draft, view);
    if (!png) continue;
    content.push({ type: 'text', text: SKETCH_TITLES[view] + ':' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } });
  }
  if (!content.length && !problems.length) return [];
  const intro = content.length
    ? 'Above is your draft drawn back in 2D, one picture per drawing. Compare each picture with its drawing side by side: the outline of every volume, where walls break or run continuous, the wall tops, the roof shape and the height of each roof edge, every door and window, and in the section, the foundations and floor levels against grade.'
    : 'Review your draft against the drawings once more.';
  const issues = problems.length ? `\n\nChecking your draft against itself also found:\n- ${problems.join('\n- ')}` : '';
  content.push({
    type: 'text',
    text: `${intro}${issues}\n\nFix every difference in 3D (a fix must keep every other view right) and return the complete corrected draft, with the summary saying briefly what you changed. If everything already matches, return the same draft.`,
  });
  return content;
}

async function structuredCall<T extends z.ZodType>(
  client: Anthropic,
  messages: Anthropic.Beta.BetaMessageParam[],
  schema: T,
  opts: { signal?: AbortSignal; onProgress?: (chars: number, stage: DraftStage) => void },
  stage: DraftStage,
): Promise<z.infer<T>> {
  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: betaZodOutputFormat(schema) },
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
  if (response.stop_reason === 'refusal') {
    const d = (response as { stop_details?: { category?: string | null; explanation?: string | null } | null }).stop_details;
    const why = [d?.category && `category: ${d.category}`, d?.explanation].filter(Boolean).join('; ');
    throw new Error(`Claude declined to read these plans${why ? ` (${why})` : ''}. Try Redraft again.`);
  }
  if (response.stop_reason === 'max_tokens') throw new Error('The draft was cut off. Try again.');
  if (!response.parsed_output) throw new Error("Claude's draft couldn't be read. Try again.");
  return response.parsed_output as z.infer<T>;
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
  const blocks: Block[] = a.volumes.map((v, i) => {
    const width = d(v.width, 1);
    const depth = d(v.depth, 1);
    const rise = d(v.roof.rise, 0);
    const roof: Roof = {
      type: v.roof.type as RoofType,
      rise,
      overhang: d(v.roof.overhang, 0),
      ridge: v.roof.ridge_along === 'width' ? 'x' : 'y',
      low: v.roof.low_side as Face,
    };
    if (roof.type === 'folded') {
      const f = roofFacets(v.roof.facets ?? [], width.mm, rise.mm, depth.mm, (x) => toMm(x, units));
      if (f) {
        roof.facets = f.facets;
        roof.rise = { ...rise, mm: f.rise };
      } else roof.type = 'flat';
    }
    return { id: id('vol', i), name: v.name, x: d(v.x), y: d(v.y), width, depth, base: d(v.base), height: d(v.wall_height, 1), roof };
  });
  (a.foundations ?? []).forEach((f, i) => {
    const bottom = d(f.bottom);
    const topD = d(f.top);
    const both = bottom.source === 'plan' && topD.source === 'plan';
    blocks.push({
      id: id('fnd', i),
      name: f.name,
      x: d(f.x),
      y: d(f.y),
      width: d(f.width, 1),
      depth: d(f.depth, 1),
      base: bottom,
      height: { mm: Math.max(1, topD.mm - bottom.mm), source: both ? 'plan' : 'ai', ref: `From ${bottom.ref ?? 'bottom'} to ${topD.ref ?? 'top'}` },
      roof: { type: 'flat', rise: { mm: 0, source: 'ai' }, overhang: { mm: 0, source: 'ai' }, ridge: 'x', low: 'left' },
      foundation: { type: f.type === 'basement' ? 'basement' : 'slab', wall: d(f.wall_thickness, 1), slab: d(f.slab_thickness, 1) },
    });
  });
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
  const conflicts = (a.conflicts ?? []).map((c) => ({ about: c.about, values: c.sheets_say, used: c.used }));
  return { ...base, openings, ...(conflicts.length ? { conflicts } : {}) };
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
