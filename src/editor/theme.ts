import { ref } from 'vue';

export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'voxelix.theme';
const media = window.matchMedia('(prefers-color-scheme: light)');

function readPref(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** The concrete theme to render right now. */
export function resolveTheme(pref: ThemePref = readPref()): ResolvedTheme {
  if (pref === 'system') return media.matches ? 'light' : 'dark';
  return pref;
}

/** Set [data-theme] on <html>. Called before Vue mounts to avoid a flash. */
export function applyTheme(pref: ThemePref = readPref()): void {
  document.documentElement.dataset.theme = resolveTheme(pref);
}

const pref = ref<ThemePref>(readPref());
const resolved = ref<ResolvedTheme>(resolveTheme(pref.value));

media.addEventListener('change', () => {
  if (pref.value === 'system') {
    resolved.value = resolveTheme('system');
    applyTheme('system');
  }
});

/** Reactive theme state + setter, shared across the app. */
export function useTheme() {
  function setTheme(next: ThemePref) {
    pref.value = next;
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
    resolved.value = resolveTheme(next);
    applyTheme(next);
  }
  return { pref, resolved, setTheme };
}
