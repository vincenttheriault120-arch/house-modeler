import { useEffect, useMemo, useState } from 'react';
import type * as THREE from 'three';
import { footprintBounds, sheetPlacement, viewForKind } from '../model/calibration';
import type { Project } from '../model/types';
import type { Backdrop } from '../Viewport';
import { loadPlanTexture } from './planTexture';
import { PLAN_KINDS, type PlanMeta } from './store';

/** Plans that can be laid over the model: scale set, and a drawing seen straight on. */
export function comparablePlans(plans: PlanMeta[]) {
  return plans.filter((p) => p.calibration && viewForKind(p.kind));
}

export function planLabel(p: PlanMeta) {
  return PLAN_KINDS.find((k) => k.value === p.kind)?.label ?? p.name;
}

/** The plan being compared against the model, loaded as a texture and placed. */
export function useCompare(project: Project, plans: PlanMeta[]) {
  const [planId, setPlanId] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.85);
  const [sheet, setSheet] = useState<{ key: string; texture: THREE.Texture; width: number; height: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = plans.find((p) => p.id === planId && p.calibration && viewForKind(p.kind)) ?? null;
  const key = plan ? `${plan.id}:${plan.calibration!.page}` : null;

  useEffect(() => {
    if (!plan || !key) return;
    let cancelled = false;
    let loaded: THREE.Texture | null = null;
    setError(null);
    loadPlanTexture(plan.id, plan.calibration!.page)
      .then((s) => {
        loaded = s.texture;
        if (cancelled) s.texture.dispose();
        else setSheet({ key, ...s });
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't read that plan."));
    return () => {
      cancelled = true;
      loaded?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const backdrop = useMemo((): Backdrop | undefined => {
    if (!plan || !sheet || sheet.key !== key) return undefined;
    const view = viewForKind(plan.kind)!;
    const bounds = footprintBounds(project);
    const place = sheetPlacement(view, plan.calibration!, bounds, sheet.width, sheet.height);
    const top = project.levels.reduce((m, l) => Math.max(m, l.elevation), 0);
    const low = project.levels.reduce((m, l) => Math.min(m, l.elevation), 0);
    const focus = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, z: (top + low) / 2 };
    const plan2d = view === 'top' ? [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY] : [];
    const side = view === 'front' || view === 'back' ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY;
    const span = view === 'top' ? Math.max(...plan2d) : Math.max(side, top - low + 3000);
    if (view === 'top') focus.z = 0;
    return { texture: sheet.texture, view, ...place, opacity, focus, span };
  }, [plan, sheet, key, project, opacity]);

  return {
    planId: plan ? plan.id : null,
    setPlanId,
    opacity,
    setOpacity,
    loading: !!plan && !backdrop && !error,
    error,
    backdrop,
  };
}
