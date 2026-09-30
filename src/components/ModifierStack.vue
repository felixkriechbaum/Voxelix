<script setup lang="ts">
import { ref } from 'vue';
import { useEditorStore } from '@/stores/editor';
import Icon from './Icon.vue';
import { faXmark, faChevronUp, faChevronDown } from '@fortawesome/pro-solid-svg-icons';
import { SMOOTH_MAX, SMOOTH_MIN, type Modifier, type ModifierType } from '@/core/project/parts';

const props = defineProps<{ partId: string; partName: string; modifiers: Modifier[] }>();
const store = useEditorStore();

const kinds: Array<{ type: ModifierType; label: string; title: string }> = [
  { type: 'array', label: 'Array', title: 'Repeat the part along an axis' },
  { type: 'mirror', label: 'Mirror', title: 'Mirror the part across a plane through the middle of the object' },
  { type: 'move', label: 'Move', title: 'Shift the part by whole voxels, without redrawing it' },
  { type: 'radial', label: 'Radial', title: 'Copies turned around the middle of the object — 2 or 4 times' },
  {
    type: 'smooth',
    label: 'Smooth',
    title: 'Round off edges and corners, like a subdivision surface — subdivides the object if it is still coarse',
  },
  {
    type: 'unvoxel',
    label: 'Unvoxel',
    title: 'Drop the voxel look: draw and export the part as one smooth surface, colours blending into each other',
  },
];
const names: Record<ModifierType, string> = {
  array: 'Array',
  mirror: 'Mirror',
  move: 'Move',
  radial: 'Radial',
  smooth: 'Smooth',
  unvoxel: 'Unvoxel',
};
/**
 * Strength while the slider is dragged — only committed on release, each change
 * re-meshes the part. The slider binds to it too: Vue re-applies `value` on
 * every render, which would otherwise snap the thumb back mid-drag.
 */
const draggingStrength = ref<{ id: string; value: number } | null>(null);
/** one-click radii, in voxels */
const smoothPresets = [0.5, 1, 2, 3];
const axes = ['x', 'y', 'z'] as const;
/** mirror planes in the toolbar's order; `axis` is the one the plane flips */
const mirrorPlanes: Array<{ axis: 0 | 1 | 2; label: string; title: string }> = [
  { axis: 1, label: 'XZ', title: 'Top ↔ bottom (flips Y)' },
  { axis: 2, label: 'XY', title: 'Front ↔ back (flips Z)' },
  { axis: 0, label: 'YZ', title: 'Left ↔ right (flips X)' },
];

function update(m: Modifier, patch: Record<string, unknown>) {
  store.updateModifier(props.partId, m.id, patch as Partial<Modifier>);
}
function num(e: Event): number {
  return Number((e.target as HTMLInputElement).value);
}
function setOffset(m: Modifier, axis: number, e: Event) {
  if (m.type !== 'move') return;
  const offset = [...m.offset] as [number, number, number];
  offset[axis] = num(e);
  update(m, { offset });
}
</script>

