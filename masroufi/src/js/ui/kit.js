// UI building blocks shared by every screen: buttons, rows, sheets, dialogs,
// toasts, progress, switches, chips, empty states and small animations.
// Styling lives in css/components.css under the same class names.

import { h, s, icon, clear } from './dom.js';
import { fmtMoney, clamp } from '../core/util.js';
import { motion } from '../core/theme.js';

/* ------------------------------------------------------- feedback */

const reduced = () => motion() !== 'full';

/** Light haptic tick where supported (Android); a no-op on iPhone. */
export function haptic(ms = 8) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch { /* ignore */ }
}

// Ripple on anything with .ripple; :active works on iOS only with a touch listener.
document.addEventListener('touchstart', () => {}, { passive: true });
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.ripple');
  if (!el || el.disabled || motion() === 'off') return;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2;
  const wave = h('span.ripple-wave', { style: { width: size + 'px', height: size + 'px', left: e.clientX - r.left - size / 2 + 'px', top: e.clientY - r.top - size / 2 + 'px' } });
  el.appendChild(wave);
  wave.addEventListener('animationend', () => wave.remove());
  setTimeout(() => wave.remove(), 900);
}, { passive: true });

// Keep sheets above the on-screen keyboard (iOS overlays it instead of resizing).
if (window.visualViewport) {
  const vv = window.visualViewport;
  const sync = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', kb + 'px');
    document.documentElement.style.setProperty('--vvh', vv.height + 'px');
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
}

/* -------------------------------------------------------- buttons */

/**
 * button({ label, icon, variant: 'primary'|'soft'|'ghost'|'danger'|'plain'|'outline',
 *          size: 'lg'|'md'|'sm', block, onClick, disabled, type })
 */
export function button({ label, icon: ic, iconEnd, variant = 'primary', size = 'md', block = false, onClick, disabled, type = 'button', cls = '', title } = {}) {
  return h('button.btn.ripple.tap', {
    type,
    class: [`btn-${variant}`, `btn-${size}`, block && 'btn-block', cls],
    disabled,
    title,
    onclick: (e) => {
      haptic();
      onClick && onClick(e);
    },
  }, ic && icon(ic, { size: size === 'sm' ? 18 : 20 }), label && h('span', label), iconEnd && icon(iconEnd, { size: 18 }));
}

export function iconButton(name, { onClick, label, variant = 'ghost', size = 22, cls = '', badge } = {}) {
  return h('button.btn-icon.ripple.tap', { type: 'button', class: [`btn-icon-${variant}`, cls], 'aria-label': label, title: label, onclick: (e) => { haptic(); onClick && onClick(e); } },
    icon(name, { size }), badge ? h('span.dot-badge', String(badge)) : null);
}

/** Run an async action while showing a spinner on the button. */
export async function busy(btn, fn) {
  if (btn.classList.contains('is-busy')) return;
  btn.classList.add('is-busy');
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.classList.remove('is-busy');
    btn.disabled = false;
  }
}

/* ---------------------------------------------------------- text */

export function moneyEl(m, { sign = 'auto', tone = 'none', cls = '', compact = false } = {}) {
  const t = tone === 'auto' ? (m > 0 ? 'pos' : m < 0 ? 'neg' : '') : tone === 'none' ? '' : tone;
  return h('span.money', { class: [t && `tone-${t}`, cls] }, fmtMoney(m, { sign, compact }));
}

/** Animate a number from → to inside `el`, formatted by `fmt`. */
export function countUp(el, to, { from = 0, duration = 900, fmt = (v) => fmtMoney(v) } = {}) {
  if (reduced() || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 4);
  const tick = (now) => {
    const t = clamp((now - start) / duration, 0, 1);
    el.textContent = fmt(Math.round(from + (to - from) * ease(t)));
    if (t < 1 && el.isConnected) requestAnimationFrame(tick);
  };
  el.textContent = fmt(from);
  requestAnimationFrame(tick);
}

