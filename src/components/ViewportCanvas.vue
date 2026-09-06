<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { Viewport } from '@/viewport/Viewport';
import { ToolRunner } from '@/editor/ToolRunner';
import { setSession } from '@/editor/session';
import { useEditorStore } from '@/stores/editor';
import { buildActiveRender } from '@/core/project/resolve';
import { floodRegion } from '@/core/ops/flood';
import { deleteSelection, moveSelection } from '@/editor/selectionOps';
import ContextMenu, { type MenuItem } from './ContextMenu.vue';
import SelectionPanel from './SelectionPanel.vue';
import type { ToolId } from '@/tools/types';
import type { PresetView, ProjectionMode } from '@/viewport/GodotControls';

const store = useEditorStore();
const canvas = ref<HTMLCanvasElement | null>(null);
let viewport: Viewport | null = null;
let runner: ToolRunner | null = null;
let ro: ResizeObserver | null = null;

const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);
const projection = ref<ProjectionMode>('perspective');

const presetViews: Array<{ id: PresetView; label: string; hint: string }> = [
  { id: 'front', label: 'Front', hint: 'Numpad 1' },
  { id: 'back', label: 'Back', hint: 'Ctrl+Numpad 1' },
  { id: 'right', label: 'Right', hint: 'Numpad 3' },
  { id: 'left', label: 'Left', hint: 'Ctrl+Numpad 3' },
  { id: 'top', label: 'Top', hint: 'Numpad 7' },
  { id: 'bottom', label: 'Bottom', hint: 'Ctrl+Numpad 7' },
  { id: 'iso', label: 'Iso', hint: 'isometric' },
];

function setProjection(mode: ProjectionMode) {
  projection.value = mode;
  viewport?.setProjection(mode);
}
function setView(view: PresetView) {
  setProjection('ortho');
  viewport?.setView(view);
}

const toolKeys: Record<string, ToolId> = {
  Digit1: 'place',
  Digit2: 'erase',
  Digit3: 'box',
  Digit4: 'paint',
  Digit5: 'eyedropper',
  Digit6: 'select',
};

const nudgeKeys: Record<string, [number, number, number]> = {
  ArrowLeft: [-1, 0, 0],
  ArrowRight: [1, 0, 0],
  ArrowUp: [0, 0, -1],
  ArrowDown: [0, 0, 1],
};

function syncSelectionGizmo() {
  const sel = store.toolId === 'select' ? store.selection : null;
  viewport?.setSelectionBox(
    sel
      ? {
          min: new THREE.Vector3(...sel.min),
          max: new THREE.Vector3(sel.max[0] + 1, sel.max[1] + 1, sel.max[2] + 1),
          color: 0x7cff9b,
        }
      : null,
  );
}

function loadActive() {
  const obj = store.activeObject();
  const project = store.project;
  if (!viewport || !runner || !obj || !project) return;
  runner.syncActive();
  viewport.setActiveRender(buildActiveRender(obj, project));
}

onMounted(() => {
  const c = canvas.value!;
  viewport = new Viewport(c);
  runner = new ToolRunner(viewport, store);
  setSession(viewport, runner);
  viewport.controls.onContextClick = openContextMenu;

  viewport.setPalette(store.paletteLinear());
  loadActive();
  viewport.frameActive();
  syncSelectionGizmo();

  ro = new ResizeObserver(() => viewport?.resize());
  ro.observe(c);

  c.addEventListener('pointerdown', onDown);
  c.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  c.addEventListener('pointerleave', onLeave);
  window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  const c = canvas.value;
  c?.removeEventListener('pointerdown', onDown);
  c?.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  c?.removeEventListener('pointerleave', onLeave);
  window.removeEventListener('keydown', onKey);
  ro?.disconnect();
  setSession(null, null);
  viewport?.dispose();
  viewport = null;
  runner = null;
});

function onDown(e: PointerEvent) {
  menu.value = null;
  runner?.pointerDown(e);
}
function onMove(e: PointerEvent) {
  runner?.pointerMove(e);
}
function onUp(e: PointerEvent) {
  runner?.pointerUp(e);
}
function onLeave() {
  runner?.pointerLeave();
}

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    if (e.shiftKey) runner?.redo();
    else runner?.undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
    e.preventDefault();
    runner?.redo();
    return;
  }
  if (e.code === 'KeyF') {
    viewport?.frameActive();
    return;
  }
  if (e.code === 'Numpad5') {
    setProjection(projection.value === 'ortho' ? 'perspective' : 'ortho');
    return;
  }
  if (e.code === 'Numpad1') return setView(e.ctrlKey || e.metaKey ? 'back' : 'front');
  if (e.code === 'Numpad3') return setView(e.ctrlKey || e.metaKey ? 'left' : 'right');
  if (e.code === 'Numpad7') return setView(e.ctrlKey || e.metaKey ? 'bottom' : 'top');

  if (store.toolId === 'select' && store.selection && runner) {
    const sel = store.selection;
    if (e.code === 'Escape') {
      store.clearSelection();
      return;
    }
    if (e.code === 'Delete' || e.code === 'Backspace') {
      e.preventDefault();
      deleteSelection(runner, sel);
      return;
    }
    if (e.shiftKey && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
      e.preventDefault();
      moveSelection(runner, sel, [0, e.code === 'ArrowUp' ? 1 : -1, 0]);
      return;
    }
    if (nudgeKeys[e.code]) {
      e.preventDefault();
      moveSelection(runner, sel, nudgeKeys[e.code]);
      return;
    }
  }

  if (toolKeys[e.code]) store.toolId = toolKeys[e.code];
}

