import { defineStore } from 'pinia';
import { computed, markRaw, ref, shallowRef } from 'vue';
import { Project } from '@/core/project/Project';
import { defaultExportSettings, type ExportSettings } from '@/core/project/types';
import {
  alignOverlayToBase,
  effectiveDetail,
  extendFamily,
  resolveEffectiveData,
} from '@/core/project/resolve';
import { CELLS_PER_VOXEL } from '@/core/voxel/constants';
import { paletteToLinearArray } from '@/core/palette';
import { useSession } from '@/editor/session';
import type { ToolId } from '@/tools/types';
import type { BuildPlane } from '@/viewport/Picker';
import type { Selection } from '@/core/ops/selection';
import type { VoxelObject } from '@/core/project/VoxelObject';

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

  /** non-null while a long export is running — shown as a blocking overlay */
  const exportStatus = ref<string | null>(null);

  const activeObjectId = ref<string | null>(null);
  const currentColor = ref(16);
  const toolId = ref<ToolId>('place');
  const boxMode = ref<'fill' | 'erase'>('fill');
  /** paint-bucket spread: whole volume, just the clicked face, or its outline */
  const bucketMode = ref<'volume' | 'face' | 'outline'>('volume');
  /** right-click in the viewport erases a voxel instead of opening the context menu */
  const rmbErase = ref(false);
  /** brush size as a fraction of a voxel: 1 = full voxel, 2 = half, 3 = third */
  const voxelFraction = ref(1);
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

  /** grid cells per voxel edge for the active object (overlays report their base's) */
  const activeDetail = computed(() => {
    void structureVersion.value;
    void activeVersion.value;
    const o = activeObject();
    return o && project.value ? effectiveDetail(o, project.value) : 1;
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
    try {
      localStorage.setItem('voxelix.lastProject', p.id);
    } catch {
      /* private mode */
    }
  }

  function newProject(name: string) {
    setProject(Project.createNew(name || 'Untitled'));
  }

  /** Back to the start screen. Autosave has the project; nothing is lost. */
  function closeProject() {
    project.value = null;
    fileHandle.value = null;
    activeObjectId.value = null;
    selection.value = null;
    try {
      localStorage.removeItem('voxelix.lastProject');
    } catch {
      /* private mode */
    }
    structureVersion.value++;
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

  /**
   * (Re)link `id` as an overlay of `baseId`, keeping the object's own voxel diff
   * — for reconnecting an extend whose base link broke, or re-parenting it. The
   * grids are subdivided to a common detail if needed, and the overlay is
   * auto-rotated when its orientation clearly drifted from the base. Undo
   * history is dropped; a cycle is rejected.
   */
  function setExtendBase(id: string, baseId: string) {
    const proj = project.value;
    if (!proj) return;
    const obj = proj.getById(id);
    const base = proj.getById(baseId);
    if (!obj || !base || obj.id === base.id) return;
    // walk up from the candidate base — if it leads back to `id`, it's a cycle
    let cur: VoxelObject | null = base;
    const seen = new Set<string>();
    while (cur && cur.kind === 'extend' && cur.baseId) {
      if (cur.baseId === id || seen.has(cur.id)) return;
      seen.add(cur.id);
      cur = proj.getById(cur.baseId);
    }

    const { runner } = useSession();
    // bring the base family and the overlay to one cell resolution
    const targetDetail = Math.max(obj.detail, base.detail);
    for (const o of extendFamily(base, proj)) {
      if (o.detail < targetDetail) {
        o.data.upscale(targetDetail / o.detail);
        o.detail = targetDetail;
        runner.value?.forgetHistory(o.id);
      }
    }
    if (obj.detail < targetDetail) obj.data.upscale(targetDetail / obj.detail);

    obj.kind = 'extend';
    obj.baseId = base.id;
    obj.detail = targetDetail;

    const aligned = alignOverlayToBase(obj.data, resolveEffectiveData(base, proj));
    if (aligned) obj.data = aligned;

    runner.value?.forgetHistory(id);
    selection.value = null;
    structureVersion.value++;
    activeVersion.value++;
    editVersion.value++;
  }

  /**
   * Rotate an overlay's own diff 90° about the vertical axis, leaving its base
   * untouched — for nudging a drifted overlay back into line with its base.
   */
  function rotateOverlay(id: string, dir: 1 | -1) {
    const obj = project.value?.getById(id);
    if (!obj) return;
    obj.data.rotateY(dir);
    const { runner } = useSession();
    runner.value?.forgetHistory(id);
    selection.value = null;
    structureVersion.value++;
    activeVersion.value++;
    editVersion.value++;
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

  /**
   * Subdivide an object's grid to CELLS_PER_VOXEL cells per voxel so a fractional
   * brush has somewhere to land. Lossless (VoxelData.upscale keeps the shape),
   * one-way, done automatically the first time a sub-voxel brush is used. Undo
   * history is dropped; an extend overlay redirects to its base.
   */
  function ensureDetail(id: string) {
    const proj = project.value;
    const obj = proj?.getById(id);
    if (!proj || !obj) return;
    const target = obj.kind === 'extend' && obj.baseId ? proj.getById(obj.baseId) : obj;
    if (!target || target.detail >= CELLS_PER_VOXEL) return;

    const factor = CELLS_PER_VOXEL / target.detail;
    const touched = extendFamily(target, proj);
    for (const o of touched) {
      o.data.upscale(factor);
      o.detail = CELLS_PER_VOXEL;
    }
    const { runner } = useSession();
    for (const o of touched) runner.value?.forgetHistory(o.id);

    selection.value = null;
    structureVersion.value++;
    activeVersion.value++;
    editVersion.value++;
  }

  /**
   * Rotate the active object 90° about the vertical axis (`dir === 1` clockwise
   * seen from above). An extend object rotates together with its base and every
   * sibling overlay so the diffs stay aligned. Undo history for the touched
   * objects is dropped — a rotation remaps the whole grid.
   */
  function rotateActive(dir: 1 | -1) {
    const proj = project.value;
    const obj = activeObject();
    if (!proj || !obj) return;
    const base = obj.kind === 'extend' && obj.baseId ? proj.getById(obj.baseId) : obj;
    if (!base) return;
    const touched = extendFamily(base, proj);
    for (const o of touched) o.data.rotateY(dir);
    const { runner } = useSession();
    for (const o of touched) runner.value?.forgetHistory(o.id);
    selection.value = null;
    structureVersion.value++;
    activeVersion.value++;
    editVersion.value++;
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
    exportStatus,
    objects,
    projectName,
    exportSettings,
    activeDetail,
    activeObjectId,
    currentColor,
    toolId,
    boxMode,
    bucketMode,
    rmbErase,
    voxelFraction,
    buildPlane,
    buildOffset,
    selection,
    activeObject,
    setProject,
    newProject,
    closeProject,
    setActive,
    addObject,
    duplicateObject,
    extendObject,
    setExtendBase,
    rotateOverlay,
    removeObject,
    renameObject,
    resizeActive,
    rotateActive,
    ensureDetail,
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
