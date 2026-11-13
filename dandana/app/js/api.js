// Everything YouTube/online in one place. Three possible backends:
//   1. cobalt (built in, no setup) — downloads from YouTube, TikTok, Instagram…
//   2. YouTube Data API key (free, official) — search, playlists, Shorts
//   3. Dandana home server (optional) — search, mixes, streaming, downloads
import * as lib from './library.js';
import * as db from './db.js';
import * as cobalt from './cobalt.js';
import * as ytapi from './ytapi.js';
import { importOne } from './importer.js';
import { cleanYouTubeTitle, cleanChannel } from './tags.js';
import { fetchTimeout, uid, sleep } from './util.js';

export function base() {
  let u = (lib.settings.serverUrl || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
}
export const hasServer = () => !!base();
export const hasKey = ytapi.hasKey;
/** Search / browse YouTube inside the app. */
export const canSearch = () => hasServer() || hasKey();
/** YouTube "Mix" radios (server only). */
export const canMix = () => hasServer();

function headers(extra = {}) {
  const h = { ...extra };
  if (lib.settings.serverKey) h['X-Dandana-Key'] = lib.settings.serverKey;
  return h;
}

export async function api(path, { method = 'GET', body, timeout = 30000, signal } = {}) {
  const b = base();
  if (!b) throw new Error('لم يتم ضبط خادم البيت');
  let r;
  try {
    r = await fetchTimeout(b + path, {
      method, signal,
      headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }, timeout);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بخادم البيت');
    throw new Error('تعذّر الوصول لخادم البيت — تأكد أنه يعمل');
  }
  let data = null;
  try { data = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) throw new Error((data && (data.detail || data.error)) || `خطأ من الخادم (${r.status})`);
  return data;
}

export const health = () => api('/api/health', { timeout: 8000 });

export function withKey(url) {
  const k = lib.settings.serverKey;
  return k ? url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(k) : url;
}
export const streamURL = (id, kind = 'audio') => withKey(`${base()}/api/stream?id=${encodeURIComponent(id)}&kind=${kind}`);
export const radioURL = (url) => withKey(`${base()}/api/radio?url=${encodeURIComponent(url)}`);

export function ytId(s) {
  const m = (s || '').match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : null;
}
export const isYouTubeUrl = (s) => /(?:youtube\.com|youtu\.be)\//i.test(s || '');
export const playlistId = (s) => ((s || '').match(/[?&]list=((?:PL|OL|UU|FL)[\w-]+)/) || [])[1] || null;
export const isPlaylistUrl = (s) => !!playlistId(s) && (!/[?&]v=/.test(s || '') || /\/playlist\?/.test(s || ''));
export function siteName(url) {
  const h = (url.match(/^https?:\/\/(?:www\.|m\.|vm\.|vt\.)?([^/]+)/i) || [])[1] || '';
  if (/youtu/.test(h)) return 'يوتيوب';
  if (/tiktok/.test(h)) return 'تيك توك';
  if (/instagram/.test(h)) return 'إنستغرام';
  if (/soundcloud/.test(h)) return 'ساوند كلاود';
  if (/facebook|fb\.watch/.test(h)) return 'فيسبوك';
  if (/twitter|x\.com/.test(h)) return 'إكس';
  if (/snapchat/.test(h)) return 'سناب شات';
  return h;
}

// ---------------------------------------------------------------- search

export async function search(q, limit = 20, kind = 'video') {
  if (hasServer()) {
    try {
      return (await api(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}&kind=${kind}`)).items;
    } catch (e) {
      if (!hasKey()) throw e;
    }
  }
  return ytapi.search(q, limit, { short: kind === 'short' });
}

/** Songs like this one: YouTube Mix with the server, otherwise more by the same artist. */
export async function related(id, limit = 25, hint = {}) {
  if (hasServer()) return (await api(`/api/related?id=${encodeURIComponent(id)}&limit=${limit}`)).items;
  const who = cleanYouTubeTitle(hint.title || '', hint.channel || '').artist || cleanChannel(hint.channel || '');
  if (!who) throw new Error('الميكس المشابه يحتاج خادم البيت');
  return (await search(who, limit)).filter((x) => x.id !== id);
}

export async function playlist(url) {
  if (hasServer()) return (await api(`/api/playlist?url=${encodeURIComponent(url)}`, { timeout: 90000 })).items;
  const id = playlistId(url);
  if (!id) throw new Error('رابط قائمة غير صالح');
  return ytapi.playlist(id);
}

/** Title/channel/thumbnail for a pasted link, from whatever is available. */
export async function meta(url) {
  const id = ytId(url);
  const fallback = { id, url, title: '', channel: '', thumbnail: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '' };
  if (id && hasServer()) { try { return { ...fallback, ...(await api(`/api/meta?url=${encodeURIComponent(url)}`)) }; } catch { /* next */ } }
  if (id && hasKey()) { try { const v = await ytapi.video(id); if (v) return { ...fallback, ...v }; } catch { /* next */ } }
  try {
    const r = await fetchTimeout('https://noembed.com/embed?url=' + encodeURIComponent(url), {}, 6000);
    const d = await r.json();
    if (d && d.title) return { ...fallback, title: d.title, channel: d.author_name || '', thumbnail: fallback.thumbnail || d.thumbnail_url || '' };
  } catch { /* offline or unsupported */ }
  return fallback;
}

/** Best YouTube match for "artist title" (recommendations → playable song). */
export async function findOnYouTube(artist, title) {
  const q = `${artist} ${title}`.trim();
  const hit = await ytapi.cachedFind(q);
  if (hit) return hit;
  const items = await search(q, 5);
  const good = items.find((i) => i.duration && i.duration > 90 && i.duration < 900) || items[0] || null;
  if (good) ytapi.rememberFind(q, good);
  return good;
}

// ---------------------------------------------------------------- play without saving

const playCache = new Map();
/** A playable URL for a YouTube video: server stream, or a cobalt download kept in memory. */
export async function playableURL(id, { video = false, onStatus } = {}) {
  if (hasServer()) return { url: streamURL(id, video ? 'video' : 'audio'), stream: true };
  const k = id + (video ? ':v' : ':a');
  if (playCache.has(k)) return playCache.get(k);
  const res = await cobalt.download(`https://www.youtube.com/watch?v=${id}`, { kind: video ? 'video' : 'audio', quality: '480', bitrate: '128', onStatus });
  const out = { url: URL.createObjectURL(res.blob), blob: res.blob, filename: res.filename };
  playCache.set(k, out);
  if (playCache.size > 6) {
    const [oldK, old] = playCache.entries().next().value;
    URL.revokeObjectURL(old.url);
    playCache.delete(oldK);
  }
  return out;
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

const ACTIVE = ['queued', 'server', 'cobalt', 'transfer', 'saving'];

export async function restoreDownloads() {
  const saved = (await db.kvGet('downloads', [])) || [];
  downloads.push(...saved);
  for (const d of downloads) {
    if (ACTIVE.includes(d.status)) {
      d.status = 'queued';
      if (d.engine !== 'server') d.jobId = null;
      run(d);
    }
  }
  changed();
}

/** opts: {url, id, title, channel, thumbnail, kind:'audio'|'video', quality, format, hint} */
export function startDownload(opts) {
  const vid = opts.id || ytId(opts.url);
  const url = opts.url || `https://www.youtube.com/watch?v=${vid}`;
  const exists = downloads.find((d) => (vid ? d.vid === vid : d.url === url) && d.kind === opts.kind && ACTIVE.includes(d.status));
  if (exists) return exists;
  const d = {
    lid: uid(), vid, url, site: siteName(url),
    title: opts.title || '', channel: opts.channel || '', thumbnail: opts.thumbnail || (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : ''),
    kind: opts.kind || 'audio', quality: opts.quality || lib.settings.videoQuality, format: opts.format || lib.settings.audioFormat,
    hint: opts.hint || null, status: 'queued', progress: 0, created: Date.now(),
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

async function viaServer(d, signal) {
  d.engine = 'server';
  if (!d.jobId) {
    d.status = 'server'; d.progress = 0; changed();
    const job = await api('/api/jobs', { method: 'POST', body: { url: d.url, kind: d.kind, quality: d.quality, format: d.format } });
    d.jobId = job.id; changed();
  }
  let job;
  for (;;) {
    if (signal.aborted) throw new DOMException('abort', 'AbortError');
    job = await api(`/api/jobs/${d.jobId}`, { timeout: 15000 });
    d.status = 'server';
    d.detail = job.status === 'processing' ? 'يحوّل الملف على الخادم…' : `يحمّل على الخادم ${Math.round((job.progress || 0) * 100)}%`;
    d.progress = (job.progress || 0) * 0.7;
    if (job.status === 'done') break;
    if (job.status === 'error') { d.jobId = null; throw new Error(job.error || 'فشل التحميل'); }
    if (job.status === 'cancelled') throw new DOMException('abort', 'AbortError');
    changed();
    await sleep(job.status === 'processing' ? 800 : 1000);
  }
  d.status = 'transfer'; d.detail = 'ينقل للآيفون…'; changed();
  const r = await fetch(`${base()}/api/jobs/${d.jobId}/file`, { headers: headers(), signal });
  if (!r.ok) throw new Error(`تعذّر نقل الملف (${r.status})`);
  const total = +r.headers.get('content-length') || job.size || 0;
  let m = {};
  try { m = JSON.parse(decodeURIComponent(r.headers.get('x-dandana-meta') || '%7B%7D')); } catch { /* none */ }
  const reader = r.body.getReader();
  const chunks = [];
  let got = 0, tick = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (total && Date.now() - tick > 250) { d.progress = 0.7 + 0.28 * (got / total); d.detail = `ينقل للآيفون ${Math.round((got / total) * 100)}%`; tick = Date.now(); changed(); }
  }
  const type = r.headers.get('content-type') || (d.kind === 'video' ? 'video/mp4' : 'audio/mp4');
  api(`/api/jobs/${d.jobId}`, { method: 'DELETE' }).catch(() => {});
  return { blob: new Blob(chunks, { type }), type, meta: { ...(job.meta || {}), ...m }, filename: job.filename };
}

async function viaCobalt(d, signal) {
  d.engine = 'cobalt';
  d.status = 'cobalt'; d.progress = 0.02; d.detail = 'يجهّز الملف…'; changed();
  let lastTick = 0;
  const res = await cobalt.download(d.url, {
    kind: d.kind, quality: d.quality,
    onStatus: (s) => { d.detail = s; changed(); },
    onProgress: (f, got) => {
      if (Date.now() - lastTick < 250) return;
      lastTick = Date.now();
      d.status = 'transfer';
      d.progress = f ? 0.05 + 0.93 * f : Math.min(0.9, d.progress + 0.01);
      d.detail = f ? `ينقل للآيفون ${Math.round(f * 100)}%` : `ينقل للآيفون… ${(got / 1048576).toFixed(1)} م.ب`;
      changed();
    },
  }, signal);
  const ext = (res.filename.match(/\.([a-z0-9]{2,4})$/i) || [])[1] || (d.kind === 'video' ? 'mp4' : 'mp3');
  const type = res.blob.type && res.blob.type !== 'application/octet-stream' ? res.blob.type
    : ({ mp3: 'audio/mpeg', mp4: 'video/mp4', m4a: 'audio/mp4', webm: 'video/webm', opus: 'audio/ogg', ogg: 'audio/ogg' }[ext] || '');
  return { blob: new Blob([res.blob], { type }), type, meta: { title: d.title || cobalt.titleFromFilename(res.filename) }, filename: res.filename || `download.${ext}`, server: res.server };
}

async function process(d) {
  const ctl = new AbortController();
  d.abort = () => ctl.abort();
  d.error = null;
  try {
    let got;
    const engine = lib.settings.dlEngine || 'auto';
    if (hasServer() && engine !== 'cobalt') {
      try { got = await viaServer(d, ctl.signal); } catch (e) {
        if (e.name === 'AbortError' || engine === 'server') throw e;
        d.serverError = e.message; // fall back to the free servers
      }
    }
    if (!got) got = await viaCobalt(d, ctl.signal);

    d.status = 'saving'; d.progress = 0.99; d.detail = 'يحفظ في المكتبة…'; changed();
    const m = got.meta || {};
    const isYT = !!d.vid;
    const names = d.hint || (isYT ? cleanYouTubeTitle(m.title || d.title, m.channel || d.channel, m)
      : { title: (m.title || d.title || got.filename.replace(/\.[^.]+$/, '')).slice(0, 120), artist: d.channel || d.site || '' });
    let artBlob = null;
    const th = (m.thumbnail && /ytimg\.com/.test(m.thumbnail)) ? m.thumbnail : d.thumbnail;
    if (th) {
      for (const u of [th.replace(/hqdefault/, 'maxresdefault'), th]) {
        try {
          const tr = await fetchTimeout(u, {}, 12000);
          if (tr.ok) { const b = await tr.blob(); if (b.size > 3000) { artBlob = b; break; } }
        } catch { /* cover is optional */ }
      }
    }
    const res = await importOne(
      { name: got.filename || `${names.title}.${d.kind === 'video' ? 'mp4' : 'mp3'}`, size: got.blob.size, type: got.type, get: async () => got.blob },
      { title: names.title, artist: names.artist, source: isYT ? 'youtube' : 'link', ytId: d.vid || null, artBlob,
        duration: m.duration, width: m.width, height: m.height, force: true },
    );
    lib.emit('tracks');
    d.trackId = res.track.id;
    d.status = 'done'; d.progress = 1; d.title = names.title; d.artist = names.artist; d.detail = '';
    changed();
  } catch (e) {
    if (e.name === 'AbortError') {
      d.status = 'cancelled';
      if (d.jobId) api(`/api/jobs/${d.jobId}`, { method: 'DELETE' }).catch(() => {});
    } else {
      d.status = 'error';
      d.error = e.message || String(e);
      if (d.serverError) d.error += ` (خادم البيت: ${d.serverError})`;
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
  d.status = 'queued'; d.error = null; d.serverError = null; d.progress = 0; d.jobId = null;
  changed();
  run(d);
}
export function clearFinished() {
  for (let i = downloads.length - 1; i >= 0; i--) {
    if (['done', 'cancelled', 'error'].includes(downloads[i].status)) downloads.splice(i, 1);
  }
  changed();
}
export const activeCount = () => downloads.filter((d) => ACTIVE.includes(d.status)).length;
