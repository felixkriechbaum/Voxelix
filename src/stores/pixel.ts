import { defineStore } from 'pinia';
import { computed, markRaw, ref, shallowRef } from 'vue';
import { PixelProject } from '@/core/pixel/PixelProject';
import { packRgba } from '@/core/pixel/pack';
import type { NinePatch, StateId, WidgetType } from '@/core/pixel/types';
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

  const autosaveBusy = ref(false);
  const autosaveAt = ref<number | null>(null);
  const autosaveError = ref(false);

  /** non-null while an export is running — shown as a blocking overlay */
  const exportStatus = ref<string | null>(null);

  const activeWidgetId = ref<string | null>(null);
  const activeStateId = ref<StateId>('normal');
  const toolId = ref<PixelToolId>('pencil');
  const brushSize = ref(1);
  const contiguous = ref(true);
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

  function setProject(p: PixelProject) {
    project.value = markRaw(p);
    activeWidgetId.value = p.activeWidgetId ?? p.widgets[0]?.id ?? null;
    activeStateId.value = 'normal';
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
    activeStateId.value = 'normal';
    activeVersion.value++;
  }

  function setActiveState(id: StateId) {
    if (activeStateId.value === id) return;
    activeStateId.value = id;
    activeVersion.value++;
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
    activeVersion.value++;
  }

  function renameWidget(id: string, name: string) {
    if (!project.value) return;
    project.value.rename(id, name);
    structureVersion.value++;
  }

  function setPatch(patch: NinePatch) {
    const w = activeWidget();
    if (!w) return;
    w.patch = patch;
    structureVersion.value++;
    editVersion.value++;
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
    autosaveBusy,
    autosaveAt,
    autosaveError,
    exportStatus,
    activeWidgetId,
    activeStateId,
    toolId,
    brushSize,
    contiguous,
    zoom,
    showGrid,
    primaryColor,
    secondaryColor,
    widgets,
    projectName,
    activeWidget,
    setProject,
    newProject,
    closeProject,
    setActiveWidget,
    setActiveState,
    addWidget,
    removeWidget,
    renameWidget,
    setPatch,
    setPrimary,
    setSecondary,
    bumpEdit,
  };
});

export type PixelStore = ReturnType<typeof usePixelStore>;
