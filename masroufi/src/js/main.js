// App entry: load data, apply the look, start routing, then connect the
// account, sync and notifications in the background (nothing blocks the UI).

import * as store from './core/store.js';
import * as theme from './core/theme.js';
import * as router from './core/router.js';
import * as auth from './core/auth.js';
import * as sync from './core/sync.js';
import * as automation from './core/automation.js';
import { on } from './core/bus.js';
import * as db from './core/db.js';
import { h, icon } from './ui/dom.js';
import { toast, haptic } from './ui/kit.js';

import home from './screens/home.js';
import historyScreen from './screens/history.js';
import debts from './screens/debts.js';
import more from './screens/more.js';
import person from './screens/person.js';
import salary from './screens/salary.js';
import budget from './screens/budget.js';
import reports from './screens/reports.js';
import goals, { goalScreen } from './screens/goals.js';
import recurring from './screens/recurring.js';
import categories from './screens/categories.js';
import settings, { settingsSection } from './screens/settings.js';
import notifications from './screens/notifications.js';
import welcome from './screens/welcome.js';
import { openTxnSheet } from './screens/txn-sheet.js';
import { openNewPassword } from './screens/account-sheets.js';

const routes = [
  { path: '/', screen: home, depth: 0, tab: 'home' },
  { path: '/history', screen: historyScreen, depth: 0, tab: 'history' },
  { path: '/debts', screen: debts, depth: 0, tab: 'debts' },
  { path: '/more', screen: more, depth: 0, tab: 'more' },
  { path: '/person/:id', screen: person, depth: 1, tab: 'debts' },
  { path: '/salary', screen: salary, depth: 1, tab: 'more' },
  { path: '/budget', screen: budget, depth: 1, tab: 'more' },
  { path: '/reports', screen: reports, depth: 1, tab: 'more' },
  { path: '/goals', screen: goals, depth: 1, tab: 'more' },
  { path: '/goal/:id', screen: goalScreen, depth: 2, tab: 'more' },
  { path: '/recurring', screen: recurring, depth: 1, tab: 'more' },
  { path: '/categories', screen: categories, depth: 2, tab: 'more' },
  { path: '/settings', screen: settings, depth: 1, tab: 'more' },
  { path: '/settings/:section', screen: settingsSection, depth: 2, tab: 'more' },
  { path: '/notifications', screen: notifications, depth: 1, tab: 'home' },
  { path: '/welcome', screen: welcome, depth: 0, tab: null },
  { path: '/add', action: (_, q) => openTxnSheet({ type: q.type || 'expense' }) },
  { path: '/add/:type', action: (p) => openTxnSheet({ type: p.type }) },
];

/* ---------------------------------------------------------------- tab bar */

const TABS = [
  { id: 'home', label: 'الرئيسية', icon: 'house', path: '/' },
  { id: 'history', label: 'السجل', icon: 'receipt-text', path: '/history' },
  null, // FAB
  { id: 'debts', label: 'الديون', icon: 'handshake', path: '/debts' },
  { id: 'more', label: 'المزيد', icon: 'layout-grid', path: '/more' },
];

let tabbar;
function buildTabbar() {
  tabbar = h('nav.tabbar', { 'aria-label': 'التنقل' },
    TABS.map((t) => t
      ? h('button.tab', { type: 'button', dataset: { tab: t.id }, onclick: () => { haptic(); router.go(t.path); } }, icon(t.icon, { size: 24 }), h('span', t.label))
      : h('button.fab.ripple', { type: 'button', 'aria-label': 'إضافة', onclick: () => { haptic(10); openTxnSheet({ type: 'expense' }); } }, icon('plus', { size: 28, stroke: 2.4 }))));
  document.getElementById('app').appendChild(tabbar);
}

function onRoute(cur) {
  const hide = !cur.route.tab || cur.route.screen.noTabbar;
  tabbar.classList.toggle('is-hidden', Boolean(hide));
  tabbar.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === cur.route.tab));
}

/* ---------------------------------------------------------------- service worker */

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (w) => toast('في نسخة جديدة من التطبيق', {
      icon: 'sparkles',
      duration: 10000,
      action: { label: 'حدّث', onClick: () => w.postMessage('skipWaiting') },
    });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((e) => console.warn('[sw]', e));
  // Reload only when an update replaced a running version — not when the
  // very first install takes control (that would interrupt the first launch).
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'navigate' && e.data.url) location.hash = e.data.url.replace(/^.*#/, '#');
  });
}

/* ---------------------------------------------------------------- boot */

async function boot() {
  await store.init();
  if (__DEV__) {
    window.__store = store;
    if (location.search.includes('seed=demo')) {
      const { seedDemo } = await import('./dev/demo.js');
      await seedDemo();
      history.replaceState(null, '', location.pathname + '#/');
    }
  }
  theme.apply(store.settings().look);
  on('change', ({ cols }) => {
    if (cols.has('settings')) theme.apply(store.settings().look);
  });

  buildTabbar();
  automation.start();

  if (!store.settings().onboarded && !location.hash.startsWith('#/welcome')) {
    history.replaceState(null, '', '#/welcome');
  }
  router.start(routes, { el: document.getElementById('view'), onRoute });

  const bootEl = document.getElementById('boot');
  bootEl.classList.add('hide');
  setTimeout(() => bootEl.remove(), 600);

  registerSW();
  db.persist();

  // Account + sync in the background
  const { handled } = await auth.init();
  await sync.start();
  if (handled === 'recovery') openNewPassword();
  else if (handled === 'confirmation') toast('تم تأكيد الإيميل وتسجيل دخولك ✨', { tone: 'pos' });
  else if (handled === 'error') toast('الرابط منتهي أو مستعمل قبل', { tone: 'warn' });

  // after a login on a fresh device the synced settings may say we're onboarded already
  on('change', () => {
    if (router.currentPath() === '/welcome' && store.settings().onboarded && auth.current()) router.go('/', { replace: true });
  });
}

boot().catch((e) => {
  console.error(e);
  const b = document.getElementById('boot');
  if (b) b.innerHTML = '<div style="padding:24px;text-align:center;font-family:system-ui">تعذّر تشغيل التطبيق. أعد فتحه.</div>';
});
