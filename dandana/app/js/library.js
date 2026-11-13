// In-memory view of the library, backed by IndexedDB. Track metadata for a
// few thousand songs is small, so everything is loaded once at startup.
import * as db from './db.js';
import { norm, uid } from './util.js';

export const tracks = new Map();
export const playlists = new Map();
const listeners = new Map();

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}
export function emit(type, detail) {
  for (const fn of listeners.get(type) || []) {
    try { fn(detail); } catch (e) { console.error(e); }
  }
}

// ---------------------------------------------------------------- settings

export const DEFAULTS = {
  serverUrl: '',
  serverKey: '',
  ytKey: '',
  dlEngine: 'auto',
  cobaltUrl: '',
  cobaltKey: '',
  theme: 'night',
  accent: 'auto',
  audioFormat: 'm4a',
  videoQuality: '720',
  videoMode: true,
  bgAudio: true,
  mixNew: true,
  shuffle: false,
  repeat: 'off',
  speed: 1,
  librarySort: 'added',
  reelsSource: 'mix',
  recentSearches: [],
  radioFavs: [],
  lastQueue: null,
};
export const settings = { ...DEFAULTS };

export async function loadSettings() {
  const s = await db.kvGet('settings', {});
  Object.assign(settings, DEFAULTS, s || {});
}
export async function setSetting(k, v) {
  settings[k] = v;
  await db.kvSet('settings', { ...settings });
  emit('settings', k);
}

// ---------------------------------------------------------------- load

export async function load() {
  const [ts, ps] = await Promise.all([db.all('tracks'), db.all('playlists')]);
  tracks.clear();
  for (const t of ts) { t._n = searchKey(t); tracks.set(t.id, t); }
  playlists.clear();
  for (const p of ps) playlists.set(p.id, p);
  emit('tracks');
  emit('playlists');
}

export function searchKey(t) {
  return norm(`${t.title} ${t.artist} ${t.album} ${t.fileName || ''}`);
}

export function list() {
  return [...tracks.values()];
}

export async function saveTrack(t, { silent } = {}) {
  t._n = searchKey(t);
  tracks.set(t.id, t);
  const { _n, ...plain } = t;
  await db.put('tracks', plain);
  if (!silent) emit('tracks', t.id);
}

export async function updateTrack(id, patch, opts) {
  const t = tracks.get(id);
  if (!t) return;
  Object.assign(t, patch);
  await saveTrack(t, opts);
  return t;
}

export async function deleteTracks(ids) {
  const idset = new Set(ids);
  const d = await db.db();
  const tx = d.transaction(['tracks', 'media', 'art'], 'readwrite');
  const stillUsedArt = new Set();
  for (const t of tracks.values()) if (!idset.has(t.id) && t.art) stillUsedArt.add(t.art);
  for (const id of ids) {
    const t = tracks.get(id);
    tx.objectStore('tracks').delete(id);
    tx.objectStore('media').delete(id);
    if (t && t.art && !stillUsedArt.has(t.art)) tx.objectStore('art').delete(t.art);
    tracks.delete(id);
  }
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  let touched = false;
  for (const p of playlists.values()) {
    const before = p.trackIds.length;
    p.trackIds = p.trackIds.filter((x) => !idset.has(x));
    if (p.trackIds.length !== before) { touched = true; await db.put('playlists', p); }
  }
  emit('tracks');
  if (touched) emit('playlists');
}

export async function toggleLike(id) {
  const t = tracks.get(id);
  if (!t) return false;
  t.liked = !t.liked;
  t.likedAt = t.liked ? Date.now() : null;
  await saveTrack(t);
  return t.liked;
}

// ---------------------------------------------------------------- derived

export function artistKey(name) {
  return norm(name || '') || 'unknown';
}

export function artists() {
  const map = new Map();
  for (const t of tracks.values()) {
    const name = t.artist || 'فنان غير معروف';
    const k = artistKey(t.artist);
    let a = map.get(k);
    if (!a) { a = { key: k, name, tracks: [], plays: 0, likes: 0, art: null }; map.set(k, a); }
    a.tracks.push(t);
    a.plays += t.plays || 0;
    if (t.liked) a.likes++;
    if (!a.art && t.art) a.art = t.art;
  }
  return [...map.values()];
}

