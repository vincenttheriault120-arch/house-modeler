import { bounds, draftMeshes, type P3 } from './model';
import type { ExteriorDraft } from './types';

export type SketchView = 'front' | 'back' | 'left' | 'right' | 'top' | 'section';

export const SKETCH_TITLES: Record<SketchView, string> = {
  front: 'Your draft seen from the front (oriented like the front elevation)',
  back: 'Your draft seen from the back (oriented like the back elevation: the house\'s left side is on the right)',
  left: 'Your draft seen from the left side (oriented like the left elevation: the front of the house is on the right)',
  right: 'Your draft seen from the right side (oriented like the right elevation: the front of the house is on the left)',
  top: 'Your draft seen from above (oriented like the roof plan: the front of the house is at the bottom)',
  section:
    'Your draft cut across its width halfway back and seen from the front, like a section: the black line is grade, and everything below it is your foundations (basements, slabs on grade and their frost walls)',
};

/** Where the section sketch cuts: halfway back through the whole draft. */
export function sectionCut(draft: ExteriorDraft): number {
  const ys = draft.blocks.flatMap((b) => [b.y.mm, b.y.mm + b.depth.mm]);
  return ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
}

/** Keeps the part of a polygon at or behind y = cut. */
function clipBehind(pts: P3[], cut: number): P3[] {
  const out: P3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const ina = a.y >= cut;
    const inb = b.y >= cut;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (cut - a.y) / (b.y - a.y);
      out.push({ x: a.x + t * (b.x - a.x), y: cut, z: a.z + t * (b.z - a.z) });
    }
  }
  return out;
}

/** Sheet coordinates for a view: h to the right, w up, d away from the viewer. */
function project(view: SketchView, p: P3): { h: number; w: number; d: number } {
  switch (view) {
    case 'front':
    case 'section':
      return { h: p.x, w: p.z, d: p.y };
    case 'back':
      return { h: -p.x, w: p.z, d: -p.y };
    case 'left':
      return { h: -p.y, w: p.z, d: p.x };
    case 'right':
      return { h: p.y, w: p.z, d: -p.x };
    case 'top':
      return { h: p.x, w: p.y, d: -p.z };
  }
}

interface Tri {
  pts: { h: number; w: number }[];
  d: number;
  shade: number;
  kind: string;
}

/** The draft's triangles for one view, farthest first, each shaded by how it faces the light. */
export function sketchTriangles(draft: ExteriorDraft, view: SketchView): Tri[] {
  const out: Tri[] = [];
  const light = { x: -0.4, y: -0.6, z: 0.7 };
  const ll = Math.hypot(light.x, light.y, light.z);
  // Doors and windows only on the side being looked at, so ones on the far walls don't show through.
  const facing = new Set(draft.openings.filter((o) => o.face === view).map((o) => o.id));
  const cut = view === 'section' ? sectionCut(draft) : null;
  for (const m of draftMeshes(draft)) {
    if (m.kind === 'opening' && !facing.has(m.id)) continue;
    const a = m.positions;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const p = [0, 3, 6].map((k) => ({ x: a[i + k], y: a[i + k + 1], z: a[i + k + 2] }));
      const ux = p[1].x - p[0].x, uy = p[1].y - p[0].y, uz = p[1].z - p[0].z;
      const vx = p[2].x - p[0].x, vy = p[2].y - p[0].y, vz = p[2].z - p[0].z;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-6) continue;
      const shade = Math.abs((nx * light.x + ny * light.y + nz * light.z) / (nl * ll));
      const kept = cut === null ? p : clipBehind(p, cut);
      if (kept.length < 3) continue;
      const q = kept.map((pt) => project(view, pt));
      out.push({ pts: q, d: q.reduce((sum, v) => sum + v.d, 0) / q.length, shade, kind: m.kind });
    }
  }
  // Painter's order: far first. Openings sit just proud of walls, so draw them after walls at equal depth.
  return out.sort((x, y) => y.d - x.d || (x.kind === 'opening' ? 1 : 0) - (y.kind === 'opening' ? 1 : 0));
}

/** Draws the draft for one view as a PNG (base64, no prefix). Browser only. */
export function sketchPng(draft: ExteriorDraft, view: SketchView, size = 900): string | null {
  if (typeof document === 'undefined' || !draft.blocks.length) return null;
  const tris = sketchTriangles(draft, view);
  if (!tris.length) return null;
  const hs = tris.flatMap((t) => t.pts.map((p) => p.h));
  const ws = tris.flatMap((t) => t.pts.map((p) => p.w));
  const h0 = Math.min(...hs), h1 = Math.max(...hs);
  const w0 = Math.min(view === 'top' ? Infinity : 0, ...ws), w1 = Math.max(...ws);
  const pad = 40;
  const scale = (size - 2 * pad) / Math.max(h1 - h0, w1 - w0, 1);
  const width = Math.ceil((h1 - h0) * scale + 2 * pad);
  const height = Math.ceil((w1 - w0) * scale + 2 * pad);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const X = (h: number) => pad + (h - h0) * scale;
  const Y = (w: number) => height - pad - (w - w0) * scale;
  ctx.lineJoin = 'round';
  for (const t of tris) {
    const g = t.kind === 'opening' ? 40 : t.kind === 'foundation' ? Math.round(110 + 60 * t.shade) : Math.round(150 + 90 * t.shade);
    const c = t.kind === 'roof' ? `rgb(${g - 10},${g - 10},${g})` : `rgb(${g},${g},${g})`;
    ctx.fillStyle = c;
    ctx.strokeStyle = c;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    t.pts.forEach((p, i) => (i ? ctx.lineTo(X(p.h), Y(p.w)) : ctx.moveTo(X(p.h), Y(p.w))));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  if (view !== 'top') {
    // Grade line, and the overall size for scale.
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad / 2, Y(0));
    ctx.lineTo(width - pad / 2, Y(0));
    ctx.stroke();
  }
  const b = bounds(draft);
  ctx.fillStyle = '#000';
  ctx.font = '14px sans-serif';
  ctx.fillText(
    `${view === 'section' ? 'section' : `${view} view`} · house ${Math.round(b.x1 - b.x0)} mm wide, ${Math.round(b.y1 - b.y0)} mm deep, ${Math.round(b.z1)} mm high above grade`,
    8,
    18,
  );
  return canvas.toDataURL('image/png').split(',')[1] ?? null;
}
