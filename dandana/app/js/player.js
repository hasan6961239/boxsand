// Playback engine: one <audio> (survives screen lock) and one <video> for
// clips, a queue of heterogeneous items, lock-screen controls, play counting,
// sleep timer and queue restore.
//
// Queue item shapes:
//   {type:'track', id}                         local file
//   {type:'yt', ytId, title, artist, thumbnail} YouTube via the server
//   {type:'ytq', artist, title, cover}          resolved to 'yt' on demand
//   {type:'preview', url, title, artist, cover} 30-second preview
//   {type:'radio', station}                     live radio
import * as lib from './library.js';
import * as db from './db.js';
import * as api from './api.js';
import { artURL } from './art.js';
import { toast, shuffle as shuffled } from './util.js';

const MS = 'mediaSession' in navigator;

let silentURL = null;
function silentWav() {
  if (silentURL) return silentURL;
  const sr = 8000, n = 400;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  silentURL = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentURL;
}

/**
 * iOS only lets a media element start playing from script once it has been
 * played inside a user gesture. Call this from a touch/click handler: it
 * plays the element silently for a moment so later play() calls — after an
 * IndexedDB read, from the lock screen, when a track ends — are allowed.
 */
export function unlockMedia(el, isBusy = () => false) {
  if (!el || el._unlocked) return;
  el._unlocked = true;
  const had = el.getAttribute('src');
  const wasMuted = el.muted;
  el.muted = true;
  if (!had) el.src = silentWav();
  const restore = () => {
    if (!had && el.getAttribute('src') === silentURL) { el.pause(); el.removeAttribute('src'); el.load(); }
    else if (had && !isBusy()) el.pause();
    el.muted = wasMuted;
  };
  try {
    const p = el.play();
    if (p && p.then) p.then(restore, restore); else restore();
  } catch { restore(); }
}

class Player extends EventTarget {
  constructor() {
    super();
    this.audio = document.getElementById('audio');
    this.video = document.createElement('video');
    this.video.className = 'np-video';
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('webkit-playsinline', '');
    this.el = this.audio;
    this.queue = [];
    this.original = [];
    this.index = -1;
    this.context = '';
    this.current = null;
    this.cache = new Map(); // item -> resolved source
    this.token = 0;
    this.listened = 0;
    this.lastT = null;
    this.counted = false;
    this.wantPlaying = false;
    this.feeder = null;
    this.sleepAt = null;
    this.sleepEnd = false;
    this.npOpen = false;
    for (const el of [this.audio, this.video]) this.bind(el);
    this.setupMediaSession();
    document.addEventListener('visibilitychange', () => this.onVisibility());
    setInterval(() => this.saveQueue(), 15000);
  }

  get shuffle() { return lib.settings.shuffle; }
  get repeat() { return lib.settings.repeat; }
  get playing() { return !this.el.paused && !this.el.ended; }
  get item() { return this.queue[this.index] || null; }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  bind(el) {
    el.preload = 'auto';
    el.addEventListener('play', () => { if (el === this.el) { this.emit('state'); this.posState(); } });
    el.addEventListener('pause', () => { if (el === this.el) { this.emit('state'); this.posState(); } });
    el.addEventListener('waiting', () => el === this.el && this.emit('buffering', true));
    el.addEventListener('playing', () => el === this.el && this.emit('buffering', false));
    el.addEventListener('timeupdate', () => el === this.el && this.onTime());
    el.addEventListener('ended', () => el === this.el && this.onEnded());
    el.addEventListener('ratechange', () => el === this.el && this.posState());
    el.addEventListener('loadedmetadata', () => {
      if (el !== this.el || !this.current) return;
      const d = el.duration;
      if (isFinite(d) && d > 0) {
        this.current.duration = d;
        const t = this.current.trackId && lib.tracks.get(this.current.trackId);
        if (t && (!t.duration || Math.abs(t.duration - d) > 2)) lib.updateTrack(t.id, { duration: d }, { silent: true });
      }
      this.emit('time');
      this.posState();
    });
    el.addEventListener('error', () => {
      if (el !== this.el || !this.current || !el.getAttribute('src')) return;
      const c = this.current;
      const msg = c.live ? 'تعذّر تشغيل المحطة' : c.trackId ? 'تعذّر تشغيل هذا الملف (صيغة غير مدعومة؟)' : 'تعذّر تشغيل المقطع';
      toast(msg, { error: true });
      this.emit('error', msg);
      if (!c.live && this.queue.length > 1 && this.wantPlaying) setTimeout(() => this.next(true), 1500);
    });
  }

