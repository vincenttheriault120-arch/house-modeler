import { useCallback, useEffect, useState } from 'react';
import { addPlan, deletePlan, listPlans, updatePlan, type PlanMeta } from './store';

export function usePlans() {
  const [plans, setPlans] = useState<PlanMeta[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listPlans()
      .then(setPlans)
      .catch(() => setError("Plans can't be stored in this browser (private window or blocked storage)."));
  }, []);

  useEffect(refresh, [refresh]);

  return {
    plans,
    error,
    async add(files: FileList | File[]) {
      for (const f of Array.from(files)) {
        if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) continue;
        await addPlan(f);
      }
      refresh();
    },
    async update(meta: PlanMeta) {
      await updatePlan(meta);
      refresh();
    },
    async remove(id: string) {
      await deletePlan(id);
      refresh();
    },
  };
}
