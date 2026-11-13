// "على ذوقي": a taste profile from the library (artists weighted by songs,
// likes, plays, skips), recommendations from Deezer's public catalogue
// (related artists + their top songs, filtered against the library), and
// YouTube "Mix" radios through the server.
import * as lib from './library.js';
import * as db from './db.js';
import * as api from './api.js';
import { norm, weightedOrder, shuffle } from './util.js';

// ---------------------------------------------------------------- profile

export function profile() {
  const arts = lib.artists().filter((a) => a.key !== 'unknown');
  for (const a of arts) {
    const skips = a.tracks.reduce((s, t) => s + (t.skips || 0), 0);
    a.score = a.tracks.length + a.likes * 4 + Math.log2(1 + a.plays) * 3 - skips * 0.3;
  }
  return arts.sort((a, b) => b.score - a.score);
}

function trackWeight(t, artistScores, now) {
  let w = 1 + (t.liked ? 3 : 0) + Math.log2(1 + (t.plays || 0)) * 1.2 - Math.min(3, (t.skips || 0) * 0.4);
  w += artistScores.get(lib.artistKey(t.artist)) || 0;
  if (t.lastPlayed && now - t.lastPlayed < 3 * 3600e3) w *= 0.15;
  else if (t.lastPlayed && now - t.lastPlayed < 24 * 3600e3) w *= 0.5;
  return Math.max(0.05, w);
}

/** Library songs ordered by taste-weighted randomness. */
export function tasteOrder(pool = lib.list()) {
  const prof = profile();
  const max = (prof[0] && prof[0].score) || 1;
  const scores = new Map(prof.map((a) => [a.key, (a.score / max) * 2.5]));
  const now = Date.now();
  return weightedOrder(pool, (t) => trackWeight(t, scores, now));
}

// ---------------------------------------------------------------- Deezer

let cbn = 0;
function jsonp(url, ms = 12000) {
  return new Promise((resolve, reject) => {
    const name = `__dz${Date.now().toString(36)}${++cbn}`;
    const s = document.createElement('script');
    const cleanup = () => { clearTimeout(t); delete window[name]; s.remove(); };
    const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, ms);
    window[name] = (d) => { cleanup(); d && d.error ? reject(new Error(d.error.message || 'deezer')) : resolve(d); };
    s.onerror = () => { cleanup(); reject(new Error('network')); };
    s.src = url + (url.includes('?') ? '&' : '?') + 'output=jsonp&callback=' + name;
    document.head.appendChild(s);
  });
}
const dz = (path) => jsonp('https://api.deezer.com' + path);

let artistCache = null;
async function dzArtist(name) {
  if (!artistCache) artistCache = (await db.kvGet('dzArtists', {})) || {};
  const k = norm(name);
  if (k in artistCache) return artistCache[k];
  const r = await dz(`/search/artist?q=${encodeURIComponent(name)}&limit=3`);
  const a = (r.data || []).find((x) => norm(x.name) === k) || (r.data || [])[0] || null;
  artistCache[k] = a ? { id: a.id, name: a.name, picture: a.picture_medium, fans: a.nb_fan } : null;
  db.kvSet('dzArtists', artistCache);
  return artistCache[k];
}
const dzTop = (id, n = 10) => dz(`/artist/${id}/top?limit=${n}`).then((r) => r.data || []);
const dzRelated = (id, n = 12) => dz(`/artist/${id}/related?limit=${n}`).then((r) => r.data || []);

function libraryIndex() {
  const s = new Set();
  for (const t of lib.tracks.values()) {
    s.add(norm(t.title));
    s.add(norm((t.title || '').replace(/\(.*?\)|\[.*?\]/g, '')));
  }
  return s;
}

function recFrom(tr, reason) {
  return {
    dzId: tr.id,
    title: tr.title_short || tr.title,
    artist: (tr.artist && tr.artist.name) || '',
    album: tr.album && tr.album.title,
    cover: tr.album && (tr.album.cover_medium || tr.album.cover),
    coverBig: tr.album && (tr.album.cover_xl || tr.album.cover_big),
    preview: tr.preview,
    duration: tr.duration,
    reason,
  };
}

let lastRecs = null;
export const cachedRecs = () => lastRecs;