<template>
  <div class="stack">
    <div class="sub">
      <span class="title">Modifiers on {{ partName }}</span>
    </div>
    <div class="add" role="group" aria-label="Add a modifier">
      <button v-for="k in kinds" :key="k.type" class="add-btn" :title="k.title" @click="store.addModifier(partId, k.type)">
        + {{ k.label }}
      </button>
    </div>
    <p v-if="modifiers.length === 0" class="empty">
      None yet. Modifiers change this part without touching the others, and stay editable. They apply top to bottom.
      The result shows dimmed around the part while you edit it — screenshot mode shows it as exported.
    </p>

    <div v-for="(m, i) in modifiers" :key="m.id" class="mod" :class="{ off: !m.enabled }">
      <div class="head">
        <label class="on" title="Turn the modifier on or off without losing its settings">
          <input type="checkbox" :checked="m.enabled" @change="update(m, { enabled: ($event.target as HTMLInputElement).checked })" />
          {{ names[m.type] }}
        </label>
        <span class="tools">
          <button class="ic" :disabled="i === 0" title="Apply earlier" aria-label="Move modifier up" @click="store.moveModifier(partId, m.id, -1)">
            <Icon :icon="faChevronUp" :size="10" />
          </button>
          <button
            class="ic"
            :disabled="i === modifiers.length - 1"
            title="Apply later"
            aria-label="Move modifier down"
            @click="store.moveModifier(partId, m.id, 1)"
          >
            <Icon :icon="faChevronDown" :size="10" />
          </button>
          <button class="ic del" title="Remove this modifier" aria-label="Remove modifier" @click="store.removeModifier(partId, m.id)">
            <Icon :icon="faXmark" :size="11" />
          </button>
        </span>
      </div>

      <!-- array: axis, direction, count, gap -->
      <template v-if="m.type === 'array'">
        <div class="row">
          <span class="lbl">Axis</span>
          <div class="seg axis-seg">
            <button
              v-for="(a, ax) in axes"
              :key="a"
              :class="{ active: m.axis === ax }"
              :aria-pressed="m.axis === ax"
              :style="{ '--ax': `var(--axis-${a})` }"
              @click="update(m, { axis: ax })"
            >
              {{ a.toUpperCase() }}
            </button>
          </div>
          <div class="seg dir-seg" role="group" aria-label="Direction along the axis">
            <button
              :class="{ active: m.direction === 1 }"
              :aria-pressed="m.direction === 1"
              :title="`Copies go the positive way along ${axes[m.axis].toUpperCase()}`"
              @click="update(m, { direction: 1 })"
            >
              +
            </button>
            <button
              :class="{ active: m.direction === -1 }"
              :aria-pressed="m.direction === -1"
              :title="`Copies go the negative way along ${axes[m.axis].toUpperCase()}`"
              @click="update(m, { direction: -1 })"
            >
              −
            </button>
          </div>
        </div>
        <div class="row">
          <label class="lbl" :for="`count-${m.id}`">Count</label>
          <input
            :id="`count-${m.id}`"
            class="num"
            type="number"
            min="1"
            max="64"
            :value="m.count"
            title="How many times the part appears, the original included"
            @change="update(m, { count: num($event) })"
          />
          <label class="lbl short" :for="`gap-${m.id}`">Gap</label>
          <input
            :id="`gap-${m.id}`"
            class="num"
            type="number"
            min="0"
            max="64"
            :value="m.gap"
            title="Space between the copies, in voxels"
            @change="update(m, { gap: num($event) })"
          />
        </div>
      </template>

      <!-- mirror: which plane -->
      <div v-else-if="m.type === 'mirror'" class="row">
        <span class="lbl">Plane</span>
        <div class="seg fill">
          <button
            v-for="p in mirrorPlanes"
            :key="p.axis"
            :class="{ active: m.axis === p.axis }"
            :aria-pressed="m.axis === p.axis"
            :title="p.title"
            @click="update(m, { axis: p.axis })"
          >
            <span class="dot" :style="{ background: `var(--axis-${axes[p.axis]})` }" />{{ p.label }}
          </button>
        </div>
      </div>

      <!-- move: offset per axis -->
      <div v-else-if="m.type === 'move'" class="row">
        <span class="lbl">Voxels</span>
        <label v-for="(a, ax) in axes" :key="a" class="axis" :title="`Shift along ${a.toUpperCase()}`">
          <span class="ax" :style="{ color: `var(--axis-${a})` }">{{ a.toUpperCase() }}</span>
          <input type="number" min="-192" max="192" :value="m.offset[ax]" @change="setOffset(m, ax, $event)" />
        </label>
      </div>

      <!-- radial: 2 or 4 copies -->
      <div v-else-if="m.type === 'radial'" class="row">
        <span class="lbl">Copies</span>
        <div class="seg fill">
          <button
            :class="{ active: m.count === 2 }"
            :aria-pressed="m.count === 2"
            title="The part plus one copy turned 180°"
            @click="update(m, { count: 2 })"
          >
            2 × 180°
          </button>
          <button
            :class="{ active: m.count === 4 }"
            :aria-pressed="m.count === 4"
            title="The part plus three copies, every 90°"
            @click="update(m, { count: 4 })"
          >
            4 × 90°
          </button>
        </div>
      </div>

      <!-- smooth: how far the rounding reaches, in voxels -->
      <div v-else-if="m.type === 'smooth'" class="row">
        <label class="lbl" :for="`radius-${m.id}`">Radius</label>
        <input
          :id="`radius-${m.id}`"
          class="num"
          type="number"
          :min="SMOOTH_MIN"
          :max="SMOOTH_MAX"
          step="0.25"
          :value="m.radius"
          :title="`How far the rounding reaches, in voxels (${SMOOTH_MIN}–${SMOOTH_MAX}). Larger fills in fine relief.`"
          @change="update(m, { radius: num($event) })"
        />
        <div class="seg fill" role="group" aria-label="Radius presets">
          <button
            v-for="r in smoothPresets"
            :key="r"
            :class="{ active: m.radius === r }"
            :aria-pressed="m.radius === r"
            :title="`Round by ${r} voxel${r === 1 ? '' : 's'}`"
            @click="update(m, { radius: r })"
          >
            {{ r === 0.5 ? '½' : r }}
          </button>
        </div>
      </div>

      <!-- unvoxel: 0 = voxels, 100 = fully smooth -->
      <template v-else-if="m.type === 'unvoxel'">
        <div class="row">
          <label class="lbl" :for="`strength-${m.id}`">Strength</label>
          <input
            :id="`strength-${m.id}`"
            class="range"
            type="range"
            min="0"
            max="100"
            step="1"
            :value="draggingStrength?.id === m.id ? draggingStrength.value : m.strength"
            title="0 keeps the voxels, 100 rounds everything off — reaches about three voxels"
            @input="draggingStrength = { id: m.id, value: num($event) }"
            @change="update(m, { strength: num($event) }), (draggingStrength = null)"
          />
          <span class="val">{{ draggingStrength?.id === m.id ? draggingStrength.value : m.strength }}</span>
        </div>
        <p class="hint">Applies to the finished part, wherever it sits in the stack. Edit its voxels through the cage.</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sub {
  margin: 12px 0 6px;
  font-size: 12px;
  color: var(--ink-dim);
}
.title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.add {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 3px;
}
.add-btn {
  padding: 3px 2px;
  font-size: 11.5px;
}
.empty {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink-faint);
}
.mod {
  padding: 8px;
  margin-top: 6px;
  background: var(--surface-0);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.mod.off {
  opacity: 0.6;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.on {
  display: flex;
  align-items: center;
  gap: 7px;
  font: 600 12.5px/1 var(--font-display);
  cursor: pointer;
}
.on input {
  accent-color: var(--accent);
  margin: 0;
}
.tools {
  display: flex;
  gap: 1px;
}
.ic {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--ink-faint);
  background: transparent;
  border-color: transparent;
}
.ic:hover:not(:disabled) {
  color: var(--ink);
  border-color: transparent;
}
.ic.del:hover:not(:disabled) {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 12%, transparent);
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
}
.lbl {
  font-size: 12px;
  color: var(--ink-dim);
  min-width: 42px;
}
.lbl.short {
  min-width: 0;
  margin-left: 4px;
}
.range {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}
.val {
  min-width: 26px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.hint {
  margin: 5px 0 0;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--ink-faint);
}
.num {
  width: 60px;
  padding: 3px 6px;
}
.seg.fill {
  flex: 1;
  display: flex;
}
.seg.fill > button {
  flex: 1;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.axis-seg > button {
  min-width: 28px;
  font-weight: 600;
  color: var(--ax);
}
.axis-seg > button.active,
.axis-seg > button.active:hover:not(:disabled) {
  color: var(--accent-ink);
}
.dir-seg {
  margin-left: auto;
}
.dir-seg > button {
  min-width: 26px;
  font-weight: 600;
}
.axis {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  background: var(--surface-1);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.axis:focus-within {
  border-color: var(--accent);
}
.ax {
  padding-left: 6px;
  font: 600 11px/1 var(--font-display);
}
.axis input {
  border: 0;
  background: transparent;
  min-width: 0;
  padding: 3px 4px;
}
.axis input:focus {
  outline: none;
}
</style>