  // ------------------------------------------------------------ resolving

  async resolve(item) {
    if (this.cache.has(item)) return this.cache.get(item);
    let r;
    if (item.type === 'track') {
      const t = lib.tracks.get(item.id);
      if (!t) throw new Error('الأغنية حُذفت');
      const rec = await db.get('media', item.id);
      if (!rec || !rec.blob) throw new Error('ملف الأغنية مفقود');
      r = {
        src: URL.createObjectURL(rec.blob), blob: true, isVideo: t.kind === 'video',
        title: t.title, artist: t.artist, album: t.album, duration: t.duration,
        art: await artURL(t.art, 'full'), trackId: t.id, lyrics: t.lyrics,
      };
    } else if (item.type === 'yt' || item.type === 'ytq') {
      if (!api.hasServer()) throw new Error('هذا المقطع يحتاج خادم التحميل');
      if (!item.ytId) {
        const hit = await api.findOnYouTube(item.artist || '', item.title || '');
        if (!hit) throw new Error('لم أجد الأغنية على يوتيوب');
        item.ytId = hit.id;
        item.thumbnail = item.thumbnail || hit.thumbnail;
      }
      const vid = !!item.video && lib.settings.videoMode;
      r = {
        src: api.streamURL(item.ytId, vid ? 'video' : 'audio'), isVideo: vid,
        title: item.title, artist: item.artist, album: item.type === 'ytq' ? 'اكتشاف على ذوقك' : 'يوتيوب',
        duration: item.duration, art: item.cover || item.thumbnail, ytId: item.ytId, stream: true,
      };
    } else if (item.type === 'preview') {
      r = { src: item.url, title: item.title, artist: item.artist, album: 'مقطع تجريبي', duration: 30, art: item.cover, preview: true };
    } else if (item.type === 'radio') {
      const s = item.station;
      let url = s.url_resolved || s.url;
      if (url.startsWith('http:') && location.protocol === 'https:') {
        url = api.hasServer() ? api.radioURL(url) : url.replace(/^http:/, 'https:');
      }
      r = { src: url, title: s.name, artist: [s.country, s.tags && s.tags.split(',')[0]].filter(Boolean).join(' · '), album: 'راديو', art: s.favicon, live: true, station: s };
    } else {
      throw new Error('عنصر غير معروف');
    }
    this.cache.set(item, r);
    return r;
  }

  prune() {
    // keep resolved sources only for current ±1 so blob URLs don't pile up
    const keep = new Set([this.queue[this.index - 1], this.queue[this.index], this.queue[this.index + 1]]);
    for (const [it, r] of this.cache) {
      if (!keep.has(it)) {
        if (r.blob) URL.revokeObjectURL(r.src);
        this.cache.delete(it);
      }
    }
  }

  prefetchNext() {
    const n = this.queue[this.index + 1] || (this.repeat === 'all' ? this.queue[0] : null);
    if (n && n.type === 'track') this.resolve(n).catch(() => {});
  }

  // ------------------------------------------------------------ queue ops

  /** Replace the queue and start playing. */
  playItems(items, start = 0, { context = '', shuffle = null, feeder = null, autoplay = true } = {}) {
    if (!items.length) return;
    this.feeder = feeder;
    this.context = context;
    if (shuffle != null && shuffle !== this.shuffle) lib.setSetting('shuffle', shuffle);
    this.original = items.slice();
    // start = -1 means "any song" (used by the shuffle buttons)
    let q = items.slice();
    let idx = Math.max(0, Math.min(start, q.length - 1));
    if (this.shuffle && !feeder) {
      const first = start >= 0 ? q[idx] : null;
      const rest = this.smartShuffle(q.filter((x) => x !== first));
      q = first ? [first, ...rest] : rest;
      idx = 0;
    }
    this.queue = q;
    this.emit('queue');
    return this.load(idx, autoplay);
  }

