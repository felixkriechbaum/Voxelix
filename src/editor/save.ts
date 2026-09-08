import { ref } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { serializeProject } from '@/core/io/projectFile';
import { saveTextFile } from '@/core/io/fileSystem';
import { toast } from '@/editor/toasts';

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
      const name = `${store.project.name}.voxproj`;
      const { handle, outcome } = await saveTextFile(
        name,
        serializeProject(store.project),
        store.fileHandle,
      );
      store.fileHandle = handle; // null when cancelled → next save re-prompts
      if (outcome === 'saved') toast(`Saved ${name}`);
      else if (outcome === 'downloaded') toast(`Downloaded ${name}`);
    } catch (err) {
      console.error('[save]', err);
      store.fileHandle = null;
      toast('Could not save — press Save again and pick a location', 'warn', 5000);
    } finally {
      saving.value = false;
    }
  }

  return { saving, saveProject };
}
