import { useRef } from 'react';
import { Box, Copy, FolderInput, FolderOpen, FolderSync, Globe, HardDrive, Moon, Plus, Sun, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/Segmented';
import { cn } from '@/lib/utils';
import { useTheme } from '../theme';
import type { FolderState } from './folderAccess';
import type { Location, ProjectSummary } from './types';

interface Props {
  folder: FolderState;
  browserProjects: ProjectSummary[];
  folderProjects: ProjectSummary[];
  newLocation: Location;
  busy: boolean;
  error: string | null;
  onNewLocation: (l: Location) => void;
  onPickFolder: () => void;
  onReconnect: () => void;
  onOpen: (p: ProjectSummary) => void;
  onStartNew: () => void;
  onImportFile: (file: File) => void;
  onDuplicate: (p: ProjectSummary) => void;
  onCopyTo: (p: ProjectSummary, to: Location) => void;
  onDelete: (p: ProjectSummary) => void;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function edited(ts: number, now = Date.now()): string {
  const min = Math.round((ts - now) / 60000);
  if (Math.abs(min) < 1) return 'Edited just now';
  if (Math.abs(min) < 60) return `Edited ${rtf.format(min, 'minute')}`;
  const h = Math.round(min / 60);
  if (Math.abs(h) < 24) return `Edited ${rtf.format(h, 'hour')}`;
  const d = Math.round(h / 24);
  if (Math.abs(d) < 30) return `Edited ${rtf.format(d, 'day')}`;
  return `Edited ${new Date(ts).toLocaleDateString()}`;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function Home(props: Props) {
  const { folder, browserProjects, folderProjects, busy, error } = props;
  const { dark, toggle: toggleTheme } = useTheme();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderReady = folder.status === 'ready';
  const folderName = folder.status === 'ready' || folder.status === 'needs-permission' ? folder.name : '';

  return (
    <div className="min-h-full bg-muted/40">
      <header className="flex items-center gap-2 border-b bg-background px-4 py-2">
        <Box className="size-5" />
        <h1 className="text-sm font-semibold">House Modeler</h1>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="size-8" onClick={toggleTheme} aria-label={dark ? 'Light theme' : 'Dark theme'}>
          {dark ? <Sun /> : <Moon />}
        </Button>
      </header>

      <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Your projects</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pick up where you left off, or start a new house.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Upload /> Open from file…
            </Button>
            <Button onClick={props.onStartNew} disabled={busy}>
              <Plus /> New project
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) props.onImportFile(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>

        {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p>}

        <FolderBar {...props} />

        {(folderReady || folder.status === 'needs-permission') && (
          <ProjectSection
            title={`In the folder “${folderName}”`}
            icon={<HardDrive className="size-4" />}
            projects={folderProjects}
            empty={
              folderReady
                ? 'No projects in this folder yet. New projects go here, or copy one from this browser.'
                : 'Reconnect the folder to see its projects.'
            }
            copyLabel="Copy to this browser"
            copyTo="browser"
            {...props}
          />
        )}

        <ProjectSection
          title="In this browser"
          icon={<Globe className="size-4" />}
          projects={browserProjects}
          empty="No projects in this browser."
          copyLabel={folderReady ? 'Copy to folder' : undefined}
          copyTo="folder"
          {...props}
        />

        {browserProjects.length === 0 && folderProjects.length === 0 && (
          <button
            onClick={props.onStartNew}
            className="grid min-h-40 place-items-center rounded-xl border-2 border-dashed text-muted-foreground hover:bg-background"
          >
            <span className="grid justify-items-center gap-1">
              <Plus className="size-6" />
              <span className="font-medium text-foreground">Start your first project</span>
            </span>
          </button>
        )}
      </main>

    </div>
  );
}

function FolderBar({ folder, newLocation, onNewLocation, onPickFolder, onReconnect, busy }: Props) {
  let title: string;
  let detail: string;
  let actions: React.ReactNode = null;
  switch (folder.status) {
    case 'unsupported':
      title = 'Projects are saved in this browser';
      detail = 'To keep them as real files in a folder on your computer, open the app in Chrome or Edge on a computer.';
      break;
    case 'none':
      title = 'Keep projects as files on your computer';
      detail = 'Pick a folder, for example “03 - House Modeler 03”. Each project becomes a folder with its project file and its plans, easy to back up.';
      actions = (
        <Button variant="outline" onClick={onPickFolder} disabled={busy}>
          <FolderOpen /> Choose folder…
        </Button>
      );
      break;
    case 'needs-permission':
      title = `Projects folder: ${folder.name}`;
      detail = 'Your browser asks for your OK again after a reload. Nothing has changed in the folder.';
      actions = (
        <>
          <Button onClick={onReconnect} disabled={busy}>
            <FolderSync /> Reconnect
          </Button>
          <Button variant="ghost" onClick={onPickFolder} disabled={busy}>
            Choose another…
          </Button>
        </>
      );
      break;
    case 'ready':
      title = `Projects folder: ${folder.name}`;
      detail = 'Projects there are saved as you work. Other folders inside it, like your original plans, are left alone.';
      actions = (
        <>
          <Segmented<Location>
            label="New projects go to"
            value={newLocation}
            onChange={onNewLocation}
            options={[
              { value: 'folder', label: 'Folder' },
              { value: 'browser', label: 'Browser' },
            ]}
          />
          <Button variant="ghost" onClick={onPickFolder} disabled={busy}>
            Change folder…
          </Button>
        </>
      );
      break;
  }
  return (
    <section aria-label="Where projects are saved" className="flex flex-wrap items-center gap-4 rounded-xl border bg-background px-5 py-4">
      <HardDrive className="size-6 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-[1_1_20rem]">
        <div className="font-medium">{title}</div>
        <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </section>
  );
}

function ProjectSection(
  props: Props & {
    title: string;
    icon: React.ReactNode;
    projects: ProjectSummary[];
    empty: string;
    copyLabel?: string;
    copyTo: Location;
  },
) {
  const { title, icon, projects, empty, copyLabel, copyTo, busy } = props;
  return (
    <section className="grid gap-3">
      <h3 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {icon}
        {title}
      </h3>
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
          {projects.map((p) => (
            <li key={`${p.location}:${p.id}`} className="grid overflow-hidden rounded-xl border bg-background">
              <button
                onClick={() => props.onOpen(p)}
                disabled={busy}
                className="grid gap-1 px-4 pt-4 pb-3 text-left transition-colors hover:bg-accent"
              >
                <span className="truncate text-base font-semibold">{p.name}</span>
                <span className="text-xs text-muted-foreground">{edited(p.updatedAt)}</span>
                <span className="text-sm text-muted-foreground">
                  {plural(p.stepCount, 'build step')} · {plural(p.planCount, 'plan')}
                  {p.location === 'folder' && ` · folder “${p.id}”`}
                </span>
              </button>
              <div className="flex flex-wrap gap-1 border-t px-2 py-1.5">
                <Button variant="ghost" size="sm" onClick={() => props.onDuplicate(p)} disabled={busy}>
                  <Copy /> Duplicate
                </Button>
                {copyLabel && (
                  <Button variant="ghost" size="sm" onClick={() => props.onCopyTo(p, copyTo)} disabled={busy}>
                    <FolderInput /> {copyLabel}
                  </Button>
                )}
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${p.name}`}
                  onClick={() => props.onDelete(p)}
                  disabled={busy}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
