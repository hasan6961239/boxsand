// Download engine that needs no computer: community-run cobalt servers
// (open-source media downloader, https://github.com/imputnet/cobalt).
// Each server is tried in turn; empty or failed results move on to the next.
// The server list ships with the app (instances.json) and can be extended
// from the settings with your own server.
import * as lib from './library.js';
import * as db from './db.js';
import { fetchTimeout } from './util.js';

const BUILTIN = [
  'https://rue-cobalt.xenon.zone',
  'https://cobaltapi.cjs.nz',
];

let listCache = null;
let stats = null; // { [url]: { ok, fail, lastOk, lastFail } }

async function loadStats() {
  if (!stats) stats = (await db.kvGet('cobaltStats', {})) || {};
  return stats;
}
function note(url, ok) {
  const s = (stats[url] ||= { ok: 0, fail: 0 });
  if (ok) { s.ok++; s.lastOk = Date.now(); } else { s.fail++; s.lastFail = Date.now(); }
  db.kvSet('cobaltStats', stats);
}

const clean = (u) => {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
};

export async function instances() {
  if (!listCache) {
    let shipped = [];
    try {
      const r = await fetchTimeout('instances.json', { cache: 'no-cache' }, 5000);
      if (r.ok) shipped = ((await r.json()).cobalt || []).map(clean);
    } catch { /* offline: built-ins only */ }
    listCache = [...new Set([...shipped, ...BUILTIN])].filter(Boolean);
  }
  await loadStats();
  const own = clean(lib.settings.cobaltUrl);
  const now = Date.now();
  // recently-working servers first; one that just failed waits 10 minutes
  const score = (u) => {
    const s = stats[u] || {};
    let v = (s.ok || 0) * 2 - (s.fail || 0) * 0.5 + (s.lastOk ? 5 : 0);
    if (s.lastFail && now - s.lastFail < 10 * 60e3 && (!s.lastOk || s.lastFail > s.lastOk)) v -= 100;
    return v;
  };
  const pool = listCache.filter((u) => u !== own).sort((a, b) => score(b) - score(a));
  return own ? [own, ...pool] : pool;
}

function body(url, opts) {
  const b = { url, filenameStyle: 'basic', alwaysProxy: true };
  if (opts.kind === 'audio') {
    b.downloadMode = 'audio';
    b.audioFormat = 'mp3';
    b.audioBitrate = opts.bitrate || '256';
  } else {
    b.downloadMode = 'auto';
    b.videoQuality = String(opts.quality || '720');
    b.youtubeVideoCodec = 'h264'; // plays everywhere on iPhone
  }
  return b;
}

const ERRORS = {
  'youtube.login': 'يوتيوب طلب تسجيل دخول من هذا الخادم',
  'rate_exceeded': 'الخادم مزدحم',
  'content.too_long': 'المقطع أطول من المسموح',
  'content.video.unavailable': 'الفيديو غير متاح',
  'content.video.private': 'الفيديو خاص',
  'content.video.age': 'الفيديو مقيّد بالعمر',
  'content.video.region': 'الفيديو محجوب في منطقة الخادم',
  'link.unsupported': 'هذا الموقع غير مدعوم',
  'link.invalid': 'الرابط غير صالح',
  'fetch.empty': 'رجع ملف فاضي',
};
const errText = (code = '') => {
  for (const [k, v] of Object.entries(ERRORS)) if (code.includes(k)) return v;
  return code.replace(/^error\.api\./, '') || 'خطأ غير معروف';
};
// errors no other server will fix
const FATAL = /link\.(invalid|unsupported)|content\.video\.(private|unavailable)|content\.too_long/;

