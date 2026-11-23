import type { Block, Dim, DraftLevel, ExteriorDraft, Face, Opening, RoofPoint, ViewId } from './types';
import { FOUNDATION_NAMES, OPENING_NAMES, ROOF_NAMES, VIEWS } from './types';

/** A point in plan mm: x right, y toward the back, z up from grade. */
export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** One measurement of the draft, where it shows and where it is drawn. */
export interface Measure {
  /** Stable id: `<component id>.<field>`. */
  id: string;
  /** The component it belongs to (block, roof, opening, levels), for grouping and highlighting. */
  part: string;
  partName: string;
  label: string;
  dim: Dim;
  views: ViewId[];
  /** The dimension line, and where its extension lines start. */
  a: P3;
  b: P3;
  from?: [P3, P3];
  /** Small detail lines (opening positions) are drawn only when their part is picked. */
  detail?: boolean;
  /** Levels are drawn as a mark with a name, not a line. */
  level?: boolean;
  /** Belongs to a door or window. */
  opening?: boolean;
  /**
   * In 3D the line hugs its own part instead of standing in the drawing's chains,
   * so it reads as belonging to that part. Falls back to a/b/from.
   */
  near?: { a: P3; b: P3; from?: [P3, P3] };
}

/** How far a 3D dimension line stands off the part it measures (mm). */
const NEAR = 350;

/** A piece of the clay model as flat triangles (plan mm). */
export interface DraftMesh {
  id: string;
  part: string;
  kind: 'wall' | 'roof' | 'opening' | 'foundation';
  name: string;
  /** x, y, z for each triangle corner. */
  positions: number[];
}

const ELEVATIONS: ViewId[] = ['front', 'back', 'left', 'right'];
const TIER = 700;
const GAP = 900;
/** Room between side-by-side height dimensions, so their labels don't touch. */
const COL = 2200;

export function top(b: Block) {
  return b.base.mm + b.height.mm;
}

/** The outside box of everything drafted, in plan. */
export function bounds(draft: ExteriorDraft) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let z1 = 0;
  for (const b of draft.blocks) {
    x0 = Math.min(x0, b.x.mm);
    x1 = Math.max(x1, b.x.mm + b.width.mm);
    y0 = Math.min(y0, b.y.mm);
    y1 = Math.max(y1, b.y.mm + b.depth.mm);
    z1 = Math.max(z1, top(b) + (b.roof.type === 'flat' ? 0 : b.roof.rise.mm));
  }
  if (!Number.isFinite(x0)) return { x0: 0, x1: 10000, y0: 0, y1: 10000, z1: 6000 };
  return { x0, x1, y0, y1, z1 };
}

/** The finished-floor height a floor plan view is cut at, if the draft has that level. */
export function floorLevel(draft: ExteriorDraft, view: 'ground' | 'first'): number | null {
  const re = view === 'ground' ? /(ground|rez|r\.?d\.?c|main)/i : /(first|second|upper|[ée]tage|1st)/i;
  const floors = draft.levels.filter((l) => /(floor|plancher)/i.test(l.name) && !/(ceiling|plafond)/i.test(l.name));
  const named = floors.filter((l) => re.test(l.name)).map((l) => l.elevation.mm);
  if (named.length) return Math.min(...named);
  const sorted = floors.map((l) => l.elevation.mm).filter((z) => z >= -500).sort((a, b) => a - b);
  return (view === 'ground' ? sorted[0] : sorted.find((z) => z > (sorted[0] ?? 0) + 2000)) ?? null;
}

/** Blocks cut by a floor plan: the ones whose walls stand at that floor. */
export function blocksOnFloor(draft: ExteriorDraft, view: 'ground' | 'first'): Block[] {
  const lvl = floorLevel(draft, view);
  const z =
    lvl ??
    (view === 'ground' ? Math.min(...house(draft).map((b) => b.base.mm)) + 1000 : Math.max(...house(draft).map((b) => b.base.mm)) + 1000);
  // Cut a metre above the floor, like a floor plan.
  const cut = z + 1000;
  return draft.blocks.filter((b) => !b.foundation && b.base.mm <= cut && top(b) > cut);
}

/** Which views a block shows in: every elevation, the roof, and the floor plans that cut it. */
/** The volumes above the foundations. */
export function house(draft: ExteriorDraft): Block[] {
  return draft.blocks.filter((b) => !b.foundation);
}

export const foundationPart = (b: Block) => `${b.id}:foundation`;

function blockViews(draft: ExteriorDraft, b: Block): { plan: ViewId[] } {
  if (b.foundation) return { plan: ['basement'] };
  const plan: ViewId[] = ['top'];
  for (const v of ['ground', 'first'] as const) if (blocksOnFloor(draft, v).includes(b)) plan.push(v);
  return { plan };
}