  playTracks(ids, start = 0, opts = {}) {
    return this.playItems(ids.map((id) => ({ type: 'track', id })), start, opts);
  }

  smartShuffle(items) {
    const a = shuffled(items);
    // nudge apart consecutive songs by the same artist
    const artistOf = (it) => (it.type === 'track' ? (lib.tracks.get(it.id) || {}).artist : it.artist) || '';
    for (let i = 1; i < a.length; i++) {
      if (artistOf(a[i]) && artistOf(a[i]) === artistOf(a[i - 1])) {
        for (let j = i + 1; j < a.length; j++) {
          if (artistOf(a[j]) !== artistOf(a[i - 1])) { [a[i], a[j]] = [a[j], a[i]]; break; }
        }
      }
    }
    return a;
  }

  playNext(items) {
    items = [].concat(items);
    if (this.index < 0) return this.playItems(items, 0);
    this.queue.splice(this.index + 1, 0, ...items);
    const oi = this.original.indexOf(this.item);
    this.original.splice(oi + 1, 0, ...items);
    this.emit('queue');
    this.prefetchNext();
  }

  addToQueue(items) {
    items = [].concat(items);
    if (this.index < 0) return this.playItems(items, 0);
    this.queue.push(...items);
    this.original.push(...items);
    this.emit('queue');
  }

  removeAt(i) {
    if (i === this.index) return;
    const [it] = this.queue.splice(i, 1);
    const oi = this.original.indexOf(it);
    if (oi >= 0) this.original.splice(oi, 1);
    if (i < this.index) this.index--;
    this.emit('queue');
  }