/* --------------------------------------------------------- layout */

/**
 * Screen header. back: true (history back) | function | false.
 * large: big iOS-style title for top-level tabs.
 */
export function header({ title, sub, back = false, actions = [], large = false, onBack } = {}) {
  const backBtn = back ? iconButton('chevron-right', { label: 'رجوع', onClick: onBack || (() => history.length > 1 ? history.back() : (location.hash = '#/')) }) : null;
  return h('header.page-head', { class: { 'is-large': large } },
    h('div.page-head-bar',
      h('div.page-head-start', backBtn),
      !large ? h('h1.page-head-title', title) : h('span'),
      h('div.page-head-end', actions),
    ),
    large ? h('div.page-head-large', h('h1', title), sub ? h('p', sub) : null) : sub ? h('p.page-head-sub', sub) : null,
  );
}

/** Page skeleton: a header plus the scrolling body. Screens return layout(header(...), ...blocks). */
export function layout(head, ...content) {
  return [head, h('div.page-scroll', content)];
}

export function section(title, content, { action, cls = '' } = {}) {
  return h('section.section', { class: cls },
    title || action ? h('div.section-head', title ? h('h2.section-title', title) : h('span'), action || null) : null,
    content);
}

export function linkAction(label, onClick) {
  return h('button.link-btn.tap', { type: 'button', onclick: onClick }, label, icon('chevron-left', { size: 16 }));
}

export function card(children, { cls = '', onClick, style } = {}) {
  return h('div.card', { class: [cls, onClick && 'tap ripple is-clickable'], onclick: onClick, style }, children);
}

/** Leading visual for rows: { emoji, color } | { icon, tone|color } | { name, color } (avatar). */
export function lead(spec = {}) {
  if (spec.emoji) return h('span.lead.lead-emoji', { style: { '--c': spec.color || 'var(--accent)' } }, spec.emoji);
  if (spec.name !== undefined) return avatar(spec.name, spec.color);
  return h('span.lead.lead-icon', { class: spec.tone && `tone-${spec.tone}`, style: spec.color ? { '--c': spec.color } : null }, icon(spec.icon || 'circle-help', { size: 20 }));
}

export function avatar(name, color) {
  const ch = String(name || '؟').trim().charAt(0) || '؟';
  return h('span.lead.avatar', { style: { '--c': color || 'var(--accent)' } }, ch);
}

/**
 * List row. row({ lead, title, sub, end, endSub, onClick, chevron, tone, cls })
 * `end` may be a Node or string; `endSub` a small line under it.
 */
export function row({ lead: l, title, sub, end, endSub, onClick, chevron = false, cls = '', badge } = {}) {
  return h(onClick ? 'button.row.tap.ripple' : 'div.row', { type: onClick ? 'button' : undefined, class: cls, onclick: onClick },
    l ? (l instanceof Node ? l : lead(l)) : null,
    h('span.row-main', h('span.row-title', title, badge || null), sub ? h('span.row-sub', sub) : null),
    end !== undefined && end !== null ? h('span.row-end', h('span.row-end-main', end), endSub ? h('span.row-end-sub', endSub) : null) : null,
    chevron ? icon('chevron-left', { size: 18, cls: 'row-chev' }) : null,
  );
}

export function list(rows, { cls = '', inset = true } = {}) {
  return h('div.list', { class: [inset && 'list-inset', cls] }, rows);
}

export function empty({ emoji, icon: ic, title, body, action } = {}) {
  return h('div.empty',
    emoji ? h('div.empty-art', emoji) : ic ? h('div.empty-art', icon(ic, { size: 34 })) : null,
    title ? h('h3', title) : null,
    body ? h('p', body) : null,
    action ? button({ variant: 'soft', size: 'md', ...action }) : null);
}

export function tag(text, tone = 'muted', ic) {
  return h('span.tag', { class: `tone-${tone}` }, ic ? icon(ic, { size: 13 }) : null, text);
}

