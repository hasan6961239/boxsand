/**
 * Content types.
 *
 * An allow-list, not a lookup of everything under the sun. Anything unknown is
 * served as application/octet-stream, which — together with the nosniff header
 * we always send — means an unexpected file downloads instead of executing in
 * the browser as something it is not.
 */
const TYPES = {
  // Markup and styles
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml; charset=utf-8',
  css: 'text/css; charset=utf-8',
  // Scripts and data
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  // Text
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  // Fonts
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  // Media
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  // Documents and archives
  pdf: 'application/pdf',
  zip: 'application/zip',
  // WebAssembly — needs the exact type or streaming instantiation refuses it
  wasm: 'application/wasm',
};

export const DEFAULT_TYPE = 'application/octet-stream';

export function contentTypeFor(filename) {
  const dot = String(filename).lastIndexOf('.');
  if (dot === -1) return DEFAULT_TYPE;
  const ext = String(filename).slice(dot + 1).toLowerCase();
  return TYPES[ext] ?? DEFAULT_TYPE;
}

/** Extensions the in-browser editor opens as text. */
const EDITABLE = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'txt', 'md', 'xml', 'svg', 'csv',
  'webmanifest', 'map', 'yml', 'yaml', 'toml', 'ini', 'env', 'gitignore',
]);

export function isEditable(filename) {
  const name = String(filename);
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return EDITABLE.has(name.slice(dot + 1).toLowerCase());
}

export function isImage(filename) {
  return contentTypeFor(filename).startsWith('image/');
}

/**
 * Images that are safe to render inline in the dashboard.
 *
 * SVG is deliberately excluded. It is an image by content type and a script
 * container in practice: <svg onload>, <script> inside the document, and
 * external references all execute when a browser renders it. Rendering one
 * inline would place attacker-controlled script on the panel's own origin,
 * next to the session cookie. A sandbox CSP does stop it, but a file that can
 * only ever download cannot be a hole at all.
 */
export function isInlinePreviewable(filename) {
  const type = contentTypeFor(filename);
  if (!type.startsWith('image/')) return false;
  return type !== 'image/svg+xml';
}

/** Language hint for the editor's syntax highlighting. */
export function languageFor(filename) {
  const dot = String(filename).lastIndexOf('.');
  const ext = dot === -1 ? '' : String(filename).slice(dot + 1).toLowerCase();
  if (['html', 'htm', 'xhtml'].includes(ext)) return 'html';
  if (ext === 'css') return 'css';
  if (['js', 'mjs'].includes(ext)) return 'javascript';
  if (['json', 'map', 'webmanifest'].includes(ext)) return 'json';
  if (['xml', 'svg'].includes(ext)) return 'xml';
  if (ext === 'md') return 'markdown';
  return 'text';
}
