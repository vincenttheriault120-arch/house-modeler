import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseProject } from './model/project';
import { emptyProject, type Project } from './model/types';
import Workspace from './Workspace';
import { Home } from './projects/Home';
import { browserRepo } from './projects/browserRepo';
import { folderRepo } from './projects/folderRepo';
import { loadFolder, pickFolder, reconnectFolder, type FolderState } from './projects/folderAccess';
import { migrateLegacy } from './projects/migrate';
import { copyProject, type Location, type ProjectRepo, type ProjectSummary } from './projects/types';

interface OpenProject {
  location: Location;
  id: string;
  project: Project;
}

const NEW_LOCATION_KEY = 'house-modeler:new-location';

/** `#/browser/<id>` or `#/folder/<folder name>`: a reload reopens the same project. */
function readHash(): { location: Location; id: string } | null {
  const m = /^#\/(browser|folder)\/(.+)$/.exec(window.location.hash);
  return m ? { location: m[1] as Location, id: decodeURIComponent(m[2]) } : null;
}

function writeHash(target: { location: Location; id: string } | null) {
  const hash = target ? `#/${target.location}/${encodeURIComponent(target.id)}` : '';
  if (window.location.hash !== hash) history.replaceState(null, '', hash || window.location.pathname + window.location.search);
}

/** The app: the projects home, or one open project. */
export default function App() {
  const [folder, setFolder] = useState<FolderState>({ status: 'none' });
  const [browserProjects, setBrowserProjects] = useState<ProjectSummary[]>([]);
  const [folderProjects, setFolderProjects] = useState<ProjectSummary[]>([]);
  const [open, setOpen] = useState<OpenProject | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLocation, setNewLocation] = useState<Location>(
    () => (localStorage.getItem(NEW_LOCATION_KEY) as Location | null) ?? 'folder',
  );

  const fRepo = useMemo(() => (folder.status === 'ready' ? folderRepo(folder.handle) : null), [folder]);
  const repoFor = useCallback((l: Location): ProjectRepo | null => (l === 'browser' ? browserRepo : fRepo), [fRepo]);

  const refresh = useCallback(async () => {
    try {
      setBrowserProjects(await browserRepo.list());
    } catch {
      setError("This browser won't store projects (private window or blocked storage). Use a folder, or Save to file.");
    }
    if (fRepo) {
      try {
        setFolderProjects(await fRepo.list());
      } catch {
        setError("Couldn't read the projects folder. It may have been moved or renamed: choose it again.");
      }
    } else setFolderProjects([]);
  }, [fRepo]);

  async function openProject(location: Location, id: string, repo = repoFor(location)) {
    if (!repo) return;
    try {
      const project = await repo.load(id);
      setError(null);
      setOpen({ location, id, project });
      writeHash({ location, id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open that project.");
      writeHash(null);
    }
  }

  // First run: move the old single project in, find the folder, reopen what the URL points at.
  useEffect(() => {
    (async () => {
      const migrated = await migrateLegacy(browserRepo).catch(() => null);
      const f = await loadFolder().catch((): FolderState => ({ status: 'none' }));
      setFolder(f);
      const target = readHash() ?? (migrated ? { location: 'browser' as const, id: migrated } : null);
      if (target) {
        const repo = target.location === 'browser' ? browserRepo : f.status === 'ready' ? folderRepo(f.handle) : null;
        if (repo) await openProject(target.location, target.id, repo);
        else writeHash(null);
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready && !open) refresh();
  }, [ready, open, refresh]);

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function chooseNewLocation(l: Location) {
    setNewLocation(l);
    localStorage.setItem(NEW_LOCATION_KEY, l);
  }

  const save = useCallback(
    (project: Project) => {
      const repo = open && repoFor(open.location);
      return repo ? repo.save(open.id, project) : Promise.reject(new Error('Not open'));
    },
    // Only the project's identity matters here; re-creating it would re-trigger autosave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open?.location, open?.id, repoFor],
  );
  const planStore = useMemo(() => (open ? repoFor(open.location)?.plans(open.id) : undefined), [open?.location, open?.id, repoFor]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return null;

  if (open && planStore) {
    return (
      <Workspace
        key={`${open.location}:${open.id}`}
        initial={open.project}
        whereLabel={open.location === 'browser' ? 'this browser' : `folder “${open.id}”`}
        onSave={save}
        planStore={planStore}
        onHome={() => {
          setOpen(null);
          writeHash(null);
        }}
      />
    );
  }

  const target = (): { where: Location; repo: ProjectRepo } =>
    newLocation === 'folder' && fRepo ? { where: 'folder', repo: fRepo } : { where: 'browser', repo: browserRepo };

  return (
    <Home
      folder={folder}
      browserProjects={browserProjects}
      folderProjects={folderProjects}
      newLocation={fRepo ? newLocation : 'browser'}
      busy={busy}
      error={error}
      onNewLocation={chooseNewLocation}
      onPickFolder={() =>
        withBusy(async () => {
          const f = await pickFolder();
          if (f) {
            setFolder(f);
            if (f.status === 'ready') chooseNewLocation('folder');
          }
        })
      }
      onReconnect={() => withBusy(async () => setFolder(await reconnectFolder()))}
      onOpen={(p) => withBusy(() => openProject(p.location, p.id))}
      onCreate={(name, where) =>
        withBusy(async () => {
          const repo = where === 'folder' && fRepo ? fRepo : browserRepo;
          const id = await repo.create({ ...emptyProject(), name });
          await openProject(repo.location, id, repo);
        })
      }
      onImportFile={(file) =>
        withBusy(async () => {
          const project = parseProject(await file.text());
          const { where, repo } = target();
          const id = await repo.create(project);
          await openProject(where, id, repo);
        })
      }
      onDuplicate={(p) =>
        withBusy(async () => {
          const repo = repoFor(p.location);
          if (!repo) return;
          await copyProject(repo, p.id, repo, `${p.name} (copy)`);
          await refresh();
        })
      }
      onCopyTo={(p, to) =>
        withBusy(async () => {
          const from = repoFor(p.location);
          const dest = repoFor(to);
          if (!from || !dest) return;
          await copyProject(from, p.id, dest);
          await refresh();
        })
      }
      onDelete={(p) => {
        const where = p.location === 'folder' ? `the folder “${p.id}” and everything in it, including its plans` : 'it and its plans from this browser';
        if (!window.confirm(`Delete “${p.name}”? This removes ${where}. It can't be undone.`)) return;
        withBusy(async () => {
          await repoFor(p.location)?.remove(p.id);
          await refresh();
        });
      }}
    />
  );
}
