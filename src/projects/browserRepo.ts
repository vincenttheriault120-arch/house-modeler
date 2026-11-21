import { parseProject } from '../model/project';
import type { Project } from '../model/types';
import { newPlanMeta, type PlanMeta, type PlanStore } from '../plans/store';
import { openDb, run } from './idb';
import type { ProjectRepo, ProjectSummary } from './types';

/**
 * Projects kept in this browser (IndexedDB): one record per project, plus its
 * plan PDFs. Nothing here leaves the browser.
 */
const DB = 'house-modeler-projects';
const PROJECTS = 'projects';
const PLANS = 'plans';
const FILES = 'planFiles';
export const SETTINGS = 'settings';

interface Record {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  project: Project;
}

type StoredPlan = PlanMeta & { projectId: string };

let dbPromise: Promise<IDBDatabase> | null = null;

export function projectsDb(): Promise<IDBDatabase> {
  dbPromise ??= openDb(DB, 1, (db) => {
    db.createObjectStore(PROJECTS, { keyPath: 'id' });
    db.createObjectStore(PLANS, { keyPath: 'id' }).createIndex('projectId', 'projectId');
    db.createObjectStore(FILES);
    db.createObjectStore(SETTINGS);
  });
  return dbPromise;
}

/** Forget the cached connection (tests reset the database between runs). */
export function resetProjectsDb() {
  dbPromise = null;
}

export function newProjectId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

async function plansOf(db: IDBDatabase, projectId: string): Promise<StoredPlan[]> {
  return (
    (await run<StoredPlan[]>(db, [PLANS], 'readonly', (t) => t.objectStore(PLANS).index('projectId').getAll(projectId))) ?? []
  );
}

function planStore(projectId: string): PlanStore {
  return {
    async list() {
      const all = await plansOf(await projectsDb(), projectId);
      return all.sort((a, b) => a.addedAt - b.addedAt).map(({ projectId: _p, ...meta }) => meta);
    },
    async add(file, base) {
      const meta = newPlanMeta(file, base);
      const data = await file.arrayBuffer();
      await run(await projectsDb(), [PLANS, FILES], 'readwrite', (t) => {
        t.objectStore(PLANS).put({ ...meta, projectId });
        t.objectStore(FILES).put(data, meta.id);
      });
      return meta;
    },
    async update(meta) {
      await run(await projectsDb(), [PLANS], 'readwrite', (t) => {
        t.objectStore(PLANS).put({ ...meta, projectId });
      });
    },
    async remove(id) {
      await run(await projectsDb(), [PLANS, FILES], 'readwrite', (t) => {
        t.objectStore(PLANS).delete(id);
        t.objectStore(FILES).delete(id);
      });
    },
    async data(id) {
      return run<ArrayBuffer>(await projectsDb(), [FILES], 'readonly', (t) => t.objectStore(FILES).get(id));
    },
  };
}

export const browserRepo: ProjectRepo = {
  location: 'browser',

  async list() {
    const db = await projectsDb();
    const records = (await run<Record[]>(db, [PROJECTS], 'readonly', (t) => t.objectStore(PROJECTS).getAll())) ?? [];
    const out: ProjectSummary[] = [];
    for (const r of records) {
      out.push({
        id: r.id,
        location: 'browser',
        name: r.project.name,
        updatedAt: r.updatedAt,
        stepCount: r.project.steps.length,
        planCount: (await plansOf(db, r.id)).length,
      });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async load(id) {
    const r = await run<Record>(await projectsDb(), [PROJECTS], 'readonly', (t) => t.objectStore(PROJECTS).get(id));
    if (!r) throw new Error('This project is no longer in this browser.');
    // Same checks and defaults as opening a file.
    return parseProject(JSON.stringify(r.project));
  },

  async save(id, project) {
    const db = await projectsDb();
    const r = await run<Record>(db, [PROJECTS], 'readonly', (t) => t.objectStore(PROJECTS).get(id));
    const now = Date.now();
    await run(db, [PROJECTS], 'readwrite', (t) => {
      t.objectStore(PROJECTS).put({ id, name: project.name, createdAt: r?.createdAt ?? now, updatedAt: now, project });
    });
  },

  async create(project) {
    const id = newProjectId();
    await this.save(id, project);
    return id;
  },

  async remove(id) {
    const db = await projectsDb();
    const plans = await plansOf(db, id);
    await run(db, [PROJECTS, PLANS, FILES], 'readwrite', (t) => {
      t.objectStore(PROJECTS).delete(id);
      for (const p of plans) {
        t.objectStore(PLANS).delete(p.id);
        t.objectStore(FILES).delete(p.id);
      }
    });
  },

  plans: planStore,
};

/** A small key/value store for app settings that must survive reloads (the folder handle). */
export async function getSetting<T>(key: string): Promise<T | undefined> {
  return run<T>(await projectsDb(), [SETTINGS], 'readonly', (t) => t.objectStore(SETTINGS).get(key));
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await run(await projectsDb(), [SETTINGS], 'readwrite', (t) => {
    if (value === undefined) t.objectStore(SETTINGS).delete(key);
    else t.objectStore(SETTINGS).put(value, key);
  });
}