async function ask(base, url, opts, signal) {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (base === clean(lib.settings.cobaltUrl) && lib.settings.cobaltKey) headers.Authorization = 'Api-Key ' + lib.settings.cobaltKey;
  const r = await fetchTimeout(base + '/', { method: 'POST', headers, body: JSON.stringify(body(url, opts)), signal }, 30000);
  let d;
  try { d = await r.json(); } catch { throw Object.assign(new Error(`رد غير مفهوم (${r.status})`), { code: 'bad' }); }
  if (d.status === 'error') throw Object.assign(new Error(errText(d.error && d.error.code)), { code: (d.error && d.error.code) || '' });
  if (d.status === 'tunnel' || d.status === 'redirect') return { url: d.url, filename: d.filename };
  if (d.status === 'picker' && d.picker && d.picker.length) {
    const it = opts.kind === 'audio' && d.audio ? { url: d.audio } : d.picker.find((p) => p.type === 'video') || d.picker[0];
    return { url: it.url, filename: d.audioFilename || d.filename || '' };
  }
  throw Object.assign(new Error('نوع رد غير مدعوم: ' + d.status), { code: 'unsupported' });
}

async function pull(link, onProgress, signal) {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal && signal.addEventListener('abort', stop);
  let stall = setTimeout(stop, 45000);
  try {
    const r = await fetch(link, { signal: ctl.signal });
    if (!r.ok) throw Object.assign(new Error(`فشل النقل (${r.status})`), { code: 'fetch' });
    const total = +(r.headers.get('content-length') || 0) || +(r.headers.get('estimated-content-length') || 0) || 0;
    const reader = r.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(stall);
      stall = setTimeout(stop, 45000);
      chunks.push(value);
      got += value.length;
      onProgress && onProgress(got, total);
    }
    if (got < 2048) throw Object.assign(new Error(ERRORS['fetch.empty']), { code: 'fetch.empty' });
    return new Blob(chunks, { type: r.headers.get('content-type') || '' });
  } catch (e) {
    if (signal && signal.aborted) throw new DOMException('abort', 'AbortError');
    if (e.name === 'AbortError') throw Object.assign(new Error('توقف النقل'), { code: 'stall' });
    throw e;
  } finally {
    clearTimeout(stall);
    signal && signal.removeEventListener('abort', stop);
  }
}

/**
 * Download a link (YouTube, TikTok, Instagram, SoundCloud, X, Facebook…).
 * opts: {kind:'audio'|'video', quality, onStatus(text), onProgress(fraction|null)}
 * Returns {blob, filename, server}.
 */
export async function download(url, opts = {}, signal) {
  const list = await instances();
  if (!list.length) throw new Error('لا توجد خوادم تحميل متاحة');
  const errors = [];
  for (let i = 0; i < list.length; i++) {
    if (signal && signal.aborted) throw new DOMException('abort', 'AbortError');
    const base = list[i];
    const host = base.replace(/^https?:\/\//, '');
    opts.onStatus && opts.onStatus(`يجهّز الملف (خادم ${i + 1} من ${list.length})…`);
    try {
      const res = await ask(base, url, opts, signal);
      opts.onStatus && opts.onStatus('ينقل للآيفون…');
      const blob = await pull(res.url, (got, total) => opts.onProgress && opts.onProgress(total ? got / total : null, got), signal);
      note(base, true);
      return { blob, filename: res.filename || '', server: host };
    } catch (e) {
      if (e.name === 'AbortError' || (signal && signal.aborted)) throw new DOMException('abort', 'AbortError');
      note(base, false);
      errors.push(`${host}: ${e.message}`);
      if (FATAL.test(e.code || '')) throw new Error(e.message);
    }
  }
  const err = new Error('كل خوادم التحميل المجانية فشلت لهذا المقطع. جرّب بعد شوية، أو استعمل خادم البيت.');
  err.details = errors;
  throw err;
}

/** Quick health check used by the settings screen. */
export async function check() {
  const list = await instances();
  return Promise.all(list.map(async (base) => {
    try {
      const r = await fetchTimeout(base + '/', { headers: { Accept: 'application/json' } }, 8000);
      const d = await r.json();
      const yt = ((d.cobalt && d.cobalt.services) || []).includes('youtube');
      return { base, ok: true, version: d.cobalt && d.cobalt.version, youtube: yt };
    } catch {
      return { base, ok: false };
    }
  }));
}

/** "Title - Author.mp3" / "Title (720p, h264).mp4" → readable title. */
export function titleFromFilename(name) {
  return (name || '')
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/\s*\((?:\d{3,4}p|audio|mute)[^)]*\)\s*$/i, '')
    .replace(/[｜]/g, '|')
    .trim();
}
