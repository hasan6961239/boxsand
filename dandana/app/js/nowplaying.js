// Mini player + full-screen Now Playing (artwork/video, lyrics, queue, timer).
import * as lib from './library.js';
import { player } from './player.js';
import { coverEl, dominantColor } from './art.js';
import { getLyrics } from './lyrics.js';
import * as ai from './ailyrics.js';
import * as api from './api.js';
import { importOne } from './importer.js';
import { cleanYouTubeTitle } from './tags.js';
import { addToPlaylistSheet, trackMenu, go, stationInfoSheet } from './ui.js';
import { h, ic, iconBtn, fmtTime, actionSheet, toast, $ } from './util.js';

let np, mini, panel = null; // panel: 'lyrics' | 'queue' | null

export function initPlayerUI() {
  mini = $('#mini');
  np = $('#np');
  buildMini();
  buildNP();
  player.addEventListener('track', () => { refreshTrack(); });
  player.addEventListener('state', refreshState);
  player.addEventListener('time', refreshTime);
  player.addEventListener('mode', refreshModes);
  player.addEventListener('sleep', refreshModes);
  player.addEventListener('queue', () => { if (panel === 'queue') renderQueue(); });
  player.addEventListener('element', placeMedia);
  player.addEventListener('buffering', (e) => mini.classList.toggle('buffering', e.detail));
  player.addEventListener('meta', () => showNow());
  lib.on('tracks', () => refreshLike());
  window.addEventListener('popstate', () => { if (np.classList.contains('open') && !history.state?.np) closeNP(true); });
}

// ---------------------------------------------------------------- mini

let mCover, mT, mA, mPlay, mProg;
function buildMini() {
  mCover = h('div');
  mT = h('div.t.ellipsis');
  mA = h('div.a.ellipsis');
  mPlay = iconBtn('play', (e) => { e.stopPropagation(); player.toggle(); }, 'تشغيل');
  mProg = h('div.prog');
  mini.append(mCover, h('div.grow', mT, mA), mPlay,
    iconBtn('next', (e) => { e.stopPropagation(); player.next(); }, 'التالي'), mProg);
  mini.addEventListener('click', openNP);
  // swipe up on the mini player opens the full player
  let y0 = null;
  mini.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  mini.addEventListener('touchend', (e) => { if (y0 != null && y0 - e.changedTouches[0].clientY > 30) openNP(); y0 = null; });
}

// ---------------------------------------------------------------- full

