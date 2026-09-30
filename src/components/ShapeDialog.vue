<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useSession } from '@/editor/session';
import {
  isFlat,
  planeAxes,
  supportsHollow,
  voxelizeFlat,
  voxelizeShape,
  type ShapeKind,
  type ShapePlane,
} from '@/core/shapes/primitives';
import { resolveEffectiveData } from '@/core/project/resolve';
import { CELLS_PER_VOXEL } from '@/core/voxel/constants';

const store = useEditorStore();
const { runner } = useSession();
const emit = defineEmits<{ (e: 'close'): void }>();

/** Pictograms are 24×24 line drawings — the shape as you'd sketch it. */
const solids: Array<{ kind: ShapeKind; label: string; icon: string }> = [
  { kind: 'box', label: 'Box', icon: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8' },
  { kind: 'sphere', label: 'Sphere', icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12c0 2 4 3.5 9 3.5s9-1.5 9-3.5' },
  { kind: 'dome', label: 'Dome', icon: 'M3 17a9 9 0 0 1 18 0M3 17c0 1.7 4 3 9 3s9-1.3 9-3M3 17c0-1.7 4-3 9-3s9 1.3 9 3' },
  { kind: 'cylinder', label: 'Cylinder', icon: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6' },
  { kind: 'cone', label: 'Cone', icon: 'M12 3L5 18M12 3l7 15M5 18c0 1.7 3.1 3 7 3s7-1.3 7-3-3.1-3-7-3-7 1.3-7 3' },
  { kind: 'pyramid', label: 'Pyramid', icon: 'M12 3L3 17l9 4 9-4zM12 3v18' },
  { kind: 'wedge', label: 'Wedge', icon: 'M4 18V8l6-4v10zM10 14l10 4H4M10 4l10 14' },
  { kind: 'tube', label: 'Tube', icon: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M9 6c0-.8 1.3-1.3 3-1.3s3 .5 3 1.3-1.3 1.3-3 1.3S9 6.8 9 6' },
];
const flats: Array<{ kind: ShapeKind; label: string; icon: string }> = [
  { kind: 'plane', label: 'Plane', icon: 'M3 14l9-5 9 5-9 5zM3 14v1.5l9 5 9-5V14' },
  { kind: 'circle', label: 'Circle', icon: 'M3 13c0-2.5 4-4.5 9-4.5s9 2 9 4.5-4 4.5-9 4.5-9-2-9-4.5zM3 13v1.6c0 2.5 4 4.5 9 4.5s9-2 9-4.5V13' },
  { kind: 'ring', label: 'Ring', icon: 'M3 13c0-2.5 4-4.5 9-4.5s9 2 9 4.5-4 4.5-9 4.5-9-2-9-4.5zM3 13v1.6c0 2.5 4 4.5 9 4.5s9-2 9-4.5V13M8 13c0-1 1.8-1.8 4-1.8s4 .8 4 1.8-1.8 1.8-4 1.8-4-.8-4-1.8' },
];
const planes: Array<{ id: ShapePlane; label: string; title: string }> = [
  { id: 'xz', label: 'XZ', title: 'Lying flat on the ground' },
  { id: 'xy', label: 'XY', title: 'Standing upright, facing the front' },
  { id: 'yz', label: 'YZ', title: 'Standing upright, facing the side' },
];
const axisName = ['x', 'y', 'z'] as const;

/** How big each voxel of the shape is, as a fraction of a full voxel. */
const voxelSizes: Array<{ f: number; label: string; title: string }> = [
  { f: 1, label: 'Full', title: 'Built from full voxels' },
  { f: 2, label: 'Half', title: 'Built from half voxels — 2 × 2 × 2 fit in one full voxel' },
  { f: 3, label: 'Third', title: 'Built from third voxels — 3 × 3 × 3 fit in one full voxel' },
  { f: 6, label: 'Sixth', title: 'Built from single cells — 6 × 6 × 6 fit in one full voxel' },
];

// ---- remembered input --------------------------------------------------
const STORAGE_KEY = 'voxelix.shapeDialog';
interface Remembered {
  kind: ShapeKind;
  /** solid shapes: width / height / depth */
  w: number;
  h: number;
  d: number;
  hollow: boolean;
  /** flat shapes: plane, the two in-plane sizes (full voxels), thickness and
   *  ring border (counted in the chosen voxel size, so 1 = one layer) */
  plane: ShapePlane;
  fa: number;
  fb: number;
  ft: number;
  fw: number;
  /** voxel size as a fraction of a full voxel: 1, 2, 3 or 6 */
  fraction: number;
}
const defaults: Remembered = {
  kind: 'box',
  w: 16,
  h: 16,
  d: 16,
  hollow: false,
  plane: 'xz',
  fa: 16,
  fb: 16,
  ft: 1,
  fw: 1,
  fraction: 1,
};
function load(): Remembered {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* private mode or bad JSON — start from the defaults */
  }
  return { ...defaults, plane: store.buildPlane, fraction: store.voxelFraction };
}
const spec = reactive<Remembered>(load());
watch(spec, () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(spec));
  } catch {
    /* private mode */
  }
});

