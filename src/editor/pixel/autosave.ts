import { onBeforeUnmount, onMounted, watch } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { usePixelSession } from '@/editor/pixel/session';
import {
  getPixelProjectRecord,
  isProjectStoreAvailable,
  putPixelProjectRecord,
  type PixelProjectRecord,
} from '@/core/io/projectStore';

/** Save this long after the last change (idle debounce). */
const DEBOUNCE_MS = 5000;
/** Save at least this often even while editing never pauses. */
const MAX_WAIT_MS = 30_000;

/**
 * Debounced autosave of the active pixel project into IndexedDB. Mirrors
 * editor/autosave.ts for the voxel workspace — kept as its own copy since the
 * voxel version is wired to a 3D viewport thumbnail and there's only one
 * other call site.
 */
export function usePixelAutosave(): { flushAutosave: () => Promise<void> } {
  const store = usePixelStore();
  const { runner } = usePixelSession();
  if (!isProjectStoreAvailable()) return { flushAutosave: async () => {} };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let flushPromise: Promise<void> | null = null;
  let dirtySince = 0;
  let currentId: string | null = store.project?.id ?? null;
  let createdAt = 0;

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function flush(): Promise<void> {
    clearTimer();
    while (true) {
      if (flushPromise) {
        await flushPromise;
        continue;
      }
      const project = store.project;
      if (!project || !dirty) return;

      dirty = false;
      dirtySince = 0;
      store.autosaveBusy = true;
      flushPromise = (async () => {
        try {
          if (createdAt === 0) {
            const existing = await getPixelProjectRecord(project.id);
            createdAt = existing?.createdAt ?? Date.now();
          }
          const record: PixelProjectRecord = {
            id: project.id,
            name: project.name,
            widgetCount: project.widgets.length,
            createdAt,
            updatedAt: Date.now(),
            json: project.toJSON(),
            thumbnail: runner.value?.captureThumbnail() || undefined,
          };
          await putPixelProjectRecord(record);
          store.autosaveAt = record.updatedAt;
          store.autosaveError = false;
        } catch (err) {
          console.warn('[pixel autosave] write failed', err);
          dirty = true;
          store.autosaveError = true;
        } finally {
          store.autosaveBusy = false;
        }
      })();
      await flushPromise;
      flushPromise = null;
      if (store.autosaveError) {
        if (dirty) schedule();
        return;
      }
    }
  }

  function schedule(): void {
    const waited = dirtySince ? Date.now() - dirtySince : 0;
    if (waited >= MAX_WAIT_MS) {
      void flush();
      return;
    }
    clearTimer();
    timer = setTimeout(() => void flush(), Math.min(DEBOUNCE_MS, MAX_WAIT_MS - waited));
  }

  const stopWatch = watch(
    () => [store.project?.id ?? null, store.structureVersion, store.activeVersion, store.editVersion],
    ([id]) => {
      if (id !== currentId) {
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
    dirty = true;
    void flush();
  });

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('beforeunload', onBeforeUnload);
    stopWatch();
    void flush();
  });

  return { flushAutosave: flush };
}
