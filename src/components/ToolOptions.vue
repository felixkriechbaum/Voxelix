<script setup lang="ts">
import { computed } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { resolveEffectiveData } from '@/core/project/resolve';
import type { ToolId } from '@/tools/types';
import type { BuildPlane } from '@/viewport/Picker';

const store = useEditorStore();

const toolNames: Record<ToolId, string> = {
  place: 'Place',
  erase: 'Erase',
  box: 'Box',
  paint: 'Paint',
  bucket: 'Bucket',
  eyedropper: 'Pick colour',
  select: 'Select',
};

const usesBrush = computed(() => ['place', 'erase', 'box', 'paint'].includes(store.toolId));
const mirrors = computed(() => ['place', 'erase', 'box', 'paint', 'bucket'].includes(store.toolId));
const usesPlane = computed(() => ['place', 'box', 'select'].includes(store.toolId));

const brushes = [
  { f: 1, size: 14, label: 'Full voxel' },
  { f: 2, size: 9, label: 'Half voxel' },
  { f: 3, size: 6, label: 'Third of a voxel' },
  { f: 6, size: 3, label: 'Single cell (sixth of a voxel)' },
];
function pickBrush(f: number) {
  store.voxelFraction = f;
  // any sub-voxel choice subdivides the object so the smaller sizes are distinct
  if (store.activeObjectId) store.ensureDetail(store.activeObjectId);
}
const currentBrushF = computed(() => Math.min(store.activeDetail, store.voxelFraction));

/**
 * Build planes and mirror planes share one order. Each plane's icon is the two
 * axes it spans, drawn the way the viewport shows them (X down-right, Z
 * down-left, Y up) — the same pair the axis gizmo lights up.
 */
const planes: Array<{ id: BuildPlane; lines: Array<{ axis: string; d: string }>; title: string }> = [
  {
    id: 'xz',
    lines: [
      { axis: 'x', d: 'M8 3.5L14.5 7.5' },
      { axis: 'z', d: 'M8 3.5L1.5 7.5' },
    ],
    title: 'Ground plane (XZ) — build flat on the floor',
  },
  {
    id: 'xy',
    lines: [
      { axis: 'x', d: 'M4 11L10.5 15' },
      { axis: 'y', d: 'M4 11V2' },
    ],
    title: 'Front plane (XY) — build upright, facing front',
  },
  {
    id: 'yz',
    lines: [
      { axis: 'z', d: 'M12 11L5.5 15' },
      { axis: 'y', d: 'M12 11V2' },
    ],
    title: 'Side plane (YZ) — build upright, facing the side',
  },
];
/** Mirror planes, keyed by the axis each flips; the dot is that axis. */
const mirrorPlanes: Array<{ axis: 0 | 1 | 2; label: string; dot: string; title: string }> = [
  { axis: 1, label: 'XZ', dot: 'y', title: 'Mirror top ↔ bottom across the XZ plane (flips Y)' },
  { axis: 2, label: 'XY', dot: 'z', title: 'Mirror front ↔ back across the XY plane (flips Z)' },
  { axis: 0, label: 'YZ', dot: 'x', title: 'Mirror left ↔ right across the YZ plane (flips X)' },
];

const maxBuildOffsetCells = computed(() => {
  void store.activeVersion;
  void store.structureVersion;
  const obj = store.activeObject();
  if (!obj || !store.project) return 0;
  const data = resolveEffectiveData(obj, store.project);
  const size = store.buildPlane === 'xz' ? data.sizeY : store.buildPlane === 'xy' ? data.sizeZ : data.sizeX;
  return Math.max(0, size - 1);
});
const buildOffsetVoxels = computed({
  get: () => store.buildOffset / store.activeDetail,
  set: (value: number) => {
    const cells = Math.round((Number(value) || 0) * store.activeDetail);
    store.buildOffset = Math.max(0, Math.min(maxBuildOffsetCells.value, cells));
  },
});
const maxBuildOffsetVoxels = computed(() => maxBuildOffsetCells.value / store.activeDetail);

function setBuildPlane(value: BuildPlane) {
  store.buildPlane = value;
  store.buildOffset = Math.min(store.buildOffset, maxBuildOffsetCells.value);
}
</script>

