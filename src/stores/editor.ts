import { defineStore } from 'pinia';
import { computed, markRaw, ref, shallowRef } from 'vue';
import { Project } from '@/core/project/Project';
import { defaultExportSettings, type ExportSettings } from '@/core/project/types';
import { paletteToLinearArray } from '@/core/palette';
import type { ToolId } from '@/tools/types';
import type { BuildPlane } from '@/viewport/Picker';
import type { Selection } from '@/core/ops/selection';

export const useEditorStore = defineStore('editor', () => {
  const project = shallowRef<Project | null>(null);
  const fileHandle = shallowRef<FileSystemFileHandle | null>(null);

  /** bumps on structural change (object added / removed / renamed) */
  const structureVersion = ref(0);
  /** bumps when the active object identity or its grid size changes */
  const activeVersion = ref(0);
  /** bumps when any palette colour changes */
  const paletteVersion = ref(0);
  /** bumps after every committed voxel edit / undo / redo (for autosave) */
  const editVersion = ref(0);

  /** autosave (IndexedDB) status, driven by useAutosave() */
  const autosaveBusy = ref(false);
  const autosaveAt = ref<number | null>(null);
  const autosaveError = ref(false);

  const activeObjectId = ref<string | null>(null);
  const currentColor = ref(16);
  const toolId = ref<ToolId>('place');
  const boxMode = ref<'fill' | 'erase'>('fill');
  /** right-click in the viewport erases a voxel instead of opening the context menu */
  const rmbErase = ref(false);
  const buildPlane = ref<BuildPlane>('xz');
  const buildOffset = ref(0);
  /** active voxel selection (select tool); per-object, cleared on switch */
  const selection = ref<Selection | null>(null);

  const objects = computed(() => {
    void structureVersion.value;
    return (
      project.value?.objects.map((o) => ({
        id: o.id,
        name: o.name,
        kind: o.kind,
        baseId: o.baseId,
      })) ?? []
    );
  });

  const projectName = computed(() => {
    void structureVersion.value;
    return project.value?.name ?? '';
  });

  const exportSettings = computed<ExportSettings>(() => {
    void structureVersion.value;
    return project.value?.exportSettings ?? defaultExportSettings();
  });

  function activeObject() {
    return project.value?.objects.find((o) => o.id === activeObjectId.value) ?? null;
  }

  function setProject(p: Project, handle: FileSystemFileHandle | null = null) {
    project.value = markRaw(p);
    fileHandle.value = handle;
    activeObjectId.value = p.activeObjectId ?? p.objects[0]?.id ?? null;
    currentColor.value = 16;
    buildOffset.value = 0;
    selection.value = null;
    autosaveAt.value = null;
    autosaveError.value = false;
    structureVersion.value++;
    activeVersion.value++;
    paletteVersion.value++;
  }

  function newProject(name: string) {
    setProject(Project.createNew(name || 'Untitled'));
  }

  function setActive(id: string) {
    if (!project.value) return;
    activeObjectId.value = id;
    project.value.activeObjectId = id;
    buildOffset.value = 0;
    selection.value = null;
    activeVersion.value++;
  }

  function addObject(name: string, size: [number, number, number]) {
    if (!project.value) return;
    const o = project.value.addObject(name, size);
    structureVersion.value++;
    setActive(o.id);
  }

  function duplicateObject(id: string) {
    if (!project.value) return;
    const o = project.value.duplicate(id);
    structureVersion.value++;
    if (o) setActive(o.id);
  }

  function extendObject(id: string) {
    if (!project.value) return;
    const o = project.value.extend(id);
    structureVersion.value++;
    if (o) setActive(o.id);
  }

  function removeObject(id: string) {
    if (!project.value) return;
    project.value.remove(id);
    activeObjectId.value = project.value.activeObjectId;
    structureVersion.value++;
    activeVersion.value++;
  }

  function renameObject(id: string, name: string) {
    project.value?.rename(id, name);
    structureVersion.value++;
  }

  function resizeActive(size: [number, number, number]) {
    const o = activeObject();
    if (!o) return;
    o.data.resize(size[0], size[1], size[2]);
    selection.value = null;
    activeVersion.value++;
  }

  function bumpEdit() {
    editVersion.value++;
  }

  function updateExportSettings(patch: Partial<ExportSettings>) {
    if (!project.value) return;
    Object.assign(project.value.exportSettings, patch);
    structureVersion.value++; // project metadata changed — persist it
  }

  function setSelection(s: Selection | null) {
    selection.value = s;
  }

  function clearSelection() {
    selection.value = null;
  }

  function setColor(i: number) {
    currentColor.value = i;
  }

  function setPaletteColor(i: number, hex: string) {
    if (!project.value) return;
    project.value.palette[i] = hex;
    paletteVersion.value++;
  }

  const palette = () => project.value?.palette ?? [];
  const paletteLinear = () => paletteToLinearArray(palette());

  return {
    project,
    fileHandle,
    structureVersion,
    activeVersion,
    paletteVersion,
    editVersion,
    autosaveBusy,
    autosaveAt,
    autosaveError,
    objects,
    projectName,
    exportSettings,
    activeObjectId,
    currentColor,
    toolId,
    boxMode,
    rmbErase,
    buildPlane,
    buildOffset,
    selection,
    activeObject,
    setProject,
    newProject,
    setActive,
    addObject,
    duplicateObject,
    extendObject,
    removeObject,
    renameObject,
    resizeActive,
    bumpEdit,
    updateExportSettings,
    setSelection,
    clearSelection,
    setColor,
    setPaletteColor,
    palette,
    paletteLinear,
  };
});

export type EditorStore = ReturnType<typeof useEditorStore>;
