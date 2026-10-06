import { ref, watch } from 'vue';

/** Which sidebar sections are folded away — remembered across reloads. */
const STORAGE_KEY = 'voxelix.panels';

interface StoredPrefs {
  paletteCollapsed: boolean;
  partsCollapsed: boolean;
}

function load(): StoredPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
      return { paletteCollapsed: !!parsed.paletteCollapsed, partsCollapsed: !!parsed.partsCollapsed };
    }
  } catch {
    /* private mode / corrupt value — fall through to defaults */
  }
  return { paletteCollapsed: false, partsCollapsed: false };
}

const initial = load();

/** Palette folded down to the current colour + its opacity. */
export const paletteCollapsed = ref(initial.paletteCollapsed);
/** The active object's parts list + modifier stack folded down to a one-line summary. */
export const partsCollapsed = ref(initial.partsCollapsed);

watch([paletteCollapsed, partsCollapsed], () => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ paletteCollapsed: paletteCollapsed.value, partsCollapsed: partsCollapsed.value }),
    );
  } catch {
    /* private mode */
  }
});
