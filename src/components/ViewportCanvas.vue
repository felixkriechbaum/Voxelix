<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Viewport } from '@/viewport/Viewport';
import { ToolRunner } from '@/editor/ToolRunner';
import { setSession } from '@/editor/session';
import { useEditorStore } from '@/stores/editor';
import { buildActiveRender } from '@/core/project/resolve';
import { floodRegion } from '@/core/ops/flood';
import ContextMenu, { type MenuItem } from './ContextMenu.vue';
import type { ToolId } from '@/tools/types';

const store = useEditorStore();
const canvas = ref<HTMLCanvasElement | null>(null);
let viewport: Viewport | null = null;
let runner: ToolRunner | null = null;
let ro: ResizeObserver | null = null;

const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null);

const toolKeys: Record<string, ToolId> = {
  Digit1: 'place',
  Digit2: 'erase',
  Digit3: 'box',
  Digit4: 'paint',
  Digit5: 'eyedropper',
};

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
  (id) => runner?.setTool(id),
);
watch(
  () => store.boxMode,
  () => runner?.syncBoxMode(),
);
</script>

<template>
  <div class="viewport-wrap">
    <canvas ref="canvas" class="viewport-canvas" />
    <div class="hud">
      {{ store.buildPlane.toUpperCase() }} plane @ {{ store.buildOffset }} &nbsp;·&nbsp; MMB orbit ·
      Shift+MMB pan · RMB+WASD fly · Shift draw = straight line · F frame
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
</style>
