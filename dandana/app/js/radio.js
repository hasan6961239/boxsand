// Radio Browser (community directory, no key, CORS enabled).
import { fetchTimeout, shuffle } from './util.js';

const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];
let good = null;

async function rb(path) {
  const order = good ? [good, ...MIRRORS.filter((m) => m !== good)] : shuffle(MIRRORS);
  let last;
  for (const m of order) {
    try {
      const r = await fetchTimeout(m + path, {}, 9000);
      if (!r.ok) throw new Error(r.status);
      good = m;
      return await r.json();
    } catch (e) { last = e; }
  }
  throw new Error('تعذّر الوصول لدليل المحطات' + (last ? '' : ''));
}

export const CATEGORIES = [
  { id: 'ly', label: 'ليبيا', q: { countrycode: 'LY' } },
  { id: 'arabic', label: 'عربي', q: { tag: 'arabic' } },
  { id: 'tarab', label: 'طرب', q: { tag: 'tarab' } },
  { id: 'eg', label: 'مصر', q: { countrycode: 'EG' } },
  { id: 'tn', label: 'تونس', q: { countrycode: 'TN' } },
  { id: 'sa', label: 'السعودية', q: { countrycode: 'SA' } },
  { id: 'ae', label: 'الإمارات', q: { countrycode: 'AE' } },
  { id: 'lb', label: 'لبنان', q: { countrycode: 'LB' } },
  { id: 'dz', label: 'الجزائر', q: { countrycode: 'DZ' } },
  { id: 'ma', label: 'المغرب', q: { countrycode: 'MA' } },
  { id: 'iq', label: 'العراق', q: { countrycode: 'IQ' } },
  { id: 'kw', label: 'الكويت', q: { countrycode: 'KW' } },
  { id: 'quran', label: 'قرآن', q: { tag: 'quran' } },
  { id: 'khaleeji', label: 'خليجي', q: { tag: 'khaleeji' } },
];

export async function stations(q = {}, limit = 80) {
  const p = new URLSearchParams({
    hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: String(limit), ...q,
  });
  const list = await rb('/json/stations/search?' + p);
  const seen = new Set();
  return list.filter((s) => {
    const k = (s.name || '').trim().toLowerCase();
    if (!s.url_resolved && !s.url) return false;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const searchStations = (name) => stations({ name }, 60);

export function click(uuid) {
  if (!uuid) return;
  rb('/json/url/' + uuid).catch(() => {});
}

// ---------------------------------------------------------------- now playing

/**
 * What the station is playing right now, where its server says so publicly:
 * Zeno (live events), Centova Cast, Icecast and Shoutcast v2. Calls back with
 * {song, artist, title, cover, bitrate, listeners}; returns stop().
 */
export function watchNowPlaying(station, cb) {
  const url = station.url_resolved || station.url || '';
  let stopped = false, timer = null, es = null;
  const stop = () => { stopped = true; clearTimeout(timer); if (es) es.close(); };
  const emit = (info) => { if (!stopped && info && info.song) cb(info); };
  // poll; give up early if the server never answered (not that kind of server)
  const loop = (fn, every = 20000) => {
    let everOk = false;
    const tick = async () => {
      if (stopped) return;
      let ok;
      try { ok = await fn(); if (ok === true) everOk = true; } catch { ok = everOk ? false : 'stop'; }
      if (!stopped && ok !== 'stop') timer = setTimeout(tick, every);
    };
    tick();
  };
  let u;
  try { u = new URL(url); } catch { return stop; }

  // Zeno: server-sent events with the stream title
  const zeno = url.match(/zeno\.fm\/(?:radio\/)?([\w-]{8,})/);
  if (zeno) {
    try {
      es = new EventSource(`https://api.zeno.fm/mounts/metadata/subscribe/${zeno[1]}`);
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          const t = (d.streamTitle || '').trim();
          if (t) emit(split(t));
        } catch { /* ignore */ }
      };
    } catch { /* unsupported */ }
    return stop;
  }
  if (u.protocol !== 'https:') return stop; // mixed content: the page can't ask an http server

  // Centova Cast: /proxy/<account>/stream → /rpc/<account>/streaminfo.get
  const cc = u.pathname.match(/^\/proxy\/([\w-]+)/);
  if (cc) {
    loop(async () => {
      const d = await (await fetchTimeout(`${u.origin}/rpc/${cc[1]}/streaminfo.get`, {}, 8000)).json();
      const x = d && d.data && d.data[0];
      if (!x) return 'stop';
      const img = x.track && x.track.imageurl;
      emit({ ...split(x.song || ''), cover: img && !/nocover/.test(img) ? img : null, bitrate: x.bitrate, listeners: x.listeners });
      return true;
    });
    return stop;
  }

  // Icecast first, then Shoutcast v2; keep whichever answers
  loop(async () => {
    try {
      const d = await (await fetchTimeout(`${u.origin}/status-json.xsl`, {}, 8000)).json();
      let src = d && d.icestats && d.icestats.source;
      if (src) {
        src = [].concat(src);
        const s = src.find((x) => x.listenurl && new URL(x.listenurl, u.origin).pathname === u.pathname) || src[0];
        const song = s.title ? (s.artist ? `${s.artist} - ${s.title}` : s.title) : '';
        emit({ ...split(song), listeners: s.listeners, bitrate: s.bitrate || s['ice-bitrate'] });
        return true;
      }
    } catch { /* not icecast */ }
    const d = await (await fetchTimeout(`${u.origin}/stats?sid=1&json=1`, {}, 8000)).json();
    if (!d || !('songtitle' in d)) return 'stop';
    emit({ ...split(d.songtitle || ''), listeners: d.currentlisteners, bitrate: d.bitrate });
    return true;
  });
  return stop;
}

function split(song) {
  song = (song || '').replace(/\s+/g, ' ').trim();
  const m = song.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return { song, artist: m ? m[1] : '', title: m ? m[2] : song };
}

export async function stationDetails(st) {
  if (st.votes != null && st.language != null) return st;
  try {
    const list = await rb('/json/stations/byuuid/' + st.stationuuid);
    return { ...st, ...(list && list[0]) };
  } catch {
    return st;
  }
}
