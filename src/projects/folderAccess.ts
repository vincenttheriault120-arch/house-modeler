import { getSetting, setSetting } from './browserRepo';
import type { DirHandle } from './folderRepo';

/**
 * Picking and remembering the projects folder on this computer. The browser
 * keeps the folder handle (in IndexedDB), but asks again for permission after
 * a reload: that needs a click, so the home screen shows a Reconnect button.
 */

type Permission = 'granted' | 'denied' | 'prompt';

interface PermissionHandle extends DirHandle {
  queryPermission(o: { mode: 'readwrite' }): Promise<Permission>;
  requestPermission(o: { mode: 'readwrite' }): Promise<Permission>;
}

type PickerWindow = Window & {
  showDirectoryPicker?: (o: { id?: string; mode?: 'readwrite'; startIn?: string }) => Promise<PermissionHandle>;
};

const HANDLE_KEY = 'projectsFolder';

/** Chrome and Edge on a computer; not Safari, Firefox or phones. */
export function folderSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

export type FolderState =
  | { status: 'unsupported' }
  | { status: 'none' }
  | { status: 'needs-permission'; name: string }
  | { status: 'ready'; name: string; handle: DirHandle };

export async function loadFolder(): Promise<FolderState> {
  if (!folderSupported()) return { status: 'unsupported' };
  const handle = await getSetting<PermissionHandle>(HANDLE_KEY).catch(() => undefined);
  if (!handle) return { status: 'none' };
  const perm = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied' as Permission);
  return perm === 'granted' ? { status: 'ready', name: handle.name, handle } : { status: 'needs-permission', name: handle.name };
}

/** Ask again after a reload. Must run from a click. */
export async function reconnectFolder(): Promise<FolderState> {
  const handle = await getSetting<PermissionHandle>(HANDLE_KEY);
  if (!handle) return { status: 'none' };
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  return perm === 'granted' ? { status: 'ready', name: handle.name, handle } : { status: 'needs-permission', name: handle.name };
}

/** Let the person pick the folder. Must run from a click. Returns null if they cancel. */
export async function pickFolder(): Promise<FolderState | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) return { status: 'unsupported' };
  try {
    const handle = await picker({ id: 'house-modeler-projects', mode: 'readwrite', startIn: 'documents' });
    await setSetting(HANDLE_KEY, handle);
    return { status: 'ready', name: handle.name, handle };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

export async function forgetFolder(): Promise<void> {
  await setSetting(HANDLE_KEY, undefined);
}
