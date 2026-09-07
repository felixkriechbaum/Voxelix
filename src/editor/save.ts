import { ref } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { serializeProject } from '@/core/io/projectFile';
import { saveTextFile } from '@/core/io/fileSystem';

const saving = ref(false);

/**
 * Save the project to its `.voxproj` file (the manual Save, not autosave).
 * Shared by the toolbar button and the Ctrl+S shortcut so both behave the same.
 */
export function useProjectSave() {
  const store = useEditorStore();

  async function saveProject(): Promise<void> {
    if (saving.value || !store.project) return;
    saving.value = true;
    try {
      await new Promise((r) => setTimeout(r)); // let the "Saving…" spinner paint
      const handle = await saveTextFile(
        `${store.project.name}.voxproj`,
        serializeProject(store.project),
        store.fileHandle,
      );
      store.fileHandle = handle; // null when cancelled → next save re-prompts
    } catch (err) {
      console.error('[save]', err);
      store.fileHandle = null;
      alert('Could not save the project file. Press Save again and choose a location.');
    } finally {
      saving.value = false;
    }
  }

  return { saving, saveProject };
}
