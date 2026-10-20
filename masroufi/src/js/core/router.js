// Hash router with native-feeling transitions and live re-rendering.
//
// A route is { path: '/person/:id', screen, depth, tab } where `screen` is a
// module default export: { render(params) → Node|Node[], live?: boolean,
// noTabbar?: boolean, onLeave?() }. Deeper pages slide in, shallower slide
// out, same depth (tab switches) cross-fade. When data changes, the visible
// screen re-renders in place (scroll position kept, no entrance animation).

import { on, emit } from './bus.js';
import { clear } from '../ui/dom.js';
import { motion } from './theme.js';

let routes = [];
let view = null;
let cur = null; // { route, params, page, path }
let rerenderQueued = false;
let hooks = {};
let lastN = 0;

function compile(path) {
  const keys = [];
  const re = new RegExp('^' + path.replace(/\/:([\w]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  return { re, keys };
}

function match(path) {
  for (const r of routes) {
    const m = r._c.re.exec(path);
    if (m) {
      const params = {};
      r._c.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}

export function currentPath() {
  const p = location.hash.replace(/^#/, '') || '/';
  return p.split('?')[0] || '/';
}

export function query() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}

export function go(path, { replace = false } = {}) {
  const target = '#' + path;
  if (location.hash === target) return render(true);
  if (replace) {
    history.replaceState({ n: lastN }, '', target);
    render();
  } else location.hash = target;
}

/** Back within the app, or to `fallback` when there's no in-app history. */
export function back(fallback = '/') {
  if (history.state && history.state.n > 0) history.back();
  else go(fallback, { replace: true });
}

export const current = () => cur;

export function start(list, { el, onRoute } = {}) {
  routes = list.map((r) => ({ depth: 0, ...r, _c: compile(r.path) }));
  view = el;
  hooks = { onRoute };
  window.addEventListener('hashchange', () => render());
  on('change', () => {
    if (rerenderQueued) return;
    rerenderQueued = true;
    requestAnimationFrame(() => {
      rerenderQueued = false;
      rerender();
    });
  });
  render();
}

function build(m) {
  const page = document.createElement('section');
  page.className = 'page';
  if (m.route.screen.noTabbar) page.classList.add('no-tabbar');
  fill(page, m);
  return page;
}

function fill(page, m) {
  let out;
  try {
    out = m.route.screen.render(m.params);
  } catch (e) {
    console.error('[render]', m.route.path, e);
    out = document.createElement('div');
    out.className = 'page-scroll';
    out.innerHTML = '<div class="empty"><div class="empty-art">😵</div><h3>صار خطأ في عرض الصفحة</h3><p>جرّب ترجع وتفتحها تاني.</p></div>';
  }
  clear(page);
  for (const n of [].concat(out)) if (n) page.appendChild(n);
}

function render(force = false) {
  const path = currentPath();
  const m = match(path) || match('/');
  if (!m) return;
  if (m.route.action) {
    // action routes (e.g. #/add from a notification) run then fall back to home
    history.replaceState({ n: lastN }, '', '#' + (cur ? cur.path : '/'));
    if (!cur) render();
    setTimeout(() => m.route.action(m.params, query()), cur ? 0 : 350);
    return;
  }
  if (!force && cur && cur.path === path) return;

  const prev = cur;
  const depth = m.route.depth;
  // Number each in-app history entry so back() knows whether there's a page to return to.
  if (!history.state || history.state.n === undefined) history.replaceState({ depth, n: prev ? lastN + 1 : 0 }, '', location.href);
  lastN = history.state.n;

  const page = build(m);
  const dir = !prev ? 'none' : depth > prev.route.depth ? 'push' : depth < prev.route.depth ? 'pop' : 'fade';
  view.appendChild(page);
  if (prev && prev.route.screen.onLeave) prev.route.screen.onLeave();

  const anim = motion() !== 'off' && dir !== 'none';
  if (anim) {
    page.classList.add(`enter-${dir}`);
    prev.page.classList.add(`leave-${dir}`);
    const old = prev.page;
    setTimeout(() => old.remove(), dir === 'fade' ? 200 : 460);
    page.addEventListener('animationend', () => page.classList.remove(`enter-${dir}`), { once: true });
  } else if (prev) prev.page.remove();

  // scroll new page to top, mark old one inert during animation
  if (prev) prev.page.setAttribute('inert', '');
  cur = { route: m.route, params: m.params, page, path };
  hooks.onRoute && hooks.onRoute(cur);
  emit('route', cur);
}

/** Re-render the visible page with fresh data, keeping its scroll position. */
export function rerender() {
  if (!cur || cur.route.screen.live === false) return;
  const sc = cur.page.querySelector('.page-scroll');
  const top = sc ? sc.scrollTop : 0;
  cur.page.classList.add('is-static');
  fill(cur.page, cur);
  const sc2 = cur.page.querySelector('.page-scroll');
  if (sc2) sc2.scrollTop = top;
}
