import { defineStore } from 'pinia';
import { computed, markRaw, ref, shallowRef } from 'vue';
import { Project } from '@/core/project/Project';
import { defaultExportSettings, type ColorAdjust, type ExportSettings } from '@/core/project/types';
import {
  alignOverlayToBase,
  compactOverlay,
  effectiveDetail,
  extendFamily,
  partStacks,
  resolveEffectiveData,
} from '@/core/project/resolve';
import { CELLS_PER_VOXEL } from '@/core/voxel/constants';
import { paletteToLinearArray } from '@/core/palette';
import { useSession } from '@/editor/session';
import type { ToolId } from '@/tools/types';
import type { BuildPlane } from '@/viewport/Picker';
import type { Selection } from '@/core/ops/selection';
import type { VoxelObject } from '@/core/project/VoxelObject';
import { VoxelData } from '@/core/voxel/VoxelData';
import {
  newModifier,
  normalizeModifier,
  rotateModifierY,
  VoxelPart,
  type Modifier,
  type ModifierType,
} from '@/core/project/parts';

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
  /** select tool: see-through viewport + box selection reaches hidden voxels */
  const xray = ref(false);
  /** screenshot mode: helpers hidden, the camera driven by the screenshot panel */
  const screenshotMode = ref(false);
  /** right-click in the viewport erases a voxel instead of opening the context menu */
  const rmbErase = ref(false);
  /** brush size as a fraction of a voxel: 1 = full voxel, 2 = half, 3 = third */
  const voxelFraction = ref(1);
  /**
   * Mirror modelling, indexed by the axis that gets flipped: [0] = the YZ plane
   * (mirrors X), [1] = XZ (mirrors Y), [2] = XY (mirrors Z). Each plane runs
   * through the centre of the active grid; several can be on at once.
   */
  const mirror = ref<[boolean, boolean, boolean]>([false, false, false]);
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
      localStorage.setItem('voxelix.lastWorkspace', 'voxel');
    } catch {
      /* private mode */
    }
  }

  function newProject(name: string) {
    setProject(Project.createNew(name || 'Untitled'));
  }

  /** Back to the start screen. Autosave has the project; nothing is lost. */
  function closeProject() {
    screenshotMode.value = false;
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
    if (!project.value || activeObjectId.value === id || !project.value.getById(id)) return;
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
        for (const p of o.parts) p.data.upscale(targetDetail / o.detail);
        o.detail = targetDetail;
        runner.value?.forgetHistory(o.id);
      }
    }
    // an overlay is a single diff grid — merge any parts / modifiers into it first
    obj.flatten();
    if (obj.detail < targetDetail) obj.data.upscale(targetDetail / obj.detail);

    obj.kind = 'extend';
    obj.baseId = base.id;
    obj.detail = targetDetail;

    // part state only means something for parts and modifiers the new base has
    const stacks = partStacks(base, proj);
    const partIds = new Set(stacks.map((p) => p.id));
    const modIds = new Set(stacks.flatMap((p) => p.modifiers.map((m) => m.id)));
    for (const id of Object.keys(obj.partModifiers)) if (!partIds.has(id)) delete obj.partModifiers[id];
    for (const id of Object.keys(obj.partVisibility)) if (!partIds.has(id)) delete obj.partVisibility[id];
    obj.mutedModifiers = obj.mutedModifiers.filter((id) => modIds.has(id));

    const baseResolved = resolveEffectiveData(base, proj);
    const aligned = alignOverlayToBase(obj.data, baseResolved);
    if (aligned) obj.data = aligned;
    // keep only what actually differs, so the base stays live underneath
    obj.data = compactOverlay(obj.data, baseResolved).data;

    runner.value?.forgetHistory(id);
    selection.value = null;
    structureVersion.value++;
    activeVersion.value++;
    editVersion.value++;
  }

  /**
   * Drop everything an overlay stores that its base already provides, so only
   * the real difference is left. Repairs an overlay that had the base baked
   * into it (a broad fill on an extend used to copy every resolved cell in),
   * which is what makes the base stop showing as dimmed context and stop
   * propagating its own edits. Returns the number of cells dropped.
   */
  function resyncOverlay(id: string): number {
    const proj = project.value;
    const obj = proj?.getById(id);
    if (!proj || !obj || obj.kind !== 'extend' || !obj.baseId) return 0;
    const base = proj.getById(obj.baseId);
    if (!base) return 0;
    const { data, dropped } = compactOverlay(obj.data, resolveEffectiveData(base, proj));
    if (dropped === 0) return 0;
    obj.data = data;
    const { runner } = useSession();
    runner.value?.forgetHistory(id);
    selection.value = null;
    structureVersion.value++;
    activeVersion.value++;
    editVersion.value++;
    return dropped;
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
    const previousActive = activeObjectId.value;
    project.value.remove(id);
    activeObjectId.value = project.value.activeObjectId;
    if (activeObjectId.value !== previousActive) {
      buildOffset.value = 0;
      selection.value = null;
    }
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
    for (const p of o.parts) p.data.resize(size[0], size[1], size[2]);
    selection.value = null;
    activeVersion.value++;
  }

  /** Saturation/brightness shift for one object, applied at mesh/export time —
   *  the palette itself is left untouched, so other objects are unaffected. */
  function setColorAdjust(id: string, adjust: ColorAdjust) {
    const o = project.value?.getById(id);
    if (!o) return;
    o.colorAdjust = adjust.saturation === 0 && adjust.brightness === 0 ? undefined : adjust;
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
      for (const p of o.parts) p.data.upscale(factor);
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
    for (const o of touched) {
      for (const p of o.parts) {
        p.data.rotateY(dir);
        // modifiers turn with the object (axes, directions, offsets)
        for (const m of p.modifiers) rotateModifierY(m, dir);
      }
      for (const mods of Object.values(o.partModifiers)) for (const m of mods) rotateModifierY(m, dir);
    }
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

  // ---- parts (several meshes in one object) --------------------------------

  /** A part change re-renders the object and is worth an autosave. */
  function partsChanged(structural = false) {
    if (structural) structureVersion.value++;
    activeVersion.value++;
    editVersion.value++;
  }

  function uniquePartName(obj: VoxelObject): string {
    const names = new Set(obj.parts.map((p) => p.name));
    for (let i = obj.parts.length + 1; ; i++) if (!names.has(`Part ${i}`)) return `Part ${i}`;
  }

  /** Add an empty part to the active object and make it the one being edited. */
  function addPart() {
    const obj = activeObject();
    if (!obj || obj.kind === 'extend') return;
    const d = obj.data;
    const part = new VoxelPart({ name: uniquePartName(obj), data: new VoxelData(d.sizeX, d.sizeY, d.sizeZ) });
    obj.parts.push(part);
    obj.activePartId = part.id;
    selection.value = null;
    partsChanged(true);
  }

  function setActivePart(partId: string) {
    const obj = activeObject();
    if (!obj || obj.activePartId === partId || !obj.parts.some((p) => p.id === partId)) return;
    obj.activePartId = partId;
    selection.value = null;
    activeVersion.value++;
    structureVersion.value++;
  }

  function renamePart(partId: string, name: string) {
    const part = activeObject()?.parts.find((p) => p.id === partId);
    if (!part || !name.trim()) return;
    part.name = name.trim();
    partsChanged(true);
  }

  /**
   * Show or hide a part — a hidden one is left out of the look and the export.
   * On an extend object this is the overlay's own say over a base part: it
   * overrides what the base shows, and matching the base again drops it.
   */
  function setPartHidden(partId: string, hidden: boolean) {
    const obj = activeObject();
    if (!obj) return;
    const inherited = inheritedStacks(obj);
    if (inherited) {
      const part = inherited.find((p) => p.id === partId);
      if (!part) return;
      if (part.hidden === hidden) delete obj.partVisibility[partId];
      else obj.partVisibility[partId] = !hidden;
      partsChanged(true);
      return;
    }
    const part = obj.parts.find((p) => p.id === partId);
    if (!part || part.hidden === hidden) return;
    part.hidden = hidden;
    partsChanged(true);
  }

  /**
   * For an extend object with a base: the base's parts as they reach it — the
   * modifiers and visibility it inherits, before its own part state. Else null.
   */
  function inheritedStacks(obj: VoxelObject) {
    const proj = project.value;
    const base = proj && obj.kind === 'extend' && obj.baseId ? proj.getById(obj.baseId) : null;
    return proj && base ? partStacks(base, proj) : null;
  }

  /**
   * The editable modifier stack for `partId`: the part's own, or for an extend
   * object the overlay's own additions for that base part (created on demand).
   */
  function editableModifiers(obj: VoxelObject, partId: string): Modifier[] | null {
    const inherited = inheritedStacks(obj);
    if (inherited) {
      if (!inherited.some((p) => p.id === partId)) return null;
      return (obj.partModifiers[partId] ??= []);
    }
    return obj.parts.find((p) => p.id === partId)?.modifiers ?? null;
  }

  /** Switch an inherited modifier off (or back on) in the active extend object only. */
  function setInheritedModifierMuted(modId: string, muted: boolean) {
    const obj = activeObject();
    if (!obj || !inheritedStacks(obj)) return;
    const has = obj.mutedModifiers.includes(modId);
    if (has === muted) return;
    obj.mutedModifiers = muted ? [...obj.mutedModifiers, modId] : obj.mutedModifiers.filter((id) => id !== modId);
    partsChanged();
  }

  function removePart(partId: string) {
    const obj = activeObject();
    if (!obj || obj.parts.length <= 1) return;
    const idx = obj.parts.findIndex((p) => p.id === partId);
    if (idx < 0) return;
    obj.parts.splice(idx, 1);
    if (obj.activePartId === partId) obj.activePartId = obj.parts[Math.max(0, idx - 1)].id;
    useSession().runner.value?.forgetHistory(`${obj.id}/${partId}`);
    selection.value = null;
    partsChanged(true);
  }

  /**
   * Move the selected voxels out of the active part into a new part of their
   * own — the usual first step before giving just that piece a modifier.
   * Undo history of both parts is dropped (the move spans two grids).
   */
  function selectionToNewPart(cells: Array<[number, number, number]>) {
    const obj = activeObject();
    if (!obj || obj.kind === 'extend' || cells.length === 0) return;
    const src = obj.activePart;
    const d = src.data;
    const part = new VoxelPart({ name: uniquePartName(obj), data: new VoxelData(d.sizeX, d.sizeY, d.sizeZ) });
    for (const [x, y, z] of cells) {
      const v = d.get(x, y, z);
      if (v === 0) continue;
      part.data.setRaw(x, y, z, v);
      d.setRaw(x, y, z, 0);
    }
    if (part.data.isEmpty()) return;
    obj.parts.push(part);
    obj.activePartId = part.id;
    const { runner } = useSession();
    runner.value?.forgetHistory(`${obj.id}/${src.id}`);
    selection.value = null;
    partsChanged(true);
  }

  function addModifier(partId: string, type: ModifierType) {
    const obj = activeObject();
    if (!obj || !editableModifiers(obj, partId)) return;
    // smoothing rounds at cell level — on a coarse object there's nothing to
    // round with (for an overlay, its base family gets subdivided)
    if (type === 'smooth') ensureDetail(obj.id);
    editableModifiers(obj, partId)!.push(newModifier(type));
    partsChanged();
  }

  /** Patch a modifier's settings; the result is clamped to sane values. */
  function updateModifier(partId: string, modId: string, patch: Partial<Modifier>) {
    const obj = activeObject();
    const mods = obj && editableModifiers(obj, partId);
    const i = mods?.findIndex((m) => m.id === modId) ?? -1;
    if (!mods || i < 0) return;
    const current = mods[i];
    mods[i] = normalizeModifier({ ...current, ...patch, id: current.id, type: current.type } as Modifier);
    partsChanged();
  }

  /** Reorder the stack — modifiers apply top to bottom, so order changes the result. */
  function moveModifier(partId: string, modId: string, delta: -1 | 1) {
    const obj = activeObject();
    const mods = obj && editableModifiers(obj, partId);
    const i = mods?.findIndex((m) => m.id === modId) ?? -1;
    if (!mods || i < 0 || i + delta < 0 || i + delta >= mods.length) return;
    [mods[i], mods[i + delta]] = [mods[i + delta], mods[i]];
    partsChanged();
  }

  function removeModifier(partId: string, modId: string) {
    const obj = activeObject();
    const mods = obj && editableModifiers(obj, partId);
    const i = mods?.findIndex((m) => m.id === modId) ?? -1;
    if (!obj || !mods || i < 0) return;
    mods.splice(i, 1);
    // an overlay keeps no empty stacks around
    if (mods.length === 0 && obj.partModifiers[partId] === mods) delete obj.partModifiers[partId];
    partsChanged();
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

  function toggleMirror(axis: 0 | 1 | 2) {
    const next = [...mirror.value] as [boolean, boolean, boolean];
    next[axis] = !next[axis];
    mirror.value = next;
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
    xray,
    screenshotMode,
    rmbErase,
    voxelFraction,
    mirror,
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
    resyncOverlay,
    rotateOverlay,
    removeObject,
    renameObject,
    resizeActive,
    setColorAdjust,
    rotateActive,
    ensureDetail,
    bumpEdit,
    addPart,
    setActivePart,
    renamePart,
    removePart,
    setPartHidden,
    setInheritedModifierMuted,
    selectionToNewPart,
    addModifier,
    updateModifier,
    moveModifier,
    removeModifier,
    updateExportSettings,
    setSelection,
    clearSelection,
    toggleMirror,
    setColor,
    setPaletteColor,
    palette,
    paletteLinear,
  };
});

export type EditorStore = ReturnType<typeof useEditorStore>;
