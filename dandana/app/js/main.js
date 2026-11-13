import * as lib from './library.js';
import * as api from './api.js';
import { player, unlockMedia } from './player.js';
import { initPlayerUI, dismissNP } from './nowplaying.js';
import { icon } from './icons.js';
import * as themes from './themes.js';
import { $, $$, toast } from './util.js';
import * as views from './views.js';
import { reelsView } from './reels.js';

const routes = [
  [/^home$/, views.home],
  [/^library(?:\/(\w+))?$/, views.library],
  [/^artist\/(.+)$/, views.artist],
  [/^album\/(.+)$/, views.album],
  [/^playlist\/(.+)$/, views.playlist],
  [/^smart\/(\w+)$/, views.smart],
  [/^discover$/, views.discover],
  [/^downloads$/, views.downloads],
  [/^reels$/, reelsView],
  [/^radio$/, views.radio],
  [/^foryou$/, views.foryou],
  [/^settings$/, views.settings],
  [/^stats$/, views.stats],
  [/^guide$/, views.guide],
];
const TAB_OF = { home: 'home', foryou: 'home', stats: 'home', settings: 'home', guide: 'home', library: 'library', artist: 'library', album: 'library', playlist: 'library', smart: 'library', discover: 'discover', downloads: 'discover', reels: 'reels', radio: 'radio' };

let cleanup = null;
const scrolls = new Map();
let currentHash = '';

function route() {
  const hash = (location.hash || '#/home').replace(/^#\/?/, '') || 'home';
  if (hash === currentHash) return;
  const view = $('#view');
  if (currentHash) scrolls.set(currentHash, view.scrollTop);
  currentHash = hash;
  dismissNP();
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  document.body.classList.remove('reels-mode', 'selecting');
  $$('.selbar').forEach((e) => e.remove());
  view.innerHTML = '';
  let matched = false;
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      matched = true;
      const params = m.slice(1).map((x) => (x ? decodeURIComponent(x) : x));
      try { cleanup = fn(view, ...params) || null; } catch (e) { console.error(e); view.textContent = 'حدث خطأ: ' + e.message; }
      break;
    }
  }
  if (!matched) { location.replace('#/home'); return; }
  const tab = TAB_OF[hash.split('/')[0]] || 'home';
  $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  requestAnimationFrame(() => { view.scrollTop = scrolls.get(hash) || 0; });
}

function updateBadge() {
  const n = api.activeCount();
  const b = $('#dl-badge');
  b.textContent = n ? String(n) : '';
  b.classList.toggle('show', n > 0);
}

async function boot() {
  for (const el of $$('[data-ic]')) el.innerHTML = icon(el.dataset.ic);
  try {
    await lib.loadSettings();
    themes.apply();
    await lib.load();
  } catch (e) {
    console.error(e);
    toast('تعذّر فتح قاعدة البيانات: ' + e.message, { error: true, ms: 8000 });
  }
  lib.on('settings', (k) => { if (k === 'theme' || k === 'accent') themes.apply(); });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (lib.settings.theme === 'auto') themes.apply(); });
  initPlayerUI();
  document.body.classList.add('no-mini');
  window.addEventListener('hashchange', route);
  route();
  $('#boot').classList.add('done');
  setTimeout(() => $('#boot').remove(), 400);

  api.onDownloads(updateBadge);
  api.restoreDownloads().catch(console.error);
  player.restore().catch(console.error);

  // Unlock both media elements on the first touch so later programmatic
  // play() calls (after async reads, track changes, background) are allowed.
  const unlock = () => {
    unlockMedia(player.audio, () => player.wantPlaying);
    unlockMedia(player.video, () => player.wantPlaying);
    document.removeEventListener('touchend', unlock, true);
    document.removeEventListener('click', unlock, true);
  };
  document.addEventListener('touchend', unlock, true);
  document.addEventListener('click', unlock, true);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            toast('نسخة جديدة من التطبيق جاهزة', { action: { label: 'تحديث', fn: () => location.reload() }, ms: 10000 });
          }
        });
      });
    }).catch(() => {});
  }
}

boot();
