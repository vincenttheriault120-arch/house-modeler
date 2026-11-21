import type { Project } from '../model/types';
import type { PlanStore } from '../plans/store';

/** Where a project is kept. */
export type Location = 'browser' | 'folder';

export interface ProjectSummary {
  id: string;
  location: Location;
  name: string;
  updatedAt: number;
  stepCount: number;
  planCount: number;
}

/** One place that holds many projects, each with its own plans. */
export interface ProjectRepo {
  location: Location;
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<Project>;
  save(id: string, project: Project): Promise<void>;
  /** Returns the new project's id. */
  create(project: Project): Promise<string>;
  remove(id: string): Promise<void>;
  plans(id: string): PlanStore;
}

/** Copy a project and its plans, within one place or between two. Returns the new id. */
export async function copyProject(from: ProjectRepo, id: string, to: ProjectRepo, name?: string): Promise<string> {
  const project = await from.load(id);
  const newId = await to.create({ ...project, name: name ?? project.name });
  const src = from.plans(id);
  const dst = to.plans(newId);
  for (const meta of await src.list()) {
    const data = await src.data(meta.id);
    if (!data) continue;
    const file = new File([data], `${meta.name}.pdf`, { type: 'application/pdf' });
    await dst.add(file, { kind: meta.kind, contains: meta.contains, labeledBy: meta.labeledBy });
  }
  return newId;
}
