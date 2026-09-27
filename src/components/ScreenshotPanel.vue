<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useSession } from '@/editor/session';
import { saveBinaryFile } from '@/core/io/fileSystem';
import { toast } from '@/editor/toasts';
import Icon from './Icon.vue';
import { faCamera, faXmark } from '@fortawesome/pro-solid-svg-icons';
import type { ProjectionMode } from '@/viewport/GodotControls';

const store = useEditorStore();
const { viewport } = useSession();

type ShotView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'angle';

/** yaw in degrees (0 = looking at the front), and the tilt a view starts with */
const views: Array<{ id: ShotView; label: string; yaw: number; tilt: number; title: string }> = [
  { id: 'front', label: 'Front', yaw: 0, tilt: 0, title: 'Straight at the front' },
  { id: 'back', label: 'Back', yaw: 180, tilt: 0, title: 'Straight at the back' },
  { id: 'left', label: 'Left', yaw: -90, tilt: 0, title: 'Straight at the left side' },
  { id: 'right', label: 'Right', yaw: 90, tilt: 0, title: 'Straight at the right side' },
  { id: 'top', label: 'Top', yaw: 0, tilt: 90, title: 'Straight down from above' },
  { id: 'bottom', label: 'Bottom', yaw: 0, tilt: -90, title: 'Straight up from below' },
  { id: 'angle', label: '45°', yaw: 45, tilt: 30, title: 'From the front-right corner, at 45°' },
];
const sizes = [512, 1024, 2048];

// ---- settings, remembered across sessions ------------------------------
const STORAGE_KEY = 'voxelix.screenshot';
interface ShotSettings {
  view: ShotView;
  /** degrees above the horizon */
  tilt: number;
  /** percent — 100 fits the object in the frame */
  zoom: number;
  /** percent of the normal light */
  light: number;
  mode: ProjectionMode;
  size: number;
  transparent: boolean;
}
const defaults: ShotSettings = {
  view: 'angle',
  tilt: 30,
  zoom: 100,
  light: 100,
  mode: 'perspective',
  size: 1024,
  transparent: true,
};
function load(): ShotSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* private mode or bad JSON */
  }
  return { ...defaults };
}
const shot = reactive<ShotSettings>(load());
watch(shot, () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shot));
  } catch {
    /* private mode */
  }
});

const current = computed(() => views.find((v) => v.id === shot.view) ?? views[0]);
/** top / bottom look straight along Y, so tilting means nothing there */
const tiltable = computed(() => shot.view !== 'top' && shot.view !== 'bottom');

function pickView(id: ShotView) {
  shot.view = id;
  shot.tilt = views.find((v) => v.id === id)!.tilt;
}

function applyCamera() {
  const v = current.value;
  const tilt = tiltable.value ? shot.tilt : v.tilt;
  viewport.value?.applyShot({
    yaw: (v.yaw * Math.PI) / 180,
    pitch: (tilt * Math.PI) / 180,
    zoom: shot.zoom / 100,
    mode: shot.mode,
  });
  viewport.value?.setLightScale(shot.light / 100);
}
watch(() => [shot.view, shot.tilt, shot.zoom, shot.light, shot.mode], applyCamera);
// re-aim when the object changes under us (switched in the list, or edited)
watch(() => [store.activeObjectId, store.editVersion], applyCamera, { flush: 'post' });

// ---- save ---------------------------------------------------------------
const saving = ref(false);
const objectName = computed(() => {
  void store.structureVersion;
  return store.activeObject()?.name ?? 'object';
});
/** the object's name, minus characters a file name can't hold */
const fileName = computed(() => `${objectName.value.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'object'}.png`);

