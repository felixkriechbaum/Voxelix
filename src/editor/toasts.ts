import { ref } from 'vue';

export type ToastKind = 'success' | 'info' | 'error';

export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

/** Shared queue — module state, so anything can post without prop drilling. */
const items = ref<Toast[]>([]);
let nextId = 1;

export function useToasts() {
  return { items };
}

/**
 * Post a short confirmation. Dismisses itself; posting the same text again
 * replaces the standing one rather than stacking a duplicate (Ctrl+S twice).
 */
export function toast(text: string, kind: ToastKind = 'info', ms = 2600): void {
  const id = nextId++;
  items.value = [...items.value.filter((t) => t.text !== text), { id, text, kind }];
  setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: number): void {
  items.value = items.value.filter((t) => t.id !== id);
}
