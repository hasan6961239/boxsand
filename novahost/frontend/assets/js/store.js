import { setLocale, getLocale, applyDocumentLocale } from './i18n.js';

/**
 * Application state.
 *
 * A plain observable object rather than a state library. The dashboard has one
 * user, a handful of screens and no shared derived state worth a framework —
 * adding one would be weight the phone pays for on every page load.
 *
 * Theme and locale are mirrored into localStorage so the choice survives a
 * reload even before /api/auth/me answers. Reads are wrapped because storage
 * throws in a private window and must never break boot.
 */

const STORAGE_KEY = 'novahost.prefs';

function readPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* private mode or blocked storage — the session still works */ }
}

const prefs = readPrefs();

const state = {
  user: null,
  setupRequired: false,
  theme: prefs.theme ?? 'dark',
  locale: prefs.locale ?? 'ar',
  health: null,
  sidebarOpen: false,
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(changed) {
  for (const listener of listeners) {
    try { listener(state, changed); } catch (err) { console.error(err); }
  }
}

export function getState() {
  return state;
}

export function setState(patch) {
  const changed = [];
  for (const [key, value] of Object.entries(patch)) {
    if (state[key] !== value) {
      state[key] = value;
      changed.push(key);
    }
  }
  if (changed.length) emit(changed);
}

/** Resolve 'system' against the OS preference and apply it to the document. */
export function applyTheme(theme = state.theme) {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

export function setTheme(theme) {
  setState({ theme });
  prefs.theme = theme;
  writePrefs(prefs);
  applyTheme(theme);
}

export function setLanguage(locale) {
  setState({ locale });
  prefs.locale = locale;
  writePrefs(prefs);
  setLocale(locale);
}

export function initPreferences() {
  setLocale(state.locale);
  applyDocumentLocale();
  applyTheme(state.theme);

  // Follow the OS while the user has chosen "system".
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (state.theme === 'system') applyTheme('system');
  });
}

export { getLocale };