/** Each face of a block: its line in plan, seen from outside, left end first. */
export function faceFrame(b: Block, face: Face) {
  const x0 = b.x.mm;
  const x1 = x0 + b.width.mm;
  const y0 = b.y.mm;
  const y1 = y0 + b.depth.mm;
  switch (face) {
    case 'front':
      return { start: { x: x0, y: y0 }, dir: { x: 1, y: 0 }, out: { x: 0, y: -1 }, length: b.width.mm };
    case 'back':
      return { start: { x: x1, y: y1 }, dir: { x: -1, y: 0 }, out: { x: 0, y: 1 }, length: b.width.mm };
    case 'left':
      return { start: { x: x0, y: y1 }, dir: { x: 0, y: -1 }, out: { x: -1, y: 0 }, length: b.depth.mm };
    case 'right':
      return { start: { x: x1, y: y0 }, dir: { x: 0, y: 1 }, out: { x: 1, y: 0 }, length: b.depth.mm };
  }
}

/** The ids of the parts a draft is made of. */
export const roofPart = (b: Block) => `${b.id}:roof`;
export const LEVELS_PART = 'levels';

export function openingName(draft: ExteriorDraft, o: Opening): string {
  const same = draft.openings.filter((x) => x.face === o.face && x.kind === o.kind);
  const n = same.length > 1 ? ` ${same.indexOf(o) + 1}` : '';
  const block = draft.blocks.find((b) => b.id === o.blockId);
  return `${OPENING_NAMES[o.kind]}${n}${block ? ` · ${block.name}` : ''}`;
}

