import { defineStore } from 'pinia';
import { computed, markRaw, ref, shallowRef } from 'vue';
import { PixelProject } from '@/core/pixel/PixelProject';
import type { PixelWidget } from '@/core/pixel/PixelWidget';
import { packRgba } from '@/core/pixel/pack';
import { clampContentMargins } from '@/core/pixel/ninepatch';
import { MAX_CANVAS, type ContentMargins, type NinePatch, type StateId, type WidgetType } from '@/core/pixel/types';
import type { BrushShape } from '@/core/pixel/brush';
import type { GradientKind, GradientStyle } from '@/core/pixel/ops/gradient';
import { usePixelSession } from '@/editor/pixel/session';
import type { PixelToolId } from '@/tools/pixel/types';

const OPAQUE_BLACK = packRgba(0, 0, 0, 255);
const OPAQUE_WHITE = packRgba(255, 255, 255, 255);

export const usePixelStore = defineStore('pixel', () => {
  const project = shallowRef<PixelProject | null>(null);

  /** bumps on structural change (widget added / removed / renamed) */
  const structureVersion = ref(0);
  /** bumps when the active widget/state identity changes */
  const activeVersion = ref(0);
  /** bumps after every committed pixel edit / undo / redo (for autosave) */
  const editVersion = ref(0);
  /** bumps whenever the current selection changes — deliberately separate
   *  from editVersion (which drives autosave dirty-tracking): a selection is
   *  ephemeral UI state, not part of the saved project, so it shouldn't mark
   *  the project dirty just because a drag is in progress */
  const selectionVersion = ref(0);
  function bumpSelection() {
    selectionVersion.value++;
  }
  /** bumps when the active state's layer stack changes shape (add / remove / reorder / properties / active layer) */
  const layersVersion = ref(0);
  function bumpLayers() {
    layersVersion.value++;
  }

  const autosaveBusy = ref(false);
  const autosaveAt = ref<number | null>(null);
  const autosaveError = ref(false);

  /** non-null while an export is running — shown as a blocking overlay */
  const exportStatus = ref<string | null>(null);

  const activeWidgetId = ref<string | null>(null);
  /** which part of the active widget is on the canvas (box, fill, grabber, …) */
  const activeElementId = ref<string>('box');
  const activeStateId = ref<StateId>('normal');
  const toolId = ref<PixelToolId>('pencil');
  const brushSize = ref(1);
  const brushShape = ref<BrushShape>('square');
  const contiguous = ref(true);
  /** bucket / wand colour tolerance, 0..255 per channel */
  const tolerance = ref(0);
  const gradientKind = ref<GradientKind>('linear');
  const gradientStyle = ref<GradientStyle>('smooth');
  /** paint into the active layer's mask instead of its pixels */
  const editMask = ref(false);
  /** show the active layer's mask (grayscale) on the canvas instead of the image */
  const viewMask = ref(false);
  const zoom = ref(12);
  const showGrid = ref(true);
  const primaryColor = ref(OPAQUE_BLACK);
  const secondaryColor = ref(OPAQUE_WHITE);

  const widgets = computed(() => {
    void structureVersion.value;
    return (
      project.value?.widgets.map((w) => ({ id: w.id, name: w.name, type: w.type })) ?? []
    );
  });

  const projectName = computed(() => {
    void structureVersion.value;
    return project.value?.name ?? '';
  });

  function activeWidget() {
    return project.value?.widgets.find((w) => w.id === activeWidgetId.value) ?? null;
  }

  function activeElement() {
    return activeWidget()?.element(activeElementId.value) ?? null;
  }

  /** Point the canvas at a widget's first element and that element's base state. */
  function resetElementFor(widget: PixelWidget | null) {
    const elementId = widget?.firstElementId() ?? 'box';
    activeElementId.value = elementId;
    activeStateId.value = widget?.element(elementId)?.states.keys().next().value ?? 'normal';
  }

  function setProject(p: PixelProject) {
    project.value = markRaw(p);
    activeWidgetId.value = p.activeWidgetId ?? p.widgets[0]?.id ?? null;
    resetElementFor(activeWidget());
    autosaveAt.value = null;
    autosaveError.value = false;
    structureVersion.value++;
    activeVersion.value++;
    try {
      localStorage.setItem('voxelix.lastPixelProject', p.id);
      localStorage.setItem('voxelix.lastWorkspace', 'pixel');
    } catch {
      /* private mode */
    }
  }

  function newProject(name: string, widgetType: WidgetType) {
    setProject(PixelProject.createNew(name || 'Untitled UI', widgetType));
  }

  /** Back to the start screen. Autosave has the project; nothing is lost. */
  function closeProject() {
    project.value = null;
    activeWidgetId.value = null;
    try {
      localStorage.removeItem('voxelix.lastPixelProject');
    } catch {
      /* private mode */
    }
    structureVersion.value++;
  }

  function setActiveWidget(id: string) {
    if (!project.value || activeWidgetId.value === id || !project.value.getById(id)) return;
    activeWidgetId.value = id;
    project.value.activeWidgetId = id;
    resetElementFor(activeWidget());
    activeVersion.value++;
  }

  function setActiveElement(id: string) {
    const el = activeWidget()?.element(id);
    if (!el || activeElementId.value === id) return;
    activeElementId.value = id;
    activeStateId.value = el.states.keys().next().value ?? 'normal';
    activeVersion.value++;
  }

  function setActiveState(id: StateId) {
    if (activeStateId.value === id) return;
    activeStateId.value = id;
    activeVersion.value++;
  }

  /** The layer stack on the canvas right now. */
  function activeStack() {
    return activeElement()?.states.get(activeStateId.value) ?? null;
  }

  function addWidget(type: WidgetType) {
    if (!project.value) return;
    const w = project.value.addWidget(type);
    structureVersion.value++;
    setActiveWidget(w.id);
  }

  function removeWidget(id: string) {
    if (!project.value) return;
    // forget the undo history before removing — it needs the widget's state
    // list, which is gone once the widget is
    usePixelSession().runner.value?.forgetHistory(id);
    project.value.remove(id);
    structureVersion.value++;
    activeWidgetId.value = project.value.activeWidgetId;
    resetElementFor(activeWidget());
    activeVersion.value++;
  }

  function renameWidget(id: string, name: string) {
    if (!project.value) return;
    project.value.rename(id, name);
    structureVersion.value++;
  }

  function setPatch(patch: NinePatch) {
    const w = activeElement();
    if (!w) return;
    w.patch = patch;
    structureVersion.value++;
    editVersion.value++;
  }

  function setContentMargins(contentMargins: ContentMargins) {
    const w = activeElement();
    if (!w) return;
    w.contentMargins = clampContentMargins(contentMargins);
    structureVersion.value++;
    editVersion.value++;
  }

  /**
   * Resizes the active element's canvases (every state of it — they share a
   * size; the widget's other elements keep theirs). A structural change, not a paint
   * edit, so — same as the voxel editor's resizeActive — it isn't undoable;
   * the undo history is dropped rather than left pointing at indices that no
   * longer mean the same pixel once the width has changed.
   */
  function resizeActiveElement(width: number, height: number, anchor: 'topleft' | 'center' = 'topleft') {
    const w = activeWidget();
    const el = activeElement();
    if (!w || !el) return;
    const runner = usePixelSession().runner.value;
    runner?.forgetHistory(w.id, el.id);
    el.resize(Math.min(MAX_CANVAS, width), Math.min(MAX_CANVAS, height), anchor);
    // element.resize() replaces each state's PixelData instance rather than
    // mutating it in place — the runner (and its renderer) would otherwise
    // keep drawing into the now-orphaned old one, since nothing else about
    // the active widget/state identity changed to trigger a re-sync
    runner?.syncActive();
    structureVersion.value++;
    layersVersion.value++;
    editVersion.value++;
  }

  /** Replaces the project's swatch shelf — e.g. importing a voxel project's palette
   *  so pixel and voxel work stay colour-consistent. The palette is a shared
   *  format (see core/palette.ts); this is the one deliberate bridge between
   *  the two otherwise-independent workspaces. */
  function importPalette(palette: string[]) {
    if (!project.value) return;
    project.value.palette = palette;
    structureVersion.value++;
  }

  function setPrimary(rgba: number) {
    primaryColor.value = rgba >>> 0;
  }
  function setSecondary(rgba: number) {
    secondaryColor.value = rgba >>> 0;
  }

  function bumpEdit() {
    editVersion.value++;
  }

  return {
    project,
    structureVersion,
    activeVersion,
    editVersion,
    selectionVersion,
    layersVersion,
    autosaveBusy,
    autosaveAt,
    autosaveError,
    exportStatus,
    activeWidgetId,
    activeElementId,
    activeStateId,
    toolId,
    brushSize,
    brushShape,
    contiguous,
    tolerance,
    gradientKind,
    gradientStyle,
    editMask,
    viewMask,
    zoom,
    showGrid,
    primaryColor,
    secondaryColor,
    widgets,
    projectName,
    activeWidget,
    activeElement,
    activeStack,
    setProject,
    newProject,
    closeProject,
    setActiveWidget,
    setActiveElement,
    setActiveState,
    addWidget,
    removeWidget,
    renameWidget,
    setPatch,
    setContentMargins,
    resizeActiveElement,
    importPalette,
    setPrimary,
    setSecondary,
    bumpEdit,
    bumpSelection,
    bumpLayers,
  };
});

export type PixelStore = ReturnType<typeof usePixelStore>;