  move(from, to) {
    if (to < 0 || to >= this.queue.length) return;
    const cur = this.item;
    const [it] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, it);
    this.index = this.queue.indexOf(cur);
    this.emit('queue');
  }

  setShuffle(on) {
    lib.setSetting('shuffle', on);
    const cur = this.item;
    if (cur && !this.feeder) {
      if (on) {
        const rest = this.queue.filter((x, i) => i !== this.index);
        this.queue = [cur, ...this.smartShuffle(rest)];
        this.index = 0;
      } else {
        this.queue = this.original.slice();
        this.index = Math.max(0, this.queue.indexOf(cur));
      }
    }
    this.emit('queue');
    this.emit('mode');
  }

  cycleRepeat() {
    const next = { off: 'all', all: 'one', one: 'off' }[this.repeat] || 'off';
    lib.setSetting('repeat', next);
    this.emit('mode');
    return next;
  }

  // ------------------------------------------------------------ loading

  async load(i, autoplay = true, startAt = 0) {
    if (i < 0 || i >= this.queue.length) return;
    const token = ++this.token;
    this.index = i;
    const item = this.queue[i];
    this.emit('loading', item);
    let src;
    try {
      src = await this.resolve(item);
    } catch (e) {
      if (token !== this.token) return;
      toast(e.message || 'تعذّر التشغيل', { error: true });
      if (autoplay && this.queue.length > 1 && i < this.queue.length - 1) setTimeout(() => token === this.token && this.load(i + 1, true), 1200);
      return;
    }
    if (token !== this.token) return;
    const useVideo = src.isVideo && lib.settings.videoMode;
    const el = useVideo ? this.video : this.audio;
    if (el !== this.el) {
      this.el.pause();
      this.el.removeAttribute('src');
      this.el.load();
      this.el = el;
      this.emit('element');
    }
    this.current = src;
    this.listened = 0; this.lastT = null; this.counted = false;
    el.src = src.src;
    el.playbackRate = src.live ? 1 : lib.settings.speed || 1;
    if (startAt) {
      el.addEventListener('loadedmetadata', () => { try { el.currentTime = startAt; } catch { /* ignore */ } }, { once: true });
    }
    this.updateMediaSession();
    this.emit('track', src);
    this.emit('queue');
    if (autoplay) {
      this.wantPlaying = true;
      el.play().catch((e) => {
        if (e.name === 'NotAllowedError') { this.wantPlaying = false; this.emit('state'); }
      });
    } else {
      el.load();
    }
    this.prune();
    this.prefetchNext();
    this.saveQueue();
  }

  play() {
    if (!this.current) {
      if (this.queue.length) return this.load(Math.max(0, this.index), true);
      return;
    }
    this.wantPlaying = true;
    if (this.current.live) {
      // reconnect live streams instead of resuming a stale buffer
      this.el.src = this.current.src;
    }
    return this.el.play().catch(() => {});
  }
  pause() { this.wantPlaying = false; this.el.pause(); this.saveQueue(); }
  toggle() { return this.playing ? this.pause() : this.play(); }

  seek(t) {
    if (!this.current || this.current.live) return;
    try { this.el.currentTime = Math.max(0, Math.min(t, (this.el.duration || t) - 0.2)); } catch { /* ignore */ }
    this.lastT = null;
    this.posState();
  }

  async next(auto = false) {
    if (!auto) this.noteSkip();
    if (this.index < this.queue.length - 1) return this.load(this.index + 1, true);
    if (this.feeder) {
      const more = await this.feeder().catch(() => []);
      if (more && more.length) {
        this.queue.push(...more); this.original.push(...more);
        return this.load(this.index + 1, true);
      }
    }
    if (this.repeat === 'all' && this.queue.length) return this.load(0, true);
    if (auto) { this.wantPlaying = false; this.emit('state'); this.emit('ended'); }
  }

  prev() {
    if (this.el.currentTime > 4 || this.index <= 0 || (this.current && this.current.live)) return this.seek(0);
    return this.load(this.index - 1, true);
  }

  async onEnded() {
    if (this.repeat === 'one' && this.current && !this.current.live) {
      this.el.currentTime = 0;
      this.el.play().catch(() => {});
      return;
    }
    if (this.sleepEnd) {
      this.sleepEnd = false;
      this.wantPlaying = false;
      this.emit('sleep');
      this.emit('state');
      return;
    }
    // top up endless queues early so the next track is ready
    if (this.feeder && this.index >= this.queue.length - 2) {
      const more = await this.feeder().catch(() => []);
      if (more && more.length) { this.queue.push(...more); this.original.push(...more); this.emit('queue'); }
    }
    this.next(true);
  }

  onTime() {
    const t = this.el.currentTime;
    if (this.lastT != null) {
      const d = t - this.lastT;
      if (d > 0 && d < 2) this.listened += d;
    }
    this.lastT = t;
    const c = this.current;
    if (c && c.trackId && !this.counted) {
      const need = Math.min(30, (c.duration || 60) * 0.5);
      if (this.listened >= need) { this.counted = true; lib.recordPlay(c.trackId, this.listened); }
    }
    if (this.sleepAt && Date.now() >= this.sleepAt) this.fireSleep();
    if (this.feeder && this.index >= this.queue.length - 2 && !this.feeding) {
      this.feeding = true;
      this.feeder().then((more) => {
        if (more && more.length) { this.queue.push(...more); this.original.push(...more); this.emit('queue'); }
      }).catch(() => {}).finally(() => { this.feeding = false; });
    }
    this.emit('time');
  }

  noteSkip() {
    const c = this.current;
    if (c && c.trackId && !this.counted && this.listened > 0 && this.listened < 15) lib.recordSkip(c.trackId);
  }

  // ------------------------------------------------------------ modes

  setVideoMode(on) {
    lib.setSetting('videoMode', on);
    const c = this.current;
    if (c && c.isVideo) this.switchElement(on);
    this.emit('mode');
  }

  switchElement(useVideo) {
    const from = this.el, to = useVideo ? this.video : this.audio;
    if (from === to || !this.current) return;
    const t = from.currentTime, playing = !from.paused || this.wantPlaying;
    from.pause();
    to.src = this.current.src;
    to.playbackRate = from.playbackRate;
    to.addEventListener('loadedmetadata', () => {
      try { to.currentTime = t; } catch { /* ignore */ }
      if (playing) to.play().catch(() => {});
    }, { once: true });
    if (playing) to.play().catch(() => {});
    from.removeAttribute('src');
    from.load();
    this.el = to;
    this.lastT = null;
    this.emit('element');
  }

  onVisibility() {
    if (document.hidden) {
      this.saveQueue();
      if (this.el === this.video && this.wantPlaying && lib.settings.bgAudio) {
        this.switchElement(false);
        this.autoSwitched = true;
      }
    } else if (this.autoSwitched) {
      this.autoSwitched = false;
      if (this.npOpen && this.current && this.current.isVideo && lib.settings.videoMode) this.switchElement(true);
    }
  }

  setSpeed(r) {
    lib.setSetting('speed', r);
    if (this.current && !this.current.live) this.el.playbackRate = r;
    this.emit('mode');
  }

  setSleep(v) {
    clearTimeout(this.sleepT);
    this.sleepAt = null; this.sleepEnd = false;
    if (v === 'end') this.sleepEnd = true;
    else if (v) {
      this.sleepAt = Date.now() + v * 60000;
      this.sleepT = setTimeout(() => this.fireSleep(), v * 60000 + 200);
    }
    this.emit('sleep');
  }
  fireSleep() {
    if (!this.sleepAt || Date.now() < this.sleepAt - 500) return;
    this.sleepAt = null;
    this.pause();
    this.emit('sleep');
    toast('انتهى مؤقت النوم — تصبح على خير 🌙');
  }

  // ------------------------------------------------------------ lock screen

  setupMediaSession() {
    if (!MS) return;
    const ms = navigator.mediaSession;
    const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported */ } };
    set('play', () => this.play());
    set('pause', () => this.pause());
    set('previoustrack', () => this.prev());
    set('nexttrack', () => this.next());
    set('seekto', (d) => this.seek(d.seekTime));
    set('stop', () => this.pause());
  }

  updateMediaSession() {
    if (!MS || !this.current) return;
    const c = this.current;
    const art = c.art ? [{ src: c.art, sizes: '512x512', type: 'image/jpeg' }] :
      [{ src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: c.title || '', artist: c.artist || '', album: c.album || 'دندنة', artwork: art,
      });
    } catch { /* ignore */ }
  }

  posState() {
    if (!MS || !navigator.mediaSession.setPositionState) return;
    const el = this.el;
    try {
      if (this.current && !this.current.live && isFinite(el.duration) && el.duration > 0) {
        navigator.mediaSession.setPositionState({
          duration: el.duration, playbackRate: el.playbackRate || 1, position: Math.min(el.currentTime, el.duration),
        });
      }
      navigator.mediaSession.playbackState = el.paused ? 'paused' : 'playing';
    } catch { /* ignore */ }
  }

  // ------------------------------------------------------------ persistence

  saveQueue() {
    if (!this.queue.length) return;
    const items = this.queue.filter((x) => x.type === 'track').slice(0, 1000);
    const cur = this.item;
    const idx = cur && cur.type === 'track' ? items.indexOf(cur) : -1;
    db.kvSet('queue', {
      ids: items.map((x) => x.id), index: Math.max(0, idx),
      pos: idx >= 0 ? this.el.currentTime || 0 : 0, context: this.context,
    });
  }

  async restore() {
    const q = await db.kvGet('queue', null);
    if (!q || !q.ids || !q.ids.length) return;
    const ids = q.ids.filter((id) => lib.tracks.has(id));
    if (!ids.length) return;
    this.context = q.context || '';
    this.queue = ids.map((id) => ({ type: 'track', id }));
    this.original = this.queue.slice();
    const idx = Math.min(q.index || 0, this.queue.length - 1);
    await this.load(idx, false, q.pos || 0);
  }
}

export const player = new Player();