/** Every measurement in the draft, with the views it can be checked on. */
export function measures(draft: ExteriorDraft): Measure[] {
  const out: Measure[] = [];
  const box = bounds(draft);
  const midX = (box.x0 + box.x1) / 2;
  const n = draft.blocks.length;
  // Dimension rows go under the lowest part, so they stay clear of the foundations.
  const zLow = Math.min(0, ...draft.blocks.map((b) => b.base.mm));

  draft.blocks.forEach((b, i) => {
    const { plan } = blockViews(draft, b);
    const x0 = b.x.mm;
    const x1 = x0 + b.width.mm;
    const y0 = b.y.mm;
    const y1 = y0 + b.depth.mm;
    const zb = b.base.mm;
    const zt = top(b);
    // Widths run in a row under the front, depths under the left side, like the chains on a drawing.
    const wz = zLow - TIER * (i + 1);
    const wy = box.y0 - GAP / 3;
    out.push({
      id: `${b.id}.width`,
      part: b.id,
      partName: b.name,
      label: 'Width',
      dim: b.width,
      views: ['front', 'back', ...plan],
      a: { x: x0, y: wy, z: wz },
      b: { x: x1, y: wy, z: wz },
      from: [
        { x: x0, y: y0, z: zb },
        { x: x1, y: y0, z: zb },
      ],
      near: { a: { x: x0, y: y0 - NEAR, z: zb }, b: { x: x1, y: y0 - NEAR, z: zb }, from: [{ x: x0, y: y0, z: zb }, { x: x1, y: y0, z: zb }] },
    });
    const leftSide = (x0 + x1) / 2 < midX;
    const sideX = leftSide ? x0 - NEAR : x1 + NEAR;
    if (Math.abs(b.x.mm - box.x0) > 1) {
      const z = zLow - TIER * (n + i + 1);
      out.push({
        id: `${b.id}.x`,
        part: b.id,
        partName: b.name,
        label: 'From left of house',
        dim: { ...b.x, mm: b.x.mm - box.x0 },
        views: ['front', 'back', ...plan],
        a: { x: box.x0, y: wy, z },
        b: { x: x0, y: wy, z },
        near: { a: { x: box.x0, y: y0 - 2 * NEAR, z: zb }, b: { x: x0, y: y0 - 2 * NEAR, z: zb }, from: [{ x: box.x0, y: y0, z: zb }, { x: x0, y: y0, z: zb }] },
      });
    }
    const dx = box.x0 - GAP / 3;
    out.push({
      id: `${b.id}.depth`,
      part: b.id,
      partName: b.name,
      label: 'Depth',
      dim: b.depth,
      views: ['left', 'right', ...plan],
      a: { x: dx, y: y0, z: wz },
      b: { x: dx, y: y1, z: wz },
      from: [
        { x: x0, y: y0, z: zb },
        { x: x0, y: y1, z: zb },
      ],
      near: { a: { x: sideX, y: y0, z: zb }, b: { x: sideX, y: y1, z: zb }, from: [{ x: leftSide ? x0 : x1, y: y0, z: zb }, { x: leftSide ? x0 : x1, y: y1, z: zb }] },
    });
    if (Math.abs(b.y.mm - box.y0) > 1) {
      const z = zLow - TIER * (n + i + 1);
      out.push({
        id: `${b.id}.y`,
        part: b.id,
        partName: b.name,
        label: 'Back from front',
        dim: { ...b.y, mm: b.y.mm - box.y0 },
        views: ['left', 'right', ...plan],
        a: { x: dx, y: box.y0, z },
        b: { x: dx, y: y0, z },
        near: { a: { x: leftSide ? x0 - 2 * NEAR : x1 + 2 * NEAR, y: box.y0, z: zb }, b: { x: leftSide ? x0 - 2 * NEAR : x1 + 2 * NEAR, y: y0, z: zb } },
      });
    }
    // Heights stand beside the block, on the outer side of the house.
    // Spread them apart in both directions so they stay apart from the front and from the side.
    const col = draft.blocks.filter((o, j) => j < i && (o.x.mm + o.x.mm + o.width.mm) / 2 < midX === leftSide).length;
    const hx = leftSide ? box.x0 - GAP - col * COL : box.x1 + GAP + col * COL;
    const hy = box.y0 - GAP - i * COL;
    out.push({
      id: `${b.id}.height`,
      part: b.id,
      partName: b.name,
      label: b.foundation ? 'Foundation wall height' : 'Wall height',
      dim: b.height,
      views: ELEVATIONS,
      a: { x: hx, y: hy, z: zb },
      b: { x: hx, y: hy, z: zt },
      from: [
        { x: leftSide ? x0 : x1, y: y0, z: zb },
        { x: leftSide ? x0 : x1, y: y0, z: zt },
      ],
      // On the front corner, just off the wall.
      near: { a: { x: sideX, y: y0 - NEAR, z: zb }, b: { x: sideX, y: y0 - NEAR, z: zt } },
    });
    if (Math.abs(zb) > 1) {
      out.push({
        id: `${b.id}.base`,
        part: b.id,
        partName: b.name,
        label: b.foundation ? 'Bottom of foundation walls (from grade)' : 'Base above grade',
        dim: b.base,
        views: ELEVATIONS,
        a: { x: hx, y: hy, z: 0 },
        b: { x: hx, y: hy, z: zb },
        near: { a: { x: sideX + (leftSide ? -NEAR : NEAR), y: y0 - NEAR, z: 0 }, b: { x: sideX + (leftSide ? -NEAR : NEAR), y: y0 - NEAR, z: zb } },
      });
    }

    if (b.foundation) {
      const fp = foundationPart(b);
      out.push({
        id: `${fp}.wall`,
        part: b.id,
        partName: b.name,
        label: 'Foundation wall thickness',
        dim: b.foundation.wall,
        views: ['basement'],
        // Across the back wall, clear of the width and depth chains.
        a: { x: (x0 + x1) / 2, y: y1 - b.foundation.wall.mm, z: zt },
        b: { x: (x0 + x1) / 2, y: y1, z: zt },
      });
      const sz = b.foundation.type === 'basement' ? zb : zt - b.foundation.slab.mm;
      const sx = leftSide ? x0 + 300 : x1 - 300;
      out.push({
        id: `${fp}.slab`,
        part: b.id,
        partName: b.name,
        label: b.foundation.type === 'basement' ? 'Basement slab thickness' : 'Slab thickness',
        dim: b.foundation.slab,
        views: ELEVATIONS,
        a: { x: sx, y: y0 - 150, z: sz },
        b: { x: sx, y: y0 - 150, z: sz + b.foundation.slab.mm },
      });
      return;
    }

    // Roof
    const r = b.roof;
    const rp = roofPart(b);
    const rname = `${ROOF_NAMES[r.type]} · ${b.name}`;
    if (r.type !== 'flat') {
      let rx = (x0 + x1) / 2;
      if (r.type === 'shed' || r.type === 'parapet') rx = r.low === 'left' ? x1 : r.low === 'right' ? x0 : rx;
      let ry = y0 - r.overhang.mm - 150;
      const high = r.type === 'folded' ? highestPoint(r.facets) : null;
      if (high) {
        // Measure at the highest corner, set just outside the nearest wall.
        rx = x0 + high.u * (x1 - x0);
        ry = high.v > 0.5 ? y1 + 150 : y0 - 150;
      }
      out.push({
        id: `${rp}.rise`,
        part: rp,
        partName: rname,
        label:
          r.type === 'shed'
            ? 'Rise to the high side'
            : r.type === 'parapet'
              ? 'Parapet top above the low roof'
              : r.type === 'folded'
                ? 'Highest roof edge above the lowest'
                : 'Rise to the ridge',
        dim: r.rise,
        views: ELEVATIONS,
        a: { x: rx, y: ry, z: zt },
        b: { x: rx, y: ry, z: zt + r.rise.mm },
      });
    }
    if (r.overhang.mm > 1 || r.type === 'hip' || r.type === 'gable') {
      const z = zt - 150;
      out.push({
        id: `${rp}.overhang`,
        part: rp,
        partName: rname,
        label: 'Overhang',
        dim: r.overhang,
        views: ['front', 'back', 'top'],
        a: { x: x0 - r.overhang.mm, y: y0 - r.overhang.mm, z },
        b: { x: x0, y: y0 - r.overhang.mm, z },
        detail: true,
      });
    }
  });

  // Openings, on the face they are in.
  for (const o of draft.openings) {
    const b = draft.blocks.find((x) => x.id === o.blockId);
    if (!b) continue;
    const f = faceFrame(b, o.face);
    const name = openingName(draft, o);
    const at = (along: number, z: number, out = 60): P3 => ({
      x: f.start.x + f.dir.x * along + f.out.x * out,
      y: f.start.y + f.dir.y * along + f.out.y * out,
      z,
    });
    const s = o.offset.mm;
    const e = s + o.width.mm;
    const zb = b.base.mm + o.sill.mm;
    const zt = zb + o.height.mm;
    const views: ViewId[] = [o.face];
    const base = { part: o.id, partName: name, views, opening: true };
    out.push({ ...base, id: `${o.id}.width`, label: 'Width', dim: o.width, a: at(s, zt + 250), b: at(e, zt + 250) });
    out.push({ ...base, id: `${o.id}.height`, label: 'Height', dim: o.height, a: at(s - 250, zb), b: at(s - 250, zt) });
    out.push({ ...base, id: `${o.id}.sill`, label: o.kind === 'window' ? 'Sill height' : 'Bottom above base', dim: o.sill, a: at(e + 250, b.base.mm), b: at(e + 250, zb), detail: true });
    out.push({ ...base, id: `${o.id}.offset`, label: 'From left end of wall', dim: o.offset, a: at(0, b.base.mm + 200), b: at(s, b.base.mm + 200), detail: true });
  }

  // Levels, on a marker left of the house.
  const leftCols = draft.blocks.filter((b) => (b.x.mm + b.x.mm + b.width.mm) / 2 < midX).length;
  const lx = box.x0 - GAP - leftCols * COL - 600;
  const ly = box.y0 - GAP - n * COL - 600;
  for (const l of draft.levels) {
    const at = { x: lx, y: ly, z: l.elevation.mm };
    out.push({ id: `${l.id}.elevation`, part: LEVELS_PART, partName: 'Levels', label: l.name, dim: l.elevation, views: ELEVATIONS, a: at, b: at, level: true });
  }
  return out;
}

