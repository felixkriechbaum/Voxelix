<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

export interface MenuItem {
  label?: string;
  action?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const el = ref<HTMLDivElement | null>(null);
const pos = ref({ x: props.x, y: props.y });

function run(item: MenuItem) {
  if (item.disabled || item.separator) return;
  item.action?.();
  emit('close');
}

function onDocPointer(e: PointerEvent) {
  if (el.value && !el.value.contains(e.target as Node)) emit('close');
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
    return;
  }
  const buttons = Array.from(el.value?.querySelectorAll<HTMLButtonElement>('.item:not(:disabled)') ?? []);
  if (buttons.length === 0) return;
  const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
  let next = current;
  if (e.key === 'ArrowDown') next = (current + 1) % buttons.length;
  else if (e.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = buttons.length - 1;
  else return;
  e.preventDefault();
  buttons[next]?.focus();
}

onMounted(() => {
  // keep the menu on-screen
  const r = el.value!.getBoundingClientRect();
  const nx = Math.min(props.x, window.innerWidth - r.width - 6);
  const ny = Math.min(props.y, window.innerHeight - r.height - 6);
  pos.value = { x: Math.max(6, nx), y: Math.max(6, ny) };
  el.value?.querySelector<HTMLButtonElement>('.item:not(:disabled)')?.focus();
  setTimeout(() => document.addEventListener('pointerdown', onDocPointer), 0);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div ref="el" class="menu panel" role="menu" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
    <template v-for="(item, i) in items" :key="i">
      <div v-if="item.separator" class="sep" />
      <button
        v-else
        class="item"
        role="menuitem"
        :class="{ danger: item.danger }"
        :disabled="item.disabled"
        @click="run(item)"
      >
        {{ item.label }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.menu {
  position: fixed;
  z-index: 45;
  min-width: 178px;
  padding: 4px;
  box-shadow: var(--shadow);
}
.item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  padding: 6px 9px;
}
.item:hover:not(:disabled) {
  background: var(--surface-hi);
}
.item.danger {
  color: var(--warn);
}
.item.danger:hover:not(:disabled) {
  background: var(--warn);
  color: var(--warn-ink);
}
.sep {
  height: 1px;
  background: var(--line);
  margin: 4px 2px;
}
</style>
