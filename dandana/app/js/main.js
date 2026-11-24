import * as lib from './library.js';
import * as api from './api.js';
import { player, unlockMedia } from './player.js';
import { initPlayerUI, dismissNP } from './nowplaying.js';
import { icon } from './icons.js';
import * as themes from './themes.js';
import { VERSION } from './version.js';
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
  if (lib.repairedOnLoad) setTimeout(() => toast(`صلّحنا أسماء ${lib.repairedOnLoad} أغنية كانت تظهر برموز غريبة ✓`, { ms: 5000 }), 1200);
  initPlayerUI();
  player.applyCarButtons();
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
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  setupUpdates();
}

// ---------------------------------------------------------------- updates
// iOS often resumes a home-screen app from memory without reloading it, so
// the app asks for version.json itself on launch and whenever it comes back
// to the foreground, and reloads into the new version when that is harmless
// (nothing playing). A stuck old service worker is removed as a last resort.

let pendingUpdate = null;
let lastCheck = 0;

export async function checkForUpdate({ force = false, manual = false } = {}) {
  if (location.protocol === 'file:') return { current: VERSION };
  lastCheck = Date.now();
  if (force) {
    // user asked: drop the saved app copy and load fresh files (library data is untouched)
    player.saveQueue();
    const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
    if (reg) await reg.unregister().catch(() => {});
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    location.reload();
    return { current: VERSION };
  }
  let remote;
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    remote = (await r.json()).version;
  } catch {
    if (manual) toast('ما قدرت نتحقق — تأكد من الإنترنت', { error: true });
    return { current: VERSION, remote: null };
  }
  if (!remote || remote === VERSION) {
    if (manual) toast(`عندك آخر نسخة ✓ (${VERSION})`);
    return { current: VERSION, remote };
  }
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
  try { await reg?.update(); } catch { /* offline */ }
  pendingUpdate = remote;
  let tried = null;
  try { tried = sessionStorage.getItem('dd-reloaded-for'); } catch { /* private mode */ }
  if (tried === remote) {
    // already reloaded once for this version and still old: clear the cache layer
    try { sessionStorage.setItem('dd-reloaded-for', remote + ':forced'); } catch { /* ignore */ }
    if (reg) await reg.unregister().catch(() => {});
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    location.reload();
    return { current: VERSION, remote };
  }
  if (!player.playing || manual) applyUpdate();
  else toast(`تحديث جديد (${remote}) — يتحدّث لما توقف الأغنية`, { action: { label: 'الآن', fn: applyUpdate }, ms: 8000 });
  return { current: VERSION, remote };
}

function applyUpdate() {
  if (!pendingUpdate) return;
  try { sessionStorage.setItem('dd-reloaded-for', pendingUpdate); } catch { /* ignore */ }
  player.saveQueue();
  setTimeout(() => location.reload(), 300);
}

function setupUpdates() {
  setTimeout(() => checkForUpdate(), 2500);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > 5 * 60e3) checkForUpdate();
  });
  player.addEventListener('state', () => {
    if (pendingUpdate && !player.playing && document.visibilityState === 'hidden') applyUpdate();
  });
}

boot();