export function measuresFor(draft: ExteriorDraft, view: ViewId): Measure[] {
  return measures(draft).filter((m) => m.views.includes(view));
}

/** How far along each view is. */
export function viewProgress(draft: ExteriorDraft, view: ViewId) {
  const ms = measuresFor(draft, view);
  const ok = ms.filter((m) => m.dim.ok).length;
  const ai = ms.filter((m) => m.dim.source === 'ai' && !m.dim.ok).length;
  return { total: ms.length, ok, ai, done: !!draft.done?.[view] || (ms.length > 0 && ok === ms.length) };
}

export function progress(draft: ExteriorDraft) {
  const all = measures(draft);
  return {
    total: all.length,
    ok: all.filter((m) => m.dim.ok).length,
    plan: all.filter((m) => m.dim.source === 'plan').length,
    ai: all.filter((m) => m.dim.source === 'ai').length,
    views: VIEWS.filter((v) => viewProgress(draft, v.id).done).length,
  };
}

// ---------------------------------------------------------------------------
// Changing a measurement

/** Read a measurement's Dim by id. */
export function getDim(draft: ExteriorDraft, id: string): Dim | null {
  return measures(draft).find((m) => m.id === id)?.dim ?? null;
}

/**
 * Change one measurement. `mm` is the value as shown (x and y are shown
 * from the house's front-left corner). Typing a value makes it yours.
 */