let nArtWrap, nT, nA, nLike, nSeek, nCur, nDur, nPlay, nShuf, nRep, nCtx, nTools, nVideoBtn, nSleepBtn, nSpeedBtn, nLyrBtn, nQBtn, nStage, nPanel, nSeekWrap, nLive;
function buildNP() {
  nCtx = h('div.ctx');
  const top = h('div.np-top',
    iconBtn('chevD', () => closeNP(), 'إغلاق'),
    nCtx,
    iconBtn('more', () => npMenu(), 'خيارات'));
  nArtWrap = h('div.np-artwrap', { style: { display: 'contents' } });
  nPanel = h('div.np-panel.hidden');
  nStage = h('div.np-stage', nArtWrap, nPanel);
  nT = h('div.t');
  nA = h('div.a');
  nA.addEventListener('click', () => {
    const c = player.current;
    if (c && c.trackId && c.artist) go('#/artist/' + encodeURIComponent(lib.artistKey(c.artist)));
  });
  nLike = iconBtn('heart', async () => {
    const c = player.current;
    if (!c || !c.trackId) return;
    await lib.toggleLike(c.trackId);
    refreshLike();
  }, 'مفضلة');
  const info = h('div.np-info', h('div.grow', nT, nA), nLike);
  nSeek = h('input.range', { type: 'range', min: 0, max: 1000, value: 0, step: 1, 'aria-label': 'الموضع' });
  let seeking = false;
  nSeek.addEventListener('input', () => {
    seeking = true;
    const d = player.el.duration || 0;
    nCur.textContent = fmtTime((nSeek.value / 1000) * d);
    nSeek.style.setProperty('--p', nSeek.value / 10 + '%');
  });
  nSeek.addEventListener('change', () => {
    const d = player.el.duration || 0;
    player.seek((nSeek.value / 1000) * d);
    seeking = false;
  });
  nSeek._seeking = () => seeking;
  nCur = h('span', '0:00');
  nDur = h('span', '–:––');
  nSeekWrap = h('div.np-seek', nSeek, h('div.np-times', nCur, nDur));
  nLive = h('div.np-live.hidden', h('span.live', 'بث مباشر'));
  nShuf = iconBtn('shuffle', () => player.setShuffle(!player.shuffle), 'عشوائي', 'side');
  nRep = iconBtn('repeat', () => {
    const r = player.cycleRepeat();
    toast({ off: 'التكرار متوقف', all: 'تكرار القائمة', one: 'تكرار الأغنية' }[r]);
  }, 'تكرار', 'side');
  nPlay = iconBtn('play', () => player.toggle(), 'تشغيل', 'big');
  const ctrl = h('div.np-ctrl', nShuf, iconBtn('prev', () => player.prev(), 'السابق'), nPlay, iconBtn('next', () => player.next(), 'التالي'), nRep);
  nLyrBtn = iconBtn('mic', () => togglePanel('lyrics'), 'الكلمات', 'tl');
  nQBtn = iconBtn('queue', () => togglePanel('queue'), 'قائمة الانتظار', 'tl');
  nSleepBtn = iconBtn('moon', sleepMenu, 'مؤقت النوم', 'tl');
  nSpeedBtn = iconBtn('speed', speedMenu, 'السرعة', 'tl');
  nVideoBtn = iconBtn('video', () => {
    player.setVideoMode(!lib.settings.videoMode);
    toast(lib.settings.videoMode ? 'وضع الفيديو' : 'صوت فقط — يستمر بعد قفل الشاشة');
  }, 'فيديو/صوت', 'tl');
  nTools = h('div.np-tools', nLyrBtn, nQBtn, nVideoBtn, nSleepBtn, nSpeedBtn,
    iconBtn('listplus', () => { const c = player.current; if (c && c.trackId) addToPlaylistSheet([c.trackId]); else toast('متاح لأغاني مكتبتك'); }, 'أضف لقائمة', 'tl'));
  np.append(top, h('div.np-body', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } },
    nStage, info, nSeekWrap, nLive, ctrl, nTools));

  // drag down to close (from the top bar / artwork)
  let y0 = null, dy = 0;
  np.addEventListener('touchstart', (e) => {
    if (e.target.closest('.np-panel,.range,.np-ctrl,.np-tools,video')) return;
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  np.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) { np.classList.add('dragging'); np.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  np.addEventListener('touchend', () => {
    if (y0 == null) return;
    np.classList.remove('dragging'); np.style.transform = '';
    if (dy > 120) closeNP();
    y0 = null;
  });
}

export function openNP() {
  if (!player.current) return;
  np.classList.add('open');
  np.setAttribute('aria-hidden', 'false');
  player.npOpen = true;
  history.pushState({ np: true }, '');
  placeMedia();
  if (panel === 'lyrics') renderLyrics();
}
/** Called by the router: navigating anywhere hides the full player. */
export function dismissNP() {
  if (!np || !np.classList.contains('open')) return;
  np.classList.remove('open');
  np.setAttribute('aria-hidden', 'true');
  player.npOpen = false;
}

export function closeNP(fromPop) {
  np.classList.remove('open');
  np.setAttribute('aria-hidden', 'true');
  player.npOpen = false;
  if (!fromPop && history.state && history.state.np) history.back();
}

function placeMedia() {
  const c = player.current;
  nArtWrap.innerHTML = '';
  if (!c) return;
  if (player.el === player.video) {
    const w = h('div.np-video-wrap');
    const t = c.trackId && lib.tracks.get(c.trackId);
    if (t && t.height > t.width) w.classList.add('portrait');
    w.append(player.video);
    player.video.controls = false;
    nArtWrap.append(w);
  } else {
    const el = coverEl({ title: c.title, art: c.trackId ? lib.tracks.get(c.trackId)?.art : null, artUrl: c.trackId ? null : ((c.now && c.now.cover) || c.art) }, { size: 'full', cls: 'np-art', eager: true });
    nArtWrap.append(el);
  }
}

async function refreshTrack() {
  const c = player.current;
  document.body.classList.toggle('no-mini', !c);
  mini.classList.toggle('hidden', !c);
  if (!c) return;
  mCover.replaceWith(mCover = coverEl({ title: c.title, art: c.trackId ? lib.tracks.get(c.trackId)?.art : null, artUrl: c.trackId ? null : c.art }, { eager: true }));
  mT.textContent = c.title || '';
  mA.textContent = c.artist || (c.live ? 'بث مباشر' : '');
  nT.textContent = c.title || '';
  nA.textContent = c.artist || '';
  if (c.live) showNow();
  nCtx.innerHTML = '';
  if (c.live) nCtx.append('بث مباشر', h('b', [c.station && c.station.country, c.station && c.station.state].filter(Boolean).join(' · ') || 'راديو'));
  else nCtx.append(c.preview ? 'مقطع تجريبي 30 ثانية' : c.stream ? 'من يوتيوب' : 'يتم التشغيل من', h('b', player.context || c.album || 'مكتبتك'));
  nSeekWrap.classList.toggle('hidden', !!c.live);
  nLive.classList.toggle('hidden', !c.live);
  nLike.classList.toggle('hidden', !c.trackId);
  nVideoBtn.classList.toggle('hidden', !c.isVideo);
  refreshLike();
  refreshModes();
  refreshState();
  placeMedia();
  if (panel === 'lyrics') renderLyrics();
  if (panel === 'queue') renderQueue();
  // tint the player with the cover colour
  if (c.art) {
    const rgb = await dominantColor(c.art);
    if (rgb && player.current === c) {
      const [r, g, b] = rgb.map((v) => Math.round(v * 0.75));
      np.style.setProperty('--np-tint', `${r} ${g} ${b}`);
    }
  } else {
    np.style.setProperty('--np-tint', '60 40 80');
  }
}

function refreshState() {
  const playing = player.playing || (player.wantPlaying && player.el.readyState < 3 && !player.el.paused);
  const name = playing ? 'pause' : 'play';
  mPlay.innerHTML = ''; mPlay.append(ic(name));
  nPlay.innerHTML = ''; nPlay.append(ic(name));
  np.classList.toggle('paused', !playing);
  document.querySelectorAll('.eq').forEach((e) => e.classList.toggle('paused', !playing));
}

function refreshTime() {
  const el = player.el;
  const d = el.duration;
  const t = el.currentTime;
  const f = isFinite(d) && d > 0 ? t / d : 0;
  mProg.style.width = (f * 100).toFixed(2) + '%';
  if (!np.classList.contains('open')) return;
  if (!nSeek._seeking()) {
    nSeek.value = String(Math.round(f * 1000));
    nSeek.style.setProperty('--p', (f * 100).toFixed(2) + '%');
    nCur.textContent = fmtTime(t);
  }
  nDur.textContent = isFinite(d) ? '-' + fmtTime(Math.max(0, d - t)) : '–:––';
  if (panel === 'lyrics') syncLyrics(t);
}

function refreshModes() {
  nShuf.classList.toggle('on', !!player.shuffle);
  nRep.classList.toggle('on', player.repeat !== 'off');
  nRep.classList.toggle('rep1', player.repeat === 'one');
  nVideoBtn.classList.toggle('on', !!lib.settings.videoMode);
  const sp = lib.settings.speed || 1;
  nSpeedBtn.classList.toggle('on', sp !== 1);
  setBadge(nSpeedBtn, sp !== 1 ? sp + '×' : '');
  const on = !!(player.sleepAt || player.sleepEnd);
  nSleepBtn.classList.toggle('on', on);
  setBadge(nSleepBtn, player.sleepAt ? Math.max(1, Math.round((player.sleepAt - Date.now()) / 60000)) + 'د' : player.sleepEnd ? 'نهاية' : '');
}
setInterval(() => { if (player.sleepAt) refreshModes(); }, 30000);

function setBadge(b, text) {
  let s = b.querySelector('small');
  if (!text) { s && s.remove(); return; }
  if (!s) { s = h('small'); b.append(s); }
  s.textContent = text;
}

function refreshLike() {
  const c = player.current;
  const t = c && c.trackId && lib.tracks.get(c.trackId);
  const on = !!(t && t.liked);
  nLike.innerHTML = ''; nLike.append(ic(on ? 'heartf' : 'heart'));
  nLike.classList.toggle('on', on);
}

// ---------------------------------------------------------------- panels

function togglePanel(name) {
  panel = panel === name ? null : name;
  nPanel.classList.toggle('hidden', !panel);
  nLyrBtn.classList.toggle('on', panel === 'lyrics');
  nQBtn.classList.toggle('on', panel === 'queue');
  if (panel === 'lyrics') renderLyrics();
  if (panel === 'queue') renderQueue();
}

let lyr = null, lyrFor = null;
async function renderLyrics(force) {
  const c = player.current;
  if (!c) return;
  if (!force && lyrFor === c && nPanel.firstChild) return;
  lyrFor = c;
  nPanel.innerHTML = '';
  nPanel.append(h('div.spinner'));
  const data = c.live ? null : await getLyrics({ trackId: c.trackId, title: c.title, artist: c.artist, duration: c.duration || player.el.duration });
  if (player.current !== c || panel !== 'lyrics') return;
  lyr = null;
  if (!data) {
    const t = c.trackId && lib.tracks.get(c.trackId);
    if (t && ai.hasAI() && lib.settings.aiAuto && !t.aiNoLyrics) return writeWithAI(c);
    nPanel.innerHTML = '';
    nPanel.append(h('div.empty', ic('mic'), h('h3', 'لا توجد كلمات'),
      h('p', c.live ? 'الراديو بث مباشر بدون كلمات.' : !c.trackId ? 'الكلمات بالذكاء الاصطناعي متاحة لأغاني مكتبتك.' : 'ما لقيت كلمات لهذه الأغنية.'),
      c.trackId ? aiButton(c) : null));
    return;
  }
  nPanel.innerHTML = '';
  const foot = h('div.src', 'الكلمات: ' + data.source,
    c.trackId && ai.hasAI() ? h('button.ai-again', { onclick: () => writeWithAI(c) }, '✨ اكتبها بالذكاء الاصطناعي') : null);
  if (data.synced && data.synced.length) {
    const box = h('div.lyrics');
    lyr = data.synced.map((l) => {
      const p = h('p', l.text || '♪');
      p.addEventListener('click', () => player.seek(l.t));
      box.append(p);
      return { ...l, el: p };
    });
    box.append(foot);
    nPanel.append(box);
    syncLyrics(player.el.currentTime, true);
  } else {
    const box = h('div.lyrics.plain');
    for (const line of (data.plain || '').split('\n')) box.append(h('p', line || '\u00a0'));
    box.append(foot);
    nPanel.append(box);
  }
}

function aiButton(c) {
  if (!ai.hasAI()) {
    return h('div', h('p', { style: { marginTop: '6px' } }, 'تقدر الذكاء الاصطناعي يسمع الأغنية ويكتب كلماتها — يحتاج مفتاح مجاني (Gemini أو Groq).'),
      h('button.btn.primary', { onclick: () => { closeNP(); go('#/settings'); } }, 'أضف مفتاح الذكاء الاصطناعي'));
  }
  return h('button.btn.primary', { onclick: () => writeWithAI(c) }, '✨ اكتب الكلمات بالذكاء الاصطناعي');
}

async function writeWithAI(c) {
  const status = h('p', 'يجهّز…');
  nPanel.innerHTML = '';
  nPanel.append(h('div.empty', h('div.spinner'), h('h3', 'الذكاء الاصطناعي يسمع الأغنية'), status));
  try {
    await ai.transcribe(c.trackId, (s) => { status.textContent = s; });
    if (player.current === c && panel === 'lyrics') renderLyrics(true);
  } catch (e) {
    if (player.current !== c || panel !== 'lyrics') return;
    nPanel.innerHTML = '';
    nPanel.append(h('div.empty', ic('mic'), h('h3', 'ما قدرت نكتب الكلمات'), h('p', e.message),
      h('button.btn', { onclick: () => writeWithAI(c) }, 'جرّب مرة ثانية')));
  }
}

let lastLine = -1;
function syncLyrics(t, force) {
  if (!lyr) return;
  let i = -1;
  for (let k = 0; k < lyr.length; k++) { if (lyr[k].t <= t + 0.3) i = k; else break; }
  if (i === lastLine && !force) return;
  if (lastLine >= 0 && lyr[lastLine]) lyr[lastLine].el.classList.remove('on');
  lastLine = i;
  if (i >= 0) {
    const el = lyr[i].el;
    el.classList.add('on');
    nPanel.scrollTo({ top: el.offsetTop - nPanel.clientHeight * 0.35, behavior: force ? 'auto' : 'smooth' });
  }
}

function itemInfo(it) {
  if (it.type === 'track') {
    const t = lib.tracks.get(it.id) || {};
    return { title: t.title || '—', artist: t.artist || '', art: t.art };
  }
  if (it.type === 'radio') return { title: it.station.name, artist: 'راديو', artUrl: it.station.favicon };
  return { title: it.title, artist: it.artist, artUrl: it.cover || it.thumbnail, isNew: it.isNew };
}

function renderQueue() {
  nPanel.innerHTML = '';
  const box = h('div.qlist');
  const q = player.queue;
  const make = (it, i) => {
    const inf = itemInfo(it);
    const row = h('div.trow' + (i === player.index ? '.playing' : ''),
      coverEl({ title: inf.title, art: inf.art, artUrl: inf.artUrl }),
      h('div.meta', h('div.t', inf.title), h('div.s', inf.isNew ? h('span.badge-new', 'جديد') : null, h('span.ellipsis', inf.artist || ''))));
    if (i > player.index) {
      row.append(
        iconBtn('arrowUp', (e) => { e.stopPropagation(); player.move(i, i - 1); }, 'لأعلى', 'sm'),
        iconBtn('close', (e) => { e.stopPropagation(); player.removeAt(i); }, 'إزالة', 'sm'));
    }
    row.addEventListener('click', () => player.load(i, true));
    return row;
  };
  if (player.index >= 0 && q[player.index]) {
    box.append(h('h4', 'يتم التشغيل الآن'), make(q[player.index], player.index));
  }
  const upcoming = q.slice(player.index + 1, player.index + 101);
  if (upcoming.length) {
    box.append(h('h4', `التالي (${q.length - player.index - 1})`));
    upcoming.forEach((it, k) => box.append(make(it, player.index + 1 + k)));
  } else {
    box.append(h('p', { style: { opacity: '.6', fontSize: '14px', marginTop: '10px' } }, 'لا شيء بعد هذه الأغنية.'));
  }
  nPanel.append(box);
}

// ---------------------------------------------------------------- menus

function sleepMenu() {
  const set = (v, msg) => () => { player.setSleep(v); refreshModes(); toast(msg); };
  actionSheet([
    { icon: 'moon', label: '15 دقيقة', fn: set(15, 'سيتوقف بعد 15 دقيقة') },
    { icon: 'moon', label: '30 دقيقة', fn: set(30, 'سيتوقف بعد 30 دقيقة') },
    { icon: 'moon', label: '45 دقيقة', fn: set(45, 'سيتوقف بعد 45 دقيقة') },
    { icon: 'moon', label: 'ساعة', fn: set(60, 'سيتوقف بعد ساعة') },
    { icon: 'moon', label: 'نهاية الأغنية الحالية', fn: set('end', 'سيتوقف بنهاية الأغنية') },
    (player.sleepAt || player.sleepEnd) ? { icon: 'close', label: 'إلغاء المؤقت', danger: true, fn: set(null, 'أُلغي المؤقت') } : null,
  ], { title: 'مؤقت النوم' });
}

function speedMenu() {
  const cur = lib.settings.speed || 1;
  actionSheet([0.75, 0.9, 1, 1.1, 1.25, 1.5].map((r) => ({
    icon: r === cur ? 'check' : 'speed', label: r === 1 ? 'عادي (1×)' : r + '×', fn: () => player.setSpeed(r),
  })), { title: 'سرعة التشغيل' });
}

function npMenu() {
  const c = player.current;
  if (!c) return;
  if (c.trackId) {
    const t = lib.tracks.get(c.trackId);
    if (t) return trackMenu(t);
  }
  actionSheet([
    c.live && c.station ? { icon: 'info', label: 'معلومات المحطة', fn: () => stationInfoSheet(c.station, c.now) } : null,
    c.ytId ? { icon: 'download', label: 'احفظها في مكتبتي', fn: () => saveStream(c) } : null,
    c.ytId ? { icon: 'link', label: 'افتح في يوتيوب', fn: () => window.open(`https://www.youtube.com/watch?v=${c.ytId}`, '_blank') } : null,
    { icon: 'close', label: 'أوقف التشغيل', fn: () => player.pause() },
  ]);
}

async function saveStream(c) {
  if (lib.findByYt(c.ytId)) return toast('موجودة في مكتبتك');
  if (!c.streamBlob) {
    api.startDownload({ id: c.ytId, title: c.title, channel: c.artist, kind: 'audio' });
    return toast('بدأ التحميل — تابعه من «التحميلات»');
  }
  const names = c.album === 'اكتشاف على ذوقك' ? { title: c.title, artist: c.artist } : cleanYouTubeTitle(c.title, c.artist);
  let artBlob = null;
  try { const r = await fetch(`https://i.ytimg.com/vi/${c.ytId}/hqdefault.jpg`); if (r.ok) artBlob = await r.blob(); } catch { /* optional */ }
  const blob = c.streamBlob;
  await importOne({ name: `${names.title}.mp3`, size: blob.size, type: blob.type || 'audio/mpeg', get: async () => blob },
    { title: names.title, artist: names.artist, source: 'youtube', ytId: c.ytId, artBlob, force: true });
  lib.emit('tracks');
  toast('انحفظت في مكتبتك ✓');
}

/** Radio: put the song the station is playing under its name. */
function showNow() {
  const c = player.current;
  if (!c || !c.live) return;
  const song = c.now && c.now.song;
  mA.textContent = song ? '♪ ' + song : (c.artist || 'بث مباشر');
  nA.textContent = song ? '♪ ' + song : (c.artist || '');
  nLive.innerHTML = '';
  nLive.append(h('span.live', 'بث مباشر'));
  if (c.now && c.now.listeners) nLive.append(h('span', { style: { marginInlineStart: '10px', opacity: '.7', fontSize: '12px' } }, `${c.now.listeners} يستمعون`));
  if (c.now && c.now.cover) placeMedia();
}
