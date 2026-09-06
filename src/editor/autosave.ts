import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useSession } from '@/editor/session';
import {
  getProjectRecord,
  isProjectStoreAvailable,
  putProjectRecord,
  type ProjectRecord,
} from '@/core/io/projectStore';

/** Save this long after the last change (idle debounce). */
const DEBOUNCE_MS = 5000;
/** Save at least this often even while editing never pauses. */
const MAX_WAIT_MS = 30_000;

/**
 * Debounced autosave of the active project into IndexedDB. Every structural,
 * active-object or palette mutation marks the project dirty; a flush also fires
 * when the tab is hidden or unloaded. Call once from the editor view's setup.
 */
export function useAutosave(): void {
  const store = useEditorStore();
  const { viewport } = useSession();
  if (!isProjectStoreAvailable()) return;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let flushing = false;
  let dirtySince = 0;
  let currentId: string | null = store.project?.id ?? null;
  /** preserved across rewrites; resolved from the existing record on first flush */
  let createdAt = 0;

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function flush(): Promise<void> {
    clearTimer();
    const project = store.project;
    if (!project || !dirty || flushing) return;

    flushing = true;
    dirty = false;
    dirtySince = 0;
    store.autosaveBusy = true;
    try {
      if (createdAt === 0) {
        const existing = await getProjectRecord(project.id);
        createdAt = existing?.createdAt ?? Date.now();
      }
      const record: ProjectRecord = {
        id: project.id,
        name: project.name,
        objectCount: project.objects.length,
        createdAt,
        updatedAt: Date.now(),
        json: project.toJSON(),
        thumbnail: viewport.value?.captureThumbnail() ?? undefined,
      };
      await putProjectRecord(record);
      store.autosaveAt = record.updatedAt;
      store.autosaveError = false;
    } catch (err) {
      console.warn('[autosave] write failed', err);
      dirty = true; // try again on the next change
      store.autosaveError = true;
    } finally {
      flushing = false;
      store.autosaveBusy = false;
    }
    if (dirty) schedule();
  }

  function schedule(): void {
    // fire 5 s after the last edit, but never wait longer than MAX_WAIT_MS
    const waited = dirtySince ? Date.now() - dirtySince : 0;
    if (waited >= MAX_WAIT_MS) {
      void flush();
      return;
    }
    clearTimer();
    timer = setTimeout(() => void flush(), Math.min(DEBOUNCE_MS, MAX_WAIT_MS - waited));
  }

  const stopWatch = watch(
    () => [
      store.project?.id ?? null,
      store.structureVersion,
      store.activeVersion,
      store.paletteVersion,
      store.editVersion,
    ],
    ([id]) => {
      if (id !== currentId) {
        // a different project loaded — reset, and don't treat the load as an edit
        currentId = id as string | null;
        createdAt = 0;
        dirty = false;
        dirtySince = 0;
        clearTimer();
        return;
      }
      if (!id) return;
      if (!dirtySince) dirtySince = Date.now();
      dirty = true;
      schedule();
    },
  );

  function onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') void flush();
  }
  function onBeforeUnload(): void {
    void flush();
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', onBeforeUnload);
    // make sure even an untouched new / just-opened project lands in recents
    dirty = true;
    void flush();
  });

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('beforeunload', onBeforeUnload);
    stopWatch();
    void flush();
  });
}