/** Returns {items, artists, seeds}. */
export async function recommend({ limit = 40 } = {}) {
  const prof = profile();
  if (!prof.length) return { items: [], artists: [], seeds: [] };
  const seeds = weightedOrder(prof.slice(0, 15), (a) => a.score + 1).slice(0, 5);
  const idx = libraryIndex();
  const mine = new Set(prof.map((a) => a.key));
  const out = [], seen = new Set(), newArtists = new Map();
  const add = (tr, reason) => {
    if (!tr || !tr.title) return;
    const r = recFrom(tr, reason);
    const key = norm(r.artist + ' ' + r.title);
    if (seen.has(r.dzId) || seen.has(key) || idx.has(norm(r.title))) return;
    seen.add(r.dzId); seen.add(key);
    out.push(r);
  };
  await Promise.all(seeds.map(async (s) => {
    try {
      const a = await dzArtist(s.name);
      if (!a) return;
      const [top, rel] = await Promise.all([dzTop(a.id, 15), dzRelated(a.id)]);
      for (const tr of shuffle(top).slice(0, 4)) add(tr, `جديد من ${s.name}`);
      const picks = shuffle(rel.slice(0, 10)).slice(0, 3);
      await Promise.all(picks.map(async (ra) => {
        if (!mine.has(norm(ra.name))) newArtists.set(ra.id, { id: ra.id, name: ra.name, picture: ra.picture_medium, because: s.name });
        const tt = await dzTop(ra.id, 8).catch(() => []);
        for (const tr of shuffle(tt).slice(0, 2)) add(tr, `لأنك تحب ${s.name}`);
      }));
    } catch (e) {
      console.warn('recs', s.name, e);
    }
  }));
  lastRecs = { items: shuffle(out).slice(0, limit), artists: [...newArtists.values()].slice(0, 12), seeds: seeds.map((s) => s.name), at: Date.now() };
  db.kvSet('lastRecs', lastRecs);
  return lastRecs;
}

export async function loadCachedRecs() {
  if (!lastRecs) lastRecs = await db.kvGet('lastRecs', null);
  return lastRecs;
}

export async function artistTop(name, n = 20) {
  const a = await dzArtist(name);
  if (!a) return [];
  const idx = libraryIndex();
  return (await dzTop(a.id, n)).map((tr) => ({ ...recFrom(tr, ''), inLibrary: idx.has(norm(tr.title_short || tr.title)) }));
}

// ---------------------------------------------------------------- radios

export const recToItem = (r) => ({ type: 'ytq', artist: r.artist, title: r.title, cover: r.coverBig || r.cover, isNew: true });

/** Endless taste radio. Mixes in new songs (every 4th) when the server is set up. */
export function tasteRadio() {
  const order = tasteOrder();
  let pos = 0;
  let recs = [];
  let recPos = 0;
  const mix = lib.settings.mixNew && api.canSearch();
  if (mix) {
    const c = cachedRecs();
    if (c && c.items) recs = shuffle(c.items);
    recommend().then((r) => { recs = shuffle(r.items); recPos = 0; }).catch(() => {});
  }
  let reshuffles = 0;
  const batch = (n) => {
    const b = [];
    if (!order.length) {
      while (b.length < n && recPos < recs.length) b.push(recToItem(recs[recPos++]));
      return b;
    }
    while (b.length < n) {
      if (mix && recs.length && (b.length + pos) % 4 === 3 && recPos < recs.length) b.push(recToItem(recs[recPos++]));
      if (pos >= order.length) {
        if (++reshuffles > 50) break;
        order.splice(0, order.length, ...tasteOrder());
        pos = 0;
      }
      b.push({ type: 'track', id: order[pos++].id });
    }
    return b;
  };
  return { items: batch(20), feeder: async () => batch(15) };
}

/** YouTube "Mix" for a song (server). */
export async function ytMix({ ytId, artist, title }) {
  let id = ytId;
  if (!id) {
    const hit = await api.findOnYouTube(artist, title);
    if (!hit) throw new Error('لم أجد الأغنية على يوتيوب');
    id = hit.id;
  }
  return api.related(id, 30, { title: `${artist || ''} - ${title || ''}`, channel: artist });
}
