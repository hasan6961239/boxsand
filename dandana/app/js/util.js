import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny element builder: h('div.card#id', {onclick}, child, 'text', ...) */
export function h(tag, attrs, ...children) {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const ic = (name, cls) => {
  const s = document.createElement('span');
  s.className = 'icw';
  s.innerHTML = icon(name, cls);
  return s.firstChild;
};

export function btn(iconName, label, onclick, cls = '') {
  const b = h('button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { onclick, type: 'button' });
  if (iconName) b.append(ic(iconName));
  if (label) b.append(h('span', label));
  return b;
}

export function iconBtn(iconName, onclick, label = '', cls = '') {
  return h('button.ibtn' + (cls ? '.' + cls.split(' ').join('.') : ''), {
    onclick, type: 'button', 'aria-label': label, title: label,
  }, ic(iconName));
}

// ---------------------------------------------------------------- text

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
export function norm(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .replace(TASHKEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const hasArabic = (s) => /[؀-ۿ]/.test(s || '');

export function fmtTime(sec) {
  if (sec == null || !isFinite(sec) || sec < 0) return '–:––';
  sec = Math.floor(sec);
  const hh = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const minutes = (m) => (m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتان' : m >= 3 && m <= 10 ? `${m} دقائق` : `${m} دقيقة`);
export function fmtDuration(sec) {
  if (!sec) return '';
  const h_ = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h_) return `${h_} س ${m} د`;
  return minutes(Math.max(1, m));
}

export function fmtBytes(b) {
  if (!b && b !== 0) return '';
  const u = ['ب', 'ك.ب', 'م.ب', 'ج.ب'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b < 10 && i ? 1 : 0)} ${u[i]}`;
}

export function fmtCount(n) {
  if (n == null) return '';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + ' مليار';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' مليون';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + ' ألف';
  return String(n);
}

export function plural(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}
export const songsCount = (n) => n === 0 ? 'لا أغاني' : plural(n, 'أغنية واحدة', 'أغنيتان', 'أغانٍ', 'أغنية');

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 16);
}

export function hash(str) {
  let h_ = 2166136261;
  for (let i = 0; i < str.length; i++) { h_ ^= str.charCodeAt(i); h_ = Math.imul(h_, 16777619); }
  return h_ >>> 0;
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Weighted sample without replacement (Efraimidis–Spirakis). */
export function weightedOrder(items, weightFn) {
  return items
    .map((it) => ({ it, k: Math.pow(Math.random(), 1 / Math.max(0.0001, weightFn(it))) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.it);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const debounce = (fn, ms = 250) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export function placeholderArt(seed) {
  const n = hash(seed || 'x');
  const h1 = n % 360, h2 = (h1 + 40 + (n >> 8) % 80) % 360;
  return `linear-gradient(135deg, hsl(${h1} 55% 38%), hsl(${h2} 60% 22%))`;
}

// ---------------------------------------------------------------- UI bits

let toastTimer;
export function toast(msg, opts = {}) {
  const t = $('#toast');
  t.innerHTML = '';
  t.append(h('span', msg));
  if (opts.action) {
    t.append(h('button', { onclick: () => { opts.action.fn(); t.classList.remove('show'); } }, opts.action.label));
  }
  t.classList.toggle('err', !!opts.error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), opts.ms || (opts.action ? 5000 : 2600));
}

/** Bottom sheet. content: Node | (close) => Node. Returns close(). */
export function sheet(content, { title, cls = '', onClose } = {}) {
  const root = $('#sheets');
  const back = h('div.sheet-back');
  const panel = h('div.sheet' + (cls ? '.' + cls : ''), { role: 'dialog' });
  const close = () => {
    panel.classList.remove('open');
    back.classList.remove('open');
    setTimeout(() => { back.remove(); panel.remove(); }, 280);
    onClose && onClose();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  back.onclick = close;
  panel.append(h('div.sheet-grip'));
  if (title) panel.append(h('div.sheet-title', title));
  const body = h('div.sheet-body');
  body.append(typeof content === 'function' ? content(close) : content);
  panel.append(body);
  root.append(back, panel);
  // drag down to dismiss
  let y0 = null, dy = 0;
  panel.addEventListener('touchstart', (e) => {
    if (body.scrollTop > 0 && !e.target.closest('.sheet-grip,.sheet-title')) return;
    y0 = e.touches[0].clientY; dy = 0; panel.style.transition = 'none';
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener('touchend', () => {
    if (y0 == null) return;
    panel.style.transition = ''; panel.style.transform = '';
    if (dy > 110) close();
    y0 = null;
  });
  requestAnimationFrame(() => { back.classList.add('open'); panel.classList.add('open'); });
  return close;
}

/** Action list sheet: items = [{icon, label, fn, danger, hidden}] */
export function actionSheet(items, { title, header } = {}) {
  return sheet((close) => {
    const wrap = h('div.actions');
    if (header) wrap.append(header);
    for (const it of items) {
      if (!it || it.hidden) continue;
      wrap.append(h('button.action' + (it.danger ? '.danger' : ''), {
        type: 'button',
        onclick: () => { close(); setTimeout(() => it.fn(), 60); },
      }, ic(it.icon || 'chevL'), h('span', it.label), it.hint ? h('small', it.hint) : null));
    }
    return wrap;
  }, { title });
}

export function confirmDialog(message, { ok = 'تأكيد', danger = false, title } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const close = sheet((close) => h('div.dialog',
      h('p', message),
      h('div.row.gap',
        h('button.btn.wide' + (danger ? '.danger' : '.primary'), { onclick: () => { done = true; close(); resolve(true); } }, ok),
        h('button.btn.wide.ghost', { onclick: () => { close(); } }, 'إلغاء'),
      ),
    ), { title, onClose: () => { if (!done) resolve(false); } });
    void close;
  });
}

export function promptDialog(title, { value = '', placeholder = '', ok = 'حفظ' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input.input', { value, placeholder, enterkeyhint: 'done' });
    const close = sheet((close) => {
      const submit = () => { done = true; close(); resolve(input.value.trim()); };
      input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
      return h('div.dialog', input, h('div.row.gap',
        h('button.btn.wide.primary', { onclick: submit }, ok),
        h('button.btn.wide.ghost', { onclick: () => close() }, 'إلغاء'),
      ));
    }, { title, onClose: () => { if (!done) resolve(null); } });
    void close;
    setTimeout(() => input.focus(), 320);
  });
}

/** Long-press helper for touch + contextmenu. */
export function onLongPress(el, fn, ms = 480) {
  let t, moved = false, x0, y0;
  el.addEventListener('touchstart', (e) => {
    moved = false; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    t = setTimeout(() => { if (!moved) { el.dataset.lp = '1'; fn(e); } }, ms);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (Math.abs(e.touches[0].clientX - x0) > 8 || Math.abs(e.touches[0].clientY - y0) > 8) { moved = true; clearTimeout(t); }
  }, { passive: true });
  el.addEventListener('touchend', () => clearTimeout(t));
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); fn(e); });
  // swallow the click that follows a long press
  el.addEventListener('click', (e) => {
    if (el.dataset.lp) { delete el.dataset.lp; e.stopPropagation(); e.preventDefault(); }
  }, true);
}

export function lazyObserve(el, fn) {
  if (!lazyObserve.io) {
    lazyObserve.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          lazyObserve.io.unobserve(e.target);
          const f = lazyObserve.map.get(e.target);
          lazyObserve.map.delete(e.target);
          f && f();
        }
      }
    }, { rootMargin: '300px' });
    lazyObserve.map = new WeakMap();
  }
  lazyObserve.map.set(el, fn);
  lazyObserve.io.observe(el);
}

export function isStandalone() {
  return window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}
export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function emptyState(iconName, title, text, action) {
  return h('div.empty', ic(iconName), h('h3', title), text ? h('p', text) : null, action || null);
}

export function fetchTimeout(url, opts = {}, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  if (opts.signal) opts.signal.addEventListener('abort', () => ctl.abort());
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}
