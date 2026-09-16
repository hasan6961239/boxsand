/**
 * Client-side router.
 *
 * Real URLs via the History API rather than hash routing, because the server
 * already falls back to index.html for any extensionless path — so a deep link
 * pasted into a phone browser opens the right page.
 */

const routes = [];
let notFoundHandler = null;
let currentPath = null;

function compile(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^/${source}/?$`), keys };
}

export function route(pattern, handler) {
  routes.push({ pattern, handler, ...compile(pattern) });
}

export function notFound(handler) {
  notFoundHandler = handler;
}

export function navigate(path, { replace = false } = {}) {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  resolve();
}

export function currentRoute() {
  return currentPath;
}

export async function resolve() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  currentPath = path;

  for (const entry of routes) {
    const match = entry.regex.exec(path);
    if (!match) continue;
    const params = {};
    entry.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });
    const query = Object.fromEntries(new URLSearchParams(window.location.search));
    await entry.handler({ params, query, path });
    return;
  }

  if (notFoundHandler) await notFoundHandler({ path });
}

export function startRouter() {
  window.addEventListener('popstate', () => { resolve(); });

  // Intercept in-app links so the whole page never reloads, while leaving
  // external links, downloads and modified clicks alone.
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    if (anchor.dataset.external === 'true') return;

    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname.startsWith('/api/')) return;

    event.preventDefault();
    navigate(url.pathname + url.search);
  });

  return resolve();
}
