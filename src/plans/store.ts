/**
 * Plan PDFs, stored in this browser only (IndexedDB). They are never part of
 * the project file or the repository.
 */

export type PlanKind =
  | 'basement'
  | 'ground-floor'
  | 'first-floor'
  | 'roof'
  | 'elevation-front'
  | 'elevation-back'
  | 'elevation-left'
  | 'elevation-right'
  | 'section'
  | 'other';

export const PLAN_KINDS: { value: PlanKind; label: string }[] = [
  { value: 'basement', label: 'Basement / foundation plan' },
  { value: 'ground-floor', label: 'Ground floor plan' },
  { value: 'first-floor', label: 'First floor plan' },
  { value: 'roof', label: 'Roof / top view' },
  { value: 'elevation-front', label: 'Front elevation' },
  { value: 'elevation-back', label: 'Back elevation' },
  { value: 'elevation-left', label: 'Left elevation' },
  { value: 'elevation-right', label: 'Right elevation' },
  { value: 'section', label: 'Section' },
  { value: 'other', label: 'Other' },
];

export interface PlanMeta {
  id: string;
  name: string;
  kind: PlanKind;
  size: number;
  addedAt: number;
  /** Other drawings on the same PDF (multi-sheet sets). */
  contains?: PlanKind[];
  /** Set when Claude read the PDF to label it. */
  labeledBy?: 'claude';
}

/** The drawings worth having before building, in the order they're used. */
export const EXPECTED_PLANS: { kind: PlanKind; why: string }[] = [
  { kind: 'basement', why: 'Foundation outline and dimensions' },
  { kind: 'ground-floor', why: 'Ground floor walls and openings' },
  { kind: 'first-floor', why: 'Upper floor, incl. the cantilever' },
  { kind: 'elevation-front', why: 'Heights: grade, floors, roof' },
  { kind: 'elevation-back', why: 'Heights, back of the house' },
  { kind: 'elevation-left', why: 'Heights, side' },
  { kind: 'elevation-right', why: 'Heights, side' },
  { kind: 'section', why: 'Floor and wall build-up, exact heights' },
];

/** Which plan kinds are covered by the uploaded PDFs. */
export function coveredKinds(plans: PlanMeta[]): Set<PlanKind> {
  const s = new Set<PlanKind>();
  for (const p of plans) {
    s.add(p.kind);
    for (const k of p.contains ?? []) s.add(k);
  }
  return s;
}

/** Guess the plan type from its file name (English or French). */
export function guessKind(fileName: string): PlanKind {
  const n = fileName.toLowerCase();
  if (/(basement|sous-sol|fondation|foundation)/.test(n)) return 'basement';
  if (/(ground|rez|rdc|main floor)/.test(n)) return 'ground-floor';
  if (/(first floor|second floor|etage|étage|upper)/.test(n)) return 'first-floor';
  if (/(top view|roof|toit|toiture)/.test(n)) return 'roof';
  if (/(section|coupe)/.test(n)) return 'section';
  if (/(front|avant|fa[cç]ade)/.test(n)) return 'elevation-front';
  if (/(back|rear|arri[eè]re)/.test(n)) return 'elevation-back';
  if (/(left|gauche)/.test(n)) return 'elevation-left';
  if (/(right|droite)/.test(n)) return 'elevation-right';
  return 'other';
}

const DB = 'house-modeler-plans';
const META = 'meta';
const FILES = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: 'id' });
      req.result.createObjectStore(FILES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode);
        const req = fn(t);
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function listPlans(): Promise<PlanMeta[]> {
  const all = (await tx<PlanMeta[]>([META], 'readonly', (t) => t.objectStore(META).getAll())) ?? [];
  return all.sort((a, b) => a.addedAt - b.addedAt);
}

export async function addPlan(file: File): Promise<PlanMeta> {
  const meta: PlanMeta = {
    id: Math.random().toString(36).slice(2, 10),
    name: file.name.replace(/\.pdf$/i, ''),
    kind: guessKind(file.name),
    size: file.size,
    addedAt: Date.now(),
  };
  const data = await file.arrayBuffer();
  await tx([META, FILES], 'readwrite', (t) => {
    t.objectStore(META).put(meta);
    t.objectStore(FILES).put(data, meta.id);
  });
  return meta;
}

export async function updatePlan(meta: PlanMeta): Promise<void> {
  await tx([META], 'readwrite', (t) => {
    t.objectStore(META).put(meta);
  });
}

export async function deletePlan(id: string): Promise<void> {
  await tx([META, FILES], 'readwrite', (t) => {
    t.objectStore(META).delete(id);
    t.objectStore(FILES).delete(id);
  });
}

export async function getPlanData(id: string): Promise<ArrayBuffer | undefined> {
  return tx<ArrayBuffer>([FILES], 'readonly', (t) => t.objectStore(FILES).get(id));
}