export function setDim(draft: ExteriorDraft, id: string, change: { mm?: number; ok?: boolean }): ExteriorDraft {
  const dot = id.lastIndexOf('.');
  const owner = id.slice(0, dot);
  const field = id.slice(dot + 1);
  const box = bounds(draft);
  const patch = (d: Dim, offset = 0): Dim => {
    if (change.mm === undefined) return { ...d, ok: change.ok ?? d.ok };
    const mm = change.mm + offset;
    const same = Math.abs(mm - d.mm) < 0.5;
    return same ? { ...d, ok: change.ok ?? true } : { mm, source: 'user', ref: d.ref, ok: change.ok ?? true };
  };
  if (owner.endsWith(':foundation')) {
    const bid = owner.slice(0, -':foundation'.length);
    return {
      ...draft,
      blocks: draft.blocks.map((b) =>
        b.id === bid && b.foundation && (field === 'wall' || field === 'slab') ? { ...b, foundation: { ...b.foundation, [field]: patch(b.foundation[field]) } } : b,
      ),
    };
  }
  if (owner.endsWith(':roof')) {
    const bid = owner.slice(0, -5);
    return {
      ...draft,
      blocks: draft.blocks.map((b) =>
        b.id === bid && (field === 'rise' || field === 'overhang') ? { ...b, roof: { ...b.roof, [field]: patch(b.roof[field]) } } : b,
      ),
    };
  }
  if (draft.blocks.some((b) => b.id === owner)) {
    return {
      ...draft,
      blocks: draft.blocks.map((b) => {
        if (b.id !== owner) return b;
        const k = field as 'x' | 'y' | 'width' | 'depth' | 'base' | 'height';
        const offset = k === 'x' ? box.x0 : k === 'y' ? box.y0 : 0;
        return { ...b, [k]: patch(b[k], offset) };
      }),
    };
  }
  if (draft.openings.some((o) => o.id === owner)) {
    const k = field as 'offset' | 'sill' | 'width' | 'height';
    return { ...draft, openings: draft.openings.map((o) => (o.id === owner ? { ...o, [k]: patch(o[k]) } : o)) };
  }
  if (draft.levels.some((l) => l.id === owner)) {
    return { ...draft, levels: draft.levels.map((l) => (l.id === owner ? { ...l, elevation: patch(l.elevation) } : l)) };
  }
  return draft;
}

/** Mark every measurement in a view as matching the plan. */
export function confirmView(draft: ExteriorDraft, view: ViewId): ExteriorDraft {
  let d = draft;
  for (const m of measuresFor(draft, view)) d = setDim(d, m.id, { ok: true });
  return { ...d, done: { ...d.done, [view]: true } };
}

export function removePart(draft: ExteriorDraft, part: string): ExteriorDraft {
  return {
    ...draft,
    blocks: draft.blocks.filter((b) => b.id !== part),
    openings: draft.openings.filter((o) => o.id !== part && o.blockId !== part),
  };
}

// ---------------------------------------------------------------------------
// The clay model

function tri(out: number[], ...pts: P3[]) {
  for (const p of pts) out.push(p.x, p.y, p.z);
}
function quad(out: number[], a: P3, b: P3, c: P3, d: P3) {
  tri(out, a, b, c);
  tri(out, a, c, d);
}

/** A box between two corners. */
export function boxTriangles(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const o: number[] = [];
  const p = (x: number, y: number, z: number) => ({ x, y, z });
  quad(o, p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0)); // bottom
  quad(o, p(x0, y0, z1), p(x0, y1, z1), p(x1, y1, z1), p(x1, y0, z1)); // top
  quad(o, p(x0, y0, z0), p(x0, y0, z1), p(x1, y0, z1), p(x1, y0, z0)); // front
  quad(o, p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)); // back
  quad(o, p(x0, y0, z0), p(x0, y1, z0), p(x0, y1, z1), p(x0, y0, z1)); // left
  quad(o, p(x1, y0, z0), p(x1, y0, z1), p(x1, y1, z1), p(x1, y1, z0)); // right
  return o;
}

