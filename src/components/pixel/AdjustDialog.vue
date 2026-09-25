<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { usePixelSession } from '@/editor/pixel/session';
import { rgbaToHex } from '@/core/pixel/pack';
import type { Adjustment } from '@/core/pixel/ops/adjust';

export type AdjustKind = 'hsl' | 'brightnessContrast' | 'posterize' | 'replace' | 'scale';

const props = defineProps<{ kind: AdjustKind }>();
const emit = defineEmits<{ close: [] }>();

const store = usePixelStore();
const { runner } = usePixelSession();

const v = reactive({
  hue: 0,
  saturation: 0,
  lightness: 0,
  brightness: 0,
  contrast: 0,
  levels: 4,
  tolerance: 0,
  scaleX: 200,
  scaleY: 200,
  lockRatio: true,
});

const title = computed(
  () =>
    ({
      hsl: 'Hue / Saturation',
      brightnessContrast: 'Brightness / Contrast',
      posterize: 'Posterize',
      replace: 'Replace colour',
      scale: 'Scale',
    })[props.kind],
);
const scope = computed(() => {
  void store.selectionVersion;
  const target = runner.value?.editingMask ? 'mask' : 'layer';
  return runner.value?.selection ? `selection on the active ${target}` : `whole active ${target}`;
});

function adjustment(): Adjustment | null {
  switch (props.kind) {
    case 'hsl':
      return { kind: 'hsl', hue: v.hue, saturation: v.saturation, lightness: v.lightness };
    case 'brightnessContrast':
      return { kind: 'brightnessContrast', brightness: v.brightness, contrast: v.contrast };
    case 'posterize':
      return { kind: 'posterize', levels: v.levels };
    case 'replace':
      return { kind: 'replace', from: store.primaryColor, to: store.secondaryColor, tolerance: v.tolerance };
    case 'scale':
      return null;
  }
}

let raf = 0;
function update() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const adj = adjustment();
    if (adj) runner.value?.previewAdjustment(adj);
  });
}

watch(v, update);
watch(() => [store.primaryColor, store.secondaryColor], update);
watch(
  () => v.scaleX,
  (x) => {
    if (v.lockRatio) v.scaleY = x;
  },
);

function apply() {
  const r = runner.value;
  if (!r) return;
  if (props.kind === 'scale') {
    r.transform({ kind: 'scale', sx: Math.max(1, v.scaleX) / 100, sy: Math.max(1, v.scaleY) / 100 });
  } else {
    cancelAnimationFrame(raf);
    const adj = adjustment();
    if (adj) r.previewAdjustment(adj);
    r.endPreview(true, title.value);
  }
  emit('close');
}

function cancel() {
  runner.value?.endPreview(false);
  emit('close');
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    cancel();
  } else if (e.key === 'Enter' && !(e.target instanceof HTMLSelectElement)) {
    e.preventDefault();
    e.stopPropagation();
    apply();
  }
}

onMounted(() => {
  if (props.kind !== 'scale') {
    runner.value?.beginPreview();
    update();
  }
  window.addEventListener('keydown', onKey, true);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  window.removeEventListener('keydown', onKey, true);
  // closed some other way (widget switch, unmount) — never leave a preview half-applied
  runner.value?.endPreview(false);
});
</script>

<template>
  <form class="panel adjust" role="dialog" :aria-label="title" @submit.prevent="apply">
    <div class="row">
      <h3>{{ title }}</h3>
    </div>
    <p class="scope">Applies to the {{ scope }}.</p>

    <template v-if="kind === 'hsl'">
      <label>Hue <span>{{ v.hue }}°</span><input v-model.number="v.hue" type="range" min="-180" max="180" /></label>
      <label>Saturation <span>{{ v.saturation }}</span><input v-model.number="v.saturation" type="range" min="-100" max="100" /></label>
      <label>Lightness <span>{{ v.lightness }}</span><input v-model.number="v.lightness" type="range" min="-100" max="100" /></label>
    </template>
    <template v-else-if="kind === 'brightnessContrast'">
      <label>Brightness <span>{{ v.brightness }}</span><input v-model.number="v.brightness" type="range" min="-100" max="100" /></label>
      <label>Contrast <span>{{ v.contrast }}</span><input v-model.number="v.contrast" type="range" min="-100" max="100" /></label>
    </template>
    <template v-else-if="kind === 'posterize'">
      <label>Levels per channel <span>{{ v.levels }}</span><input v-model.number="v.levels" type="range" min="2" max="32" /></label>
    </template>
    <template v-else-if="kind === 'replace'">
      <div class="row swatches">
        <span class="sw" :style="{ background: rgbaToHex(store.primaryColor) }" title="Primary colour — what gets replaced" />
        <span>→</span>
        <span class="sw" :style="{ background: rgbaToHex(store.secondaryColor) }" title="Secondary colour — what it becomes" />
        <span class="dim">primary → secondary (pick them in the Colour panel)</span>
      </div>
      <label>Tolerance <span>{{ v.tolerance }}</span><input v-model.number="v.tolerance" type="range" min="0" max="128" /></label>
    </template>
    <template v-else-if="kind === 'scale'">
      <div class="row dims">
        <label>Width %<input v-model.number="v.scaleX" type="number" min="1" max="1600" /></label>
        <label>Height %<input v-model.number="v.scaleY" type="number" min="1" max="1600" :disabled="v.lockRatio" /></label>
      </div>
      <label class="check"><input v-model="v.lockRatio" type="checkbox" /> Keep proportions</label>
      <p class="dim">Nearest-neighbour, about the centre of the selection (or the layer). 200% doubles every pixel.</p>
    </template>

    <div class="row end">
      <button type="button" @click="cancel">Cancel</button>
      <button class="primary" type="submit">Apply</button>
    </div>
  </form>
</template>

<style scoped>
.adjust {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 20;
  width: min(280px, calc(100% - 24px));
  padding: 14px;
  box-shadow: var(--shadow);
}
h3 {
  margin: 0;
}
.scope {
  margin: 4px 0 8px;
  font-size: 11px;
  color: var(--text-dim);
}
label {
  display: block;
  margin: 8px 0 2px;
  font-size: 12px;
  color: var(--text-dim);
}
label span {
  float: right;
  color: var(--text);
}
label input[type='range'] {
  display: block;
  width: 100%;
  margin-top: 3px;
}
.dims {
  gap: 8px;
}
.dims label {
  flex: 1;
  margin: 0;
}
.dims input {
  width: 100%;
  margin-top: 3px;
}
label.check {
  display: flex;
  gap: 6px;
  align-items: center;
}
.swatches {
  gap: 6px;
  align-items: center;
  font-size: 12px;
}
.sw {
  width: 22px;
  height: 22px;
  flex: none;
  border: 1px solid var(--line-strong);
  border-radius: 3px;
}
.dim {
  font-size: 11px;
  color: var(--text-dim);
}
.row.end {
  margin-top: 12px;
  justify-content: flex-end;
  gap: 6px;
}
</style>
