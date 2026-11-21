import { useCallback, useEffect, useState } from 'react';
import { loadApiKey } from '../chat/apiKey';
import type { PlanMeta, PlanStore } from './store';
import { labelPlan } from './suggest';

/** The plans of the open project, wherever that project is kept. */
export function usePlans(store: PlanStore) {
  const [plans, setPlans] = useState<PlanMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [labeling, setLabeling] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    store
      .list()
      .then((p) => {
        setPlans(p);
        setError(null);
      })
      .catch(() => setError("Couldn't read this project's plans (blocked storage, or the folder was moved)."));
  }, [store]);

  useEffect(refresh, [refresh]);

  /** Ask Claude what a plan shows. Quietly keeps the file-name guess if it can't. */
  const label = useCallback(
    async (meta: PlanMeta) => {
      const key = loadApiKey();
      if (!key) return;
      setLabeling((s) => new Set(s).add(meta.id));
      try {
        const l = await labelPlan(key, meta);
        await store.update({ ...meta, kind: l.kind, contains: l.also_contains.filter((k) => k !== l.kind), labeledBy: 'claude' });
      } catch {
        // Keep the guess from the file name; the person can pick the type.
      } finally {
        setLabeling((s) => {
          const n = new Set(s);
          n.delete(meta.id);
          return n;
        });
        refresh();
      }
    },
    [refresh, store],
  );

  return {
    plans,
    error,
    labeling,
    async add(files: FileList | File[]) {
      const added: PlanMeta[] = [];
      for (const f of Array.from(files)) {
        if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) continue;
        added.push(await store.add(f));
      }
      refresh();
      await Promise.all(added.map(label));
    },
    async update(meta: PlanMeta) {
      // A type picked by hand replaces Claude's label.
      await store.update({ ...meta, labeledBy: undefined });
      refresh();
    },
    async remove(id: string) {
      await store.remove(id);
      refresh();
    },
  };
}
