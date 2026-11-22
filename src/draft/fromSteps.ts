import { outlineWithSources } from '../model/geometry';
import type { Project } from '../model/types';
import { dim, type Block, type ExteriorDraft } from './types';

const FT = 304.8;

/**
 * A starting draft for a project begun from scratch: one box per foundation
 * footprint, the storeys asked for in the wizard, and a simple gable roof.
 * Every value is yours to change.
 */
export function draftFromSteps(project: Project): ExteriorDraft {
  const storeys = project.storeys ?? 2;
  const blocks: Block[] = [];
  for (const s of project.steps) {
    if (s.kind !== 'foundation') continue;
    const { poly } = outlineWithSources(s.params.runs, s.params.origin);
    if (poly.length < 3) continue;
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(...xs) - x0;
    const d = Math.max(...ys) - y0;
    const slab = s.params.type === 'slab-on-grade';
    blocks.push({
      id: `vol-${s.id}`,
      name: s.label,
      x: dim(x0),
      y: dim(y0),
      width: dim(w),
      depth: dim(d),
      base: dim(Math.max(0, s.params.topElevation)),
      height: dim((slab ? 1 : storeys) * 9 * FT),
      roof: { type: 'gable', rise: dim(Math.min(w, d) / 2 / 2), overhang: dim(12 * 25.4), ridge: w >= d ? 'x' : 'y', low: 'left' },
    });
  }
  if (blocks.length === 0) {
    blocks.push({
      id: 'vol-house',
      name: 'House',
      x: dim(0),
      y: dim(0),
      width: dim(40 * FT),
      depth: dim(30 * FT),
      base: dim(0),
      height: dim(storeys * 9 * FT),
      roof: { type: 'gable', rise: dim(7 * FT), overhang: dim(FT), ridge: 'x', low: 'left' },
    });
  }
  return {
    summary: 'Started from your footprint. Change any measurement, or add your plans and let Claude draft it.',
    createdAt: Date.now(),
    levels: [{ id: 'lvl-grade-floor', name: 'Ground floor', elevation: dim(blocks[0].base.mm) }],
    blocks,
    openings: [],
  };
}
