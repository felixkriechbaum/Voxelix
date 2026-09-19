<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useEditorStore } from '@/stores/editor';
import { useTheme, type ThemePref } from '@/editor/theme';

const store = useEditorStore();
const emit = defineEmits<{ (e: 'close'): void }>();
const { pref, setTheme } = useTheme();

const dialog = ref<HTMLDivElement | null>(null);
let returnFocus: HTMLElement | null = null;

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    done();
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
  } else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
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
  void nextTick(() => dialog.value?.focus());
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  returnFocus?.focus();
});

const themes: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const s = store.exportSettings;
const form = reactive({ refVoxels: s.refVoxels, refMeters: s.refMeters, upAxis: s.upAxis });

const perVoxel = computed(() => {
  const v = form.refMeters / form.refVoxels;
  return Number.isFinite(v) && v > 0 ? v : 0;
});

function done() {
  store.updateExportSettings({
    refVoxels: Math.max(1, Math.round(form.refVoxels || 1)),
    refMeters: Math.max(0.0001, Number(form.refMeters) || 1),
    upAxis: form.upAxis,
  });
  emit('close');
}
</script>

<template>
  <div class="overlay" @click.self="done">
    <div
      ref="dialog"
      class="panel dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
    >
      <div class="row title">
        <h3 id="settings-title">Settings</h3>
        <span class="spacer" />
        <button class="x" title="Close" @click="done">×</button>
      </div>

      <section>
        <h4>Appearance</h4>
        <div class="seg">
          <button
            v-for="t in themes"
            :key="t.value"
            :class="{ active: pref === t.value }"
            :aria-pressed="pref === t.value"
            @click="setTheme(t.value)"
          >
            {{ t.label }}
          </button>
        </div>
        <p class="note">System follows your OS light/dark setting.</p>
      </section>

      <section>
        <h4>Export scale</h4>
        <div class="row scale">
          <input
            aria-label="Reference size in voxels"
            v-model.number="form.refVoxels"
            type="number"
            min="1"
            step="1"
            title="A cube this many voxels wide…"
          />
          <span>voxels&nbsp;=</span>
          <input
            aria-label="Reference size in metres"
            v-model.number="form.refMeters"
            type="number"
            min="0.001"
            step="0.1"
            title="…is exported as this many metres"
          />
          <span>metres</span>
        </div>
        <p class="note">1 voxel = {{ perVoxel.toFixed(4) }} m · a 16-voxel edge = {{ (perVoxel * 16).toFixed(2) }} m</p>
      </section>

      <section>
        <h4>Up axis</h4>
        <div class="seg">
          <button :class="{ active: form.upAxis === 'y' }" :aria-pressed="form.upAxis === 'y'" @click="form.upAxis = 'y'" title="glTF standard">
            Y-up · glTF
          </button>
          <button :class="{ active: form.upAxis === 'z' }" :aria-pressed="form.upAxis === 'z'" @click="form.upAxis = 'z'" title="Rotated for Blender import">
            Z-up · Blender
          </button>
        </div>
      </section>

      <div class="row end">
        <button class="primary" @click="done">Done</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  display: grid;
  place-items: center;
  z-index: 30;
}
.dialog {
  width: min(340px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: auto;
  padding: 16px 18px 18px;
  box-shadow: var(--shadow);
}
.title h3 {
  margin: 0;
}
.x {
  width: 26px;
  height: 26px;
  padding: 0;
  font-size: 16px;
  line-height: 1;
  color: var(--ink-dim);
}
section {
  margin-top: 16px;
}
h4 {
  margin: 0 0 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-dim);
}
.seg {
  display: flex;
  gap: 4px;
}
.seg button {
  flex: 1;
}
.note {
  margin: 7px 0 0;
  font-size: 11px;
  color: var(--ink-faint);
}
.scale {
  gap: 6px;
}
.scale input {
  width: 64px;
}
.end {
  margin-top: 18px;
  justify-content: flex-end;
}
</style>
