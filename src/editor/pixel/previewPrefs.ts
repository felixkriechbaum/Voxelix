import { ref, watch } from 'vue';

/** One user-defined preview slot: a fixed pixel size to render the active widget/state into, at its own zoom. */
export interface PreviewVariant {
  id: string;
  label: string;
  w: number;
  h: number;
  zoom: number;
}

const STORAGE_KEY = 'voxelix.pixelPreview';
export const MIN_PREVIEW_WIDTH = 220;
export const MAX_PREVIEW_WIDTH = 640;
const DEFAULT_PREVIEW_WIDTH = 280;

interface StoredPrefs {
  expanded: boolean;
  width: number;
  variants: PreviewVariant[];
}

function clampWidth(w: number): number {
  return Math.min(MAX_PREVIEW_WIDTH, Math.max(MIN_PREVIEW_WIDTH, Math.round(w)));
}

function defaultVariants(): PreviewVariant[] {
  return [
    { id: 'own-size', label: 'Own size', w: 32, h: 16, zoom: 3 },
    { id: 'wide', label: 'Wide', w: 96, h: 16, zoom: 2 },
  ];
}

function load(): StoredPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
      const variants = Array.isArray(parsed.variants) ? parsed.variants : null;
      return {
        expanded: parsed.expanded ?? true,
        width: clampWidth(parsed.width ?? DEFAULT_PREVIEW_WIDTH),
        variants: variants && variants.length ? variants : defaultVariants(),
      };
    }
  } catch {
    /* private mode / corrupt value — fall through to defaults */
  }
  return { expanded: true, width: DEFAULT_PREVIEW_WIDTH, variants: defaultVariants() };
}

const initial = load();

/** Whether the preview column is expanded — shared module state, so the grid
 *  column (owned by PixelEditorView) and the panel (WidgetPreview) agree without prop plumbing. */
export const previewExpanded = ref(initial.expanded);
/** Preview column width in CSS px while expanded — dragged via the handle on WidgetPreview's left edge. */
export const previewWidth = ref(initial.width);
/** True while the handle is being dragged — not persisted, just lets the grid
 *  column's CSS transition switch off so live dragging tracks the cursor
 *  instead of easing a beat behind it. */
export const previewResizing = ref(false);
/** The user's own list of preview boxes — persisted, not part of project data (it's a viewing preference, not the design). */
export const previewVariants = ref<PreviewVariant[]>(initial.variants);

export function setPreviewWidth(w: number): void {
  previewWidth.value = clampWidth(w);
}

function persist(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        expanded: previewExpanded.value,
        width: previewWidth.value,
        variants: previewVariants.value,
      }),
    );
  } catch {
    /* private mode */
  }
}
watch([previewExpanded, previewWidth, previewVariants], persist, { deep: true });

export function addPreviewVariant(base?: { w: number; h: number }): void {
  previewVariants.value = [
    ...previewVariants.value,
    { id: crypto.randomUUID(), label: 'Custom', w: base?.w ?? 32, h: base?.h ?? 16, zoom: 2 },
  ];
}

export function removePreviewVariant(id: string): void {
  previewVariants.value = previewVariants.value.filter((v) => v.id !== id);
}