export function albums() {
  const map = new Map();
  for (const t of tracks.values()) {
    if (!t.album) continue;
    const k = norm(t.album) + '|' + artistKey(t.albumArtist || t.artist);
    let a = map.get(k);
    if (!a) { a = { key: k, name: t.album, artist: t.albumArtist || t.artist || '', tracks: [], art: null }; map.set(k, a); }
    a.tracks.push(t);
    if (!a.art && t.art) a.art = t.art;
  }
  return [...map.values()].filter((a) => a.tracks.length > 0);
}

export function search(q, pool = list()) {
  const nq = norm(q);
  if (!nq) return pool;
  const words = nq.split(' ');
  return pool.filter((t) => words.every((w) => t._n.includes(w)));
}

export const SORTS = {
  added: { label: 'الأحدث', fn: (a, b) => (b.addedAt || 0) - (a.addedAt || 0) },
  title: { label: 'الاسم', fn: (a, b) => (a.title || '').localeCompare(b.title || '', 'ar') },
  artist: { label: 'الفنان', fn: (a, b) => (a.artist || '').localeCompare(b.artist || '', 'ar') || (a.title || '').localeCompare(b.title || '', 'ar') },
  plays: { label: 'الأكثر تشغيلاً', fn: (a, b) => (b.plays || 0) - (a.plays || 0) || (b.lastPlayed || 0) - (a.lastPlayed || 0) },
  recent: { label: 'آخر تشغيل', fn: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) },
  duration: { label: 'المدة', fn: (a, b) => (b.duration || 0) - (a.duration || 0) },
};

export function sorted(arr, key) {
  return arr.slice().sort((SORTS[key] || SORTS.added).fn);
}

export const SMART = {
  liked: { name: 'المفضلة', icon: 'heartf', get: () => sorted(list().filter((t) => t.liked), 'added').sort((a, b) => (b.likedAt || 0) - (a.likedAt || 0)) },
  top: { name: 'الأكثر استماعاً', icon: 'fire', get: () => sorted(list().filter((t) => t.plays > 0), 'plays').slice(0, 100) },
  recent: { name: 'استمعت مؤخراً', icon: 'clock', get: () => sorted(list().filter((t) => t.lastPlayed), 'recent').slice(0, 100) },
  added: { name: 'أُضيفت حديثاً', icon: 'plus', get: () => sorted(list(), 'added').slice(0, 100) },
  fresh: { name: 'لم تسمعها بعد', icon: 'sparkle', get: () => list().filter((t) => !t.plays) },
  videos: { name: 'الفيديوهات', icon: 'video', get: () => sorted(list().filter((t) => t.kind === 'video'), 'added') },
};

// ---------------------------------------------------------------- playlists

export async function createPlaylist(name, trackIds = []) {
  const p = { id: uid(), name, trackIds: [...trackIds], createdAt: Date.now(), updatedAt: Date.now() };
  playlists.set(p.id, p);
  await db.put('playlists', p);
  emit('playlists');
  return p;
}
export async function savePlaylist(p) {
  p.updatedAt = Date.now();
  playlists.set(p.id, p);
  await db.put('playlists', p);
  emit('playlists');
}
export async function addToPlaylist(pid, ids) {
  const p = playlists.get(pid);
  if (!p) return 0;
  const have = new Set(p.trackIds);
  const add = ids.filter((id) => !have.has(id));
  p.trackIds.push(...add);
  await savePlaylist(p);
  return add.length;
}
export async function deletePlaylist(pid) {
  playlists.delete(pid);
  await db.del('playlists', pid);
  emit('playlists');
}

// ---------------------------------------------------------------- history

export async function recordPlay(id, listened) {
  const t = tracks.get(id);
  if (!t) return;
  t.plays = (t.plays || 0) + 1;
  t.lastPlayed = Date.now();
  await saveTrack(t, { silent: true });
  await db.put('history', { trackId: id, at: Date.now(), sec: Math.round(listened), artist: t.artist || '', title: t.title || '' });
  emit('played', id);
}
export async function recordSkip(id) {
  const t = tracks.get(id);
  if (!t) return;
  t.skips = (t.skips || 0) + 1;
  await saveTrack(t, { silent: true });
}

export function stats() {
  let size = 0, dur = 0, videos = 0;
  for (const t of tracks.values()) { size += t.size || 0; dur += t.duration || 0; if (t.kind === 'video') videos++; }
  return { count: tracks.size, size, dur, videos };
}

export function findDuplicate(fileName, size) {
  for (const t of tracks.values()) if (t.fileName === fileName && t.size === size) return t;
  return null;
}
export function findByYt(ytId) {
  for (const t of tracks.values()) if (t.ytId === ytId) return t;
  return null;
}
