import { parseProject } from '../model/project';
import { openDb, run } from './idb';
import { getSetting, setSetting } from './browserRepo';
import type { PlanMeta } from '../plans/store';
import type { ProjectRepo } from './types';

/**
 * Before projects existed, the app kept one model in localStorage and its
 * plans in their own IndexedDB database. The first time the new app runs,
 * that becomes the first project. The old data is left untouched.
 */

export const LEGACY_PROJECT_KEY = 'house-modeler:project';
const LEGACY_PLANS_DB = 'house-modeler-plans';
const MIGRATED = 'migratedLegacy';

async function legacyPlans(): Promise<{ meta: PlanMeta; data: ArrayBuffer }[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDb(LEGACY_PLANS_DB, 1, (d) => {
    // It didn't exist: create the same empty stores the old app would have.
    d.createObjectStore('meta', { keyPath: 'id' });
    d.createObjectStore('files');
  });
  try {
    const metas = (await run<PlanMeta[]>(db, ['meta'], 'readonly', (t) => t.objectStore('meta').getAll())) ?? [];
    const out: { meta: PlanMeta; data: ArrayBuffer }[] = [];
    for (const meta of metas.sort((a, b) => a.addedAt - b.addedAt)) {
      const data = await run<ArrayBuffer>(db, ['files'], 'readonly', (t) => t.objectStore('files').get(meta.id));
      if (data) out.push({ meta, data });
    }
    return out;
  } finally {
    db.close();
  }
}

/** Returns the new project's id when something was moved in. */
export async function migrateLegacy(repo: ProjectRepo, storage: Pick<Storage, 'getItem'> = localStorage): Promise<string | null> {
  if (await getSetting<boolean>(MIGRATED)) return null;
  let id: string | null = null;
  let project = null;
  try {
    const raw = storage.getItem(LEGACY_PROJECT_KEY);
    if (raw) project = parseProject(raw);
  } catch {
    project = null;
  }
  const plans = await legacyPlans().catch(() => []);
  const hasWork = !!project && (project.steps.length > 0 || project.levels.length > 0);
  if (hasWork || plans.length > 0) {
    id = await repo.create(project ?? { version: 1, name: 'My house', levels: [], steps: [] });
    const store = repo.plans(id);
    for (const { meta, data } of plans) {
      const file = new File([data], `${meta.name}.pdf`, { type: 'application/pdf' });
      await store.add(file, { kind: meta.kind, contains: meta.contains, labeledBy: meta.labeledBy });
    }
  }
  await setSetting(MIGRATED, true);
  return id;
}
