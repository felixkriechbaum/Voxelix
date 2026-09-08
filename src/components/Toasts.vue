<script setup lang="ts">
import { dismissToast, useToasts } from '@/editor/toasts';

const { items } = useToasts();
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <button
        v-for="t in items"
        :key="t.id"
        class="toast"
        :class="t.kind"
        title="Dismiss"
        @click="dismissToast(t.id)"
      >
        {{ t.text }}
      </button>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  pointer-events: none;
}
.toast {
  --toast-accent: var(--status-info);
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 320px;
  padding: 8px 12px;
  font-size: 12px;
  text-align: left;
  color: var(--ink);
  /* plain surface first, so a browser without color-mix still reads fine */
  background: var(--surface-1);
  background: color-mix(in srgb, var(--toast-accent) 9%, var(--surface-1));
  border: 1px solid var(--line);
  border-left: 3px solid var(--toast-accent);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow);
}
.toast.success {
  --toast-accent: var(--status-success);
}
.toast.error {
  --toast-accent: var(--status-error);
}
/* a small dot carries the state too, so it isn't colour-only */
.toast::before {
  content: '';
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--toast-accent);
}
.toast:hover {
  background: color-mix(in srgb, var(--toast-accent) 16%, var(--surface-1));
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
.toast-leave-active {
  position: absolute;
  right: 0;
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
</style>
