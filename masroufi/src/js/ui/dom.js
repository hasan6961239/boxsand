// Tiny hyperscript helpers. h('div.card#main', { onclick }, child, [more], 'text')
//
// props: class/className (string|array|object), style (string|object),
//        dataset (object), on (object of event → handler), onX handlers,
//        html (innerHTML — only for trusted markup), ref (fn receiving the node),
//        anything else becomes an attribute (false/null skip, true = empty).

import { ICONS } from './icon-paths.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function parseTag(tag) {
  const m = tag.match(/^([a-z0-9-]*)((?:[.#][\w-]+)*)$/i);
  const name = (m && m[1]) || 'div';
  const classes = [];
  let id = null;
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g)) part[0] === '.' ? classes.push(part.slice(1)) : (id = part.slice(1));
  return { name, classes, id };
}

function classString(c) {
  if (!c) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(classString).filter(Boolean).join(' ');
  return Object.entries(c).filter(([, v]) => v).map(([k]) => k).join(' ');
}

function applyProps(el, props, isSvg) {
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' || k === 'className') {
      const cs = classString(v);
      if (cs) el.setAttribute('class', [el.getAttribute('class'), cs].filter(Boolean).join(' '));
    } else if (k === 'style') {
      if (typeof v === 'string') el.style.cssText += v;
      else for (const [sk, sv] of Object.entries(v)) if (sv !== undefined && sv !== null) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (k === 'on') {
      for (const [evt, fn] of Object.entries(v)) el.addEventListener(evt, fn);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'html') {
      el.innerHTML = v;
    } else if (k === 'ref') {
      v(el);
    } else if (!isSvg && (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected')) {
      el[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : v);
    }
  }
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function h(tag, props, ...children) {
  if (props instanceof Node || Array.isArray(props) || typeof props !== 'object' || props === null) {
    children.unshift(props);
    props = {};
  }
  const { name, classes, id } = parseTag(tag);
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');
  if (id) el.id = id;
  applyProps(el, props, false);
  append(el, children);
  return el;
}

export function s(tag, props = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props, true);
  append(el, children);
  return el;
}

/** Lucide icon as an inline SVG. */
export function icon(name, { size = 22, stroke = 2, cls = '' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', stroke);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `ic ${cls}`.trim());
  svg.innerHTML = ICONS[name] || ICONS['circle-help'];
  return svg;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Text-safe fragment builder for lists: frag(items.map(render)). */
export function frag(...nodes) {
  const f = document.createDocumentFragment();
  append(f, nodes);
  return f;
}
