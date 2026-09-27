<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { Viewport } from '@/viewport/Viewport';
import { ToolRunner } from '@/editor/ToolRunner';
import { setSession } from '@/editor/session';
import { useEditorStore } from '@/stores/editor';
import { buildActiveRender, resolveEffectiveData } from '@/core/project/resolve';
import { floodRegion } from '@/core/ops/flood';
import { deleteSelection, moveSelection } from '@/editor/selectionOps';
import { useTheme } from '@/editor/theme';
import { loadCameraState, makeCameraSaver } from '@/editor/viewstate';
import ContextMenu, { type MenuItem } from './ContextMenu.vue';
import { toast } from '@/editor/toasts';
import SelectionPanel from './SelectionPanel.vue';
import ToolOptions from './ToolOptions.vue';
import ScreenshotPanel from './ScreenshotPanel.vue';
import type { CameraState } from '@/viewport/GodotControls';
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
const buildOffsetLabel = computed(() => {
  const voxels = store.buildOffset / store.activeDetail;
  return Number.isInteger(voxels) ? String(voxels) : voxels.toFixed(2).replace(/0+$/, '');
});

/** Preset views, laid out as opposite pairs: [view, its Shift-opposite]. */
const presetViews: Array<{ id: PresetView; label: string; hint: string }> = [
  { id: 'front', label: 'Front', hint: 'Numpad 1' },
  { id: 'back', label: 'Back', hint: 'Shift + Numpad 1' },
  { id: 'right', label: 'Right', hint: 'Numpad 3' },
  { id: 'left', label: 'Left', hint: 'Shift + Numpad 3' },
  { id: 'top', label: 'Top', hint: 'Numpad 7' },
  { id: 'bottom', label: 'Bottom', hint: 'Shift + Numpad 7' },
];

/** What the mouse and keys do with the current tool — a short line of key hints. */
const toolHints = computed<Array<{ keys: string[]; text: string }>>(() => {
  const rmb = { keys: ['Right-click'], text: store.rmbErase ? 'erase' : 'menu' };
  switch (store.toolId) {
    case 'place':
      return [{ keys: ['Click'], text: 'place' }, { keys: ['Shift'], text: 'straight line' }, rmb];
    case 'erase':
      return [{ keys: ['Click'], text: 'erase' }, { keys: ['Shift'], text: 'straight line' }, rmb];
    case 'box':
      return [{ keys: ['Drag'], text: store.boxMode === 'fill' ? 'fill a box' : 'clear a box' }, rmb];
    case 'paint':
      return [{ keys: ['Click'], text: 'recolour' }, { keys: ['Shift'], text: 'straight line' }, rmb];
    case 'bucket':
      return [{ keys: ['Click'], text: 'fill' }, { keys: ['Shift'], text: 'ignore connectivity' }, rmb];
    case 'eyedropper':
      return [{ keys: ['Click'], text: 'take that colour' }, rmb];
    case 'select':
      return [
        { keys: ['Drag'], text: 'select' },
        { keys: ['Double-click'], text: 'same-colour region' },
        { keys: ['←', '→', '↑', '↓'], text: 'nudge' },
        { keys: ['Ctrl', 'A'], text: 'all' },
      ];
  }
  return [];
});

/** Nothing in the active object yet — the viewport says how to start. */
const isEmpty = ref(false);
function syncEmpty() {
  isEmpty.value = !!runner && !runner.data.filledBounds();
}

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
    sel?.cells,
  );
}

/** X-ray only shows while the select tool is active — it's a selection aid. */
function syncXray() {
  viewport?.setXray(store.xray && store.toolId === 'select');
}

