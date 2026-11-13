// YouTube Data API v3 — Google's official API. A free key gives 10,000
// units a day (a search costs 100, so ~100 searches/day). Used for search,
// playlists and Shorts when no home server is set up.
import * as lib from './library.js';
import * as db from './db.js';
import { fetchTimeout } from './util.js';

const BASE = 'https://www.googleapis.com/youtube/v3/';
export const hasKey = () => !!(lib.settings.ytKey || '').trim();

function decode(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}

export function isoSeconds(d) {
  const m = (d || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

async function call(path, params) {
  const key = cleanKey(lib.settings.ytKey);
  if (!key) throw new Error('أضف مفتاح يوتيوب من الإعدادات للبحث');
  const q = new URLSearchParams({ ...params, key });
  let r;
  try {
    r = await fetchTimeout(BASE + path + '?' + q, {}, 15000);
  } catch {
    throw new Error('تعذّر الاتصال بيوتيوب — تحقق من الإنترنت');
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(explain(r.status, d.error || {}));
  return d;
}

/** Google's error → what to fix, in Arabic, with Google's own reason in brackets. */
function explain(status, e) {
  const msg = e.message || '';
  const reasons = [
    ...((e.errors || []).map((x) => x.reason)),
    ...((e.details || []).map((x) => x.reason)),
  ].filter(Boolean);
  const has = (...r) => r.some((x) => reasons.includes(x));
  const tag = ` (${reasons.find((x) => /^[A-Z_]+$/.test(x)) || reasons[0] || status})`;
  if (has('quotaExceeded', 'dailyLimitExceeded', 'RATE_LIMIT_EXCEEDED')) return 'خلصت حصة اليوم لمفتاح يوتيوب — تتجدد بعد منتصف الليل بتوقيت أمريكا' + tag;
  if (has('API_KEY_EXPIRED') || /expired/i.test(msg)) return 'المفتاح منتهي — اعمل مفتاح جديد من Credentials' + tag;
  if (has('API_KEY_INVALID', 'keyInvalid') || /API key not valid/i.test(msg)) return 'جوجل يقول المفتاح غلط: النسخ ناقص، أو المفتاح انمسح. انسخه من جديد بزر النسخ في Credentials' + tag;
  if (has('SERVICE_DISABLED', 'accessNotConfigured') || /has not been used|is disabled/i.test(msg)) return 'YouTube Data API v3 مش مفعّلة في مشروع المفتاح — فعّلها من Library' + tag;
  if (has('API_KEY_SERVICE_BLOCKED') || /Requests to this API .* are blocked/i.test(msg)) return 'المفتاح مقيّد بواجهات أخرى — في قيود المفتاح (API restrictions) زيد YouTube Data API v3' + tag;
  if (has('API_KEY_HTTP_REFERRER_BLOCKED') || /referer|referrer/i.test(msg)) return `المفتاح مقيّد بمواقع أخرى — زيد ${location.origin}/* في Websites` + tag;
  if (has('API_KEY_IP_ADDRESS_BLOCKED', 'API_KEY_ANDROID_APP_BLOCKED', 'API_KEY_IOS_APP_BLOCKED')) return 'المفتاح مقيّد بسيرفر أو تطبيق جوال، فما يشتغلش من المتصفح — اعمل مفتاح جديد خاص بدندنة' + tag;
  return (msg || 'خطأ من يوتيوب') + tag;
}

/** Remove spaces/new lines a copy can bring along, and check the shape (AIza + 35). */
export function cleanKey(k) {
  return (k || '').replace(/[\s‎‏‪-‮]+/g, '');
}
export function keyShapeProblem(k) {
  if (!k) return '';
  if (!k.startsWith('AIza')) return 'المفتاح لازم يبدأ بـ AIza — يمكن نسخت حاجة ثانية (مثل Client ID أو Secret)';
  if (k.length !== 39) return `المفتاح لازم يكون 39 حرف وعندك ${k.length} — النسخ ناقص أو فيه زيادة`;
  if (!/^[A-Za-z0-9_-]+$/.test(k)) return 'في المفتاح رموز غريبة — انسخه من جديد';
  return '';
}

async function details(ids) {
  if (!ids.length) return new Map();
  const d = await call('videos', { part: 'contentDetails,statistics,snippet', id: ids.join(','), maxResults: '50' });
  return new Map((d.items || []).map((v) => [v.id, v]));
}

function item(id, snippet, v) {
  return {
    id,
    title: decode(snippet.title),
    channel: decode(snippet.channelTitle || snippet.videoOwnerChannelTitle || ''),
    duration: v ? isoSeconds(v.contentDetails && v.contentDetails.duration) : null,
    views: v && v.statistics ? +v.statistics.viewCount || null : null,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${id}`,
  };
}

const memo = new Map();
export async function search(q, limit = 20, { short = false } = {}) {
  const k = `${short ? 's' : 'v'}:${limit}:${q}`;
  if (memo.has(k)) return memo.get(k);
  const params = { part: 'snippet', type: 'video', maxResults: String(Math.min(50, limit)), q: short ? `${q} #shorts` : q, relevanceLanguage: 'ar', safeSearch: 'none' };
  if (short) { params.videoDuration = 'short'; params.videoEmbeddable = 'true'; }
  const d = await call('search', params);
  const hits = (d.items || []).filter((x) => x.id && x.id.videoId);
  const info = await details(hits.map((x) => x.id.videoId)).catch(() => new Map());
  let out = hits.map((x) => item(x.id.videoId, x.snippet, info.get(x.id.videoId)));
  if (short) out = out.filter((x) => !x.duration || x.duration <= 180);
  memo.set(k, out);
  return out;
}

export async function video(id) {
  const m = await details([id]);
  const v = m.get(id);
  return v ? item(id, v.snippet, v) : null;
}

export async function playlist(listId, max = 200) {
  const out = [];
  let pageToken;
  do {
    const p = { part: 'snippet,contentDetails', playlistId: listId, maxResults: '50' };
    if (pageToken) p.pageToken = pageToken;
    const d = await call('playlistItems', p);
    for (const x of d.items || []) {
      const id = x.contentDetails && x.contentDetails.videoId;
      if (id && x.snippet.title !== 'Private video' && x.snippet.title !== 'Deleted video') out.push(item(id, x.snippet, null));
    }
    pageToken = d.nextPageToken;
  } while (pageToken && out.length < max);
  const ids = out.map((x) => x.id);
  for (let i = 0; i < ids.length; i += 50) {
    const info = await details(ids.slice(i, i + 50)).catch(() => new Map());
    for (const x of out.slice(i, i + 50)) {
      const v = info.get(x.id);
      if (v) { x.duration = isoSeconds(v.contentDetails.duration); x.views = +v.statistics.viewCount || null; }
    }
  }
  return out;
}

/** Test the key with the cheapest call (1 unit). */
export async function test() {
  await call('videos', { part: 'id', id: 'dQw4w9WgXcQ' });
  return true;
}

// Persisted "artist title" → video cache so the taste mix doesn't spend quota twice.
let found = null;
export async function cachedFind(q) {
  if (!found) found = (await db.kvGet('ytFound', {})) || {};
  return found[q];
}
export async function rememberFind(q, v) {
  if (!found) found = (await db.kvGet('ytFound', {})) || {};
  found[q] = v;
  const keys = Object.keys(found);
  if (keys.length > 800) for (const k of keys.slice(0, keys.length - 800)) delete found[k];
  db.kvSet('ytFound', found);
}
