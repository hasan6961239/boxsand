// Client for the Dandana server (YouTube search / download / stream) and the
// download manager that turns finished jobs into library tracks.
import * as lib from './library.js';
import * as db from './db.js';
import { importOne } from './importer.js';
import { cleanYouTubeTitle } from './tags.js';
import { fetchTimeout, uid, sleep } from './util.js';

export function base() {
  let u = (lib.settings.serverUrl || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
}
export const hasServer = () => !!base();

function headers(extra = {}) {
  const h = { ...extra };
  if (lib.settings.serverKey) h['X-Dandana-Key'] = lib.settings.serverKey;
  return h;
}

let online = null; // null unknown, true/false
export const isOnline = () => online;

export async function api(path, { method = 'GET', body, timeout = 30000, signal } = {}) {
  const b = base();
  if (!b) throw new Error('لم يتم ضبط خادم التحميل بعد — من الإعدادات');
  let r;
  try {
    r = await fetchTimeout(b + path, {
      method, signal,
      headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }, timeout);
  } catch (e) {
    online = false;
    if (e.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالخادم');
    throw new Error('تعذّر الوصول للخادم — تأكد أنه يعمل وأن الرابط صحيح');
  }
  online = true;
  let data = null;
  try { data = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) throw new Error((data && (data.detail || data.error)) || `خطأ من الخادم (${r.status})`);
  return data;
}

export async function health() {
  return api('/api/health', { timeout: 8000 });
}

export function withKey(url) {
  const k = lib.settings.serverKey;
  return k ? url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(k) : url;
}
export const streamURL = (id, kind = 'audio') => withKey(`${base()}/api/stream?id=${encodeURIComponent(id)}&kind=${kind}`);
export const radioURL = (url) => withKey(`${base()}/api/radio?url=${encodeURIComponent(url)}`);
export const thumbURL = (url) => withKey(`${base()}/api/thumb?url=${encodeURIComponent(url)}`);

export const search = (q, limit = 20, kind = 'video') =>
  api(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}&kind=${kind}`).then((d) => d.items);
export const related = (id, limit = 25) => api(`/api/related?id=${encodeURIComponent(id)}&limit=${limit}`).then((d) => d.items);
export const playlist = (url) => api(`/api/playlist?url=${encodeURIComponent(url)}`, { timeout: 90000 }).then((d) => d.items);
export const meta = (url) => api(`/api/meta?url=${encodeURIComponent(url)}`);

export function ytId(s) {
  const m = (s || '').match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}
export const isYouTubeUrl = (s) => /(?:youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(s || '');
export const isPlaylistUrl = (s) => /[?&]list=(PL|OL|UU|FL|LL)[\w-]+/.test(s || '') && !/[?&]v=/.test(s || '') || /\/playlist\?/.test(s || '');

const ytSearchCache = new Map();
/** Find the best YouTube match for "artist title" (used to play/download recommendations). */
export async function findOnYouTube(artist, title) {
  const q = `${artist} ${title}`.trim();
  if (ytSearchCache.has(q)) return ytSearchCache.get(q);
  const items = await search(q, 5);
  const good = items.find((i) => i.duration && i.duration > 90 && i.duration < 900) || items[0] || null;
  ytSearchCache.set(q, good);
  return good;
}

// ---------------------------------------------------------------- downloads

export const downloads = [];
const listeners = new Set();
export const onDownloads = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => { for (const fn of listeners) fn(downloads); persist(); };
let persistT;
function persist() {
  clearTimeout(persistT);
  persistT = setTimeout(() => {
    const keep = downloads.filter((d) => d.status !== 'done' || Date.now() - d.created < 6 * 3600e3).slice(-60)
      .map(({ abort, ...d }) => d);
    db.kvSet('downloads', keep);
  }, 400);
}

export async function restoreDownloads() {
  const saved = (await db.kvGet('downloads', [])) || [];
  downloads.push(...saved);
  for (const d of downloads) {
    if (['queued', 'server', 'transfer', 'saving'].includes(d.status)) {
      d.status = d.jobId ? 'server' : 'queued';
      run(d);
    }
  }
  changed();
}

/** opts: {url, id, title, channel, thumbnail, kind:'audio'|'video', quality, format} */
export function startDownload(opts) {
  const vid = opts.id || ytId(opts.url);
  const exists = downloads.find((d) => d.vid && d.vid === vid && d.kind === opts.kind && !['error', 'cancelled'].includes(d.status));
  if (exists && exists.status !== 'done') return exists;
  const d = {
    lid: uid(), vid, url: opts.url || `https://www.youtube.com/watch?v=${vid}`,
    title: opts.title || '', channel: opts.channel || '', thumbnail: opts.thumbnail || '',
    kind: opts.kind || 'audio', quality: opts.quality || lib.settings.videoQuality, format: opts.format || lib.settings.audioFormat,
    hint: opts.hint || null,
    status: 'queued', progress: 0, created: Date.now(),
  };
  downloads.push(d);
  changed();
  run(d);
  return d;
}