/** Mirror planes only show while a tool that mirrors is active. */
function syncMirror() {
  const mirrors = ['place', 'erase', 'box', 'paint', 'bucket'].includes(store.toolId);
  viewport?.setMirror(mirrors ? store.mirror : [false, false, false]);
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

/** id of the object the viewport last loaded, to spot an actual switch */
let loadedId: string | null = null;

function loadActive() {
  const obj = store.activeObject();
  const project = store.project;
  if (!viewport || !runner || !obj || !project) return;
  runner.syncActive();
  const render = buildActiveRender(obj, project);
  viewport.setActiveRender(
    store.screenshotMode
      ? // a screenshot shows the finished object: an overlay merged with its base, nothing dimmed
        { ...render, editableData: resolveEffectiveData(obj, project), baseContext: null }
      : render,
  );

  const switched = obj.id !== loadedId;
  loadedId = obj.id;
  // Nothing is drawn for a brand-new (or emptied) object, and the camera is
  // still framed on whatever was open before. Its grid would sit off to the
  // side, so every click falls outside the pick window and silently does
  // nothing — refit so the new object is actually reachable.
  const nothingToSee =
    render.editableData.isEmpty() && (!render.baseContext || render.baseContext.isEmpty());
  if (switched && nothingToSee) viewport.frameActive();
  syncEmpty();
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
    viewport.controls.onChange = () => {
      if (!store.screenshotMode) camSaver?.save(viewport!.controls.snapshot());
    };
  }
  window.addEventListener('beforeunload', persistCamera);

  syncSelectionGizmo();
  syncXray();
  syncMirror();
  viewport.setBuildPlane(store.buildPlane);

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
  if (store.screenshotMode) return;
  runner?.pointerDown(e);
}
function onMove(e: PointerEvent) {
  if (store.screenshotMode) return;
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
  if (
    menu.value ||
    document.querySelector('[aria-modal="true"]') ||
    (t && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName) || t.isContentEditable)) ||
    store.screenshotMode
  ) return;

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
    return;
  }
  if (e.altKey) {
    // Alt+Z: X-ray, as in Blender (select tool)
    if (e.key.toLowerCase() === 'z' && store.toolId === 'select') {
      e.preventDefault();
      store.xray = !store.xray;
    }
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
  // RMB erase stands in for the erase tool, so it follows the mirror planes too
  eraseCells(brushCellsAt(hit.remove), 'Erase', true);
}

function openContextMenu(x: number, y: number) {
  if (!runner) return;
  const hit = runner.pick(x, y);
  const items: MenuItem[] = [];
  const activeObject = store.activeObject();
  const canInherit =
    activeObject?.kind === 'extend' &&
    !!activeObject.baseId &&
    !!store.project?.getById(activeObject.baseId);

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
    if (canInherit) {
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
    if (activeObject?.kind === 'extend') {
      items.push(
        {
          label: 'Re-sync overlay with base',
          disabled: !canInherit,
          action: () => {
            const dropped = store.resyncOverlay(id);
            if (dropped > 0) {
              toast(`Gave ${dropped.toLocaleString()} cells back to the base`, 'success');
            } else {
              toast('Overlay was already in sync — nothing to drop', 'info');
            }
          },
        },
        {
          label: 'Reset extend to base',
          danger: true,
          disabled: !canInherit,
          action: () => runner?.resetOverlay(),
        },
      );
    }
    items.push({ label: 'Delete object', danger: true, action: () => store.removeObject(id) });
  }
  menu.value = { x, y, items };
}

function eraseCells(cells: Array<[number, number, number]>, label: string, mirrored = false) {
  if (!runner || cells.length === 0) return;
  runner.runExternal(
    label,
    (write) => {
      for (const [x, y, z] of cells) write(x, y, z, 0);
    },
    mirrored ? 'draw' : 'none',
  );
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
    syncXray();
    syncMirror();
  },
);
watch(() => store.xray, syncXray);
watch(() => store.mirror, syncMirror);
watch(
  () => store.buildPlane,
  (p) => viewport?.setBuildPlane(p),
);
watch(
  () => store.boxMode,
  () => runner?.syncBoxMode(),
);
watch(() => store.selection, syncSelectionGizmo, { deep: true });

/** the modelling camera, put back when screenshot mode ends */
let cameraBeforeShot: CameraState | null = null;
watch(
  () => store.screenshotMode,
  (on) => {
    if (!viewport || !runner) return;
    menu.value = null;
    if (on) {
      runner.pointerLeave();
      cameraBeforeShot = viewport.controls.snapshot();
      viewport.setScreenshotMode(true);
      viewport.setXray(false);
      loadActive();
    } else {
      viewport.setScreenshotMode(false);
      if (cameraBeforeShot) viewport.controls.restore(cameraBeforeShot);
      projection.value = viewport.controls.mode;
      cameraBeforeShot = null;
      loadActive();
      syncXray();
    }
  },
);
watch(() => [store.editVersion, store.activeVersion, store.structureVersion], syncEmpty, { flush: 'post' });
watch(theme, (t) => viewport?.setDark(t === 'dark'));
</script>