export function roofTriangles(b: Block): number[] {
  const r = b.roof;
  const o = Math.max(0, r.overhang.mm);
  const x0 = b.x.mm - o;
  const x1 = b.x.mm + b.width.mm + o;
  const y0 = b.y.mm - o;
  const y1 = b.y.mm + b.depth.mm + o;
  const z = top(b);
  const h = Math.max(0, r.rise.mm);
  const out: number[] = [];
  const p = (x: number, y: number, zz: number) => ({ x, y, z: zz });
  if (r.type === 'flat' || h < 1) return boxTriangles(x0, y0, z, x1, y1, z + Math.max(h, 200));
  if (r.type === 'folded') return foldedTriangles(b);
  if (r.type === 'parapet') {
    // The roof inside slopes like a shed roof; the walls rise all around to its high side.
    const inner: Block = { ...b, roof: { ...r, type: 'shed', overhang: { ...r.overhang, mm: 0 } } };
    const t = 150;
    const zt = z + h;
    const bx0 = b.x.mm;
    const bx1 = bx0 + b.width.mm;
    const by0 = b.y.mm;
    const by1 = by0 + b.depth.mm;
    return [
      ...roofTriangles(inner),
      ...boxTriangles(bx0, by0, z, bx1, by0 + t, zt),
      ...boxTriangles(bx0, by1 - t, z, bx1, by1, zt),
      ...boxTriangles(bx0, by0, z, bx0 + t, by1, zt),
      ...boxTriangles(bx1 - t, by0, z, bx1, by1, zt),
    ];
  }
  if (r.type === 'shed') {
    // Corner heights: the low side stays at the wall top.
    const hz = (x: number, y: number) => {
      const t =
        r.low === 'left' ? (x - x0) / (x1 - x0) : r.low === 'right' ? (x1 - x) / (x1 - x0) : r.low === 'front' ? (y - y0) / (y1 - y0) : (y1 - y) / (y1 - y0);
      return z + h * t;
    };
    const c = [p(x0, y0, z), p(x1, y0, z), p(x1, y1, z), p(x0, y1, z)];
    const t = c.map((q) => p(q.x, q.y, hz(q.x, q.y)));
    quad(out, c[0], c[1], c[2], c[3]);
    quad(out, t[0], t[3], t[2], t[1]);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      if (Math.abs(t[i].z - z) < 1 && Math.abs(t[j].z - z) < 1) continue;
      if (Math.abs(t[i].z - z) < 1) tri(out, c[i], c[j], t[j]);
      else if (Math.abs(t[j].z - z) < 1) tri(out, c[i], c[j], t[i]);
      else quad(out, c[i], c[j], t[j], t[i]);
    }
    return out;
  }
  const alongX = r.ridge === 'x';
  // Work in (u along the ridge, v across it), then map back.
  const u0 = alongX ? x0 : y0;
  const u1 = alongX ? x1 : y1;
  const v0 = alongX ? y0 : x0;
  const v1 = alongX ? y1 : x1;
  const vm = (v0 + v1) / 2;
  const m = (u: number, v: number, zz: number) => (alongX ? p(u, v, zz) : p(v, u, zz));
  const inset = r.type === 'hip' ? Math.min((v1 - v0) / 2, (u1 - u0) / 2) : 0;
  const ra = m(u0 + inset, vm, z + h);
  const rb = m(u1 - inset, vm, z + h);
  const a0 = m(u0, v0, z);
  const a1 = m(u1, v0, z);
  const b1 = m(u1, v1, z);
  const b0 = m(u0, v1, z);
  quad(out, a0, a1, b1, b0); // underside
  quad(out, a0, a1, rb, ra); // one slope
  quad(out, b0, b1, rb, ra); // other slope
  tri(out, a0, b0, ra); // end (gable wall or hip)
  tri(out, a1, b1, rb);
  return out;
}

/** The whole draft as clay pieces: walls, roofs and openings. */
export interface CornerLengths {
  across: string;
  back: string;
  height: string;
}

/**
 * Folded roof facets from corner lengths (across from the volume's left wall, back from its front wall,
 * height above the wall top) to fractions of the volume. Facets with an unreadable corner are dropped.
 * The rise grows to the highest corner if needed. Returns null if no facet is usable.
 */
export function roofFacets(
  raw: { corners: CornerLengths[] }[],
  width: number,
  rise: number,
  depth: number,
  parse: (s: string) => number | null,
): { facets: RoofPoint[][]; rise: number } | null {
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const out: { u: number; v: number; h: number }[][] = [];
  for (const f of raw) {
    const pts = f.corners.map((c) => {
      const x = parse(c.across);
      const y = parse(c.back);
      const h = parse(c.height);
      return x === null || y === null || h === null ? null : { u: clamp(x / width), v: clamp(y / depth), h: Math.max(0, h) };
    });
    if (pts.length >= 3 && pts.every((p) => p)) out.push(pts as { u: number; v: number; h: number }[]);
  }
  if (!out.length) return null;
  const r = Math.max(rise, ...out.flat().map((p) => p.h)) || 1;
  return { facets: out.map((f) => f.map((p) => ({ u: p.u, v: p.v, t: p.h / r }))), rise: r };
}

/** A folded roof's facets back as lengths, for showing them to Claude. */
export function facetLengths(b: Block, fmt: (mm: number) => string): { corners: CornerLengths[] }[] {
  return (b.roof.facets ?? []).map((f) => ({
    corners: f.map((p) => ({ across: fmt(p.u * b.width.mm), back: fmt(p.v * b.depth.mm), height: fmt(p.t * b.roof.rise.mm) })),
  }));
}