function openContextMenu(x: number, y: number) {
  if (!runner) return;
  const hit = runner.pick(x, y);
  const items: MenuItem[] = [];

  if (hit?.remove) {
    const v = { ...hit.remove };
    const colour = runner.data.getColor(v.x, v.y, v.z);
    items.push(
      { label: 'Pick colour', action: () => colour >= 0 && store.setColor(colour) },
      { label: 'Erase voxel', action: () => eraseCells([[v.x, v.y, v.z]], 'Erase voxel') },
      {
        label: 'Erase connected (same colour)',
        action: () => eraseCells(floodRegion(runner!.data, v.x, v.y, v.z, true), 'Erase region'),
      },
      {
        label: 'Fill connected with current colour',
        action: () =>
          fillCells(floodRegion(runner!.data, v.x, v.y, v.z, true), store.currentColor, 'Fill region'),
      },
      { separator: true },
    );
  }

  items.push({ label: 'Frame view (F)', action: () => viewport?.frameActive() });

  const id = store.activeObjectId;
  if (id) {
    items.push(
      { separator: true },
      { label: 'Duplicate object', action: () => store.duplicateObject(id) },
      { label: 'Extend object', action: () => store.extendObject(id) },
      { label: 'Delete object', danger: true, action: () => store.removeObject(id) },
    );
  }
  menu.value = { x, y, items };
}

function eraseCells(cells: Array<[number, number, number]>, label: string) {
  if (!runner || cells.length === 0) return;
  runner.runExternal(label, (write) => {
    for (const [x, y, z] of cells) write(x, y, z, 0);
  });
}

function fillCells(cells: Array<[number, number, number]>, colour: number, label: string) {
  if (!runner || cells.length === 0) return;
  runner.runExternal(label, (write) => {
    for (const [x, y, z] of cells) write(x, y, z, colour + 1);
  });
}

watch(
  () => [store.activeVersion, store.structureVersion],
  () => loadActive(),
);
watch(
  () => store.paletteVersion,
  () => viewport?.setPalette(store.paletteLinear()),
);
watch(
  () => store.toolId,
  (id) => {
    runner?.setTool(id);
    syncSelectionGizmo();
  },
);
watch(
  () => store.boxMode,
  () => runner?.syncBoxMode(),
);
watch(() => store.selection, syncSelectionGizmo, { deep: true });
</script>

<template>
  <div class="viewport-wrap">
    <canvas ref="canvas" class="viewport-canvas" />

    <div class="view-controls panel">
      <div class="seg">
        <button
          :class="{ active: projection === 'perspective' }"
          title="Perspective (Numpad 5)"
          @click="setProjection('perspective')"
        >
          Persp
        </button>
        <button
          :class="{ active: projection === 'ortho' }"
          title="Orthographic (Numpad 5)"
          @click="setProjection('ortho')"
        >
          Ortho
        </button>
      </div>
      <div class="views">
        <button
          v-for="v in presetViews"
          :key="v.id"
          :title="`${v.label} view (${v.hint})`"
          @click="setView(v.id)"
        >
          {{ v.label }}
        </button>
      </div>
    </div>

    <SelectionPanel v-if="store.toolId === 'select' && store.selection" />

    <div class="hud">
      {{ store.buildPlane.toUpperCase() }} plane @ {{ store.buildOffset }} &nbsp;·&nbsp;
      <template v-if="store.toolId === 'select'">
        drag = box-select · drag inside = move · arrows nudge · Shift+↕ = Y
      </template>
      <template v-else>MMB orbit · Shift+MMB pan · RMB+WASD fly · Shift draw = straight line · F frame</template>
    </div>
    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menu.items"
      @close="menu = null"
    />
  </div>
</template>


<style scoped>
.viewport-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.viewport-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}
.hud {
  position: absolute;
  left: 10px;
  bottom: 10px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-dim);
  background: rgba(0, 0, 0, 0.35);
  border-radius: 4px;
  pointer-events: none;
}
.view-controls {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: rgba(20, 22, 29, 0.82);
}
.view-controls button {
  padding: 3px 7px;
  font-size: 11px;
}
.view-controls .seg {
  display: flex;
  gap: 3px;
}
.view-controls .seg button {
  flex: 1;
}
.view-controls .views {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 3px;
}
.view-controls .views button:last-child {
  grid-column: 1 / -1;
}
</style>