<template>
  <div class="viewport-wrap">
    <canvas ref="canvas" class="viewport-canvas" />

    <!-- the square the saved image covers; everything outside is dimmed -->
    <div v-if="store.screenshotMode" class="crop" aria-hidden="true" />

    <div class="overlay-left">
      <ScreenshotPanel v-if="store.screenshotMode" />
      <template v-else>
        <ToolOptions />
        <SelectionPanel v-if="store.toolId === 'select' && store.selection" />
      </template>
    </div>

    <div v-if="!store.screenshotMode" class="view-controls" role="group" aria-label="Camera">
      <div class="seg projection">
        <button
          :class="{ active: projection === 'perspective' }"
          :aria-pressed="projection === 'perspective'"
          title="Perspective camera — toggle with Numpad 5"
          @click="setProjection('perspective')"
        >
          Perspective
        </button>
        <button
          :class="{ active: projection === 'ortho' }"
          :aria-pressed="projection === 'ortho'"
          title="Orthographic camera — toggle with Numpad 5"
          @click="setProjection('ortho')"
        >
          Ortho
        </button>
      </div>
      <div class="views">
        <button v-for="v in presetViews" :key="v.id" :title="`${v.label} view — ${v.hint}`" @click="setView(v.id)">
          {{ v.label }}
        </button>
        <button class="iso" title="Isometric view" @click="setView('iso')">Isometric</button>
      </div>
    </div>

    <p v-if="isEmpty && !store.screenshotMode" class="empty">
      This object is empty. Click the grid to place your first voxel, or add a shape from the tool bar.
    </p>

    <div v-if="!store.screenshotMode" class="hints" aria-hidden="true">
      <span class="where">
        {{ store.buildPlane.toUpperCase() }} plane at {{ buildOffsetLabel }}
        <template v-if="store.activeDetail > 1"> · {{ brushLabel.replace('brush: ', '') }}</template>
      </span>
      <span v-for="h in toolHints" :key="h.text" class="hint">
        <kbd v-for="k in h.keys" :key="k">{{ k }}</kbd> {{ h.text }}
      </span>
      <span class="hint nav"><kbd>Middle drag</kbd> orbit</span>
      <span class="hint nav"><kbd>Shift</kbd><kbd>Middle drag</kbd> pan</span>
      <span class="hint nav"><kbd>F</kbd> frame</span>
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
  container-type: size;
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
.crop {
  position: absolute;
  inset: 0;
  margin: auto;
  width: min(100cqw, 100cqh);
  height: min(100cqw, 100cqh);
  outline: 1px solid color-mix(in srgb, var(--ink) 55%, transparent);
  box-shadow: 0 0 0 100vmax var(--scrim);
  pointer-events: none;
}
.overlay-left {
  position: absolute;
  top: 10px;
  left: 10px;
  right: 196px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  pointer-events: none;
}
.overlay-left > * {
  pointer-events: auto;
}
.view-controls {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 176px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: color-mix(in srgb, var(--surface-1) 92%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.view-controls button {
  padding: 3px 6px;
  font-size: 12px;
}
.projection > button {
  flex: 1;
}
.views {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 3px;
}
.views .iso {
  grid-column: 1 / -1;
}
.empty {
  position: absolute;
  left: 50%;
  bottom: 64px;
  transform: translateX(-50%);
  width: min(420px, calc(100% - 32px));
  margin: 0;
  padding: 10px 14px;
  text-align: center;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink);
  background: color-mix(in srgb, var(--surface-1) 92%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  pointer-events: none;
}
.hints {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 10px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  font-size: 12px;
  color: var(--ink-dim);
  pointer-events: none;
}
.hints .where {
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.hint kbd + kbd {
  margin-left: 2px;
}
.hint.nav {
  opacity: 0.8;
}
.hint.nav:first-of-type {
  margin-left: auto;
}

@media (max-width: 720px) {
  .overlay-left {
    right: 10px;
  }
  .view-controls {
    display: none;
  }
  .hint.nav {
    display: none;
  }
}
</style>