function highestPoint(facets: RoofPoint[][] | undefined): RoofPoint | null {
  let best: RoofPoint | null = null;
  for (const f of facets ?? []) for (const p of f) if (!best || p.t > best.t) best = p;
  return best;
}

/**
 * A roof made of flat facets. Each facet is filled as a fan; walls are filled up from the
 * wall top to every facet edge that lies along an outside wall, so the walls follow the roof.
 */
function foldedTriangles(b: Block): number[] {
  const out: number[] = [];
  const facets = b.roof.facets ?? [];
  const z = top(b);
  const h = Math.max(0, b.roof.rise.mm);
  const at = (q: RoofPoint): P3 => ({ x: b.x.mm + q.u * b.width.mm, y: b.y.mm + q.v * b.depth.mm, z: z + q.t * h });
  const foot = (q: RoofPoint): P3 => ({ ...at(q), z });
  const E = 0.01;
  const onSameWall = (p: RoofPoint, q: RoofPoint) =>
    (Math.abs(p.u) < E && Math.abs(q.u) < E) ||
    (Math.abs(p.u - 1) < E && Math.abs(q.u - 1) < E) ||
    (Math.abs(p.v) < E && Math.abs(q.v) < E) ||
    (Math.abs(p.v - 1) < E && Math.abs(q.v - 1) < E);
  for (const f of facets) {
    if (f.length < 3) continue;
    const pts = f.map(at);
    for (let i = 1; i + 1 < pts.length; i++) tri(out, pts[0], pts[i], pts[i + 1]);
    for (let i = 0; i < f.length; i++) {
      const p = f[i];
      const q = f[(i + 1) % f.length];
      if (!onSameWall(p, q) || (p.t < E && q.t < E)) continue;
      if (p.t < E) tri(out, foot(p), foot(q), at(q));
      else if (q.t < E) tri(out, foot(p), foot(q), at(p));
      else quad(out, foot(p), foot(q), at(q), at(p));
    }
  }
  return out;
}

/** Foundation walls all around, with the slab at the bottom (basement) or the top (slab on grade). */
export function foundationTriangles(b: Block): number[] {
  const f = b.foundation!;
  const x0 = b.x.mm;
  const x1 = x0 + b.width.mm;
  const y0 = b.y.mm;
  const y1 = y0 + b.depth.mm;
  const z0 = b.base.mm;
  const z1 = top(b);
  const t = Math.max(50, Math.min(f.wall.mm, b.width.mm / 2, b.depth.mm / 2));
  const s = Math.max(50, Math.min(f.slab.mm, z1 - z0));
  return [
    ...boxTriangles(x0, y0, z0, x1, y0 + t, z1),
    ...boxTriangles(x0, y1 - t, z0, x1, y1, z1),
    ...boxTriangles(x0, y0 + t, z0, x0 + t, y1 - t, z1),
    ...boxTriangles(x1 - t, y0 + t, z0, x1, y1 - t, z1),
    ...(f.type === 'basement'
      ? boxTriangles(x0 + t, y0 + t, z0, x1 - t, y1 - t, z0 + s)
      : boxTriangles(x0 + t, y0 + t, z1 - s, x1 - t, y1 - t, z1)),
  ];
}

export function draftMeshes(draft: ExteriorDraft): DraftMesh[] {
  const out: DraftMesh[] = [];
  for (const b of draft.blocks) {
    if (b.foundation) {
      out.push({
        id: b.id,
        part: b.id,
        kind: 'foundation',
        name: `${FOUNDATION_NAMES[b.foundation.type]} · ${b.name}`,
        positions: foundationTriangles(b),
      });
      continue;
    }
    out.push({
      id: b.id,
      part: b.id,
      kind: 'wall',
      name: b.name,
      positions: boxTriangles(b.x.mm, b.y.mm, b.base.mm, b.x.mm + b.width.mm, b.y.mm + b.depth.mm, top(b)),
    });
    out.push({ id: roofPart(b), part: roofPart(b), kind: 'roof', name: `${ROOF_NAMES[b.roof.type]} · ${b.name}`, positions: roofTriangles(b) });
  }
  for (const o of draft.openings) {
    const b = draft.blocks.find((x) => x.id === o.blockId);
    if (!b) continue;
    const f = faceFrame(b, o.face);
    const s = o.offset.mm;
    const e = s + o.width.mm;
    const zb = b.base.mm + o.sill.mm;
    const zt = zb + o.height.mm;
    // A thin panel standing just proud of the wall.
    const ax = f.start.x + f.dir.x * s;
    const ay = f.start.y + f.dir.y * s;
    const bx = f.start.x + f.dir.x * e + f.out.x * 40;
    const by = f.start.y + f.dir.y * e + f.out.y * 40;
    out.push({
      id: o.id,
      part: o.id,
      kind: 'opening',
      name: openingName(draft, o),
      positions: boxTriangles(Math.min(ax, bx), Math.min(ay, by), zb, Math.max(ax, bx), Math.max(ay, by), zt),
    });
  }
  return out;
}

