<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from './Icon.vue';
import { faChevronRight } from '@fortawesome/pro-solid-svg-icons';

export interface MenuItem {
  label?: string;
  action?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  /** opens a submenu beside the item instead of running an action */
  children?: MenuItem[];
}

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>();
const emit = defineEmits<{ (e: 'close'): void }>();

/** A submenu longer than this gets a filter field. */
const FILTER_FROM = 8;
const GAP = 6;

const root = ref<HTMLDivElement | null>(null);
const el = ref<HTMLDivElement | null>(null);
const subEl = ref<HTMLDivElement | null>(null);
const filterInput = ref<HTMLInputElement | null>(null);
const pos = ref({ x: props.x, y: props.y });

// the open submenu: which item it belongs to, and where it sits
const sub = ref<{ index: number; x: number; y: number } | null>(null);
const filter = ref('');
const subItems = computed(() => (sub.value ? (props.items[sub.value.index].children ?? []) : []));
const filterable = computed(() => subItems.value.filter((c) => !c.separator).length > FILTER_FROM);
const shownSubItems = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return subItems.value;
  return subItems.value.filter((c) => !c.separator && c.label?.toLowerCase().includes(q));
});

let closeTimer = 0;
function cancelClose() {
  clearTimeout(closeTimer);
}
/** Closes the submenu after a moment, so a diagonal move towards it can cross other items. */
function closeSubSoon() {
  cancelClose();
  closeTimer = window.setTimeout(() => (sub.value = null), 250);
}

function itemButton(index: number) {
  return el.value?.querySelector<HTMLButtonElement>(`.item[data-index="${index}"]`) ?? null;
}

async function openSub(index: number, focus: 'none' | 'first') {
  cancelClose();
  if (sub.value?.index !== index) {
    filter.value = '';
    const r = itemButton(index)?.getBoundingClientRect();
    if (!r) return;
    sub.value = { index, x: r.right + 2, y: r.top - 5 };
    await nextTick();
    // beside the item, flipped to the left / pushed up when it would leave the screen
    const s = subEl.value?.getBoundingClientRect();
    const m = el.value?.getBoundingClientRect();
    if (s && m && sub.value) {
      let x = m.right + 2;
      if (x + s.width > window.innerWidth - GAP) x = m.left - s.width - 2;
      const y = Math.min(r.top - 5, window.innerHeight - s.height - GAP);
      sub.value = { index, x: Math.max(GAP, x), y: Math.max(GAP, y) };
    }
  }
  if (focus === 'first') {
    await nextTick();
    if (filterInput.value) filterInput.value.focus();
    else subEl.value?.querySelector<HTMLButtonElement>('.item:not(:disabled)')?.focus();
  }
}

function closeSub(refocus: boolean) {
  const index = sub.value?.index;
  sub.value = null;
  if (refocus && index !== undefined) itemButton(index)?.focus();
}

function onItemEnter(item: MenuItem, index: number) {
  if (item.children && !item.disabled) openSub(index, 'none');
  else if (sub.value) closeSubSoon();
}

function run(item: MenuItem, index?: number) {
  if (item.disabled || item.separator) return;
  if (item.children) {
    if (index !== undefined) openSub(index, 'first');
    return;
  }
  item.action?.();
  emit('close');
}

function onFilterEnter() {
  const first = shownSubItems.value.find((c) => !c.separator && !c.disabled);
  if (first) run(first);
}

function onDocPointer(e: PointerEvent) {
  if (root.value && !root.value.contains(e.target as Node)) emit('close');
}
function onKey(e: KeyboardEvent) {
  const inSub = !!subEl.value && subEl.value.contains(document.activeElement);
  if (e.key === 'Escape') {
    e.preventDefault();
    if (sub.value) closeSub(true);
    else emit('close');
    return;
  }
  // the filter field keeps its own caret keys
  if (document.activeElement === filterInput.value && !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  if (inSub && e.key === 'ArrowLeft') {
    e.preventDefault();
    closeSub(true);
    return;
  }
  if (!inSub && e.key === 'ArrowRight') {
    const index = Number((document.activeElement as HTMLElement | null)?.dataset.index);
    if (props.items[index]?.children) {
      e.preventDefault();
      openSub(index, 'first');
    }
    return;
  }
  const scope = inSub ? subEl.value : el.value;
  const buttons = Array.from(scope?.querySelectorAll<HTMLButtonElement>('.item:not(:disabled)') ?? []);
  if (buttons.length === 0) return;
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const current = Math.max(0, at);
  let next = current;
  if (e.key === 'ArrowDown') next = at < 0 ? 0 : (current + 1) % buttons.length;
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
  const nx = Math.min(props.x, window.innerWidth - r.width - GAP);
  const ny = Math.min(props.y, window.innerHeight - r.height - GAP);
  pos.value = { x: Math.max(GAP, nx), y: Math.max(GAP, ny) };
  el.value?.querySelector<HTMLButtonElement>('.item:not(:disabled)')?.focus();
  setTimeout(() => document.addEventListener('pointerdown', onDocPointer), 0);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  cancelClose();
  document.removeEventListener('pointerdown', onDocPointer);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div ref="root">
    <div ref="el" class="menu panel" role="menu" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
      <template v-for="(item, i) in items" :key="i">
        <div v-if="item.separator" class="sep" />
        <button
          v-else
          class="item"
          role="menuitem"
          :data-index="i"
          :class="{ danger: item.danger, parent: item.children, open: sub?.index === i }"
          :disabled="item.disabled"
          :aria-haspopup="item.children ? 'menu' : undefined"
          :aria-expanded="item.children ? sub?.index === i : undefined"
          @mouseenter="onItemEnter(item, i)"
          @click="run(item, i)"
        >
          <span class="label">{{ item.label }}</span>
          <Icon v-if="item.children" class="chev" :icon="faChevronRight" :size="10" />
        </button>
      </template>
    </div>

    <div
      v-if="sub"
      ref="subEl"
      class="menu panel sub"
      role="menu"
      :style="{ left: sub.x + 'px', top: sub.y + 'px' }"
      @mouseenter="cancelClose"
    >
      <input
        v-if="filterable"
        ref="filterInput"
        v-model="filter"
        class="filter"
        type="text"
        placeholder="Filter…"
        spellcheck="false"
        @keydown.enter.prevent="onFilterEnter"
      />
      <div class="scroll">
        <template v-for="(item, i) in shownSubItems" :key="i">
          <div v-if="item.separator" class="sep" />
          <button
            v-else
            class="item"
            role="menuitem"
            :class="{ danger: item.danger }"
            :disabled="item.disabled"
            :title="item.label"
            @click="run(item)"
          >
            <span class="label">{{ item.label }}</span>
          </button>
        </template>
        <p v-if="shownSubItems.length === 0" class="empty">Nothing matches</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu {
  position: fixed;
  z-index: 45;
  min-width: 178px;
  max-height: calc(100vh - 12px);
  overflow-y: auto;
  padding: 4px;
  box-shadow: var(--shadow);
}
.menu.sub {
  z-index: 46;
  display: flex;
  flex-direction: column;
  max-width: 280px;
  overflow: hidden;
}
.scroll {
  overflow-y: auto;
  min-height: 0;
}
.filter {
  flex: none;
  width: 100%;
  margin-bottom: 4px;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  padding: 6px 9px;
}
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chev {
  flex: none;
  opacity: 0.6;
}
.item:hover:not(:disabled),
.item.open {
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
.empty {
  margin: 0;
  padding: 6px 9px;
  color: var(--ink-faint);
}
</style>
