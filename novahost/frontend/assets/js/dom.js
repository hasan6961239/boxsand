/**
 * DOM helpers.
 *
 * The one rule this module exists to enforce: **no innerHTML, ever, for data
 * that came from the server**. Every string goes in through textContent, and
 * every element is built with createElement. That removes DOM-based XSS as a
 * category rather than relying on remembering to escape in each view — which
 * matters here because project names, file paths and log messages all originate
 * from files a user uploaded.
 */

/**
 * Create an element.
 *   el('div.card')
 *   el('button.btn.btn--primary', { onClick: save }, 'Save')
 *   el('span', { class: 'badge', title: 'x' }, icon('check'), 'Ready')
 *
 * The tag string accepts CSS-style shorthand: 'div.a.b#id'.
 */
export function el(tag, props = null, ...children) {
  let tagName = 'div';
  const classes = [];
  let id = null;

  const match = /^([a-zA-Z0-9-]*)((?:[.#][^.#]+)*)$/.exec(tag);
  if (match) {
    if (match[1]) tagName = match[1];
    const rest = match[2] || '';
    for (const part of rest.split(/(?=[.#])/)) {
      if (!part) continue;
      if (part.startsWith('.')) classes.push(part.slice(1));
      else if (part.startsWith('#')) id = part.slice(1);
    }
  } else {
    tagName = tag;
  }

  const node = document.createElement(tagName);
  if (classes.length) node.classList.add(...classes);
  if (id) node.id = id;

  if (props && typeof props === 'object' && !Array.isArray(props) && !(props instanceof Node)) {
    applyProps(node, props);
  } else if (props !== null && props !== undefined) {
    children.unshift(props);
  }

  append(node, children);
  return node;
}

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class' || key === 'className') {
      for (const name of String(value).split(/\s+/)) if (name) node.classList.add(name);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value') {
      node.value = value;
    } else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'required') {
      node[key] = Boolean(value);
    } else if (key === 'ref' && typeof value === 'function') {
      value(node);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replace a node's children. */
export function render(container, ...children) {
  container.replaceChildren();
  append(container, children);
  return container;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Build an SVG element from trusted, in-repo path data (never user input). */
export function svg(paths, { size = 18, stroke = 'currentColor', fill = 'none', strokeWidth = 2 } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('viewBox', '0 0 24 24');
  root.setAttribute('width', String(size));
  root.setAttribute('height', String(size));
  root.setAttribute('fill', fill);
  root.setAttribute('stroke', stroke);
  root.setAttribute('stroke-width', String(strokeWidth));
  root.setAttribute('stroke-linecap', 'round');
  root.setAttribute('stroke-linejoin', 'round');
  root.setAttribute('aria-hidden', 'true');

  for (const definition of paths) {
    const [shape, attrs] = definition;
    const child = document.createElementNS(NS, shape);
    for (const [key, value] of Object.entries(attrs)) child.setAttribute(key, String(value));
    root.append(child);
  }
  return root;
}

/** Debounce — used for search-as-you-type and the slug preview. */
export function debounce(fn, wait = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function on(node, event, handler, options) {
  node.addEventListener(event, handler, options);
  return () => node.removeEventListener(event, handler, options);
}

/** Copy to clipboard, with a fallback for insecure origins (plain-HTTP LAN). */
export async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* fall through */ }
  }
  // navigator.clipboard is unavailable over http://192.168.x.x, which is the
  // normal way to reach this dashboard on a home network.
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch { ok = false; }
  area.remove();
  return ok;
}