/** A plain-language list of a draft, for Claude and for the components list. */
export function levelsSorted(levels: DraftLevel[]) {
  return [...levels].sort((a, b) => a.elevation.mm - b.elevation.mm);
}

/**
 * Where an opening seen on an elevation lands: the wall nearest the viewer
 * at that spot, and its position along and up that wall.
 */
export function placeOpening(draft: ExteriorDraft, face: Face, fromLeft: number, bottom: number, width: number) {
  if (!draft.blocks.length) return null;
  const box = bounds(draft);
  const house = { x: { mm: box.x0 }, y: { mm: box.y0 }, width: { mm: box.x1 - box.x0 }, depth: { mm: box.y1 - box.y0 } } as Block;
  const hf = faceFrame(house, face);
  const along = fromLeft + width / 2;
  const cx = hf.start.x + hf.dir.x * along;
  const cy = hf.start.y + hf.dir.y * along;
  // How far each block's face is toward the viewer on this side.
  const nearness = (b: Block) => {
    const f = faceFrame(b, face);
    return f.start.x * f.out.x + f.start.y * f.out.y;
  };
  const covers = (b: Block) =>
    face === 'front' || face === 'back' ? cx >= b.x.mm - 1 && cx <= b.x.mm + b.width.mm + 1 : cy >= b.y.mm - 1 && cy <= b.y.mm + b.depth.mm + 1;
  // Walls under a shed, gable, parapet or folded roof rise above the wall top to meet it.
  const wallTop = (b: Block) => top(b) + (b.roof.type === 'flat' || b.roof.type === 'hip' ? 0 : b.roof.rise.mm);
  const zIn = (b: Block) => bottom >= b.base.mm - 150 && bottom < wallTop(b);
  // Only walls at the opening's height: an opening with no wall there is left out (and reported) rather than left floating.
  const list = draft.blocks.filter(covers).filter(zIn);
  if (!list.length) return null;
  const b = list.reduce((best, x) => (nearness(x) > nearness(best) ? x : best));
  const f = faceFrame(b, face);
  const lx = hf.start.x + hf.dir.x * fromLeft;
  const ly = hf.start.y + hf.dir.y * fromLeft;
  const offset = (lx - f.start.x) * f.dir.x + (ly - f.start.y) * f.dir.y;
  return { blockId: b.id, offset: Math.max(0, offset), sill: Math.max(0, bottom - b.base.mm) };
}

/** Things in a draft that can't be right, in words Claude can act on. */
export function draftProblems(draft: ExteriorDraft, answer?: { openings: unknown[] }): string[] {
  const out: string[] = [];
  const bs = draft.blocks;
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i];
      const b = bs[j];
      const ox = Math.min(a.x.mm + a.width.mm, b.x.mm + b.width.mm) - Math.max(a.x.mm, b.x.mm);
      const oy = Math.min(a.y.mm + a.depth.mm, b.y.mm + b.depth.mm) - Math.max(a.y.mm, b.y.mm);
      const oz = Math.min(top(a), top(b)) - Math.max(a.base.mm, b.base.mm);
      // A narrow overlap where two parts meet (an addition built against an existing wall) is what the plans show.
      if (Math.min(ox, oy) > 600 && oz > 100) out.push(`Volumes "${a.name}" and "${b.name}" overlap by more than a wall junction. Split them so they only touch.`);
    }
  for (const o of draft.openings) {
    const b = bs.find((x) => x.id === o.blockId);
    if (!b) continue;
    const len = faceFrame(b, o.face).length;
    const name = `${o.kind} on the ${o.face} elevation`;
    if (o.offset.mm + o.width.mm > len + 50) out.push(`A ${name} runs past the end of the "${b.name}" wall it sits in.`);
    if (o.sill.mm + o.height.mm > b.height.mm + (b.roof.type === 'flat' ? 0 : b.roof.rise.mm) + 50)
      out.push(`A ${name} goes above the top of the "${b.name}" wall it sits in.`);
  }
  if (answer) {
    const placed = draft.openings.length;
    if (placed < answer.openings.length) out.push(`${answer.openings.length - placed} openings don't land on any wall of the drafted volumes.`);
  }
  return out;
}

