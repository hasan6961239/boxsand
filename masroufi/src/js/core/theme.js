// Appearance: light/dark/auto, accent color, motion level, text size, digits.
// The last applied look is cached in localStorage so index.html can paint the
// right colors before any script loads (no white flash in dark mode).

import { ACCENTS } from './defaults.js';
import { setFormatPrefs } from './util.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
let look = null;

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export function isDark() {
  if (!look) return media.matches;
  return look.mode === 'dark' || (look.mode === 'auto' && media.matches);
}

export function motion() {
  if (!look) return reduce.matches ? 'reduced' : 'full';
  if (look.motion === 'full' && reduce.matches) return 'reduced';
  return look.motion;
}

export function apply(next) {
  look = { ...next };
  const root = document.documentElement;
  const dark = isDark();
  const acc = ACCENTS[look.accent] || ACCENTS.emerald;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.motion = motion();
  root.dataset.size = look.size || 'm';
  root.style.setProperty('--accent', acc.a);
  root.style.setProperty('--accent-2', acc.b);
  root.style.setProperty('--accent-rgb', hexToRgb(acc.a));
  root.style.setProperty('--accent-ink', acc.ink);
  setFormatPrefs({ digits: look.digits || 'latin' });
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || (dark ? '#0B0F0E' : '#F3F6F5');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
  try {
    localStorage.setItem('look', JSON.stringify({ dark, a: acc.a, b: acc.b, rgb: hexToRgb(acc.a), motion: motion(), size: look.size || 'm' }));
  } catch { /* private mode */ }
}

media.addEventListener('change', () => look && look.mode === 'auto' && apply(look));
reduce.addEventListener('change', () => look && apply(look));
