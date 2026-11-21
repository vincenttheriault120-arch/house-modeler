import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyProject, type Project } from '../model/types';
import { defaultFoundation } from '../model/foundation';
import { browserRepo, resetProjectsDb } from './browserRepo';
import { folderRepo, freeName, PROJECT_FILE, safeName, type DirHandle, type FileHandleLike } from './folderRepo';
import { LEGACY_PROJECT_KEY, migrateLegacy } from './migrate';
import { copyProject } from './types';
import { edited } from './Home';

/** An in-memory folder that behaves like the File System Access API. */
class FakeDir implements DirHandle {
  readonly kind = 'directory' as const;
  dirs = new Map<string, FakeDir>();
  files = new Map<string, File>();
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandle> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!o?.create) throw new DOMException('missing', 'NotFoundError');
      d = new FakeDir(name);
      this.dirs.set(name, d);
    }
    return d;
  }
  async getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandleLike> {
    if (!this.files.has(name)) {
      if (!o?.create) throw new DOMException('missing', 'NotFoundError');
      this.files.set(name, new File([], name));
    }
    const files = this.files;
    return {
      kind: 'file',
      name,
      getFile: async () => files.get(name)!,
      createWritable: async () => {
        const parts: (Blob | string | ArrayBuffer)[] = [];
        return {
          write: async (d: Blob | string | ArrayBuffer) => void parts.push(d),
          close: async () => void files.set(name, new File(parts, name)),
        };
      },
    };
  }
  async removeEntry(name: string) {
    if (!this.dirs.delete(name) && !this.files.delete(name)) throw new DOMException('missing', 'NotFoundError');
  }
  async *values() {
    for (const n of this.dirs.keys()) yield { kind: 'directory' as const, name: n };
    for (const n of this.files.keys()) yield { kind: 'file' as const, name: n };
  }
}

function house(name = 'Gardenville'): Project {
  return {
    ...emptyProject(),
    name,
    steps: [{ id: 's1', kind: 'foundation', label: 'Basement', level: 'Basement', visible: true, notes: '', params: defaultFoundation() }],
  };
}

const pdf = (name: string) => new File([new Uint8Array([37, 80, 68, 70])], name, { type: 'application/pdf' });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetProjectsDb();
});

describe('browser projects', () => {
  it('keeps several projects apart, each with its own plans', async () => {
    const a = await browserRepo.create(house('A'));
    const b = await browserRepo.create(house('B'));
    await browserRepo.plans(a).add(pdf('Front Elevation 01.pdf'));
    const list = await browserRepo.list();
    expect(list.map((p) => p.name).sort()).toEqual(['A', 'B']);
    expect(list.find((p) => p.id === a)?.planCount).toBe(1);
    expect(list.find((p) => p.id === b)?.planCount).toBe(0);
    const [plan] = await browserRepo.plans(a).list();
    expect(plan.kind).toBe('elevation-front');
    expect(new Uint8Array((await browserRepo.plans(a).data(plan.id))!)[0]).toBe(37);
  });

  it('saves, reloads and deletes with its plans', async () => {
    const id = await browserRepo.create(house());
    await browserRepo.save(id, { ...house(), name: 'Renamed' });
    expect((await browserRepo.load(id)).name).toBe('Renamed');
    const plan = await browserRepo.plans(id).add(pdf('Basement 01.pdf'));
    await browserRepo.remove(id);
    expect(await browserRepo.list()).toEqual([]);
    expect(await browserRepo.plans(id).data(plan.id)).toBeUndefined();
  });
});

describe('folder projects', () => {
  it('writes a project folder with its file and plans, and ignores other folders', async () => {
    const root = new FakeDir('03 - House Modeler 03');
    await root.getDirectoryHandle('Current 2D plans', { create: true });
    const repo = folderRepo(root);
    const id = await repo.create(house('311 Gardenville'));
    expect(id).toBe('311 Gardenville');
    expect(root.dirs.get(id)!.files.has(PROJECT_FILE)).toBe(true);

    const meta = await repo.plans(id).add(pdf('Top View 01.pdf'));
    await repo.plans(id).update({ ...meta, kind: 'roof', labeledBy: 'claude' });
    const plansDir = root.dirs.get(id)!.dirs.get('plans')!;
    expect([...plansDir.files.keys()].sort()).toEqual(['Top View 01.pdf', 'plans.json']);

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: '311 Gardenville', stepCount: 1, planCount: 1 });
    expect((await repo.plans(id).list())[0]).toMatchObject({ kind: 'roof', labeledBy: 'claude' });

    await repo.plans(id).remove(meta.id);
    expect([...plansDir.files.keys()]).toEqual(['plans.json']);
  });

  it('never overwrites an existing folder', async () => {
    const root = new FakeDir('root');
    const repo = folderRepo(root);
    expect(await repo.create(house('Same'))).toBe('Same');
    expect(await repo.create(house('Same'))).toBe('Same 2');
    expect(await freeName(root, 'Same')).toBe('Same 3');
  });

  it('makes names that are valid folder names', () => {
    expect(safeName('Plan: 311/Gardenville?')).toBe('Plan 311 Gardenville');
    expect(safeName('  ...  ')).toBe('House');
    expect(safeName('house.')).toBe('house');
  });
});

describe('copying projects', () => {
  it('copies a browser project with its labelled plans into a folder', async () => {
    const id = await browserRepo.create(house('Gardenville'));
    const m = await browserRepo.plans(id).add(pdf('Back Elevation.pdf'));
    await browserRepo.plans(id).update({ ...m, labeledBy: 'claude' });
    const root = new FakeDir('root');
    const repo = folderRepo(root);
    const newId = await copyProject(browserRepo, id, repo);
    expect((await repo.load(newId)).steps).toHaveLength(1);
    expect(await repo.plans(newId).list()).toEqual([expect.objectContaining({ kind: 'elevation-back', labeledBy: 'claude', name: 'Back Elevation' })]);
  });
});

describe('moving the old single project in', () => {
  const storage = (value: string | null) => ({ getItem: (k: string) => (k === LEGACY_PROJECT_KEY ? value : null) });

  it('creates the first project once, from the old autosave', async () => {
    const id = await migrateLegacy(browserRepo, storage(JSON.stringify(house('311 Gardenville'))));
    expect(id).not.toBeNull();
    expect((await browserRepo.load(id!)).name).toBe('311 Gardenville');
    expect(await migrateLegacy(browserRepo, storage(JSON.stringify(house())))).toBeNull();
    expect(await browserRepo.list()).toHaveLength(1);
  });

  it('skips an empty old project', async () => {
    expect(await migrateLegacy(browserRepo, storage(JSON.stringify(emptyProject())))).toBeNull();
    expect(await browserRepo.list()).toEqual([]);
  });
});

describe('edited', () => {
  it('reads like a person would say it', () => {
    const now = Date.UTC(2026, 10, 21, 12);
    expect(edited(now - 20_000, now)).toBe('Edited just now');
    expect(edited(now - 5 * 60_000, now)).toBe('Edited 5 minutes ago');
    expect(edited(now - 3 * 86_400_000, now)).toBe('Edited 3 days ago');
  });
});