async function save() {
  if (!viewport.value || saving.value) return;
  saving.value = true;
  try {
    const blob = await viewport.value.renderShot(shot.size, shot.transparent);
    if (!blob) {
      toast('Could not render the image — try a smaller size', 'error');
      return;
    }
    await saveBinaryFile(fileName.value, blob, { description: 'PNG image', accept: { 'image/png': ['.png'] } });
  } catch (e) {
    toast(`Screenshot failed: ${(e as Error).message}`, 'error');
  } finally {
    saving.value = false;
  }
}

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
  if (e.key === 'Escape') store.screenshotMode = false;
}
onMounted(() => {
  applyCamera();
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <section class="shot" aria-labelledby="shot-title">
    <header class="head">
      <h3 id="shot-title">Screenshot</h3>
      <button class="close" title="Back to modelling — Esc" aria-label="Leave screenshot mode" @click="store.screenshotMode = false">
        <Icon :icon="faXmark" :size="14" />
      </button>
    </header>

    <div class="label" id="shot-view">View</div>
    <div class="views" role="radiogroup" aria-labelledby="shot-view">
      <button
        v-for="v in views"
        :key="v.id"
        :class="{ active: shot.view === v.id, wide: v.id === 'angle' }"
        role="radio"
        :aria-checked="shot.view === v.id"
        :title="v.title"
        @click="pickView(v.id)"
      >
        {{ v.label }}
      </button>
    </div>

    <label class="slider" :class="{ off: !tiltable }">
      <span>Tilt</span>
      <input v-model.number="shot.tilt" type="range" min="-60" max="80" step="1" :disabled="!tiltable" />
      <span class="val">{{ tiltable ? `${shot.tilt}°` : '—' }}</span>
    </label>
    <label class="slider">
      <span>Zoom</span>
      <input v-model.number="shot.zoom" type="range" min="50" max="250" step="5" />
      <span class="val">{{ shot.zoom }}%</span>
    </label>
    <label class="slider">
      <span>Light</span>
      <input v-model.number="shot.light" type="range" min="20" max="200" step="5" />
      <span class="val">{{ shot.light }}%</span>
    </label>

    <div class="label">Camera</div>
    <div class="seg fill">
      <button :class="{ active: shot.mode === 'perspective' }" :aria-pressed="shot.mode === 'perspective'" @click="shot.mode = 'perspective'">
        Perspective
      </button>
      <button
        :class="{ active: shot.mode === 'ortho' }"
        :aria-pressed="shot.mode === 'ortho'"
        title="No perspective distortion — parallel edges stay parallel, good for icons"
        @click="shot.mode = 'ortho'"
      >
        Ortho
      </button>
    </div>

    <div class="label">Image size in pixels</div>
    <div class="seg fill">
      <button
        v-for="s in sizes"
        :key="s"
        :class="{ active: shot.size === s }"
        :aria-pressed="shot.size === s"
        @click="shot.size = s"
      >
        {{ s }}
      </button>
    </div>
    <label class="check">
      <input v-model="shot.transparent" type="checkbox" />
      Transparent background
    </label>

    <button class="primary save" :disabled="saving" @click="save">
      <Icon :icon="faCamera" :size="13" />
      <span>{{ saving ? 'Saving…' : 'Save image' }}</span>
    </button>
    <p class="file" :title="fileName">{{ fileName }}</p>
  </section>
</template>

<style scoped>
.shot {
  width: 232px;
  padding: 10px 12px 12px;
  background: color-mix(in srgb, var(--surface-1) 94%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  backdrop-filter: blur(6px);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.head h3 {
  margin: 0;
  font-size: 14px;
}
.close {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  color: var(--ink-dim);
  background: transparent;
  border-color: transparent;
}
.close:hover:not(:disabled) {
  color: var(--ink);
}
.label {
  margin: 10px 0 5px;
  font-size: 12px;
  color: var(--ink-dim);
}
.views {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 3px;
}
.views button {
  padding: 3px 6px;
  font-size: 12px;
}
.views .wide {
  grid-column: 1 / -1;
}
.slider {
  display: grid;
  grid-template-columns: 38px 1fr 42px;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--ink-dim);
}
.slider:first-of-type {
  margin-top: 12px;
}
.slider input {
  width: 100%;
  min-width: 0;
}
.slider.off {
  opacity: 0.5;
}
.val {
  text-align: right;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.seg.fill {
  display: flex;
}
.seg.fill > button {
  flex: 1;
  font-size: 12px;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 12px;
  cursor: pointer;
}
.check input {
  accent-color: var(--accent);
  margin: 0;
}
.save {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 14px;
  padding: 7px 10px;
}
.file {
  margin: 6px 0 0;
  font-size: 11.5px;
  color: var(--ink-faint);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