/** Apply staggered entrance animation to the children of `el`. */
export function stagger(el, { step = 35, max = 12 } = {}) {
  [...el.children].forEach((c, i) => {
    c.classList.add('enter');
    c.style.setProperty('--d', `${Math.min(i, max) * step}ms`);
  });
  return el;
}

/* -------------------------------------------------------- controls */

export function progress(pct, { tone = 'auto', thin = false, cls = '' } = {}) {
  const t = tone === 'auto' ? (pct >= 100 ? 'neg' : pct >= 80 ? 'warn' : 'accent') : tone;
  const fill = h('span.progress-fill', { class: `tone-${t}` });
  const el = h('div.progress', { class: [thin && 'is-thin', cls], role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 }, fill);
  const w = clamp(pct, 0, 100) + '%';
  if (reduced()) fill.style.width = w;
  else requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = w; }));
  return el;
}

/** Circular progress (goals, debts). */
export function ring(pct, { size = 64, stroke = 7, tone = 'accent', label, sub } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round', class: `ring-arc tone-${tone}`, 'stroke-dasharray': c, 'stroke-dashoffset': c, transform: `rotate(-90 ${size / 2} ${size / 2})` });
  const off = c * (1 - clamp(pct, 0, 100) / 100);
  if (reduced()) arc.setAttribute('stroke-dashoffset', off);
  else requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', off)));
  return h('div.ring', { style: { width: size + 'px', height: size + 'px' } },
    s('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
      s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, class: 'ring-track' }),
      arc),
    label !== undefined ? h('div.ring-label', h('b', label), sub ? h('small', sub) : null) : null);
}

/** iOS-style switch. */
export function toggle({ checked = false, onChange, label, disabled } = {}) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, disabled, 'aria-label': label, onchange: (e) => { haptic(); onChange && onChange(e.target.checked); } });
  return h('label.switch', input, h('span.switch-track', h('span.switch-thumb')));
}

/** Segmented control with a sliding thumb. options: [{ value, label, icon }] */
export function segmented({ options, value, onChange, cls = '' }) {
  const el = h('div.seg', { class: cls, role: 'tablist', style: { '--n': options.length } });
  const thumb = h('span.seg-thumb');
  el.appendChild(thumb);
  const set = (v, fire) => {
    const i = Math.max(0, options.findIndex((o) => o.value === v));
    el.style.setProperty('--i', i);
    [...el.querySelectorAll('.seg-btn')].forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
    if (fire) onChange && onChange(options[i].value);
  };
  options.forEach((o) => el.appendChild(h('button.seg-btn.tap', { type: 'button', role: 'tab', onclick: () => { haptic(); set(o.value, true); } }, o.icon ? icon(o.icon, { size: 16 }) : null, h('span', o.label))));
  set(value, false);
  el.setValue = (v) => set(v, false);
  return el;
}

/** Chip group. options: [{ value, label, emoji, color }]. multi → value is a Set. */
export function chips({ options, value, onChange, multi = false, scroll = false, cls = '' }) {
  const el = h('div.chips', { class: [scroll && 'is-scroll', cls] });
  let cur = multi ? new Set(value || []) : value;
  const paint = () => [...el.children].forEach((b, i) => {
    const v = options[i].value;
    b.classList.toggle('on', multi ? cur.has(v) : cur === v);
  });
  options.forEach((o) => el.appendChild(h('button.chip.tap', {
    type: 'button',
    style: o.color ? { '--c': o.color } : null,
    onclick: () => {
      haptic();
      if (multi) cur.has(o.value) ? cur.delete(o.value) : cur.add(o.value);
      else cur = o.value;
      paint();
      onChange && onChange(multi ? new Set(cur) : cur);
    },
  }, o.emoji ? h('span.chip-emoji', o.emoji) : null, o.icon ? icon(o.icon, { size: 16 }) : null, o.label)));
  paint();
  el.setValue = (v) => { cur = multi ? new Set(v) : v; paint(); };
  return el;
}

