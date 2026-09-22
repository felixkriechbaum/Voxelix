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

interface StoredPrefs {
  expanded: boolean;
  variants: PreviewVariant[];
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
        variants: variants && variants.length ? variants : defaultVariants(),
      };
    }
  } catch {
    /* private mode / corrupt value — fall through to defaults */
  }
  return { expanded: true, variants: defaultVariants() };
}

const initial = load();

/** Whether the preview column is expanded — shared module state, so the grid
 *  column (owned by PixelEditorView) and the panel (WidgetPreview) agree without prop plumbing. */
export const previewExpanded = ref(initial.expanded);
/** The user's own list of preview boxes — persisted, not part of project data (it's a viewing preference, not the design). */
export const previewVariants = ref<PreviewVariant[]>(initial.variants);

function persist(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ expanded: previewExpanded.value, variants: previewVariants.value }),
    );
  } catch {
    /* private mode */
  }
}
watch([previewExpanded, previewVariants], persist, { deep: true });

export function addPreviewVariant(base?: { w: number; h: number }): void {
  previewVariants.value = [
    ...previewVariants.value,
    { id: crypto.randomUUID(), label: 'Custom', w: base?.w ?? 32, h: base?.h ?? 16, zoom: 2 },
  ];
}

export function removePreviewVariant(id: string): void {
  previewVariants.value = previewVariants.value.filter((v) => v.id !== id);
}
