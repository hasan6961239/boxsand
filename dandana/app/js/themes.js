// Complete colour themes. Each one sets every surface/text/accent variable;
// an optional accent override recolours buttons and highlights only.
import * as lib from './library.js';
import { h, ic, sheet } from './util.js';

const T = (id, name, dark, c) => ({ id, name, dark, c });
export const THEMES = [
  T('night', 'ليل', true, { bg: '#0c0a10', bg2: '#131019', card: '#1b1722', card2: '#241f2d', card3: '#2e2839', text: '#f6f3fa', muted: '#a9a1b6', dim: '#716a80', accent: '#f2b84b', accent2: '#ffd88f', ink: '#1d1406', rose: '#ef5d7e' }),
  T('amoled', 'أسود', true, { bg: '#000000', bg2: '#0b0b0b', card: '#121212', card2: '#1b1b1b', card3: '#272727', text: '#ffffff', muted: '#a6a6a6', dim: '#6c6c6c', accent: '#e8c27a', accent2: '#f6dfb0', ink: '#1a1203', rose: '#ff4f7b' }),
  T('tarab', 'طرب', true, { bg: '#170d08', bg2: '#1f130c', card: '#2a1a11', card2: '#352217', card3: '#432c1e', text: '#fbefe2', muted: '#c9ab92', dim: '#8e7360', accent: '#e9b85c', accent2: '#f7d79a', ink: '#2a1704', rose: '#e8735e' }),
  T('sea', 'بحر', true, { bg: '#06111c', bg2: '#0a1826', card: '#0f2133', card2: '#152b40', card3: '#1c374f', text: '#eaf6ff', muted: '#93b2c9', dim: '#5e7d94', accent: '#3fd0e0', accent2: '#9bebf3', ink: '#022127', rose: '#ff7a90' }),
  T('emerald', 'زمرّد', true, { bg: '#06130e', bg2: '#0a1b14', card: '#10251c', card2: '#163126', card3: '#1e3e31', text: '#ecfbf3', muted: '#98c2ad', dim: '#5f8a74', accent: '#3fe0a0', accent2: '#9ff2cf', ink: '#032116', rose: '#ff8a8a' }),
  T('rose', 'ورد', true, { bg: '#16070e', bg2: '#1e0b14', card: '#2a101c', card2: '#361626', card3: '#451d31', text: '#fdeef4', muted: '#d1a3b7', dim: '#94667b', accent: '#ff6f9f', accent2: '#ffb3cc', ink: '#2b0613', rose: '#ff4f7b' }),
  T('violet', 'بنفسج', true, { bg: '#0d0818', bg2: '#130c22', card: '#1c1230', card2: '#26193f', card3: '#31214f', text: '#f3eeff', muted: '#b0a3d1', dim: '#75699a', accent: '#b18cff', accent2: '#d9c7ff', ink: '#170a33', rose: '#ff7aa8' }),
  T('sunset', 'غروب', true, { bg: '#140909', bg2: '#1c0d0c', card: '#281412', card2: '#341b17', card3: '#43241e', text: '#fff0ea', muted: '#d6a99b', dim: '#946c60', accent: '#ff8a4c', accent2: '#ffc09b', ink: '#2b0e02', rose: '#ff5c7a' }),
  T('day', 'نهار', false, { bg: '#f6f4f9', bg2: '#efecf3', card: '#ffffff', card2: '#f1eef5', card3: '#e6e1ec', text: '#17121e', muted: '#645c71', dim: '#9a92a7', accent: '#c7860f', accent2: '#8a5a00', ink: '#ffffff', rose: '#d63b60' }),
  T('sand', 'رمل', false, { bg: '#f6efe4', bg2: '#efe5d6', card: '#fffaf2', card2: '#f2e8d9', card3: '#e6d8c4', text: '#2a1d10', muted: '#7a6650', dim: '#a8957d', accent: '#c0622b', accent2: '#8a3f12', ink: '#ffffff', rose: '#d6455d' }),
];

export const ACCENTS = [
  ['auto', 'حسب السمة', null],
  ['gold', 'ذهبي', '#f2b84b'], ['rose', 'وردي', '#ef5d7e'], ['teal', 'فيروزي', '#3fd0b6'],
  ['violet', 'بنفسجي', '#a78bfa'], ['blue', 'أزرق', '#5aa9ff'], ['orange', 'برتقالي', '#ff8a4c'],
  ['green', 'أخضر', '#4fd18b'], ['red', 'أحمر', '#ff5d63'],
];

