// Reels: a vertical, swipeable feed. "مكتبتي" plays hooks from your own songs
// and videos; "يوتيوب" shows short clips for the artists you listen to —
// streamed through the home server when there is one, otherwise played in
// YouTube's official embedded player (needs only the free YouTube key).
// One shared <video> element moves between slides so iOS only needs a single
// tap to allow sound.
import * as lib from './library.js';
import * as db from './db.js';
import * as api from './api.js';
import * as taste from './taste.js';
import { player, unlockMedia } from './player.js';
import { artURL } from './art.js';
import { addToPlaylistSheet, ytSheet, ytToItem, openImport, go } from './ui.js';
import { h, ic, toast, shuffle, placeholderArt, btn } from './util.js';

let unlockedOnce = false;
let sharedVideo = null; // reused so iOS remembers the tap that unlocked sound

export function reelsView(root) {
  document.body.classList.add('reels-mode');
  if (player.playing) player.pause();

  const feed = h('div.reels');
  root.append(feed);
  if (!sharedVideo) {
    sharedVideo = document.createElement('video');
    sharedVideo.playsInline = true;
    sharedVideo.setAttribute('playsinline', '');
    sharedVideo.setAttribute('webkit-playsinline', '');
    sharedVideo.preload = 'auto';
  }
  const video = sharedVideo;
  const life = new AbortController();
  const sig = { signal: life.signal };
  let muted = false;
  video.muted = false;

  const sources = [['local', 'مكتبتي'], ['mix', 'الكل'], ['yt', 'يوتيوب']];
  let source = lib.settings.reelsSource || 'mix';
  const ytOn = api.canSearch();
  const embed = !api.hasServer(); // YouTube clips via the official embed player
  if (!ytOn) source = 'local';
  const topBar = h('div.reels-top');
  const drawTop = () => {
    topBar.innerHTML = '';
    for (const [k, label] of sources) {
      if (k !== 'local' && !ytOn) continue;
      topBar.append(h('button' + (k === source ? '.on' : ''), { onclick: () => { if (k === source) return; source = k; lib.setSetting('reelsSource', k); reset(); drawTop(); } }, label));
    }
  };
  root.append(topBar);
  drawTop();

  let items = [], slides = [], active = -1, loading = false, objURL = null, win = null, token = 0;
  let localQ = [], localPos = 0, ytQ = [], ytSeen = new Set(), ytQueries = [], exhaustedYT = false;

  // ------------------------------------------------------------ feeds
  function buildLocal() {
    const all = lib.list();
    const vids = shuffle(all.filter((t) => t.kind === 'video'));
    const auds = taste.tasteOrder(all.filter((t) => t.kind !== 'video'));
    const out = [];
    let v = 0, a = 0;
    while (v < vids.length || a < auds.length) {
      if (v < vids.length) out.push(vids[v++]);
      for (let k = 0; k < 2 && a < auds.length; k++) out.push(auds[a++]);
    }
    localQ = out; localPos = 0;
  }
  function nextLocal(n) {
    if (!localQ.length) buildLocal();
    if (!localQ.length) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      if (localPos >= localQ.length) buildLocal();
      out.push({ kind: 'local', track: localQ[localPos++] });
    }
    return out;
  }
  function buildQueries() {
    const arts = taste.profile().slice(0, 12).map((a) => a.name);
    const qs = [];
    for (const a of shuffle(arts).slice(0, 6)) qs.push(`${a} ${Math.random() < 0.5 ? 'حالات واتس' : 'shorts'}`);
    qs.push(...shuffle(['اغاني ليبية حالات واتس', 'طرب حالات واتس', 'اغاني عربية shorts', 'مقاطع اغاني قصيرة', 'طرب اصيل shorts']).slice(0, 3));
    ytQueries = shuffle(qs);
  }
  async function fetchYT() {
    if (!ytOn || exhaustedYT) return;
    if (ytQueries.length < 2) buildQueries();
    const qs = ytQueries.splice(0, 2);
    const results = await Promise.allSettled(qs.map((q) => api.search(q, 15, 'short')));
    let ok = false;
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      ok = true;
      for (const it of shuffle(r.value)) {
        if (ytSeen.has(it.id) || (it.duration && it.duration > 180)) continue;
        ytSeen.add(it.id);
        ytQ.push({ kind: 'yt', ...it });
      }
    }
    if (!ok && !ytQ.length) {
      const err = results.find((r) => r.status === 'rejected');
      toast(err ? err.reason.message : 'تعذّر جلب مقاطع يوتيوب', { error: true });
      exhaustedYT = true;
    }
  }
  const spinner = h('div.spinner', { style: { position: 'fixed', top: '45%', left: 'calc(50% - 14px)', zIndex: '3' } });
  let feedGen = 0;
  async function more() {
    if (loading) return;
    loading = true;
    const g = feedGen;
    if (!items.length) root.append(spinner);
    if (source !== 'yt') for (const it of nextLocal(source === 'local' ? 8 : 4)) addSlide(it);
    if (source !== 'local') {
      await fetchYT();
      if (g !== feedGen) return; // tab switched while loading
      const yt = ytQ.splice(0, source === 'yt' ? 8 : 4);
      if (source === 'yt') yt.forEach(addSlide);
      else {
        const loc = nextLocal(4);
        for (let i = 0; i < Math.max(loc.length, yt.length); i++) { if (yt[i]) addSlide(yt[i]); if (loc[i]) addSlide(loc[i]); }
      }
    }
    spinner.remove();
    loading = false;
    if (!items.length) showEmpty();
  }

  // ------------------------------------------------------------ slides
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting && e.intersectionRatio > 0.6) activate(slides.indexOf(e.target));
  }, { root: feed, threshold: [0.6] });

  function addSlide(it) {
    const i = items.length;
    items.push(it);
    const el = h('div.reel');
    const bg = h('div.bg');
    const media = h('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center' } });
    const t = it.kind === 'local' ? it.track : null;
    const title = t ? t.title : it.title;
    const artist = t ? (t.artist || '') : it.channel;
    if (t) {
      bg.style.background = placeholderArt(t.album || t.title);
      if (t.kind !== 'video') {
        const art = h('div.cover.art', h('span.cover-letter', (title || '♪').charAt(0)));
        art.style.background = placeholderArt(t.album || t.title);
        media.append(h('div.rings', h('i'), h('i'), h('i')), art);
        if (t.art) artURL(t.art, 'full').then((u) => {
          if (!u) return;
          bg.style.backgroundImage = `url("${u}")`;
          const img = h('img', { src: u, alt: '' });
          img.onload = () => art.classList.add('has-img');
          art.append(img);
        });
      } else if (t.art) {
        artURL(t.art, 'full').then((u) => { if (u) { bg.style.backgroundImage = `url("${u}")`; media.prepend(h('img', { src: u, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: '0' } })); } });
      }
    } else {
      bg.style.backgroundImage = `url("${it.thumbnail}")`;
      media.append(h('img', { src: it.thumbnail, alt: '', style: { width: '100%', height: '100%', objectFit: 'contain', position: 'absolute', inset: '0' } }));
    }
    const likeOn = () => (t ? !!lib.tracks.get(t.id)?.liked : !!lib.findByYt(it.id));
    const likeBtn = h('button' + (likeOn() ? '.on' : ''), { onclick: (e) => { e.stopPropagation(); like(i, likeBtn); } },
      h('span.c', ic(likeOn() ? 'heartf' : 'heart')), t ? 'مفضلة' : 'حفظ');
    const side = h('div.side',
      likeBtn,
      t ? h('button', { onclick: (e) => { e.stopPropagation(); addToPlaylistSheet([t.id]); } }, h('span.c', ic('listplus')), 'قائمة')
        : h('button', { onclick: (e) => { e.stopPropagation(); video.pause(); ytCmd('pauseVideo'); ytSheet(it); } }, h('span.c', ic('download')), 'تحميل'),
      h('button', { onclick: (e) => { e.stopPropagation(); playFull(it); } }, h('span.c', ic('play')), 'كاملة'),
      h('button.mute', { onclick: (e) => { e.stopPropagation(); muted = !muted; video.muted = muted; ytCmd(muted ? 'mute' : 'unMute'); if (!muted) ytCmd('playVideo'); drawMute(); } }, h('span.c', ic(muted ? 'mute' : 'volume')), muted ? 'صامت' : 'صوت'));
    const info = h('div.info',
      h('div.src', ic(t ? (t.kind === 'video' ? 'video' : 'note') : 'compass'), t ? 'من مكتبتك' : 'يوتيوب'),
      h('div.t', title || ''), h('div.a', artist || ''));
    const prog = h('div.rprog', h('i'));
    el.append(bg, media, h('div.shade'), info, side, prog, h('div.pausemark', ic('play')));
    el._media = media; el._prog = prog.firstChild; el._like = likeBtn;
    // tap = pause/play, double tap = like
    let lastTap = 0, tapT;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.side')) return;
      const now = Date.now();
      if (now - lastTap < 280) {
        clearTimeout(tapT);
        lastTap = 0;
        if (!likeOn()) like(i, likeBtn);
        const b = h('div.burst', ic('heartf'));
        b.style.left = (e.clientX - 48) + 'px'; b.style.top = (e.clientY - 48) + 'px'; b.style.position = 'fixed';
        el.append(b);
        setTimeout(() => b.remove(), 900);
        return;
      }
      lastTap = now;
      tapT = setTimeout(() => {
        if (i !== active) return;
        if (video.paused) { video.play().catch(() => {}); } else video.pause();
      }, 280);
    });
    slides.push(el);
    feed.append(el);
    io.observe(el);
  }

  function drawMute() {
    for (const s of slides) {
      const b = s.querySelector('.mute');
      if (!b) continue;
      b.innerHTML = '';
      b.append(h('span.c', ic(muted ? 'mute' : 'volume')), muted ? 'صامت' : 'صوت');
    }
  }

  async function like(i, b) {
    const it = items[i];
    if (it.kind === 'local') {
      const on = await lib.toggleLike(it.track.id);
      b.classList.toggle('on', on);
      b.querySelector('.c').innerHTML = '';
      b.querySelector('.c').append(ic(on ? 'heartf' : 'heart'));
      toast(on ? 'أُضيفت للمفضلة ❤️' : 'أُزيلت من المفضلة');
    } else {
      if (lib.findByYt(it.id)) return toast('موجودة في مكتبتك');
      api.startDownload({ ...it, kind: 'audio' });
      b.classList.add('on');
      b.querySelector('.c').innerHTML = '';
      b.querySelector('.c').append(ic('heartf'));
      toast('يتحمّل لمكتبتك كصوت 🎵');
    }
  }

  function playFull(it) {
    video.pause();
    ytCmd('pauseVideo');
    if (it.kind === 'local') player.playTracks([it.track.id], 0, { context: 'من الريلز' });
    else player.playItems([{ ...ytToItem(it), video: false }], 0, { context: 'من الريلز' });
    toast('يشتغل في المشغّل', { action: { label: 'افتح', fn: () => go('#/home') } });
  }

  let frame = null;
  function ytCmd(func) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');
  }
  function dropFrame() {
    if (frame) { frame.remove(); frame = null; }
  }

  async function activate(i) {
    if (i < 0 || i === active || !items[i]) return;
    active = i;
    const my = ++token;
    for (const s of slides) s.classList.remove('playing', 'paused');
    const slide = slides[i];
    const it = items[i];
    video.pause();
    dropFrame();
    if (it.kind === 'yt' && embed) {
      video.removeAttribute('src');
      const q = new URLSearchParams({
        autoplay: '1', mute: muted || !unlockedOnce ? '1' : '0', playsinline: '1', controls: '0', loop: '1',
        playlist: it.id, rel: '0', enablejsapi: '1', modestbranding: '1', origin: location.origin,
      });
      frame = h('iframe.reel-frame', {
        src: `https://www.youtube-nocookie.com/embed/${it.id}?${q}`,
        allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true, title: it.title || 'YouTube',
      });
      slide._media.append(frame);
      slide.classList.add('playing');
      if (i >= items.length - 3) more();
      return;
    }
    video.classList.remove('contain');
    if (objURL) { URL.revokeObjectURL(objURL); objURL = null; }
    let src, isVideo = true, start = 0, dur = it.duration || null;
    try {
      if (it.kind === 'local') {
        const rec = await db.get('media', it.track.id);
        if (!rec) throw new Error('missing');
        if (my !== token) return;
        objURL = src = URL.createObjectURL(rec.blob);
        isVideo = it.track.kind === 'video';
        dur = it.track.duration || null;
        if (dur) start = isVideo ? (dur > 75 ? dur * 0.2 : 0) : Math.min(dur * 0.32, Math.max(0, dur - 40));
        win = { start, len: isVideo ? 45 : 35 };
      } else {
        src = api.streamURL(it.id, 'video');
        win = null;
      }
    } catch {
      return;
    }
    if (my !== token) return;
    video.style.display = isVideo ? '' : 'none';
    if (it.kind === 'local' && isVideo && it.track.width > it.track.height) video.classList.add('contain');
    slide._media.append(video);
    video.muted = muted;
    video.src = src;
    if (start) video.addEventListener('loadedmetadata', () => { try { video.currentTime = start; } catch { /* ignore */ } }, { once: true, signal: life.signal });
    slide.classList.add('playing');
    video.play().catch((e) => { if (e.name === 'NotAllowedError') showGate(); });
    if (i >= items.length - 3) more();
  }

  video.addEventListener('timeupdate', () => {
    const s = slides[active];
    if (!s) return;
    const d = video.duration;
    let f = 0;
    if (win) {
      const pos = video.currentTime - win.start;
      if (pos > win.len) { video.currentTime = win.start; return; }
      f = Math.max(0, pos / win.len);
    } else if (isFinite(d) && d > 0) f = video.currentTime / d;
    s._prog.style.width = (f * 100).toFixed(1) + '%';
  }, sig);
  video.addEventListener('ended', () => {
    // loop the clip once; if it's a short, move on after two plays
    const s = slides[active];
    if (!s) return;
    s._plays = (s._plays || 0) + 1;
    if (s._plays >= 2 && slides[active + 1]) slides[active + 1].scrollIntoView({ behavior: 'smooth' });
    else { video.currentTime = win ? win.start : 0; video.play().catch(() => {}); }
  }, sig);
  video.addEventListener('pause', () => slides[active] && slides[active].classList.add('paused'), sig);
  video.addEventListener('play', () => slides[active] && slides[active].classList.remove('paused'), sig);
  video.addEventListener('error', () => {
    if (!video.getAttribute('src')) return;
    const it = items[active];
    if (it && it.kind === 'yt') toast('تعذّر تشغيل المقطع، ننتقل للتالي', { error: true });
    if (slides[active + 1]) setTimeout(() => slides[active + 1].scrollIntoView({ behavior: 'smooth' }), 800);
  }, sig);
  const onMainPlay = () => { if (player.playing) video.pause(); };
  player.addEventListener('state', onMainPlay);

  let gate = null;
  function showGate() {
    if (gate) return;
    gate = h('div.reels-gate', h('button', {
      onclick: () => {
        unlockMedia(video);
        unlockedOnce = true;
        gate.remove(); gate = null;
        const i = active; active = -1; activate(i < 0 ? 0 : i);
      },
    }, h('span.c', ic('play')), 'اضغط للتشغيل'));
    root.append(gate);
  }

  function showEmpty() {
    feed.innerHTML = '';
    feed.append(h('div.reel.msg', h('div',
      h('h3', 'ما في مقاطع للعرض'),
      h('p', ytOn ? 'أضف أغاني لمكتبتك أو جرّب تبويب «يوتيوب».' : 'أضف أغاني أو فيديوهات لمكتبتك. ولمقاطع يوتيوب القصيرة أضف مفتاح يوتيوب المجاني من الإعدادات.'),
      h('div.row.gap', { style: { justifyContent: 'center' } }, btn('upload', 'أضف أغاني', openImport, 'primary'), !ytOn ? btn('sliders', 'الإعدادات', () => go('#/settings'), 'ghost') : null))));
  }

  function reset() {
    token++;
    feedGen++;
    loading = false;
    dropFrame();
    video.pause();
    video.removeAttribute('src');
    for (const s of slides) io.unobserve(s);
    feed.innerHTML = '';
    items = []; slides = []; active = -1;
    ytQ = []; exhaustedYT = false;
    feed.scrollTop = 0;
    more().then(() => { if (!unlockedOnce) showGate(); });
  }

  reset();

  return () => {
    token++;
    dropFrame();
    life.abort();
    io.disconnect();
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (objURL) URL.revokeObjectURL(objURL);
    player.removeEventListener('state', onMainPlay);
    topBar.remove();
    if (gate) gate.remove();
    spinner.remove();
    document.body.classList.remove('reels-mode');
  };
}