const flat = computed(() => isFlat(spec.kind));
const hollowable = computed(() => supportsHollow(spec.kind));
/** For a flat shape: [first in-plane axis, second in-plane axis, thickness axis]. */
const flatAxes = computed(() => planeAxes(spec.plane));
/** Thickness / border are counted in the chosen voxel size — say which, when it isn't a full voxel. */
const layerUnit = computed(() => (spec.fraction > 1 ? voxelSizes.find((v) => v.f === spec.fraction)?.label.toLowerCase() : ''));

// ---- limits --------------------------------------------------------------
const maxDims = computed<[number, number, number]>(() => {
  void store.activeVersion;
  void store.structureVersion;
  const obj = store.activeObject();
  if (!obj || !store.project) return [1, 1, 1];
  const data = resolveEffectiveData(obj, store.project);
  const detail = store.activeDetail;
  return [data.sizeX, data.sizeY, data.sizeZ].map((n) => Math.max(1, Math.floor(n / detail))) as [
    number,
    number,
    number,
  ];
});

/** Picking a size smaller than a full voxel subdivides a coarse object first. */
const willSubdivide = computed(() => spec.fraction > 1 && store.activeDetail < CELLS_PER_VOXEL);

const placementNote = computed(() => {
  if (!flat.value) return 'Placed centred on the ground of the object.';
  return spec.plane === store.buildPlane
    ? 'Placed centred, on the build plane.'
    : spec.plane === 'xz'
      ? 'Placed centred on the ground.'
      : 'Placed centred, standing on the ground.';
});

// ---- dialog plumbing ----------------------------------------------------
const dialog = ref<HTMLFormElement | null>(null);
let returnFocus: HTMLElement | null = null;
/** only a press that *starts* on the backdrop closes — not a text drag ending there */
let pressedBackdrop = false;

function close() {
  emit('close');
}
function onBackdropDown(e: PointerEvent) {
  pressedBackdrop = e.target === e.currentTarget;
}
function onBackdropClick(e: MouseEvent) {
  if (pressedBackdrop && e.target === e.currentTarget) close();
  pressedBackdrop = false;
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return;
  }
  if (e.key !== 'Tab' || !dialog.value) return;
  const controls = Array.from(
    dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'),
  );
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!dialog.value.contains(document.activeElement)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  returnFocus = document.activeElement as HTMLElement | null;
  window.addEventListener('keydown', onKey);
  void nextTick(() => {
    const shape = dialog.value?.querySelector<HTMLButtonElement>('.shape.active') ?? dialog.value?.querySelector<HTMLButtonElement>('.shape');
    shape?.focus();
  });
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  returnFocus?.focus();
});

// ---- add ------------------------------------------------------------------
async function add() {
  const obj = store.activeObject();
  if (!obj || !runner.value) return;
  // a sub-voxel size needs the subdivided grid (lossless, one-way, like the brush)
  if (willSubdivide.value) {
    store.ensureDetail(obj.id);
    await nextTick();
    runner.value.syncActive();
  }
  const read = runner.value.data;
  const det = store.activeDetail; // dimensions are entered in voxels
  // the shape is rasterised at the chosen voxel size: each unit is a grid-aligned
  // block of `block`³ cells (a full voxel, a half, a third or a single cell)
  const block = Math.max(1, Math.round(det / Math.min(det, spec.fraction)));
  const max = maxDims.value;
  const units = (voxels: number, axis: number) => Math.max(1, Math.round((clamp(voxels, max[axis]) * det) / block));
  // thickness / border are already in the shape's own voxels — one means one layer
  const layers = (n: number, axis: number) => clamp(n, Math.max(1, Math.floor((max[axis] * det) / block)));

  let cells: Array<[number, number, number]>;
  let dims: [number, number, number];
  let thickAxis = -1;
  if (isFlat(spec.kind)) {
    const [a, b, t] = flatAxes.value;
    const r = voxelizeFlat(
      spec.kind,
      spec.plane,
      units(spec.fa, a),
      units(spec.fb, b),
      layers(spec.ft, t),
      layers(spec.fw, a),
    );
    cells = r.cells;
    dims = r.dims;
    thickAxis = t;
  } else {
    dims = [units(spec.w, 0), units(spec.h, 1), units(spec.d, 2)];
    cells = voxelizeShape({ kind: spec.kind, w: dims[0], h: dims[1], d: dims[2], hollow: spec.hollow });
  }

  // centre on x / z, stand on the ground; a flat shape on the build plane's
  // orientation sits at the build plane's offset instead
  const grid = [read.sizeX, read.sizeY, read.sizeZ];
  const origin = [0, 1, 2].map((i) => {
    if (i === thickAxis && spec.plane === store.buildPlane) return Math.floor(store.buildOffset / block) * block;
    if (i === 1) return 0;
    return Math.max(0, Math.floor((grid[i] - dims[i] * block) / 2 / block) * block);
  });

  const value = store.currentColor + 1;
  const label = [...solids, ...flats].find((s) => s.kind === spec.kind)?.label ?? spec.kind;
  runner.value.runExternal(`Add ${label.toLowerCase()}`, (write) => {
    for (const [ux, uy, uz] of cells) {
      const bx = origin[0] + ux * block;
      const by = origin[1] + uy * block;
      const bz = origin[2] + uz * block;
      for (let z = bz; z < bz + block; z++)
        for (let y = by; y < by + block; y++)
          for (let x = bx; x < bx + block; x++) if (read.inBounds(x, y, z)) write(x, y, z, value);
    }
  });
  close();
}