let active = 0;
const MAX_ACTIVE = 2;
const waiting = [];

function run(d) {
  if (active >= MAX_ACTIVE) { if (!waiting.includes(d)) waiting.push(d); return; }
  active++;
  process(d).finally(() => {
    active--;
    const next = waiting.shift();
    if (next) run(next);
  });
}

async function process(d) {
  const ctl = new AbortController();
  d.abort = () => ctl.abort();
  try {
    if (!d.jobId) {
      d.status = 'server'; d.progress = 0; changed();
      const job = await api('/api/jobs', { method: 'POST', body: { url: d.url, kind: d.kind, quality: d.quality, format: d.format } });
      d.jobId = job.id; changed();
    }
    // wait for the server to finish downloading/converting
    let job;
    for (;;) {
      if (ctl.signal.aborted) throw new DOMException('abort', 'AbortError');
      job = await api(`/api/jobs/${d.jobId}`, { timeout: 15000 });
      d.serverStatus = job.status;
      d.progress = (job.progress || 0) * 0.7;
      if (job.status === 'done') break;
      if (job.status === 'error') throw new Error(job.error || 'فشل التحميل');
      if (job.status === 'cancelled') throw new DOMException('abort', 'AbortError');
      changed();
      await sleep(job.status === 'processing' ? 800 : 1000);
    }
    // transfer the finished file to the phone
    d.status = 'transfer'; changed();
    const r = await fetch(`${base()}/api/jobs/${d.jobId}/file`, { headers: headers(), signal: ctl.signal });
    if (!r.ok) throw new Error(`تعذّر نقل الملف (${r.status})`);
    const total = +r.headers.get('content-length') || job.size || 0;
    let metaHdr = {};
    try { metaHdr = JSON.parse(decodeURIComponent(r.headers.get('x-dandana-meta') || '%7B%7D')); } catch { /* none */ }
    const reader = r.body.getReader();
    const chunks = [];
    let got = 0, lastTick = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (total && Date.now() - lastTick > 250) { d.progress = 0.7 + 0.28 * (got / total); lastTick = Date.now(); changed(); }
    }
    const type = r.headers.get('content-type') || (d.kind === 'video' ? 'video/mp4' : 'audio/mp4');
    const blob = new Blob(chunks, { type });
    d.status = 'saving'; d.progress = 0.99; changed();

    const m = { ...(job.meta || {}), ...metaHdr };
    const names = d.hint || cleanYouTubeTitle(m.title || d.title, m.channel || d.channel, m);
    let artBlob = null;
    const th = m.thumbnail || d.thumbnail;
    if (th) {
      try {
        const tr = await fetchTimeout(thumbURL(th), { headers: headers() }, 15000);
        if (tr.ok) artBlob = await tr.blob();
      } catch { /* cover is optional */ }
    }
    const fname = job.filename || `${names.title}.${d.kind === 'video' ? 'mp4' : d.format}`;
    const res = await importOne(
      { name: fname, size: blob.size, type, get: async () => blob },
      { title: names.title, artist: names.artist, source: 'youtube', ytId: m.id || d.vid, artBlob,
        duration: m.duration, width: m.width, height: m.height, force: true },
    );
    lib.emit('tracks');
    d.trackId = res.track.id;
    d.status = 'done'; d.progress = 1; d.title = names.title; d.artist = names.artist;
    changed();
    api(`/api/jobs/${d.jobId}`, { method: 'DELETE' }).catch(() => {});
  } catch (e) {
    if (e.name === 'AbortError') {
      d.status = 'cancelled';
      if (d.jobId) api(`/api/jobs/${d.jobId}`, { method: 'DELETE' }).catch(() => {});
    } else {
      d.status = 'error'; d.error = e.message || String(e);
      if (/غير موجودة|انتهت صلاحيتها/.test(d.error)) d.jobId = null;
    }
    changed();
  } finally {
    delete d.abort;
  }
}

export function cancelDownload(d) {
  if (d.abort) d.abort();
  const i = waiting.indexOf(d);
  if (i >= 0) { waiting.splice(i, 1); d.status = 'cancelled'; changed(); }
}
export function retryDownload(d) {
  d.status = 'queued'; d.error = null; d.progress = 0;
  changed();
  run(d);
}
export function clearFinished() {
  for (let i = downloads.length - 1; i >= 0; i--) {
    if (['done', 'cancelled', 'error'].includes(downloads[i].status)) downloads.splice(i, 1);
  }
  changed();
}
export const activeCount = () => downloads.filter((d) => ['queued', 'server', 'transfer', 'saving'].includes(d.status)).length;
