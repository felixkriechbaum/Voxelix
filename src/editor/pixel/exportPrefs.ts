import { ref, watch } from 'vue';
import { normalizeResPrefix } from '@/pixel/exportWidget';

const STORAGE_KEY = 'voxelix.pixelExport';

function load(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { resPrefix?: string };
      if (parsed.resPrefix) return normalizeResPrefix(parsed.resPrefix);
    }
  } catch {
    /* private mode / corrupt value */
  }
  return 'res://';
}

/**
 * The Godot res:// folder exported .tres files will reference. A visible,
 * persisted field rather than a per-export window.prompt() — that was the
 * original design, but browsers can (and do, after enough dialogs on one
 * page) silently start returning null from prompt() instead of showing it,
 * with a checkbox the user may not even remember ticking. Every subsequent
 * export then failed to make it past the null check, with zero feedback —
 * exactly "the second time I click, nothing happens". Persisted state has no
 * such failure mode: the field is just always there, editable in place.
 */
export const resPrefix = ref(load());

export function setResPrefix(v: string): void {
  resPrefix.value = normalizeResPrefix(v);
}

watch(resPrefix, (v) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ resPrefix: v }));
  } catch {
    /* private mode */
  }
});
