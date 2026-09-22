import { ref, watch } from 'vue';

const STORAGE_KEY = 'voxelix.pixelSide';
export const MIN_SIDE_WIDTH = 200;
export const MAX_SIDE_WIDTH = 480;
const DEFAULT_SIDE_WIDTH = 260;

interface StoredPrefs {
  expanded: boolean;
  width: number;
}

function clampWidth(w: number): number {
  return Math.min(MAX_SIDE_WIDTH, Math.max(MIN_SIDE_WIDTH, Math.round(w)));
}

function load(): StoredPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
      return { expanded: parsed.expanded ?? true, width: clampWidth(parsed.width ?? DEFAULT_SIDE_WIDTH) };
    }
  } catch {
    /* private mode / corrupt value — fall through to defaults */
  }
  return { expanded: true, width: DEFAULT_SIDE_WIDTH };
}

const initial = load();

/** Whether the side column (widgets/colour/nine-patch) is expanded — shared
 *  module state, same reasoning as previewPrefs.ts's previewExpanded. */
export const sideExpanded = ref(initial.expanded);
/** Side column width in CSS px while expanded — dragged via the handle on its right edge. */
export const sideWidth = ref(initial.width);
/** True while the handle is being dragged — see previewPrefs.ts's previewResizing. */
export const sideResizing = ref(false);

export function setSideWidth(w: number): void {
  sideWidth.value = clampWidth(w);
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ expanded: sideExpanded.value, width: sideWidth.value }));
  } catch {
    /* private mode */
  }
}
watch([sideExpanded, sideWidth], persist);
