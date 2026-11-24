// Skip the non-music parts of songs that came from YouTube clips (talking,
// intros, promos), using the community SponsorBlock database. The request
// sends only the first 4 characters of the video id's SHA-256 hash, so the
// server doesn't learn which song is playing.
import * as db from './db.js';
import { fetchTimeout } from './util.js';

const CATS = ['music_offtopic', 'sponsor', 'selfpromo', 'interaction'];
let cache = null;

async function prefix(id) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return [...new Uint8Array(h)].slice(0, 2).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** [{start, end}] to skip for a YouTube video id (cached for a week). */
export async function segments(id) {
  if (!id || !crypto.subtle) return [];
  if (!cache) cache = (await db.kvGet('sponsor', {})) || {};
  const hit = cache[id];
  if (hit && Date.now() - hit.at < 7 * 86400e3) return hit.s;
  let s = [];
  try {
    const q = encodeURIComponent(JSON.stringify(CATS));
    const r = await fetchTimeout(`https://sponsor.ajay.app/api/skipSegments/${await prefix(id)}?categories=${q}`, {}, 8000);
    if (r.ok) {
      const list = await r.json();
      const v = list.find((x) => x.videoID === id);
      s = ((v && v.segments) || [])
        .filter((x) => x.actionType === 'skip' || !x.actionType)
        .map((x) => ({ start: x.segment[0], end: x.segment[1] }))
        .filter((x) => x.end - x.start >= 1)
        .sort((a, b) => a.start - b.start);
    } else if (r.status !== 404) {
      return hit ? hit.s : [];
    }
  } catch {
    return hit ? hit.s : [];
  }
  cache[id] = { s, at: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > 1500) for (const k of keys.slice(0, keys.length - 1500)) delete cache[k];
  db.kvSet('sponsor', cache);
  return s;
}
