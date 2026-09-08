/** Thin wrappers over the File System Access API with download/upload fallbacks. */

interface PickerWindow {
  showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: (opts?: unknown) => Promise<FileSystemDirectoryHandle>;
}
const w = window as unknown as PickerWindow;

export const hasFsAccess = typeof w.showSaveFilePicker === 'function';
export const hasDirectoryPicker = typeof w.showDirectoryPicker === 'function';

export interface OpenedFile {
  name: string;
  text: string;
  handle: FileSystemFileHandle | null;
}

export async function openTextFile(extensions: string[]): Promise<OpenedFile | null> {
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: [{ description: 'Project', accept: { 'application/json': extensions } }],
        multiple: false,
      });
      const file = await handle.getFile();
      return { name: file.name, text: await file.text(), handle };
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return null;
    }
  }
  return openViaInput(extensions);
}

interface PermissionHandle {
  queryPermission?: (o: { mode: string }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: string }) => Promise<PermissionState>;
}

/** A stored handle can lose its write grant between sessions / after a while. */
async function canWrite(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as unknown as PermissionHandle;
  const opts = { mode: 'readwrite' };
  try {
    if (!h.queryPermission) return true; // old spec — assume ok, createWritable will tell us
    if ((await h.queryPermission(opts)) === 'granted') return true;
    return (await h.requestPermission?.(opts)) === 'granted';
  } catch {
    return false;
  }
}

async function writeText(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

/** `downloaded` is the no-File-System-Access fallback — a success, but there is
 *  no handle to write to next time. `cancelled` means the user dismissed the
 *  picker, so nothing was written. */
export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

export interface SaveResult {
  handle: FileSystemFileHandle | null;
  outcome: SaveOutcome;
}

export async function saveTextFile(
  suggestedName: string,
  text: string,
  handle: FileSystemFileHandle | null,
): Promise<SaveResult> {
  if (handle && (await canWrite(handle))) {
    try {
      await writeText(handle, text);
      return { handle, outcome: 'saved' };
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return { handle, outcome: 'cancelled' };
      // the handle went stale (file moved / permission revoked) — re-pick below
    }
  }
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'Project', accept: { 'application/json': ['.voxproj'] } }],
      });
      await writeText(h, text);
      return { handle: h, outcome: 'saved' };
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return { handle: null, outcome: 'cancelled' };
      throw err;
    }
  }
  downloadBlob(suggestedName, new Blob([text], { type: 'application/json' }));
  return { handle: null, outcome: 'downloaded' };
}

export async function saveBinaryFile(suggestedName: string, blob: Blob): Promise<void> {
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'glTF binary', accept: { 'model/gltf-binary': ['.glb'] } }],
      });
      const writable = await h.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
    }
  }
  downloadBlob(suggestedName, blob);
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!w.showDirectoryPicker) return null;
  try {
    return await w.showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return null;
  }
}

export async function writeFileToDirectory(
  dir: FileSystemDirectoryHandle,
  name: string,
  blob: Blob,
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openViaInput(extensions: string[]): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.join(',');
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve({ name: file.name, text: await file.text(), handle: null });
    };
    input.click();
  });
}