function clamp(n: number, max: number) {
  return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.round(n))) : 1;
}
</script>

<template>
  <div class="overlay" @pointerdown="onBackdropDown" @click="onBackdropClick">
    <form ref="dialog" class="panel dialog" role="dialog" aria-modal="true" aria-labelledby="shape-title" @submit.prevent="add">
      <h3 id="shape-title">Add shape</h3>

      <div class="group-label" id="solid-label">Solid</div>
      <div class="shapes" role="radiogroup" aria-labelledby="solid-label">
        <button
          v-for="s in solids"
          :key="s.kind"
          type="button"
          class="shape"
          :class="{ active: spec.kind === s.kind }"
          role="radio"
          :aria-checked="spec.kind === s.kind"
          @click="spec.kind = s.kind"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="s.icon" /></svg>
          <span>{{ s.label }}</span>
        </button>
      </div>

      <div class="group-label" id="flat-label">Flat</div>
      <div class="shapes" role="radiogroup" aria-labelledby="flat-label">
        <button
          v-for="s in flats"
          :key="s.kind"
          type="button"
          class="shape"
          :class="{ active: spec.kind === s.kind }"
          role="radio"
          :aria-checked="spec.kind === s.kind"
          @click="spec.kind = s.kind"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="s.icon" /></svg>
          <span>{{ s.label }}</span>
        </button>
      </div>

      <template v-if="flat">
        <div class="field-label">Lies on</div>
        <div class="slot seg planes">
          <button
            v-for="p in planes"
            :key="p.id"
            type="button"
            :class="{ active: spec.plane === p.id }"
            :aria-pressed="spec.plane === p.id"
            :title="p.title"
            @click="spec.plane = p.id"
          >
            {{ p.label }}
          </button>
        </div>

        <div class="field-label">
          Size in voxels<template v-if="layerUnit"> · {{ spec.kind === 'ring' ? 'thick + border' : 'thick' }} in {{ layerUnit }} voxels</template>
        </div>
        <div class="dims">
          <label class="axis" :title="`Along ${axisName[flatAxes[0]].toUpperCase()}`">
            <span class="ax" :style="{ color: `var(--axis-${axisName[flatAxes[0]]})` }">{{ axisName[flatAxes[0]].toUpperCase() }}</span>
            <input v-model.number="spec.fa" type="number" min="1" :max="maxDims[flatAxes[0]]" />
          </label>
          <label class="axis" :title="`Along ${axisName[flatAxes[1]].toUpperCase()}`">
            <span class="ax" :style="{ color: `var(--axis-${axisName[flatAxes[1]]})` }">{{ axisName[flatAxes[1]].toUpperCase() }}</span>
            <input v-model.number="spec.fb" type="number" min="1" :max="maxDims[flatAxes[1]]" />
          </label>
          <label class="axis thick" :title="`Thickness through the plane, in ${layerUnit || 'full'} voxels`">
            <span class="ax">Thick</span>
            <input v-model.number="spec.ft" type="number" min="1" :max="maxDims[flatAxes[2]] * spec.fraction" />
          </label>
          <label v-if="spec.kind === 'ring'" class="axis thick" :title="`Width of the ring's band, in ${layerUnit || 'full'} voxels`">
            <span class="ax">Border</span>
            <input v-model.number="spec.fw" type="number" min="1" :max="maxDims[flatAxes[0]] * spec.fraction" />
          </label>
        </div>
      </template>

      <template v-else>
        <div class="field-label">Shell</div>
        <div class="slot">
          <label class="check" :class="{ off: !hollowable }">
            <input v-model="spec.hollow" type="checkbox" :disabled="!hollowable" />
            {{ hollowable ? 'Hollow — only the outer layer' : 'A tube is always open at both ends' }}
          </label>
        </div>

        <div class="field-label">Size in voxels</div>
        <div class="dims">
          <label class="axis" title="Width (X)">
            <span class="ax" style="color: var(--axis-x)">X</span>
            <input v-model.number="spec.w" type="number" min="1" :max="maxDims[0]" aria-label="Width in voxels" />
          </label>
          <label class="axis" title="Height (Y)">
            <span class="ax" style="color: var(--axis-y)">Y</span>
            <input v-model.number="spec.h" type="number" min="1" :max="maxDims[1]" aria-label="Height in voxels" />
          </label>
          <label class="axis" title="Depth (Z)">
            <span class="ax" style="color: var(--axis-z)">Z</span>
            <input v-model.number="spec.d" type="number" min="1" :max="maxDims[2]" aria-label="Depth in voxels" />
          </label>
        </div>
      </template>

      <div class="field-label" id="vsize-label">Voxel size</div>
      <div class="sizes" role="radiogroup" aria-labelledby="vsize-label">
        <button
          v-for="v in voxelSizes"
          :key="v.f"
          type="button"
          class="vsize"
          :class="{ active: spec.fraction === v.f }"
          role="radio"
          :aria-checked="spec.fraction === v.f"
          :title="v.title"
          @click="spec.fraction = v.f"
        >
          <!-- one full voxel, split into the chosen grid; the lit cell is one voxel of the shape -->
          <svg viewBox="0 0 30 30" aria-hidden="true">
            <rect class="cell" x="1" y="1" :width="28 / v.f" :height="28 / v.f" />
            <path
              v-if="v.f > 1"
              class="grid"
              :d="
                Array.from({ length: v.f - 1 }, (_, i) => {
                  const p = 1 + ((i + 1) * 28) / v.f;
                  return `M${p} 1V29M1 ${p}H29`;
                }).join('')
              "
            />
            <rect class="outline" x="1" y="1" width="28" height="28" />
          </svg>
          <span>{{ v.label }}</span>
        </button>
      </div>
      <p class="note">
        <template v-if="willSubdivide">
          The object gets subdivided so the smaller voxels fit. Its shape stays the same; undo history is cleared.
        </template>
        <template v-else>{{ placementNote }} Uses the current colour.</template>
      </p>

      <div class="row end">
        <button type="button" @click="close">Cancel</button>
        <button class="primary" type="submit">Add shape</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  display: grid;
  /* centred — safe because every shape lays out to the same height (fixed
     slots below), so switching shapes never shifts the dialog */
  place-items: center;
  z-index: 30;
}
.dialog {
  width: min(372px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: auto;
  padding: 18px;
  box-shadow: var(--shadow);
}
.dialog h3 {
  font-size: 16px;
  margin-bottom: 12px;
}
.group-label,
.field-label {
  margin: 14px 0 6px;
  font-size: 12px;
  color: var(--ink-dim);
}
.dialog h3 + .group-label {
  margin-top: 0;
}
.shapes {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
}
.shape {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 7px 2px 6px;
  font-size: 12px;
  color: var(--ink-dim);
}
.shape svg {
  width: 26px;
  height: 26px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.shape:hover:not(:disabled) {
  color: var(--ink);
}
.shape.active,
.shape.active:hover:not(:disabled) {
  color: var(--accent-ink);
}
.planes {
  display: flex;
}
.planes > button {
  flex: 1;
}
.dims {
  display: flex;
  gap: 5px;
}
.axis {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  background: var(--surface-0);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.axis:focus-within {
  border-color: var(--accent);
}
.ax {
  padding-left: 8px;
  font: 600 11px/1 var(--font-display);
  color: var(--ink-dim);
}
.axis input {
  border: 0;
  background: transparent;
  min-width: 0;
  padding: 5px 6px;
}
.axis input:focus {
  outline: none;
}
.slot {
  display: flex;
  align-items: center;
  height: 32px;
}
label.check {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--ink);
  cursor: pointer;
}
label.check.off {
  color: var(--ink-faint);
  cursor: default;
}
label.check input {
  accent-color: var(--accent);
  width: 15px;
  height: 15px;
  margin: 0;
}
.sizes {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
}
.vsize {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 2px 6px;
  font-size: 12px;
  color: var(--ink-dim);
}
.vsize svg {
  width: 34px;
  height: 34px;
}
.vsize .outline {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
}
.vsize .grid {
  fill: none;
  stroke: currentColor;
  stroke-width: 0.6;
  opacity: 0.45;
}
.vsize .cell {
  fill: currentColor;
  opacity: 0.85;
}
.vsize:hover:not(:disabled) {
  color: var(--ink);
}
.vsize.active,
.vsize.active:hover:not(:disabled) {
  color: var(--accent-ink);
}
.note {
  min-height: calc(2 * 1.45em);
  margin: 14px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink-faint);
}
.row.end {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
