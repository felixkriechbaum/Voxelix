/** Thin wrappers over the File System Access API with download/upload fallbacks. */

interface PickerWindow {
  showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: (opts?: unknown) => Promise<FileSystemDirectoryHandle>;
}
const w = window as unknown as PickerWindow;

export const hasFsAccess = typeof w.showSaveFilePicker === 'function';

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

export async function saveTextFile(
  suggestedName: string,
  text: string,
  handle: FileSystemFileHandle | null,
): Promise<FileSystemFileHandle | null> {
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return handle;
  }
  if (w.showSaveFilePicker) {
    try {
      const h = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'Project', accept: { 'application/json': ['.voxproj'] } }],
      });
      const writable = await h.createWritable();
      await writable.write(text);
      await writable.close();
      return h;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return null;
    }
  }
  downloadBlob(suggestedName, new Blob([text], { type: 'application/json' }));
  return null;
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
