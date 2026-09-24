<script setup lang="ts">
import { computed } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import {
  CONTENT_MARGIN_MAX,
  CONTENT_MARGIN_MIN,
  setContentMarginField,
  setPatchField,
} from '@/core/pixel/ninepatch';
import { elementSpec } from '@/core/pixel/widgets';
import type { ContentMargins } from '@/core/pixel/types';

const store = usePixelStore();
// The project graph is markRaw'd (no deep reactivity), so binding straight to
// `store.activeElement().patch` would never re-render after store.setPatch
// mutates it in place — same object reference in, same object reference out.
// Depend on structureVersion explicitly and hand the template a fresh copy.
// Icons have no nine-patch in Godot (drawn at their own size), so the panel
// hides for them; textures (TextureProgressBar) get stretch margins but no
// content margins.
const widget = computed(() => {
  void store.structureVersion;
  void store.activeVersion;
  const owner = store.activeWidget();
  const w = store.activeElement();
  const kind = owner ? elementSpec(owner.type, store.activeElementId)?.kind ?? 'texture' : 'texture';
  return w && kind !== 'icon'
    ? {
        id: w.id,
        width: w.width,
        height: w.height,
        kind,
        patch: { ...w.patch },
        contentMargins: { ...w.contentMargins },
      }
    : null;
});

function set(field: 'left' | 'top' | 'right' | 'bottom', e: Event) {
  const w = widget.value;
  if (!w) return;
  const raw = Number((e.target as HTMLInputElement).value) || 0;
  store.setPatch(setPatchField(w.patch, field, raw, { w: w.width, h: w.height }));
}

function setContent(field: keyof ContentMargins, e: Event) {
  const w = widget.value;
  if (!w) return;
  const raw = Number((e.target as HTMLInputElement).value);
  store.setContentMargins(setContentMarginField(w.contentMargins, field, raw));
}
</script>

<template>
  <div v-if="widget" class="panel patch-panel">
    <div class="row">
      <h3>Nine-patch margins</h3>
    </div>
    <p class="hint">Stretch-safe borders for the preview and the exported StyleBoxTexture, in pixels.</p>
    <div class="grid">
      <label>Left<input type="number" min="0" :value="widget.patch.left" @change="set('left', $event)" /></label>
      <label>Top<input type="number" min="0" :value="widget.patch.top" @change="set('top', $event)" /></label>
      <label>Right<input type="number" min="0" :value="widget.patch.right" @change="set('right', $event)" /></label>
      <label>Bottom<input type="number" min="0" :value="widget.patch.bottom" @change="set('bottom', $event)" /></label>
    </div>
    <div v-if="widget.kind === 'style'" class="content-section">
      <h3>Content margins</h3>
      <p class="hint">
        Godot content padding in pixels. -1 automatically uses the corresponding nine-patch margin.
      </p>
      <div class="grid">
        <label>
          Left
          <input type="number" :min="CONTENT_MARGIN_MIN" :max="CONTENT_MARGIN_MAX" step="1" :value="widget.contentMargins.left" @change="setContent('left', $event)" />
        </label>
        <label>
          Top
          <input type="number" :min="CONTENT_MARGIN_MIN" :max="CONTENT_MARGIN_MAX" step="1" :value="widget.contentMargins.top" @change="setContent('top', $event)" />
        </label>
        <label>
          Right
          <input type="number" :min="CONTENT_MARGIN_MIN" :max="CONTENT_MARGIN_MAX" step="1" :value="widget.contentMargins.right" @change="setContent('right', $event)" />
        </label>
        <label>
          Bottom
          <input type="number" :min="CONTENT_MARGIN_MIN" :max="CONTENT_MARGIN_MAX" step="1" :value="widget.contentMargins.bottom" @change="setContent('bottom', $event)" />
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.patch-panel {
  padding: 10px;
}
.hint {
  margin: 0 0 8px;
  color: var(--text-dim);
  font-size: 12px;
}
.content-section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}
.content-section h3 {
  margin-bottom: 4px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
}
.grid label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--text-dim);
}
</style>
