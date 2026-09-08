<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { Viewport } from '@/viewport/Viewport';
import { ToolRunner } from '@/editor/ToolRunner';
import { setSession } from '@/editor/session';
import { useEditorStore } from '@/stores/editor';
import { buildActiveRender } from '@/core/project/resolve';
import { floodRegion } from '@/core/ops/flood';
import { deleteSelection, moveSelection } from '@/editor/selectionOps';
import { useTheme } from '@/editor/theme';
import { loadCameraState, makeCameraSaver } from '@/editor/viewstate';
import ContextMenu, { type MenuItem } from './ContextMenu.vue';
import { toast } from '@/editor/toasts';
import SelectionPanel from './SelectionPanel.vue';
import type { ToolId } from '@/tools/types';
import type { PresetView, ProjectionMode } from '@/viewport/GodotControls';

const store = useEditorStore();
const { resolved: theme } = useTheme();
const canvas = ref<HTMLCanvasElement | null>(null);
let viewport: Viewport | null = null;
let runner: ToolRunner | null = null;
let ro: ResizeObserver | null = null;
let camSaver: ReturnType<typeof makeCameraSaver> | null = null;

function persistCamera() {
  if (viewport && camSaver) camSaver.flush(viewport.controls.snapshot());
}

const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);
const projection = ref<ProjectionMode>('perspective');

const brushLabel = computed(() => {
  const f = Math.min(store.activeDetail, store.voxelFraction);
  return f <= 1 ? 'brush: full voxel' : `brush: 1/${f} voxel`;
});

const presetViews: Array<{ id: PresetView; label: string; badge: string; hint: string }> = [
  { id: 'front', label: 'Front', badge: 'Num 1', hint: 'Numpad 1' },
  { id: 'back', label: 'Back', badge: '⇧1', hint: 'Shift + Numpad 1' },
  { id: 'right', label: 'Right', badge: 'Num 3', hint: 'Numpad 3' },
  { id: 'left', label: 'Left', badge: '⇧3', hint: 'Shift + Numpad 3' },
  { id: 'top', label: 'Top', badge: 'Num 7', hint: 'Numpad 7' },
  { id: 'bottom', label: 'Bottom', badge: '⇧7', hint: 'Shift + Numpad 7' },
  { id: 'iso', label: 'Iso', badge: '', hint: 'Isometric view' },
];

function setProjection(mode: ProjectionMode) {
  projection.value = mode;
  viewport?.setProjection(mode);
}
function setView(view: PresetView) {
  setProjection('ortho');
  viewport?.setView(view);
}

// digits + a left-hand letter cluster (Q W E R T G, V for select)
const toolKeys: Record<string, ToolId> = {
  Digit1: 'place',
  Digit2: 'erase',
  Digit3: 'box',
  Digit4: 'paint',
  Digit5: 'bucket',
  Digit6: 'eyedropper',
  Digit7: 'select',
  KeyW: 'place',
  KeyE: 'erase',
  KeyR: 'box',
  KeyT: 'paint',
  KeyG: 'bucket',
  KeyQ: 'eyedropper',
  KeyV: 'select',
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
          color: 0x28e0ff,
        }
      : null,
  );
}

/** Ctrl+A: switch to the select tool and select the active object's filled bounds. */
function selectAll() {
  if (!runner) return;
  const b = runner.data.filledBounds();
  if (!b) return;
  store.toolId = 'select';
  store.setSelection({
    min: [b.min.x, b.min.y, b.min.z],
    max: [b.max.x - 1, b.max.y - 1, b.max.z - 1],
  });
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
  viewport.controls.onContextClick = (x, y) => {
    if (store.rmbErase) rmbEraseAt(x, y);
    else openContextMenu(x, y);
  };

  viewport.setPalette(store.paletteLinear());
  viewport.setDark(theme.value === 'dark');
  loadActive();

  const pid = store.project?.id;
  const cam = pid ? loadCameraState(pid) : null;
  if (cam) {
    viewport.controls.restore(cam);
    projection.value = cam.mode;
  } else {
    viewport.frameActive();
  }
  if (pid) {
    camSaver = makeCameraSaver(pid);
    viewport.controls.onChange = () => camSaver?.save(viewport!.controls.snapshot());
  }
  window.addEventListener('beforeunload', persistCamera);

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
  persistCamera();
  window.removeEventListener('beforeunload', persistCamera);
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
  camSaver = null;
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

  // Use e.key (layout-aware) for the letter shortcuts: on a QWERTZ keyboard the
  // physical Z key reports e.code === 'KeyY', which would swap undo and redo.
  if (e.ctrlKey || e.metaKey) {
    const key = e.key.toLowerCase();
    if (key === 'z') {
      e.preventDefault();
      if (e.shiftKey) runner?.redo();
      else runner?.undo();
      return;
    }
    if (key === 'y') {
      e.preventDefault();
      runner?.redo();
      return;
    }
    if (key === 'a') {
      e.preventDefault();
      selectAll();
      return;
    }
  }
  if (e.code === 'KeyF') {
    viewport?.frameActive();
    return;
  }
  if (e.code === 'Numpad5') {
    setProjection(projection.value === 'ortho' ? 'perspective' : 'ortho');
    return;
  }
  if (e.code === 'Numpad1') return setView(e.shiftKey ? 'back' : 'front');
  if (e.code === 'Numpad3') return setView(e.shiftKey ? 'left' : 'right');
  if (e.code === 'Numpad7') return setView(e.shiftKey ? 'bottom' : 'top');

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

  if (toolKeys[e.code] && !viewport?.controls.navigating) store.toolId = toolKeys[e.code];
}

