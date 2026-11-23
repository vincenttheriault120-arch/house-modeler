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
- ONE roof outline on the roof plan over ONE continuous set of walls is ONE volume. Lines drawn INSIDE a roof outline are the roof's own ridges, hips, valleys or folds: never split a volume at them.
- Roof rise: for hip and gable roofs the ridge height is often not dimensioned; scale it from the elevations and say so.

Each drawing is a 2D view of the same 3D house. No single view is enough: build each volume and roof in 3D by combining them, and only accept a shape that looks right on every view.

How to work, in this order:
1. Footprints (x, y, width, depth) from the roof plan and the floor plans, using the written chain dimensions. A storey that sticks out past the one below (a cantilever) or is set back is its own volume.
2. Heights from the elevations and sections: convert every level to grade = 0, then base and wall_height of each volume.
3. Cross-check every volume on EVERY view where it shows: its width on the front and back elevations, its depth on the left and right elevations, its outline on the roof plan, and its wall tops on all four elevations. Where an elevation draws one continuous wall (one rectangle, one cladding), the volumes behind it must line up exactly there (same x or y edge, same top). Fix the numbers until every view's outline matches its drawing.
4. Roofs, in 3D. The roof plan (plan de toiture) gives the shape from above: its outline, the lines inside it (ridges, hips, valleys, folds), slope arrows (they point DOWNHILL), and small circles (drains, at the LOW points). The elevations give heights: the levels written beside them (e.g. "niveau haut du toit" = roof top, "niveau bas du toit" = low roof), and the roof's edge on each side (flat at one level, or sloping from one level to another). Combine them: each region between lines on the roof plan is one flat facet; the height of each of its corners comes from the elevations where that corner shows; check that every arrow points downhill on your facets and the drains sit at the bottom. Then check the result on every elevation: a wall whose top slopes on a side elevation means the roof edge on that side slopes; a roof surface drawn (hatched or stippled) above a wall on an elevation means the roof rises behind that wall.
5. Pick the roof type: hip and gable as usual; shed for one plane with the walls following it; parapet for flat-topped walls all around with one plane hidden inside; folded for anything made of several facets that is not a plain hip or gable (for example a rectangle whose edges are high on some sides and that dips along valley lines toward drains). For folded, wall_height runs to the LOWEST roof edge and rise to the HIGHEST.

Foundations (below grade), in foundations: read them from the basement / foundation plan (plan du sous-sol, fondation), the sections (coupe longitudinale / transversale) and the dashed lines below the grade line on the elevations.
- One foundation per part with its own footprint or type, e.g. a basement under the original house and a slab on grade under an addition or garage. Footprints use the outside face of the foundation walls, in the same x/y frame as the volumes; they usually match the walls above.
- basement: bottom = the basement slab level (niv. dalle du sous-sol), top = the top of the foundation wall where the house above starts.
- slab-on-grade: top = top of the slab (e.g. a garage floor a few inches above grade), bottom = bottom of the perimeter frost wall (top of its footing). If the depth is not written, scale it from the sections and say so.
- Wall and slab thickness from the plans and sections (thick grey or hatched walls); otherwise infer typical values (8" walls, 4" slab) and say so.
- The volumes above start at the top of their foundation: a volume's base and its foundation's top are the same height, and they must not overlap.

Openings: list every door, window, patio door and garage door visible on the four elevations, placed exactly as you see them on that elevation sheet: from_left = distance from the left end of the house's outline on that sheet, bottom = height above grade. Use the window and door sizes written on plans (e.g. "36\"x84\"" = 36" wide by 84" high) when given; otherwise scale them from the elevation using its written dimensions.

Sourcing (this is shown to the homeowner in black or red):
- from_plans = true only when the number is written on a drawing or is the plain difference of two written levels or a sum of written chain dimensions.
- Anything you scaled from the drawing, assumed or inferred is from_plans = false, with a short reason in ref. Never leave a value out: infer a sensible one instead.
- Read dimension strings exactly (12'-1 1/2" → "12' 1 1/2\\""). Write every length in the requested unit system.

French drawing terms: élévation avant/arrière/gauche/droite = front/back/left/right elevation; plan de toiture = roof plan; niveau = level; plancher = floor; plafond = ceiling; R.D.C. = ground floor; étage = upper floor; sous-sol = basement; sol moyen = average grade; haut/bas du toit = top/bottom of the roof; toit vert = green roof; fenêtre = window; porte = door; porte patio = patio door; porte de garage = garage door; existant = existing; nouveau/ajout = new/addition.`;

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
  // One review pass: draw the draft from every side, put it next to the drawings, and let Claude correct it.
  const review = reviewContent(draft, draftProblems(draft, answer));
  if (review.length) {
    messages.push({ role: 'assistant', content: [{ type: 'text', text: JSON.stringify(answer) }] }, { role: 'user', content: review });
    try {
      answer = await draftCall(client, messages, opts, 'check');
      draft = answerToDraft(answer, opts.units);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      // Keep the first draft if the review fails.
    }
  }
  return draft;
}

const SKETCH_VIEWS: SketchView[] = ['front', 'right', 'back', 'left', 'top'];

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
    ? 'Above is your draft drawn back in 2D, one picture per drawing. Compare each picture with its drawing side by side: the outline of every volume, where walls break or run continuous, the wall tops, the roof shape and the height of each roof edge, and every door and window.'
    : 'Review your draft against the drawings once more.';
  const issues = problems.length ? `\n\nChecking your draft against itself also found:\n- ${problems.join('\n- ')}` : '';
  content.push({
    type: 'text',
    text: `${intro}${issues}\n\nFix every difference in 3D (a fix must keep every other view right) and return the complete corrected draft, with the summary saying briefly what you changed. If everything already matches, return the same draft.`,
  });
  return content;
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
  if (response.stop_reason === 'refusal') {
    const d = (response as { stop_details?: { category?: string | null; explanation?: string | null } | null }).stop_details;
    const why = [d?.category && `category: ${d.category}`, d?.explanation].filter(Boolean).join('; ');
    throw new Error(`Claude declined to read these plans${why ? ` (${why})` : ''}. Try Redraft again.`);
  }
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