export function field(label, control, { hint, cls = '' } = {}) {
  return h('label.field', { class: cls }, label ? h('span.field-label', label) : null, control, hint ? h('span.field-hint', hint) : null);
}

export function input({ value = '', placeholder = '', type = 'text', inputmode, onInput, onChange, maxlength, autocomplete = 'off', cls = '', autofocus, name, enterkeyhint } = {}) {
  const el = h('input.input', { type, value, placeholder, inputmode, maxlength, autocomplete, class: cls, name, enterkeyhint, oninput: onInput && ((e) => onInput(e.target.value)), onchange: onChange && ((e) => onChange(e.target.value)) });
  if (autofocus) setTimeout(() => el.focus({ preventScroll: true }), 350);
  return el;
}

export function textarea({ value = '', placeholder = '', onInput, rows = 2 } = {}) {
  return h('textarea.input.textarea', { placeholder, rows, oninput: onInput && ((e) => onInput(e.target.value)) }, value);
}

/* ------------------------------------------------------------ sheets */

const layer = () => document.getElementById('overlays') || document.body;
const openSheets = [];

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openSheets.length) openSheets[openSheets.length - 1].dismiss();
});

/**
 * Bottom sheet. body: Node | (api) => Node, api = { close(result), setTitle(t), el }.
 * Returns api with `.result` (Promise resolved with the close value).
 */
