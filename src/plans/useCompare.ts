import { useEffect, useMemo, useState } from 'react';
import type * as THREE from 'three';
import { addShift, alignTargets, footprintBounds, inSheet, sheetPlacement, snapToTarget, viewForKind, type Calibration } from '../model/calibration';
import type { Point3 } from '../model/dimensions';
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

export type CompareMode = 'view' | 'move' | 'align';

/** The plan being compared against the model, loaded as a texture and placed; it can be moved into line. */
export function useCompare(project: Project, plans: PlanMeta[], onSave: (meta: PlanMeta) => void) {
  const [mode, setModeState] = useState<CompareMode>('view');
  /** Align: the point picked on the plan, waiting for its match on the model. */
  const [alignFrom, setAlignFrom] = useState<Point3 | null>(null);
  /** Move: how far the sheet is being dragged right now (saved on release). */
  const [dragging, setDragging] = useState<Point3 | null>(null);
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

  const view = plan ? viewForKind(plan.kind)! : null;
  const calibration: Calibration | null = plan ? (dragging ? addShift(plan.calibration!, dragging) : plan.calibration!) : null;

  function setMode(m: CompareMode) {
    setModeState(m);
    setAlignFrom(null);
    setDragging(null);
  }

  /** Save a move of the sheet (mm in the model, kept in the sheet's plane). */
  function shiftBy(d: Point3) {
    if (!plan || !view) return;
    onSave({ ...plan, calibration: addShift(plan.calibration!, inSheet(view, d)) });
  }

  /** Align: first click on the plan, second on the model (snapped to the nearest corner or level). */
  function pick(p: Point3) {
    if (!view) return;
    if (!alignFrom) {
      setAlignFrom(p);
      return;
    }
    const reach = 600;
    const to = snapToTarget(view, p, alignTargets(project, view), reach) ?? p;
    shiftBy({ x: to.x - alignFrom.x, y: to.y - alignFrom.y, z: to.z - alignFrom.z });
    setAlignFrom(null);
    setModeState('view');
  }

  function drag(d: Point3, done: boolean) {
    if (!view) return;
    if (done) {
      shiftBy(d);
      setDragging(null);
    } else setDragging(inSheet(view, d));
  }

  function resetPosition() {
    if (!plan) return;
    const { shift: _gone, ...rest } = plan.calibration!;
    onSave({ ...plan, calibration: rest });
  }

  const backdrop = useMemo((): Backdrop | undefined => {
    if (!plan || !sheet || sheet.key !== key || !view || !calibration) return undefined;
    const bounds = footprintBounds(project);
    const place = sheetPlacement(view, calibration, bounds, sheet.width, sheet.height);
    const top = project.levels.reduce((m, l) => Math.max(m, l.elevation), 0);
    const low = project.levels.reduce((m, l) => Math.min(m, l.elevation), 0);
    const focus = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, z: (top + low) / 2 };
    const plan2d = view === 'top' ? [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY] : [];
    const side = view === 'front' || view === 'back' ? bounds.maxX - bounds.minX : bounds.maxY - bounds.minY;
    const span = view === 'top' ? Math.max(...plan2d) : Math.max(side, top - low + 3000);
    if (view === 'top') focus.z = 0;
    return { texture: sheet.texture, view, ...place, opacity, focus, span, mode, marker: alignFrom };
  }, [plan, sheet, key, project, opacity, view, calibration, mode, alignFrom]);

  return {
    planId: plan ? plan.id : null,
    setPlanId,
    opacity,
    setOpacity,
    loading: !!plan && !backdrop && !error,
    error,
    backdrop,
    view,
    mode,
    setMode,
    alignFrom,
    pick,
    drag,
    shiftBy,
    resetPosition,
    moved: !!plan?.calibration?.shift,
  };
}