/** The block the current brush covers at `v`, snapped to the brush grid. Every
 *  single-voxel action goes through this so it matches the brush the toolbar
 *  shows, instead of silently acting on one grid cell. */
function brushCellsAt(v: { x: number; y: number; z: number }): Array<[number, number, number]> {
  const b = Math.max(1, runner?.brushSize ?? 1);
  const ox = Math.floor(v.x / b) * b;
  const oy = Math.floor(v.y / b) * b;
  const oz = Math.floor(v.z / b) * b;
  const cells: Array<[number, number, number]> = [];
  for (let dz = 0; dz < b; dz++)
    for (let dy = 0; dy < b; dy++)
      for (let dx = 0; dx < b; dx++) cells.push([ox + dx, oy + dy, oz + dz]);
  return cells;
}

/** Right-click erase (toggle in the toolbar): clear the block under the cursor,
 *  matching the current brush size. */
function rmbEraseAt(x: number, y: number) {
  if (!runner) return;
  const hit = runner.pick(x, y);
  if (!hit?.remove) return;
  eraseCells(brushCellsAt(hit.remove), 'Erase');
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
      {
        label: `Erase here (${brushLabel.value.replace('brush: ', '')})`,
        action: () => eraseCells(brushCellsAt(v), 'Erase voxel'),
      },
      {
        label: 'Erase connected (same colour)',
        action: () => eraseCells(floodRegion(runner!.data, v.x, v.y, v.z, true), 'Erase region'),
      },
      {
        label: 'Fill connected with current colour',
        action: () =>
          fillCells(floodRegion(runner!.data, v.x, v.y, v.z, true), store.currentColor, 'Fill region'),
      },
    );
    if (store.activeObject()?.kind === 'extend') {
      items.push(
        {
          label: `Give back to base (${brushLabel.value.replace('brush: ', '')})`,
          action: () => runner!.revertToBase(brushCellsAt(v), 'Revert voxel to base'),
        },
        {
          label: 'Give connected region back to base',
          action: () =>
            runner!.revertToBase(
              floodRegion(runner!.data, v.x, v.y, v.z, true),
              'Revert region to base',
            ),
        },
      );
    }
    items.push({ separator: true });
  }

  items.push({ label: 'Frame view (F)', action: () => viewport?.frameActive() });

  const id = store.activeObjectId;
  if (id) {
    items.push(
      { separator: true },
      { label: 'Rotate object 90° ⟲', action: () => store.rotateActive(-1) },
      { label: 'Rotate object 90° ⟳', action: () => store.rotateActive(1) },
      { separator: true },
      { label: 'Duplicate object', action: () => store.duplicateObject(id) },
      { label: 'Extend object', action: () => store.extendObject(id) },
    );
    if (store.activeObject()?.kind === 'extend') {
      items.push(
        {
          label: 'Re-sync overlay with base',
          action: () => {
            const dropped = store.resyncOverlay(id);
            toast(
              dropped > 0
                ? `Gave ${dropped.toLocaleString()} cells back to the base`
                : 'Overlay was already in sync — nothing to drop',
            );
          },
        },
        {
          label: 'Reset extend to base',
          danger: true,
          action: () => runner?.resetOverlay(),
        },
      );
    }
    items.push({ label: 'Delete object', danger: true, action: () => store.removeObject(id) });
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
// increasing detail upscales the grid — the object grows in cell space, refit it
watch(
  () => store.activeDetail,
  () => viewport?.frameActive(),
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
watch(theme, (t) => viewport?.setDark(t === 'dark'));
</script>

<template>
  <div class="viewport-wrap">
    <canvas ref="canvas" class="viewport-canvas" />

    <div class="view-controls panel">
      <div class="seg">
        <button
          :class="{ active: projection === 'perspective' }"
          title="Perspective camera — toggle with Numpad 5"
          @click="setProjection('perspective')"
        >
          Persp
        </button>
        <button
          :class="{ active: projection === 'ortho' }"
          title="Orthographic camera — toggle with Numpad 5"
          @click="setProjection('ortho')"
        >
          Ortho
        </button>
      </div>
      <div class="views">
        <button
          v-for="v in presetViews"
          :key="v.id"
          :title="`${v.label} view — ${v.hint}`"
          @click="setView(v.id)"
        >
          <span>{{ v.label }}</span>
          <span v-if="v.badge" class="kbd">{{ v.badge }}</span>
        </button>
      </div>
    </div>

    <SelectionPanel v-if="store.toolId === 'select' && store.selection" />

    <div class="hud">
      {{ store.buildPlane.toUpperCase() }} plane @ {{ store.buildOffset }}
      <template v-if="store.activeDetail > 1">&nbsp;·&nbsp; {{ brushLabel }}</template>
      &nbsp;·&nbsp;
      <template v-if="store.toolId === 'select'">
        double-click = same-colour region · drag = box · drag inside = move · arrows nudge · Shift+↕ = Y · Ctrl+A = all
      </template>
      <template v-else>
        Q/W/E/R/T/G = tools · MMB orbit · Shift+MMB pan · RMB+WASD fly · Shift draw = straight line ·
        {{ store.rmbErase ? 'RMB erase' : 'RMB menu' }} · F frame
      </template>
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
  padding: 5px 9px;
  font: 11px/1.4 system-ui, sans-serif;
  color: var(--ink-dim);
  background: var(--surface-1);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
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
.view-controls .views button {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 5px;
}
.view-controls .views button:last-child {
  grid-column: 1 / -1;
  justify-content: center;
}
.kbd {
  font-size: 9px;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}
.view-controls .views button.active .kbd {
  color: var(--accent-ink);
  opacity: 0.7;
}
</style>