<template>
  <div class="options" role="toolbar" :aria-label="`${toolNames[store.toolId]} options`">
    <strong class="tool">{{ toolNames[store.toolId] }}</strong>

    <div v-if="store.toolId === 'box'" class="group">
      <div class="seg">
        <button
          :class="{ active: store.boxMode === 'fill' }"
          :aria-pressed="store.boxMode === 'fill'"
          title="Fill the box with the current colour"
          @click="store.boxMode = 'fill'"
        >
          Fill
        </button>
        <button
          :class="{ active: store.boxMode === 'erase' }"
          :aria-pressed="store.boxMode === 'erase'"
          title="Clear every voxel inside the box"
          @click="store.boxMode = 'erase'"
        >
          Erase
        </button>
      </div>
    </div>

    <div v-if="store.toolId === 'bucket'" class="group">
      <span class="cap">Spread</span>
      <div class="seg">
        <button
          :class="{ active: store.bucketMode === 'volume' }"
          :aria-pressed="store.bucketMode === 'volume'"
          title="The whole connected region of this colour, through the object. Shift-click ignores connectivity."
          @click="store.bucketMode = 'volume'"
        >
          Volume
        </button>
        <button
          :class="{ active: store.bucketMode === 'face' }"
          :aria-pressed="store.bucketMode === 'face'"
          title="Only the surface you clicked — the flat patch of this colour. Shift-click ignores connectivity."
          @click="store.bucketMode = 'face'"
        >
          Face
        </button>
        <button
          :class="{ active: store.bucketMode === 'outline' }"
          :aria-pressed="store.bucketMode === 'outline'"
          title="Only the border ring of that surface patch. Shift-click ignores connectivity."
          @click="store.bucketMode = 'outline'"
        >
          Outline
        </button>
      </div>
    </div>

    <div v-if="store.toolId === 'select'" class="group">
      <button
        class="toggle"
        :class="{ active: store.xray }"
        :aria-pressed="store.xray"
        title="X-ray (Alt+Z): see through the object, and a box selection reaches every voxel behind — not just the visible ones"
        @click="store.xray = !store.xray"
      >
        X-ray
      </button>
    </div>

    <div v-if="usesBrush" class="group">
      <span class="cap">Brush</span>
      <div class="seg">
        <button
          v-for="b in brushes"
          :key="b.f"
          class="brush"
          :class="{ active: currentBrushF === b.f }"
          :aria-pressed="currentBrushF === b.f"
          :aria-label="b.label"
          :title="`${b.label} — the object is subdivided the first time you pick a smaller size`"
          @click="pickBrush(b.f)"
        >
          <span class="sq" :style="{ width: b.size + 'px', height: b.size + 'px' }" />
        </button>
      </div>
    </div>

    <div v-if="mirrors" class="group">
      <span class="cap" title="Edits are copied across every active plane, through the centre of the object">Mirror</span>
      <div class="seg">
        <button
          v-for="m in mirrorPlanes"
          :key="m.axis"
          class="axis-btn"
          :class="{ active: store.mirror[m.axis] }"
          :aria-pressed="store.mirror[m.axis]"
          :title="m.title"
          @click="store.toggleMirror(m.axis)"
        >
          <span class="dot" :style="{ background: `var(--axis-${m.dot})` }" />{{ m.label }}
        </button>
      </div>
    </div>

    <div v-if="usesPlane" class="group">
      <span class="cap" title="Where new voxels land when you click empty space — and the plane a box drag stays in">Plane</span>
      <div class="seg">
        <button
          v-for="p in planes"
          :key="p.id"
          class="axis-btn"
          :class="{ active: store.buildPlane === p.id }"
          :aria-pressed="store.buildPlane === p.id"
          :title="p.title"
          @click="setBuildPlane(p.id)"
        >
          <svg class="plane-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path v-for="l in p.lines" :key="l.axis" :d="l.d" :style="{ stroke: `var(--axis-${l.axis})` }" />
          </svg>
          {{ p.id.toUpperCase() }}
        </button>
      </div>
      <label class="offset" title="How far the build plane sits from the grid origin, in voxels">
        <span class="cap">at</span>
        <input
          v-model.number="buildOffsetVoxels"
          class="num"
          type="number"
          aria-label="Build plane offset in voxels"
          min="0"
          :max="maxBuildOffsetVoxels"
          :step="1 / store.activeDetail"
        />
      </label>
    </div>

    <div class="group">
      <button
        class="toggle"
        :class="{ active: store.rmbErase }"
        :aria-pressed="store.rmbErase"
        title="When on, a right-click erases the voxel under the cursor instead of opening the menu"
        @click="store.rmbErase = !store.rmbErase"
      >
        Right-click erases
      </button>
    </div>
  </div>
</template>

<style scoped>
.options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  padding: 6px 10px 6px 12px;
  background: color-mix(in srgb, var(--surface-1) 92%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  backdrop-filter: blur(6px);
}
.tool {
  font: 600 14px/1 var(--font-display);
  letter-spacing: 0.01em;
  padding-right: 12px;
  border-right: 1px solid var(--line);
  align-self: stretch;
  display: flex;
  align-items: center;
}
.group {
  display: flex;
  align-items: center;
  gap: 7px;
}
.cap {
  color: var(--ink-dim);
  font-size: 12px;
}
.seg > button {
  font-size: 12px;
}
.brush {
  display: grid;
  place-items: center;
  width: 28px;
  height: 24px;
  padding: 0 !important;
}
.brush .sq {
  display: block;
  background: currentColor;
  border-radius: 1px;
}
.axis-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-variant-numeric: tabular-nums;
}
.plane-icon {
  width: 17px;
  height: 17px;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  opacity: 0.7;
}
.axis-btn.active .plane-icon {
  opacity: 1;
  /* a dark halo so the axis colours stay readable on the mint button */
  filter: drop-shadow(0 0 0.6px var(--accent-ink));
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  opacity: 0.45;
}
.axis-btn.active .dot {
  opacity: 1;
  box-shadow: 0 0 0 1px var(--accent-ink);
}
.toggle {
  font-size: 12px;
  padding: 4px 10px;
}
.offset {
  display: flex;
  align-items: center;
  gap: 5px;
}
.num {
  width: 56px;
  padding: 3px 6px;
}
</style>