export function byId(id) {
  if (id === 'auto') return THEMES.find((t) => t.id === (matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night'));
  if (id === 'dark') return THEMES[0];
  if (id === 'light') return THEMES.find((t) => t.id === 'day');
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(hex, other, f) {
  const a = hexToRgb(hex), b = hexToRgb(other);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * f).toString(16).padStart(2, '0')).join('');
}
const lum = (hex) => { const [r, g, b] = hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

export function apply() {
  const t = byId(lib.settings.theme || 'night');
  const c = { ...t.c };
  const acc = ACCENTS.find((a) => a[0] === lib.settings.accent);
  if (acc && acc[2]) {
    c.accent = t.dark ? acc[2] : mix(acc[2], '#000000', 0.18);
    c.accent2 = t.dark ? mix(acc[2], '#ffffff', 0.45) : mix(acc[2], '#000000', 0.45);
    c.ink = lum(c.accent) > 0.6 ? '#141006' : '#ffffff';
  }
  const r = document.documentElement;
  const set = (k, v) => r.style.setProperty(k, v);
  set('--bg', c.bg); set('--bg-2', c.bg2); set('--card', c.card); set('--card-2', c.card2); set('--card-3', c.card3);
  set('--text', c.text); set('--muted', c.muted); set('--dim', c.dim);
  set('--accent', c.accent); set('--accent-2', c.accent2); set('--accent-ink', c.ink); set('--rose', c.rose);
  set('--line', t.dark ? 'rgba(255,255,255,.08)' : 'rgba(30,15,50,.09)');
  set('--line-2', t.dark ? 'rgba(255,255,255,.14)' : 'rgba(30,15,50,.16)');
  r.style.colorScheme = t.dark ? 'dark' : 'light';
  r.dataset.theme = t.id;
  r.dataset.dark = t.dark ? '1' : '0';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = c.bg;
}

/** Theme cards (used in settings and in the quick sheet). */
export function picker(onPick) {
  const wrap = h('div');
  const draw = () => {
    wrap.innerHTML = '';
    const grid = h('div.themes');
    const cur = lib.settings.theme === 'dark' ? 'night' : lib.settings.theme === 'light' ? 'day' : (lib.settings.theme || 'night');
    const items = [...THEMES, { id: 'auto', name: 'تلقائي', auto: true }];
    for (const t of items) {
      const c = t.auto ? null : t.c;
      const prev = t.auto
        ? h('div.tprev.auto', h('div', { style: { background: THEMES[0].c.bg } }), h('div', { style: { background: THEMES[8].c.bg } }))
        : h('div.tprev', { style: { background: c.bg } },
          h('div.tp-card', { style: { background: c.card } }, h('i', { style: { background: c.accent } }), h('b', { style: { background: c.muted } })),
          h('div.tp-card', { style: { background: c.card } }, h('i', { style: { background: c.rose } }), h('b', { style: { background: c.dim } })),
          h('div.tp-btn', { style: { background: c.accent } }));
      grid.append(h('button.tcard' + (cur === t.id ? '.on' : ''), {
        type: 'button',
        onclick: async () => { await lib.setSetting('theme', t.id); apply(); draw(); onPick && onPick(t.id); },
      }, prev, h('span', t.name, cur === t.id ? ic('check') : null)));
    }
    wrap.append(grid);
    const acc = h('div.accents');
    for (const [id, name, color] of ACCENTS) {
      acc.append(h('button.swatch' + ((lib.settings.accent || 'auto') === id ? '.on' : '') + (color ? '' : '.auto'), {
        type: 'button', title: name, 'aria-label': name,
        style: color ? { background: color } : {},
        onclick: async () => { await lib.setSetting('accent', id); apply(); draw(); },
      }, color ? null : ic('sparkle')));
    }
    wrap.append(h('div.acc-label', 'لون الأزرار'), acc);
  };
  draw();
  return wrap;
}

export function themeSheet() {
  sheet(() => picker(), { title: 'الثيمات' });
}
