// Lyrics from LRCLIB (free, no key). Synced (LRC) when available.
import * as lib from './library.js';
import { fetchTimeout, norm } from './util.js';

export function parseLRC(text) {
  const lines = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) {
      const t = +m[1] * 60 + +m[2] + (m[3] ? +('0.' + m[3].padEnd(3, '0')) : 0);
      lines.push({ t, text: words });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

async function lrclib(path) {
  const r = await fetchTimeout('https://lrclib.net/api/' + path, {}, 10000);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('lrclib ' + r.status);
  return r.json();
}

/** Returns {synced:[{t,text}]|null, plain:string|null, source} or null. */
export async function getLyrics({ trackId, title, artist, duration }) {
  const t = trackId && lib.tracks.get(trackId);
  if (t && t.lyricsData) return t.lyricsData;
  if (t && t.lyrics && !t.lyricsChecked) {
    const synced = parseLRC(t.lyrics);
    return { synced: synced.length > 3 ? synced : null, plain: t.lyrics, source: 'الملف' };
  }
  if (t && t.lyricsChecked && !t.lyricsData) return null;
  let hit = null;
  try {
    if (artist && title && duration) {
      const p = new URLSearchParams({ artist_name: artist, track_name: title, duration: String(Math.round(duration)) });
      hit = await lrclib('get?' + p);
    }
    if (!hit) {
      const list = await lrclib('search?' + new URLSearchParams({ q: `${artist || ''} ${title || ''}`.trim() }));
      if (list && list.length) {
        const nt = norm(title);
        hit = list.find((x) => norm(x.trackName) === nt && (!duration || Math.abs((x.duration || 0) - duration) < 8)) ||
          list.find((x) => norm(x.trackName).includes(nt) || nt.includes(norm(x.trackName))) || null;
      }
    }
  } catch {
    return null; // offline — don't cache the miss
  }
  const data = hit && (hit.syncedLyrics || hit.plainLyrics) ? {
    synced: hit.syncedLyrics ? parseLRC(hit.syncedLyrics) : null,
    plain: hit.plainLyrics || null,
    source: 'LRCLIB',
  } : null;
  if (t) lib.updateTrack(t.id, { lyricsData: data, lyricsChecked: true }, { silent: true });
  return data;
}
