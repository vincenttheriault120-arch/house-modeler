import { parseProject } from '../model/project';
import { newPlanMeta, type PlanMeta, type PlanStore } from '../plans/store';
import type { ProjectRepo, ProjectSummary } from './types';

/**
 * Projects kept as real files in a folder the person picked on their computer
 * (File System Access API, Chrome and Edge). Layout:
 *
 *   <picked folder>/
 *     <Project name>/
 *       project.house.json
 *       plans/
 *         plans.json          labels for each PDF
 *         Front Elevation.pdf
 *
 * Any other folder in there (for example the original plans) is left alone:
 * only folders holding a project.house.json are projects.
 */

export const PROJECT_FILE = 'project.house.json';
const PLANS_DIR = 'plans';
const PLANS_INDEX = 'plans.json';

/** The parts of a directory handle this module uses (so tests can fake one). */
export interface DirHandle {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  values(): AsyncIterable<{ kind: 'file' | 'directory'; name: string }>;
}

export interface FileHandleLike {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob | string | ArrayBuffer): Promise<void>; close(): Promise<void> }>;
}

type StoredPlan = PlanMeta & { file: string };

/** A name that is a valid folder or file name on Windows and macOS. */
export function safeName(name: string, fallback = 'House'): string {
  const n = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return n || fallback;
}

async function exists(dir: DirHandle, name: string): Promise<boolean> {
  for await (const e of dir.values()) if (e.name === name) return true;
  return false;
}

/** `base`, or `base 2`, `base 3`… whichever is free in `dir`. */
export async function freeName(dir: DirHandle, base: string, ext = ''): Promise<string> {
  let name = base + ext;
  for (let i = 2; await exists(dir, name); i++) name = `${base} ${i}${ext}`;
  return name;
}

async function readText(dir: DirHandle, name: string): Promise<string | undefined> {
  try {
    return await (await (await dir.getFileHandle(name)).getFile()).text();
  } catch {
    return undefined;
  }
}

async function writeFile(dir: DirHandle, name: string, data: Blob | string | ArrayBuffer) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(data);
  await w.close();
}

function folderPlans(root: DirHandle, projectId: string): PlanStore {
  const dir = async () => (await root.getDirectoryHandle(projectId)).getDirectoryHandle(PLANS_DIR, { create: true });
  const readIndex = async (d: DirHandle): Promise<StoredPlan[]> => {
    const raw = await readText(d, PLANS_INDEX);
    try {
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  };
  const writeIndex = (d: DirHandle, list: StoredPlan[]) => writeFile(d, PLANS_INDEX, JSON.stringify(list, null, 2));

  return {
    async list() {
      const list = await readIndex(await dir());
      return list.sort((a, b) => a.addedAt - b.addedAt).map(({ file: _f, ...meta }) => meta);
    },
    async add(file, base) {
      const d = await dir();
      const meta = newPlanMeta(file, base);
      const fileName = await freeName(d, safeName(meta.name, 'Plan'), '.pdf');
      await writeFile(d, fileName, file);
      await writeIndex(d, [...(await readIndex(d)), { ...meta, file: fileName }]);
      return meta;
    },
    async update(meta) {
      const d = await dir();
      const list = await readIndex(d);
      await writeIndex(
        d,
        list.map((p) => (p.id === meta.id ? { ...meta, file: p.file } : p)),
      );
    },
    async remove(id) {
      const d = await dir();
      const list = await readIndex(d);
      const gone = list.find((p) => p.id === id);
      if (gone) await d.removeEntry(gone.file).catch(() => undefined);
      await writeIndex(d, list.filter((p) => p.id !== id));
    },
    async data(id) {
      const d = await dir();
      const p = (await readIndex(d)).find((x) => x.id === id);
      if (!p) return undefined;
      try {
        return await (await (await d.getFileHandle(p.file)).getFile()).arrayBuffer();
      } catch {
        return undefined;
      }
    },
  };
}

/** A project's id in a folder is its folder name. */
export function folderRepo(root: DirHandle): ProjectRepo {
  return {
    location: 'folder',

    async list() {
      const out: ProjectSummary[] = [];
      for await (const e of root.values()) {
        if (e.kind !== 'directory') continue;
        const d = await root.getDirectoryHandle(e.name);
        let file: File;
        try {
          file = await (await d.getFileHandle(PROJECT_FILE)).getFile();
        } catch {
          continue; // not a project folder
        }
        try {
          const p = parseProject(await file.text());
          out.push({
            id: e.name,
            location: 'folder',
            name: p.name,
            updatedAt: file.lastModified,
            stepCount: p.steps.length,
            planCount: (await folderPlans(root, e.name).list()).length,
          });
        } catch {
          // An unreadable project file: skip it rather than break the list.
        }
      }
      return out.sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async load(id) {
      const d = await root.getDirectoryHandle(id);
      const raw = await readText(d, PROJECT_FILE);
      if (raw === undefined) throw new Error(`No ${PROJECT_FILE} in the folder “${id}”.`);
      return parseProject(raw);
    },

    async save(id, project) {
      const d = await root.getDirectoryHandle(id, { create: true });
      await writeFile(d, PROJECT_FILE, JSON.stringify(project, null, 2));
    },

    async create(project) {
      const id = await freeName(root, safeName(project.name));
      await this.save(id, project);
      return id;
    },

    async remove(id) {
      await root.removeEntry(id, { recursive: true });
    },

    plans: (id) => folderPlans(root, id),
  };
}
