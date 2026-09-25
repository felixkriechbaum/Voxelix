<script setup lang="ts">
import { computed } from 'vue';
import { usePixelStore } from '@/stores/pixel';
import { specFor } from '@/core/pixel/widgets';
import { hexToRgba, packRgba, rgbaToHex, unpackRgba } from '@/core/pixel/pack';
import Icon from '@/components/Icon.vue';
import { faXmark, faFillDrip } from '@fortawesome/pro-solid-svg-icons';

const store = usePixelStore();

/** Godot's default font colour (0.875 gray) — what an unset item shows as before anything along its chain is set. */
const GODOT_DEFAULT = packRgba(223, 223, 223, 255);

// the colour map lives on the markRaw'd widget, so depend on the counters setWidgetColor bumps
const rows = computed(() => {
  void store.structureVersion;
  void store.activeVersion;
  const w = store.activeWidget();
  if (!w) return [];
  const specs = specFor(w.type).colors ?? [];
  return specs.map((c) => {
    const own = w.colors.get(c.id);
    const shown = own ?? w.resolveColor(c.id) ?? GODOT_DEFAULT;
    const fromLabel = c.from ? specs.find((x) => x.id === c.from)?.label : undefined;
    return {
      ...c,
      set: own !== undefined,
      hex: rgbaToHex(shown),
      alpha: unpackRgba(shown)[3],
      fallback: fromLabel ? `uses ${fromLabel}` : 'Godot default',
      current: !!c.state && c.state === store.activeStateId,
    };
  });
});

function onColor(id: string, e: Event, alpha: number) {
  store.setWidgetColor(id, hexToRgba((e.target as HTMLInputElement).value, alpha));
}
function onAlpha(id: string, hex: string, e: Event) {
  store.setWidgetColor(id, hexToRgba(hex, Number((e.target as HTMLInputElement).value)));
}
</script>

<template>
  <div v-if="rows.length" class="panel font-colors">
    <div class="row">
      <h3>Text colours</h3>
    </div>
    <p class="hint">Exported to the theme as <code>colors/…</code>. Unset ones keep Godot's default.</p>
    <ul class="list">
      <li v-for="r in rows" :key="r.id" class="item" :class="{ current: r.current, unset: !r.set }" :title="`${r.id}${r.hint ? ' — ' + r.hint : ''}`">
        <span class="name">{{ r.label }}</span>
        <span v-if="!r.set" class="fallback">{{ r.fallback }}</span>
        <span class="spacer" />
        <input type="color" :value="r.hex" :title="`Set ${r.id}`" @input="onColor(r.id, $event, r.alpha)" />
        <input
          type="range"
          min="0"
          max="255"
          :value="r.alpha"
          :disabled="!r.set"
          class="alpha"
          title="Alpha"
          @input="onAlpha(r.id, r.hex, $event)"
        />
        <button class="icon-btn" title="Use the primary colour" @click="store.setWidgetColor(r.id, store.primaryColor)">
          <Icon :icon="faFillDrip" :size="11" />
        </button>
        <button class="icon-btn" :disabled="!r.set" title="Clear (back to the fallback)" @click="store.setWidgetColor(r.id, null)">
          <Icon :icon="faXmark" :size="11" />
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.font-colors {
  padding: 10px;
}
.hint {
  margin: 2px 0 6px;
  font-size: 11px;
  color: var(--text-dim);
}
.hint code {
  font-size: 10px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: 12px;
}
.item.current {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.name {
  white-space: nowrap;
}
.fallback {
  font-size: 10px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.item.unset input[type='color'] {
  opacity: 0.45;
}
input[type='color'] {
  width: 26px;
  height: 20px;
  padding: 0;
  flex: none;
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.alpha {
  width: 48px;
  flex: none;
}
.icon-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