export function sheet({ title, sub, body, footer, full = false, cls = '', dismissible = true, onClose } = {}) {
  let resolve;
  const result = new Promise((r) => { resolve = r; });
  const titleEl = h('h2.sheet-title', title || '');
  const backdrop = h('div.sheet-backdrop');
  const panel = h('div.sheet', { class: [full && 'is-full', cls], role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' });
  const root = h('div.sheet-layer', backdrop, panel);
  let closed = false;

  const api = {
    el: panel,
    result,
    setTitle: (t) => { titleEl.textContent = t; },
    close(value) {
      if (closed) return;
      closed = true;
      openSheets.splice(openSheets.indexOf(api), 1);
      root.classList.remove('open');
      root.classList.add('closing');
      const done = () => { root.remove(); };
      if (reduced()) done();
      else setTimeout(done, 320);
      document.documentElement.classList.toggle('has-sheet', openSheets.length > 0);
      onClose && onClose(value);
      resolve(value);
    },
    dismiss() { if (dismissible) api.close(undefined); },
  };

  const head = h('div.sheet-head',
    h('div.sheet-grab', h('span')),
    title !== undefined ? h('div.sheet-head-row', h('div.sheet-head-text', titleEl, sub ? h('p.sheet-sub', sub) : null), dismissible ? iconButton('x', { label: 'إغلاق', variant: 'soft', size: 18, onClick: () => api.dismiss() }) : null) : null);
  const content = typeof body === 'function' ? body(api) : body;
  const bodyEl = h('div.sheet-body', content);
  panel.append(head, bodyEl);
  if (footer) panel.appendChild(h('div.sheet-foot', typeof footer === 'function' ? footer(api) : footer));

  backdrop.addEventListener('click', () => api.dismiss());
  dragToDismiss(panel, head, bodyEl, () => api.dismiss(), () => dismissible);

  layer().appendChild(root);
  openSheets.push(api);
  document.documentElement.classList.add('has-sheet');
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
  return api;
}

function dragToDismiss(panel, handle, scroller, dismiss, allowed) {
  let startY = 0, dy = 0, dragging = false, t0 = 0, fromBody = false;
  const down = (e) => {
    if (!allowed() || e.button > 0) return;
    fromBody = !handle.contains(e.target);
    if (fromBody && (scroller.scrollTop > 0 || e.target.closest('input, textarea, select, .keypad, .no-drag'))) return;
    startY = e.clientY; dy = 0; dragging = true; t0 = performance.now();
  };
  const move = (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    if (fromBody && dy < 8) return;
    panel.style.transition = 'none';
    panel.style.transform = `translateY(${dy}px)`;
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = '';
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > 120 || (dy > 40 && v > 0.6)) dismiss();
    else panel.style.transform = '';
  };
  panel.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** Yes/no dialog as a compact sheet. Resolves true/false. */
export function confirm({ title, body, ok = 'تمام', cancel = 'إلغاء', danger = false, icon: ic } = {}) {
  const api = sheet({
    cls: 'sheet-dialog',
    body: (a) => h('div.dialog',
      ic ? h('div.dialog-icon', { class: danger ? 'tone-neg' : 'tone-accent' }, icon(ic, { size: 28 })) : null,
      h('h3', title),
      body ? h('p', body) : null,
      h('div.dialog-actions',
        button({ label: ok, variant: danger ? 'danger' : 'primary', block: true, onClick: () => a.close(true) }),
        button({ label: cancel, variant: 'plain', block: true, onClick: () => a.close(false) }))),
  });
  return api.result.then(Boolean);
}

/** Action menu: items [{ label, icon, tone, onClick }] */
export function actions({ title, items }) {
  const api = sheet({
    title,
    cls: 'sheet-actions',
    body: (a) => h('div.action-list', items.filter(Boolean).map((it) => h('button.action-item.tap.ripple', {
      type: 'button',
      class: it.tone && `tone-${it.tone}`,
      onclick: () => { a.close(); setTimeout(() => it.onClick && it.onClick(), 60); },
    }, icon(it.icon || 'chevron-left', { size: 20 }), h('span', it.label)))),
  });
  return api;
}

/* ------------------------------------------------------------ toasts */

let toastHost = null;
/** toast('تم الحفظ', { tone: 'pos', icon, action: { label, onClick }, duration }) */
export function toast(message, { tone = 'default', icon: ic, action, duration = 2600 } = {}) {
  if (!toastHost) {
    toastHost = h('div.toasts', { 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const defaultIcon = { pos: 'circle-check', neg: 'triangle-alert', warn: 'triangle-alert', default: 'info' }[tone];
  const el = h('div.toast', { class: `tone-${tone}` },
    icon(ic || defaultIcon, { size: 20 }),
    h('span.toast-text', message),
    action ? h('button.toast-action.tap', { type: 'button', onclick: () => { action.onClick(); hide(); } }, action.label) : null);
  toastHost.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  let gone = false;
  function hide() {
    if (gone) return;
    gone = true;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }
  setTimeout(hide, action ? Math.max(duration, 4500) : duration);
  el.addEventListener('click', (e) => { if (!e.target.closest('.toast-action')) hide(); });
  return hide;
}

/* ---------------------------------------------------------- confetti */

export function confetti({ count = 90 } = {}) {
  if (reduced()) return;
  const cv = h('canvas.confetti');
  document.body.appendChild(cv);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (cv.width = innerWidth * dpr);
  const H = (cv.height = innerHeight * dpr);
  const ctx = cv.getContext('2d');
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#10B981';
  const colors = [accent, '#F59E0B', '#3B82F6', '#EC4899', '#22C55E', '#8B5CF6'];
  const parts = Array.from({ length: count }, (_, i) => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.35,
    vx: (Math.random() - 0.5) * 18 * dpr,
    vy: (-Math.random() * 16 - 6) * dpr,
    r: (4 + Math.random() * 5) * dpr,
    a: Math.random() * Math.PI,
    va: (Math.random() - 0.5) * 0.3,
    c: colors[i % colors.length],
  }));
  const t0 = performance.now();
  const step = (now) => {
    const t = now - t0;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.45 * dpr;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.a += p.va;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / 1800);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      ctx.restore();
    }
    if (t < 1800) requestAnimationFrame(step);
    else cv.remove();
  };
  requestAnimationFrame(step);
}

export { h, icon, clear };
