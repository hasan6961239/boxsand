// Screens. Each view renders into the scroll container and returns a cleanup.
import * as lib from './library.js';
import * as db from './db.js';
import * as api from './api.js';
import * as taste from './taste.js';
import * as radioApi from './radio.js';
import * as cobalt from './cobalt.js';
import * as ytapi from './ytapi.js';
import * as themes from './themes.js';
import { player } from './player.js';
import { coverEl } from './art.js';
import {
  trackRow, markPlaying, tile, openImport, playAllButtons, addToPlaylistSheet, deleteTracksFlow,
  ytRow, ytSheet, ytToItem, recRow, go,
} from './ui.js';
import {
  h, ic, btn, iconBtn, toast, sheet, actionSheet, confirmDialog, promptDialog, emptyState, debounce,
  fmtTime, fmtBytes, fmtDuration, songsCount, isStandalone, isIOS, norm, $,
} from './util.js';

const VERSION = '1.1.1';

function page(root, ...kids) {
  const p = h('div.page', ...kids);
  root.append(p);
  return p;
}
function head(title, { back, sub, actions = [] } = {}) {
  return h('div.page-head',
    back ? h('button.back', { onclick: () => (history.length > 1 ? history.back() : go(back)) }, ic('chevR'), 'رجوع') : null,
    h('div.grow', back ? h('h1', { style: { fontSize: '22px' } }, title) : h('h1', title), sub ? h('div.sub', sub) : null),
    ...actions);
}
function section(title, more, ...kids) {
  return h('section.section', h('div.section-head', h('h2', title), more || null), ...kids);
}
const subs = (...offs) => () => offs.forEach((f) => f && f());
const onPlayer = (type, fn) => { player.addEventListener(type, fn); return () => player.removeEventListener(type, fn); };

/** Render many rows without blocking: first chunk now, the rest per frame. */
function renderRows(container, items, make, first = 60, chunk = 120) {
  container.innerHTML = '';
  let i = 0;
  const step = (n) => {
    const frag = document.createDocumentFragment();
    for (const end = Math.min(items.length, i + n); i < end; i++) frag.append(make(items[i], i));
    container.append(frag);
    if (i < items.length) container._raf = requestAnimationFrame(() => step(chunk));
  };
  cancelAnimationFrame(container._raf);
  step(first);
}

function trackList(ids, context) {
  const box = h('div.list');
  const arr = ids.map((id) => lib.tracks.get(id)).filter(Boolean);
  renderRows(box, arr, (t, i) => trackRow(t, { onPlay: () => player.playTracks(arr.map((x) => x.id), i, { context, shuffle: false }) }));
  return box;
}

// ================================================================ HOME

export function home(root) {
  const p = page(root);
  const render = () => {
    p.innerHTML = '';
    const hr = new Date().getHours();
    const hello = hr < 5 ? 'سهرة طرب 🌙' : hr < 12 ? 'صباح الخير ☀️' : hr < 18 ? 'مساء الخير' : 'مساء الطرب 🌙';
    const st = lib.stats();
    p.append(h('div.page-head',
      h('div.grow', h('div.hello', hello), h('div.hello-sub', st.count ? `${songsCount(st.count)} في مكتبتك` : 'مكتبتك جاهزة لأغانيك')),
      iconBtn('palette', themes.themeSheet, 'الثيمات'),
      iconBtn('stats', () => go('#/stats'), 'إحصائيات'),
      iconBtn('sliders', () => go('#/settings'), 'الإعدادات')));

    if (isIOS() && !isStandalone()) {
      p.append(h('div.banner.warn', ic('share'), h('div',
        h('b', 'ثبّت دندنة على الشاشة الرئيسية'),
        'اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية». أضف أغانيك من داخل التطبيق بعد تثبيته — مكتبة سفاري منفصلة عنه.')));
    }

    p.append(h('div.quick',
      h('button.qa.q1', { onclick: shuffleAll }, ic('dice'), h('div', h('b', 'عشوائي'), h('small', 'كل الأغاني'))),
      h('button.qa.q2', { onclick: playTaste }, ic('sparkle'), h('div', h('b', 'على ذوقي'), h('small', 'ميكس ذكي'))),
      h('button.qa.q3', { onclick: () => go('#/reels') }, ic('reels'), h('div', h('b', 'ريلز'), h('small', 'مقاطع قصيرة')))));

    if (!st.count) {
      p.append(h('div.onboard',
        h('h2', 'ابدأ بإضافة أغانيك 🎶'),
        h('p', 'أغانيك تتخزن داخل التطبيق وتشتغل بدون إنترنت.'),
        h('ul',
          h('li', 'اختر ملفات صوت أو فيديو من تطبيق «الملفات» أو ألبوم الصور.'),
          h('li', 'عندك مئات الأغاني؟ اضغط مطولاً على المجلد في «الملفات» ← «ضغط»، ثم اختر ملف ZIP هنا مرة وحدة.'),
          h('li', 'أو حمّل مباشرة من يوتيوب من تبويب «اكتشف».')),
        h('div.row.gap', btn('upload', 'أضف أغاني', openImport, 'primary'), btn('compass', 'من يوتيوب', () => go('#/discover'), 'ghost'))));
      return;
    }

    const recent = lib.SMART.recent.get().slice(0, 15);
    if (recent.length) p.append(section('استمعت مؤخراً', h('a', { href: '#/smart/recent' }, 'الكل'), rail(recent, 'استمعت مؤخراً')));

    p.append(h('div.card', { style: { marginTop: '18px', display: 'flex', gap: '12px', alignItems: 'center' }, onclick: () => go('#/foryou') },
      h('div', { style: { width: '46px', height: '46px', borderRadius: '14px', display: 'grid', placeItems: 'center', background: 'linear-gradient(140deg,#f2b84b,#ef5d7e)', color: '#fff', flex: 'none' } }, ic('sparkle')),
      h('div.grow', h('h3', { style: { margin: 0 } }, 'اكتشف على ذوقك'), h('p', 'أغانٍ جديدة قريبة من اللي تسمعه، مش موجودة عندك')),
      ic('chevL')));

    const top = lib.SMART.top.get().slice(0, 15);
    if (top.length >= 3) p.append(section('الأكثر استماعاً', h('a', { href: '#/smart/top' }, 'الكل'), rail(top, 'الأكثر استماعاً')));

    const arts = taste.profile().slice(0, 14);
    if (arts.length) {
      p.append(section('فنانينك', h('a', { href: '#/library/artists' }, 'الكل'),
        h('div.hscroll', arts.map((a) => tile({ name: a.name, art: a.art }, {
          round: true, sub: songsCount(a.tracks.length), onClick: () => go('#/artist/' + encodeURIComponent(a.key)),
        })))));
    }

    p.append(section('أُضيفت حديثاً', h('a', { href: '#/smart/added' }, 'الكل'), rail(lib.SMART.added.get().slice(0, 15), 'أُضيفت حديثاً')));

    const pls = [...lib.playlists.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
    if (pls.length) {
      p.append(section('قوائمك', h('a', { href: '#/library/playlists' }, 'الكل'),
        h('div.hscroll', pls.map((pl) => {
          const first = lib.tracks.get(pl.trackIds.find((id) => lib.tracks.get(id)?.art) || pl.trackIds[0]);
          return tile({ name: pl.name, art: first && first.art }, { sub: songsCount(pl.trackIds.length), onClick: () => go('#/playlist/' + pl.id) });
        }))));
    }

    const favs = lib.settings.radioFavs || [];
    if (favs.length) {
      p.append(section('محطاتك', h('a', { href: '#/radio' }, 'الكل'),
        h('div.hscroll', favs.slice(0, 12).map((s) => tile({ name: s.name, artUrl: s.favicon }, {
          sub: s.country || 'راديو', onClick: () => player.playItems([{ type: 'radio', station: s }], 0, { context: 'راديو' }),
        })))));
    }
  };
  render();
  return subs(lib.on('tracks', debounce(render, 400)), lib.on('playlists', debounce(render, 400)));
}

function rail(tracks, context) {
  const ids = tracks.map((t) => t.id);
  return h('div.hscroll', tracks.map((t, i) => tile(t, { sub: t.artist || '', onClick: () => player.playTracks(ids, i, { context, shuffle: false }) })));
}

export function shuffleAll() {
  const ids = lib.list().map((t) => t.id);
  if (!ids.length) return toast('أضف أغاني أولاً');
  player.playTracks(ids, -1, { context: 'كل الأغاني', shuffle: true });
}

export function playTaste() {
  if (!lib.tracks.size) return toast('أضف أغاني أولاً حتى أتعرف على ذوقك');
  const { items, feeder } = taste.tasteRadio();
  if (!items.length) return toast('ما قدرت أجهز الميكس');
  player.playItems(items, 0, { context: 'على ذوقي ✨', feeder, shuffle: false });
  if (lib.settings.mixNew && !api.canSearch()) toast('للحصول على أغاني جديدة داخل الميكس أضف مفتاح يوتيوب من الإعدادات');
}

// ================================================================ LIBRARY

let libQuery = '';
const selection = new Set();

export function library(root, tab = 'songs') {
  const p = page(root);
  let selecting = false;
  const tabs = [['songs', 'الأغاني'], ['videos', 'الفيديو'], ['artists', 'الفنانون'], ['albums', 'الألبومات'], ['playlists', 'القوائم']];
  const selBtn = btn(null, 'تحديد', () => toggleSelect(), 'sm ghost');
  p.append(head('مكتبتي', { actions: [selBtn, iconBtn('plus', openImport, 'إضافة أغاني', 'filled')] }));
  const search = h('input', { type: 'search', placeholder: 'ابحث في أغانيك', value: libQuery, enterkeyhint: 'search' });
  const clear = iconBtn('close', () => { search.value = ''; libQuery = ''; renderBody(); }, 'مسح', 'sm clear');
  p.append(h('div.search', ic('search'), search, clear));
  const seg = h('div.seg', tabs.map(([k, label]) => h('button' + (k === tab ? '.on' : ''), { onclick: () => location.replace('#/library/' + k) }, label)));
  p.append(seg);
  const body = h('div', { style: { marginTop: '12px' } });
  p.append(body);
  search.addEventListener('input', debounce(() => { libQuery = search.value; renderBody(); }, 200));

  function toggleSelect(force) {
    selecting = force ?? !selecting;
    selection.clear();
    selBtn.querySelector('span').textContent = selecting ? 'إلغاء' : 'تحديد';
    document.body.classList.toggle('selecting', selecting);
    document.querySelectorAll('.selbar').forEach((e) => e.remove());
    if (selecting) document.body.append(selbar());
    renderBody();
  }
  function selbar() {
    const act = (iconName, label, fn, cls = '') => h('button' + (cls ? '.' + cls : ''), { onclick: fn }, ic(iconName), label);
    return h('div.selbar',
      act('check', 'الكل', () => { currentIds().forEach((id) => selection.add(id)); renderBody(); }),
      act('listplus', 'لقائمة', () => selection.size ? addToPlaylistSheet([...selection]) : toast('حدد أغاني أولاً')),
      act('playnext', 'شغّل', () => { if (selection.size) { player.playTracks([...selection], 0, { context: 'مختارات', shuffle: false }); toggleSelect(false); } }),
      act('heart', 'مفضلة', async () => {
        for (const id of selection) { const t = lib.tracks.get(id); if (t && !t.liked) await lib.toggleLike(id); }
        toast('أُضيفت للمفضلة'); toggleSelect(false);
      }),
      act('trash', 'حذف', async () => { if (selection.size && await deleteTracksFlow([...selection])) toggleSelect(false); }, 'danger'));
  }

  let shown = [];
  const currentIds = () => shown.map((t) => t.id);

  function renderBody() {
    body.innerHTML = '';
    selBtn.classList.toggle('hidden', !(tab === 'songs' || tab === 'videos'));
    if (!lib.tracks.size && tab !== 'playlists') {
      body.append(emptyState('note', 'مكتبتك فاضية', 'أضف أغانيك من الملفات أو حمّلها من يوتيوب.',
        h('div.row.gap', { style: { justifyContent: 'center' } }, btn('upload', 'أضف أغاني', openImport, 'primary'), btn('compass', 'يوتيوب', () => go('#/discover'), 'ghost'))));
      return;
    }
    if (tab === 'songs' || tab === 'videos') {
      let pool = lib.list();
      if (tab === 'videos') pool = pool.filter((t) => t.kind === 'video');
      pool = lib.sorted(lib.search(libQuery, pool), lib.settings.librarySort);
      shown = pool;
      const sortChip = h('button.chip', { onclick: sortMenu }, ic('sliders'), lib.SORTS[lib.settings.librarySort]?.label || 'ترتيب');
      body.append(h('div.row', { style: { justifyContent: 'space-between', marginBottom: '8px' } },
        h('span.muted', { style: { fontSize: '13px' } }, songsCount(pool.length)), sortChip));
      if (!selecting && pool.length) body.append(playAllButtons(() => pool.map((t) => t.id), tab === 'videos' ? 'الفيديوهات' : 'مكتبتي'));
      if (!pool.length) { body.append(emptyState('search', 'لا نتائج', libQuery ? `لا شيء يطابق «${libQuery}»` : 'لا توجد فيديوهات بعد')); return; }
      const list = h('div.list');
      body.append(list);
      const ids = pool.map((t) => t.id);
      renderRows(list, pool, (t, i) => trackRow(t, {
        selectable: selecting, selected: selection.has(t.id),
        onSelect: (id, on) => (on ? selection.add(id) : selection.delete(id)),
        onPlay: () => player.playTracks(ids, i, { context: tab === 'videos' ? 'الفيديوهات' : 'مكتبتي' }),
      }));
    } else if (tab === 'artists') {
      let arts = taste.profile();
      const unknown = lib.artists().find((a) => a.key === 'unknown');
      if (unknown) arts.push(unknown);
      if (libQuery) { const q = norm(libQuery); arts = arts.filter((a) => a.key.includes(q)); }
      arts.sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name, 'ar'));
      body.append(h('div.grid.artists', arts.map((a) => tile({ name: a.name, art: a.art }, {
        round: true, sub: songsCount(a.tracks.length), onClick: () => go('#/artist/' + encodeURIComponent(a.key)),
      }))));
    } else if (tab === 'albums') {
      let al = lib.albums();
      if (libQuery) { const q = norm(libQuery); al = al.filter((a) => norm(a.name + ' ' + a.artist).includes(q)); }
      al.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
      if (!al.length) { body.append(emptyState('disc', 'لا توجد ألبومات', 'تظهر الألبومات عندما تحتوي الأغاني على اسم ألبوم.')); return; }
      body.append(h('div.grid', al.map((a) => tile({ name: a.name, art: a.art }, { sub: a.artist, onClick: () => go('#/album/' + encodeURIComponent(a.key)) }))));
    } else if (tab === 'playlists') {
      const list = h('div.list');
      list.append(h('div.trow', { onclick: newPlaylist }, h('div.cover', { style: { width: '48px', height: '48px', background: 'var(--card-2)', color: 'var(--accent)' } }, ic('plus')), h('div.meta', h('div.t', 'قائمة جديدة'))));
      for (const [k, s] of Object.entries(lib.SMART)) {
        const n = s.get().length;
        list.append(h('div.trow', { onclick: () => go('#/smart/' + k) },
          h('div.cover', { style: { width: '48px', height: '48px', background: 'linear-gradient(140deg,var(--accent),var(--rose))', color: '#fff' } }, ic(s.icon)),
          h('div.meta', h('div.t', s.name), h('div.s', songsCount(n)))));
      }
      const pls = [...lib.playlists.values()].sort((a, b) => b.updatedAt - a.updatedAt);
      if (pls.length) list.append(h('h4.muted', { style: { margin: '16px 0 4px', fontSize: '13px' } }, 'قوائمك'));
      for (const pl of pls) {
        const first = lib.tracks.get(pl.trackIds.find((id) => lib.tracks.get(id)?.art) || pl.trackIds[0]);
        list.append(h('div.trow', { onclick: () => go('#/playlist/' + pl.id) },
          coverEl({ name: pl.name, art: first && first.art }), h('div.meta', h('div.t', pl.name), h('div.s', songsCount(pl.trackIds.length)))));
      }
      body.append(list);
    }
  }

  function sortMenu() {
    actionSheet(Object.entries(lib.SORTS).map(([k, s]) => ({
      icon: k === lib.settings.librarySort ? 'check' : 'sliders', label: s.label,
      fn: () => { lib.setSetting('librarySort', k); renderBody(); },
    })), { title: 'ترتيب حسب' });
  }

  renderBody();
  const rerender = debounce(() => { if (!selecting) renderBody(); }, 500);
  return subs(lib.on('tracks', rerender), lib.on('playlists', rerender),
    onPlayer('track', () => markPlaying(body)), onPlayer('state', () => markPlaying(body)),
    () => { document.body.classList.remove('selecting'); });
}

export async function newPlaylist() {
  const name = await promptDialog('قائمة جديدة', { placeholder: 'مثلاً: سهرة طرب' });
  if (!name) return;
  const pl = await lib.createPlaylist(name);
  go('#/playlist/' + pl.id);
}

// ================================================================ ARTIST / ALBUM

export function artist(root, key) {
  const p = page(root);
  const render = () => {
    p.innerHTML = '';
    const a = lib.artists().find((x) => x.key === key);
    if (!a) { p.append(head('فنان', { back: '#/library/artists' }), emptyState('user', 'لا توجد أغاني لهذا الفنان')); return; }
    const tracks = a.tracks.slice().sort((x, y) => (y.plays || 0) - (x.plays || 0) || (x.title || '').localeCompare(y.title || '', 'ar'));
    p.append(head('', { back: '#/library/artists' }));
    p.append(h('div.hero', coverEl({ name: a.name, art: a.art }, { size: 'full', cls: 'round', eager: true }), h('h1', a.name),
      h('div.sub', [songsCount(tracks.length), a.plays ? `${a.plays} تشغيل` : ''].filter(Boolean).join(' · '))));
    p.append(playAllButtons(() => tracks.map((t) => t.id), a.name));
    p.append(trackList(tracks.map((t) => t.id), a.name));
    if (a.key !== 'unknown') {
      const more = h('div', h('div.spinner'));
      p.append(section(`أغانٍ أخرى لـ${a.name}`, null, more));
      taste.artistTop(a.name, 25).then((list) => {
        more.innerHTML = '';
        const missing = list.filter((r) => !r.inLibrary);
        if (!missing.length) { more.append(h('p.muted', { style: { fontSize: '13px' } }, list.length ? 'عندك كل أشهر أغانيه 👌' : 'ما لقيت معلومات عن هذا الفنان.')); return; }
        more.append(h('div.list', missing.slice(0, 15).map((r) => recItem(r))));
      }).catch(() => { more.innerHTML = ''; more.append(h('p.muted', { style: { fontSize: '13px' } }, 'تعذّر الاتصال — تحقق من الإنترنت.')); });
    }
  };
  render();
  return subs(lib.on('tracks', debounce(render, 500)), onPlayer('track', () => markPlaying(p)));
}

export function album(root, key) {
  const p = page(root);
  const render = () => {
    p.innerHTML = '';
    const a = lib.albums().find((x) => x.key === key);
    if (!a) { p.append(head('ألبوم', { back: '#/library/albums' }), emptyState('disc', 'الألبوم غير موجود')); return; }
    const tracks = a.tracks.slice().sort((x, y) => (x.trackNo || 999) - (y.trackNo || 999) || (x.title || '').localeCompare(y.title || '', 'ar'));
    const dur = tracks.reduce((s, t) => s + (t.duration || 0), 0);
    p.append(head('', { back: '#/library/albums' }));
    p.append(h('div.hero', coverEl({ name: a.name, art: a.art }, { size: 'full', eager: true }), h('h1', a.name),
      h('div.sub', [a.artist, songsCount(tracks.length), fmtDuration(dur)].filter(Boolean).join(' · '))));
    p.append(playAllButtons(() => tracks.map((t) => t.id), a.name));
    p.append(trackList(tracks.map((t) => t.id), a.name));
  };
  render();
  return subs(lib.on('tracks', debounce(render, 500)), onPlayer('track', () => markPlaying(p)));
}

// ================================================================ PLAYLISTS

function mosaic(ids) {
  const arts = [];
  for (const id of ids) { const t = lib.tracks.get(id); if (t && t.art && !arts.includes(t.art)) arts.push(t.art); if (arts.length === 4) break; }
  if (arts.length < 4) {
    const t = lib.tracks.get(ids[0]);
    return coverEl({ name: t ? t.title : '♪', art: arts[0] }, { size: 'full', eager: true });
  }
  return h('div.mosaic', arts.map((a) => coverEl({ art: a }, { size: 'full', eager: true })));
}

export function playlist(root, id) {
  const p = page(root);
  let editing = false;
  const render = () => {
    p.innerHTML = '';
    const pl = lib.playlists.get(id);
    if (!pl) { p.append(head('قائمة', { back: '#/library/playlists' }), emptyState('queue', 'القائمة غير موجودة')); return; }
    const ids = pl.trackIds.filter((x) => lib.tracks.has(x));
    const dur = ids.reduce((s, x) => s + (lib.tracks.get(x).duration || 0), 0);
    p.append(head('', {
      back: '#/library/playlists',
      actions: [btn(null, editing ? 'تم' : 'تعديل', () => { editing = !editing; render(); }, 'sm ghost'), iconBtn('more', () => menu(pl), 'خيارات')],
    }));
    p.append(h('div.hero', mosaic(ids), h('h1', pl.name), h('div.sub', [songsCount(ids.length), fmtDuration(dur)].filter(Boolean).join(' · '))));
    if (!ids.length) {
      p.append(emptyState('listplus', 'القائمة فاضية', 'أضف أغاني من مكتبتك.', btn('plus', 'أضف أغاني', () => pickSongs(pl), 'primary')));
      return;
    }
    p.append(playAllButtons(() => ids, pl.name));
    if (editing) {
      const list = h('div.list');
      ids.forEach((tid, i) => {
        const t = lib.tracks.get(tid);
        list.append(h('div.trow', coverEl(t), h('div.meta', h('div.t', t.title), h('div.s', t.artist || '')),
          iconBtn('arrowUp', async () => { if (i > 0) { [pl.trackIds[i - 1], pl.trackIds[i]] = [pl.trackIds[i], pl.trackIds[i - 1]]; await lib.savePlaylist(pl); } }, 'لأعلى', 'sm'),
          iconBtn('arrowDown', async () => { if (i < ids.length - 1) { [pl.trackIds[i + 1], pl.trackIds[i]] = [pl.trackIds[i], pl.trackIds[i + 1]]; await lib.savePlaylist(pl); } }, 'لأسفل', 'sm'),
          iconBtn('close', async () => { pl.trackIds = pl.trackIds.filter((x) => x !== tid); await lib.savePlaylist(pl); }, 'إزالة', 'sm')));
      });
      p.append(list, h('div.btn-row', btn('plus', 'أضف أغاني', () => pickSongs(pl))));
    } else {
      p.append(trackList(ids, pl.name));
    }
  };
  const menu = (pl) => actionSheet([
    { icon: 'plus', label: 'أضف أغاني', fn: () => pickSongs(pl) },
    { icon: 'edit', label: 'إعادة تسمية', fn: async () => { const n = await promptDialog('اسم القائمة', { value: pl.name }); if (n) { pl.name = n; await lib.savePlaylist(pl); } } },
    { icon: 'shuffle', label: 'رتّب عشوائياً', fn: async () => { pl.trackIds.sort(() => Math.random() - 0.5); await lib.savePlaylist(pl); } },
    { icon: 'trash', label: 'احذف القائمة', danger: true, fn: async () => { if (await confirmDialog(`تحذف قائمة «${pl.name}»؟ (الأغاني تبقى في مكتبتك)`, { ok: 'احذف', danger: true })) { await lib.deletePlaylist(pl.id); history.back(); } } },
  ]);
  render();
  return subs(lib.on('playlists', render), lib.on('tracks', debounce(render, 500)), onPlayer('track', () => markPlaying(p)));
}

function pickSongs(pl) {
  const chosen = new Set();
  sheet((close) => {
    const input = h('input', { type: 'search', placeholder: 'ابحث', enterkeyhint: 'search' });
    const list = h('div.list');
    const draw = () => {
      const have = new Set(pl.trackIds);
      const pool = lib.sorted(lib.search(input.value), 'title').filter((t) => !have.has(t.id));
      renderRows(list, pool, (t) => trackRow(t, { selectable: true, selected: chosen.has(t.id), onSelect: (tid, on) => (on ? chosen.add(tid) : chosen.delete(tid)) }), 50, 100);
    };
    input.addEventListener('input', debounce(draw, 200));
    draw();
    return h('div', h('div.search', ic('search'), input), list,
      h('div', { style: { position: 'sticky', bottom: '0', paddingTop: '10px', background: 'var(--bg-2)' } },
        h('button.btn.primary', { style: { width: '100%' }, onclick: async () => {
          close();
          if (chosen.size) { const n = await lib.addToPlaylist(pl.id, [...chosen]); toast(`أُضيفت ${songsCount(n)}`); }
        } }, 'إضافة المحدد')));
  }, { title: `أضف إلى «${pl.name}»` });
}

export function smart(root, key) {
  const s = lib.SMART[key];
  const p = page(root);
  if (!s) { p.append(head('قائمة', { back: '#/library/playlists' })); return; }
  const render = () => {
    p.innerHTML = '';
    const tracks = s.get();
    p.append(head(s.name, { back: '#/library/playlists', sub: songsCount(tracks.length) }));
    if (!tracks.length) {
      p.append(emptyState(s.icon, 'لا شيء هنا بعد', key === 'liked' ? 'اضغط ❤️ على أي أغنية لتظهر هنا.' : 'استمع لأغانيك وستمتلئ هذه القائمة.'));
      return;
    }
    p.append(playAllButtons(() => tracks.map((t) => t.id), s.name));
    p.append(trackList(tracks.map((t) => t.id), s.name));
  };
  render();
  return subs(lib.on('tracks', debounce(render, 500)), onPlayer('track', () => markPlaying(p)));
}

// ================================================================ DISCOVER (YouTube)

let lastQuery = '';
let lastResults = null;

export function discover(root) {
  const p = page(root);
  const dlBtn = btn('download', 'التحميلات', () => go('#/downloads'), 'sm ghost');
  const updDl = () => {
    const n = api.activeCount();
    dlBtn.querySelector('span').textContent = n ? `التحميلات (${n})` : 'التحميلات';
  };
  p.append(head('اكتشف', { actions: [dlBtn] }));
  updDl();

  const searchable = api.canSearch();
  const input = h('input', { type: 'search', placeholder: searchable ? 'ابحث في يوتيوب أو الصق رابط' : 'الصق رابط يوتيوب أو تيك توك أو إنستغرام', value: lastQuery, enterkeyhint: 'search', autocapitalize: 'off', autocorrect: 'off' });
  const form = h('form.search', { onsubmit: (e) => { e.preventDefault(); input.blur(); run(input.value); } }, ic('search'), input,
    iconBtn('paste', async () => {
      try {
        const txt = await navigator.clipboard.readText();
        if (!txt) return toast('الحافظة فاضية');
        input.value = txt.trim();
        run(input.value);
      } catch { toast('اسمح بالوصول للحافظة أو الصق الرابط يدوياً'); input.focus(); }
    }, 'لصق', 'sm clear'));
  p.append(form);
  const chips = h('div.chips');
  if (searchable) p.append(chips);
  const results = h('div', { style: { marginTop: '12px' } });
  p.append(results);
  if (!searchable) {
    p.append(h('div.card', { style: { marginTop: '6px' } },
      h('h3', 'التحميل يشتغل الآن بدون كمبيوتر ✓'),
      h('p', 'انسخ رابط أي فيديو من يوتيوب (مشاركة ← نسخ الرابط)، أو من تيك توك وإنستغرام وساوند كلاود، وارجع هنا واضغط زر اللصق 📋.'),
      h('div.btn-row', { style: { marginTop: '12px' } },
        btn('link', 'افتح يوتيوب', () => window.open('https://www.youtube.com/', '_blank'), 'primary'),
        btn('paste', 'لصق رابط', () => form.querySelector('.clear').click()))),
      h('div.card',
        h('h3', 'تبي تبحث وتتصفح يوتيوب من داخل التطبيق؟'),
        h('p', 'أضف «مفتاح يوتيوب» المجاني من جوجل مرة وحدة (3 دقائق من الآيفون). بعدها يشتغل البحث، القوائم، وريلز يوتيوب، والأغاني الجديدة في «على ذوقي».'),
        h('div.btn-row', { style: { marginTop: '12px' } }, btn('info', 'طريقة الحصول على المفتاح', () => go('#/guide'), 'primary'), btn('sliders', 'أدخل المفتاح', () => go('#/settings'), 'ghost'))));
  }

  const drawChips = () => {
    chips.innerHTML = '';
    const rec = (lib.settings.recentSearches || []).slice(0, 6);
    const suggest = taste.profile().slice(0, 6).map((a) => a.name);
    const base = ['طرب ليبي', 'أغاني ليبية', 'أم كلثوم', 'فيروز', 'عبد الحليم'];
    const seen = new Set();
    for (const q of [...rec, ...suggest, ...base]) {
      if (seen.has(q)) continue; seen.add(q);
      chips.append(h('button.chip', { onclick: () => { input.value = q; run(q); } }, rec.includes(q) ? ic('clock') : null, q));
    }
  };
  drawChips();

  async function run(q) {
    q = (q || '').trim();
    if (!q) return;
    lastQuery = q;
    results.innerHTML = '';
    results.append(h('div.spinner'));
    try {
      if (api.isYouTubeUrl(q) || /^https?:\/\//.test(q)) {
        if (api.isPlaylistUrl(q)) {
          const items = await api.playlist(q);
          lastResults = { kind: 'playlist', items, q };
        } else {
          const m = await api.meta(q);
          lastResults = null;
          results.innerHTML = '';
          ytSheet({ ...m, url: q });
          return;
        }
      } else {
        if (!searchable) throw new Error('البحث يحتاج مفتاح يوتيوب — أو الصق رابط مباشرة');
        const items = await api.search(q, 25);
        lastResults = { kind: 'search', items, q };
        const rs = [q, ...(lib.settings.recentSearches || []).filter((x) => x !== q)].slice(0, 10);
        lib.setSetting('recentSearches', rs);
        drawChips();
      }
      drawResults();
    } catch (e) {
      results.innerHTML = '';
      results.append(emptyState('cloud', 'تعذّر البحث', e.message));
    }
  }

  function drawResults() {
    results.innerHTML = '';
    if (!lastResults) return;
    const { items, kind } = lastResults;
    if (!items.length) { results.append(emptyState('search', 'لا نتائج')); return; }
    if (kind === 'playlist') {
      results.append(h('div.card', { style: { marginBottom: '10px' } },
        h('h3', `قائمة تشغيل · ${items.length} مقطع`),
        h('p', 'تقدر تحمّل القائمة كلها دفعة وحدة كصوت.'),
        h('div.btn-row', { style: { marginTop: '10px' } },
          btn('download', 'حمّل الكل (صوت)', async () => {
            if (!(await confirmDialog(`تحمّل ${items.length} مقطع كصوت؟ خلي التطبيق مفتوح أثناء النقل.`, { ok: 'ابدأ' }))) return;
            for (const it of items) if (!lib.findByYt(it.id)) api.startDownload({ ...it, kind: 'audio' });
            go('#/downloads');
          }, 'primary'),
          btn('play', 'شغّل', () => player.playItems(items.map(ytToItem), 0, { context: 'قائمة يوتيوب' })))));
    }
    results.append(h('div.list', items.map((it) => ytRow(it, ytSheet))));
  }
  if (lastResults) drawResults();
  return subs(api.onDownloads(updDl), lib.on('tracks', debounce(() => lastResults && drawResults(), 600)));
}

export function downloads(root) {
  const p = page(root);
  p.append(head('التحميلات', { back: '#/discover', actions: [btn(null, 'مسح المنتهية', () => api.clearFinished(), 'sm ghost')] }));
  p.append(h('p.muted', { style: { fontSize: '13px', marginBottom: '8px' } }, 'خلي التطبيق مفتوحاً أثناء التحميل — آيفون يوقف التطبيقات في الخلفية.'));
  const list = h('div');
  p.append(list);
  const label = (d) => ({
    queued: 'في الانتظار…',
    server: d.detail || 'على خادم البيت…',
    cobalt: d.detail || 'يجهّز الملف…',
    transfer: d.detail || 'ينقل للآيفون…',
    saving: 'يحفظ في المكتبة…',
    done: 'تم ✓ في مكتبتك',
    error: d.error || 'فشل',
    cancelled: 'أُلغي',
  }[d.status] || d.status);
  const draw = () => {
    list.innerHTML = '';
    const ds = api.downloads.slice().reverse();
    if (!ds.length) { list.append(emptyState('download', 'لا توجد تحميلات', 'ابحث في «اكتشف» واضغط على أي فيديو لتحميله.')); return; }
    for (const d of ds) {
      const actions = [];
      if (['queued', 'server', 'cobalt', 'transfer'].includes(d.status)) actions.push(iconBtn('close', () => api.cancelDownload(d), 'إلغاء', 'sm'));
      if (['error', 'cancelled'].includes(d.status)) actions.push(iconBtn('refresh', () => api.retryDownload(d), 'إعادة', 'sm'));
      if (d.status === 'done' && d.trackId && lib.tracks.has(d.trackId)) actions.push(iconBtn('play', () => player.playTracks([d.trackId], 0, { context: 'التحميلات' }), 'تشغيل', 'sm'));
      list.append(h('div.dl',
        h('div.thumb', d.thumbnail ? h('img', { src: d.thumbnail, alt: '' }) : null),
        h('div.grow',
          h('div.t', d.title || d.url),
          h('div.s' + (d.status === 'error' ? '.err' : ''), `${d.site && d.site !== 'يوتيوب' ? d.site + ' · ' : ''}${d.kind === 'video' ? 'فيديو' + (d.quality && d.quality !== 'max' && d.vid ? ' ' + d.quality + 'p' : '') : 'صوت ' + (d.engine === 'cobalt' ? 'MP3' : (d.format || '').toUpperCase())} · ${label(d)}`),
          ['server', 'cobalt', 'transfer', 'saving', 'queued'].includes(d.status) ? h('div.bar', h('i', { style: { width: Math.round(d.progress * 100) + '%' } })) : null),
        ...actions));
    }
  };
  draw();
  return subs(api.onDownloads(draw));
}

// ================================================================ RADIO

let radioCat = 'ly';
let radioCache = new Map();

export function radio(root) {
  const p = page(root);
  p.append(head('راديو', { sub: 'محطات عربية وعالمية مباشرة' }));
  const input = h('input', { type: 'search', placeholder: 'ابحث عن محطة', enterkeyhint: 'search' });
  p.append(h('form.search', { onsubmit: (e) => { e.preventDefault(); input.blur(); load({ search: input.value }); } }, ic('search'), input));
  const chips = h('div.chips');
  p.append(chips);
  const list = h('div.list', { style: { marginTop: '10px' } });
  p.append(list);
  const cats = [{ id: 'fav', label: '❤️ المفضلة' }, ...radioApi.CATEGORIES];
  const drawChips = () => {
    chips.innerHTML = '';
    for (const c of cats) chips.append(h('button.chip' + (c.id === radioCat ? '.on' : ''), { onclick: () => { radioCat = c.id; drawChips(); load(); } }, c.label));
  };
  const favs = () => lib.settings.radioFavs || [];
  const isFav = (s) => favs().some((f) => f.stationuuid === s.stationuuid);
  const toggleFav = (s) => {
    const slim = { stationuuid: s.stationuuid, name: s.name, url: s.url, url_resolved: s.url_resolved, favicon: s.favicon, country: s.country, tags: s.tags, codec: s.codec, bitrate: s.bitrate };
    const next = isFav(s) ? favs().filter((f) => f.stationuuid !== s.stationuuid) : [slim, ...favs()];
    lib.setSetting('radioFavs', next);
    toast(isFav(s) ? 'أُضيفت للمفضلة' : 'أُزيلت من المفضلة');
  };
  let current = [];
  const draw = (stations) => {
    current = stations;
    list.innerHTML = '';
    if (!stations.length) {
      list.append(emptyState('radio', radioCat === 'fav' ? 'لا توجد محطات مفضلة' : 'لا توجد محطات', radioCat === 'fav' ? 'اضغط ❤️ بجانب أي محطة لتظهر هنا.' : 'جرّب تصنيفاً آخر أو ابحث بالاسم.'));
      return;
    }
    const playingId = player.current && player.current.station && player.current.station.stationuuid;
    for (const s of stations) {
      const fav = iconBtn(isFav(s) ? 'heartf' : 'heart', (e) => {
        e.stopPropagation(); toggleFav(s);
        fav.innerHTML = ''; fav.append(ic(isFav(s) ? 'heartf' : 'heart'));
        fav.style.color = isFav(s) ? 'var(--rose)' : '';
      }, 'مفضلة', 'sm');
      if (isFav(s)) fav.style.color = 'var(--rose)';
      const needsProxy = (s.url_resolved || s.url || '').startsWith('http:') && !api.hasServer();
      const row = h('div.station' + (playingId === s.stationuuid ? '.playing' : ''),
        coverEl({ name: s.name, artUrl: s.favicon }),
        h('div.grow',
          h('div.t', s.name),
          h('div.s', [s.country, (s.tags || '').split(',').slice(0, 2).join('، '), s.bitrate ? s.bitrate + 'kbps' : '', needsProxy ? '⚠︎ قد لا تعمل' : ''].filter(Boolean).join(' · '))),
        fav);
      row.addEventListener('click', () => {
        radioApi.click(s.stationuuid);
        player.playItems([{ type: 'radio', station: s }], 0, { context: 'راديو' });
        setTimeout(() => draw(current), 50);
      });
      list.append(row);
    }
  };
  async function load({ search } = {}) {
    if (radioCat === 'fav' && !search) return draw(favs());
    const key = search ? 'q:' + search : radioCat;
    if (radioCache.has(key)) return draw(radioCache.get(key));
    list.innerHTML = '';
    list.append(h('div.spinner'));
    try {
      const cat = radioApi.CATEGORIES.find((c) => c.id === radioCat);
      const st = search ? await radioApi.searchStations(search) : await radioApi.stations(cat ? cat.q : {});
      radioCache.set(key, st);
      draw(st);
    } catch (e) {
      list.innerHTML = '';
      list.append(emptyState('cloud', 'تعذّر تحميل المحطات', e.message));
    }
  }
  if (radioCat === 'ly' && favs().length) radioCat = 'fav';
  drawChips();
  load();
  return subs(onPlayer('track', () => draw(current)), lib.on('settings', (k) => { if (k === 'radioFavs' && radioCat === 'fav') draw(favs()); }));
}

// ================================================================ FOR YOU

function recItem(r) {
  const acts = [];
  if (r.preview) acts.push(iconBtn('play', (e) => { e.stopPropagation(); player.playItems([{ type: 'preview', url: r.preview, title: r.title, artist: r.artist, cover: r.coverBig || r.cover }], 0, { context: 'مقطع تجريبي' }); }, 'استمع لمقطع', 'sm'));
  if (api.canSearch()) acts.push(iconBtn('download', (e) => { e.stopPropagation(); downloadRec(r); }, 'تحميل', 'sm'));
  return recRow(r, () => recMenu(r), h('div.row', acts));
}

async function downloadRec(r) {
  try {
    toast('أبحث عنها في يوتيوب…');
    const hit = await api.findOnYouTube(r.artist, r.title);
    if (!hit) return toast('لم أجدها على يوتيوب', { error: true });
    api.startDownload({ ...hit, kind: 'audio', hint: { title: r.title, artist: r.artist } });
    toast(`بدأ تحميل «${r.title}»`, { action: { label: 'عرض', fn: () => go('#/downloads') } });
  } catch (e) { toast(e.message, { error: true }); }
}

function recMenu(r) {
  const header = h('div.action-head', coverEl({ title: r.title, cover: r.cover }), h('div.grow', h('div.t.ellipsis', r.title), h('div.s.ellipsis', r.artist)));
  actionSheet([
    api.canSearch() ? { icon: 'play', label: 'شغّل كاملة من يوتيوب', fn: () => player.playItems([taste.recToItem(r)], 0, { context: 'على ذوقي' }) } : null,
    r.preview ? { icon: 'note', label: 'استمع لمقطع 30 ثانية', fn: () => player.playItems([{ type: 'preview', url: r.preview, title: r.title, artist: r.artist, cover: r.coverBig || r.cover }]) } : null,
    api.canSearch() ? { icon: 'download', label: 'حمّلها لمكتبتي', fn: () => downloadRec(r) } : null,
    api.canSearch() ? { icon: 'queue', label: 'أضف لقائمة الانتظار', fn: () => { player.addToQueue(taste.recToItem(r)); toast('أُضيفت'); } } : null,
    !api.canSearch() ? { icon: 'info', label: 'للتحميل والتشغيل الكامل أضف مفتاح يوتيوب', fn: () => go('#/settings') } : null,
  ], { header });
}

export function foryou(root) {
  const p = page(root);
  p.append(head('على ذوقي', { back: '#/home' }));
  const prof = taste.profile();
  if (!prof.length) {
    p.append(emptyState('sparkle', 'أتعرف على ذوقك من أغانيك', 'أضف أغاني لمكتبتك (مع أسماء الفنانين) وراح أقترح لك أغاني قريبة منها.', btn('upload', 'أضف أغاني', openImport, 'primary')));
    return;
  }
  p.append(h('div.onboard', { style: { marginTop: '0' } },
    h('h2', 'ميكس على ذوقك ✨'),
    h('p', api.canSearch() && lib.settings.mixNew ? 'من أغانيك اللي تحبها، ومعاها أغاني جديدة كل شوي من يوتيوب.' : 'أغانيك مرتبة على ذوقك: المفضلة والأكثر سماعاً أولاً، مع تنويع.'),
    btn('play', 'شغّل على ذوقي', playTaste, 'primary')));
  p.append(section('ذوقك', null, h('div.chips', prof.slice(0, 12).map((a) => h('button.chip', { onclick: () => go('#/artist/' + encodeURIComponent(a.key)) }, a.name)))));
  const recBox = h('div');
  const artBox = h('div');
  const refresh = btn('refresh', 'تحديث', () => load(true), 'sm ghost');
  p.append(section('أغانٍ قد تعجبك', refresh, recBox));
  p.append(artBox);

  const draw = (r) => {
    recBox.innerHTML = '';
    artBox.innerHTML = '';
    if (!r || !r.items || !r.items.length) { recBox.append(h('p.muted', 'ما لقيت اقتراحات الآن — جرّب «تحديث».')); return; }
    if (!api.canSearch()) recBox.append(h('p.muted', { style: { fontSize: '12.5px', marginBottom: '6px' } }, '▶ يشغّل مقطعاً تجريبياً. لتشغيل الأغاني كاملة وتحميلها أضف مفتاح يوتيوب من الإعدادات.'));
    else recBox.append(h('div.btn-row', btn('play', 'شغّل الاقتراحات كاملة', () => player.playItems(r.items.map(taste.recToItem), 0, { context: 'اقتراحات على ذوقك' }))));
    recBox.append(h('div.list', r.items.map(recItem)));
    if (r.artists && r.artists.length) {
      artBox.append(section('فنانون قد يعجبونك', null, h('div.hscroll', r.artists.map((a) => tile({ name: a.name, artUrl: a.picture }, {
        round: true, sub: `مثل ${a.because}`, onClick: () => artistSheet(a.name),
      })))));
    }
  };
  async function load(force) {
    const cached = await taste.loadCachedRecs();
    if (cached && !force) draw(cached);
    if (!cached || force || Date.now() - cached.at > 6 * 3600e3) {
      if (!cached || force) { recBox.innerHTML = ''; recBox.append(h('div.spinner')); }
      try { draw(await taste.recommend()); } catch (e) { if (!cached) { recBox.innerHTML = ''; recBox.append(h('p.muted', 'تعذّر جلب الاقتراحات: ' + e.message)); } }
    }
  }
  load();
}

function artistSheet(name) {
  sheet(() => {
    const box = h('div', h('div.spinner'));
    taste.artistTop(name, 20).then((list) => {
      box.innerHTML = '';
      box.append(h('div.list', list.map(recItem)));
    }).catch(() => { box.innerHTML = ''; box.append(h('p.muted', 'تعذّر التحميل')); });
    return box;
  }, { title: name });
}

// ================================================================ SETTINGS

export function settings(root) {
  const p = page(root);
  const S = lib.settings;
  p.append(head('الإعدادات', { back: '#/home' }));
  const group = (title, ...rows) => [h('div.set-title', title), h('div.set-group', ...rows)];
  const toggle = (key, label, sub, iconName, after) => {
    const input = h('input', { type: 'checkbox', checked: !!S[key] });
    input.addEventListener('change', () => { lib.setSetting(key, input.checked); after && after(input.checked); });
    return h('label.set-row', ic(iconName), h('div.lbl', h('b', label), sub ? h('small', sub) : null), h('span.switch', input, h('i')));
  };
  const choice = (label, iconName, opts, key) => {
    const cur = () => (opts.find((o) => o[0] === S[key]) || opts[0])[1];
    const val = h('span.muted', cur());
    return h('button.set-row', { style: { width: '100%', textAlign: 'start' }, onclick: () => actionSheet(opts.map(([v, l]) => ({
      icon: v === S[key] ? 'check' : iconName, label: l, fn: () => { lib.setSetting(key, v); val.textContent = cur(); },
    })), { title: label }) }, ic(iconName), h('div.lbl', h('b', label)), val);
  };

  // ---- download without a computer
  const engDot = h('span.status-dot');
  const engStatus = h('small', 'يفحص الخوادم…');
  const checkEngines = async () => {
    engDot.className = 'status-dot'; engStatus.textContent = 'يفحص الخوادم…';
    const res = await cobalt.check();
    const up = res.filter((r) => r.ok && r.youtube).length;
    engDot.className = 'status-dot ' + (up ? 'ok' : 'bad');
    engStatus.textContent = up ? `${up} من ${res.length} خوادم مجانية شغّالة الآن` : 'الخوادم المجانية لا ترد الآن — جرّب لاحقاً';
  };
  checkEngines();
  const own = h('input.input.ltr', { value: S.cobaltUrl, placeholder: 'https://cobalt.example.com (اختياري)', inputmode: 'url', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
  const ownKey = h('input.input.ltr', { value: S.cobaltKey, placeholder: 'Api-Key (اختياري)', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, type: 'password' });
  own.addEventListener('change', () => lib.setSetting('cobaltUrl', own.value.trim()));
  ownKey.addEventListener('change', () => lib.setSetting('cobaltKey', ownKey.value.trim()));
  p.append(...group('التحميل بدون كمبيوتر',
    h('div.set-pad',
      h('div.row.gap', engDot, h('div.grow', h('b', { style: { display: 'block' } }, 'خوادم cobalt المجانية'), engStatus), btn('refresh', 'فحص', checkEngines, 'sm ghost')),
      h('p.muted', { style: { fontSize: '12.5px', marginTop: '10px' } }, 'تشتغل تلقائياً بدون أي إعداد: يوتيوب، تيك توك، إنستغرام، ساوند كلاود، فيسبوك، إكس. لو خادم فشل، التطبيق يجرّب اللي بعده.'),
      h('details', { style: { marginTop: '10px' } }, h('summary', { style: { fontSize: '13px', color: 'var(--accent)', fontWeight: '700' } }, 'خادم cobalt خاص (اختياري)'),
        h('div', { style: { marginTop: '10px' } }, own, h('div', { style: { height: '8px' } }), ownKey))),
  ));

  // ---- YouTube key (search, playlists, Shorts)
  const ytKey = h('input.input.ltr', { value: S.ytKey, placeholder: 'AIza…', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
  const keyDot = h('span.status-dot');
  const keyStatus = h('small', S.ytKey ? '…' : 'غير مضاف — البحث داخل التطبيق متوقف');
  const testKey = async () => {
    const k = ytapi.cleanKey(ytKey.value);
    ytKey.value = k;
    await lib.setSetting('ytKey', k);
    if (!k) { keyDot.className = 'status-dot'; keyStatus.textContent = 'غير مضاف — البحث داخل التطبيق متوقف'; return; }
    const shape = ytapi.keyShapeProblem(k);
    if (shape) { keyDot.className = 'status-dot bad'; keyStatus.textContent = shape; return; }
    keyDot.className = 'status-dot'; keyStatus.textContent = 'يختبر…';
    try { await ytapi.test(); keyDot.className = 'status-dot ok'; keyStatus.textContent = 'المفتاح يشتغل ✓ — البحث والقوائم والريلز مفعّلة'; } catch (e) { keyDot.className = 'status-dot bad'; keyStatus.textContent = e.message; }
  };
  p.append(...group('مفتاح يوتيوب (للبحث والتصفح)',
    h('div.set-pad',
      h('label.field', h('span', 'YouTube Data API key — مجاني من جوجل'), ytKey),
      h('div.row.gap', keyDot, h('div.grow', keyStatus), btn(null, 'حفظ واختبار', testKey, 'sm primary')),
      h('p.muted', { style: { fontSize: '12.5px', marginTop: '10px' } }, 'كيف أحصل عليه؟ ', h('a', { href: '#/guide', style: { color: 'var(--accent)' } }, 'الخطوات في الدليل'), ' (3 دقائق من الآيفون)')),
  ));
  if (S.ytKey) testKey();

  // ---- home server (optional)
  const url = h('input.input.ltr', { value: S.serverUrl, placeholder: 'https://xxxx.trycloudflare.com', inputmode: 'url', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
  const key = h('input.input.ltr', { value: S.serverKey, placeholder: 'اختياري', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, type: 'password' });
  const dot = h('span.status-dot');
  const status = h('small', 'غير مضبوط (اختياري)');
  const test = async () => {
    await lib.setSetting('serverUrl', url.value.trim());
    await lib.setSetting('serverKey', key.value.trim());
    if (!api.hasServer()) { dot.className = 'status-dot'; status.textContent = 'غير مضبوط (اختياري)'; return; }
    dot.className = 'status-dot'; status.textContent = 'يتصل…';
    try {
      const hl = await api.health();
      dot.className = 'status-dot ok';
      const warn = [!hl.ffmpeg && 'ffmpeg غير مثبت', !hl.deno && 'deno غير مثبت'].filter(Boolean);
      status.textContent = `متصل ✓ · yt-dlp ${hl.ytdlp}` + (warn.length ? ' · ⚠︎ ' + warn.join('، ') : '');
    } catch (e) {
      dot.className = 'status-dot bad';
      status.textContent = e.message;
    }
  };
  p.append(...group('خادم البيت (اختياري — الأكثر ثباتاً)',
    h('div.set-pad',
      h('label.field', h('span', 'رابط الخادم'), url),
      h('label.field', h('span', 'مفتاح الخادم'), key),
      h('div.row.gap', dot, h('div.grow', status), btn(null, 'حفظ واختبار', test, 'sm primary'))),
    choice('طريقة التحميل', 'download', [['auto', 'تلقائي (خادم البيت ثم المجاني)'], ['cobalt', 'الخوادم المجانية فقط'], ['server', 'خادم البيت فقط']], 'dlEngine'),
  ));
  if (S.serverUrl) test();

  p.append(...group('التحميل',
    choice('صيغة الصوت (خادم البيت)', 'note', [['m4a', 'M4A (أفضل للآيفون)'], ['mp3', 'MP3']], 'audioFormat'),
    choice('جودة الفيديو الافتراضية', 'video', [['360', '360p'], ['480', '480p'], ['720', '720p HD'], ['1080', '1080p Full HD']], 'videoQuality'),
  ));

  p.append(...group('التشغيل',
    toggle('bgAudio', 'الفيديو يكمل كصوت عند قفل الشاشة', 'آيفون يوقف الفيديو في الخلفية، فنحوّله لصوت تلقائياً', 'moon'),
    toggle('mixNew', 'أغاني جديدة داخل «على ذوقي»', 'كل رابع أغنية اقتراح جديد من يوتيوب (يحتاج مفتاح يوتيوب)', 'sparkle'),
  ));

  p.append(h('div.set-title', 'الثيمات'), h('div.set-group', h('div.set-pad', themes.picker())));

  // storage
  const st = lib.stats();
  const meter = h('div.meter', h('i', { style: { width: '0%' } }));
  const used = h('small', `${songsCount(st.count)} · ${fmtBytes(st.size)}`);
  const persistRow = h('small', '…');
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then((e) => {
      if (e.quota) {
        meter.firstChild.style.width = Math.min(100, (e.usage / e.quota) * 100).toFixed(1) + '%';
        used.textContent = `${songsCount(st.count)} · مستخدم ${fmtBytes(e.usage)} من ${fmtBytes(e.quota)} متاحة`;
      }
    });
  }
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((v) => { persistRow.textContent = v ? 'محمي ✓ — الجهاز لن يحذف الأغاني تلقائياً' : 'غير محمي — اضغط للطلب'; });
  } else persistRow.textContent = 'غير مدعوم في هذا المتصفح';
  p.append(...group('التخزين',
    h('div.set-pad', h('b', 'المساحة'), meter, used),
    h('button.set-row', { style: { width: '100%', textAlign: 'start' }, onclick: async () => {
      if (!navigator.storage || !navigator.storage.persist) return;
      const ok = await navigator.storage.persist();
      persistRow.textContent = ok ? 'محمي ✓ — الجهاز لن يحذف الأغاني تلقائياً' : 'رفض المتصفح الطلب (ثبّت التطبيق على الشاشة الرئيسية أولاً)';
    } }, ic('check'), h('div.lbl', h('b', 'حماية التخزين'), persistRow)),
    h('button.set-row', { style: { width: '100%', textAlign: 'start' }, onclick: exportBackup }, ic('share'), h('div.lbl', h('b', 'نسخة احتياطية للبيانات'), h('small', 'القوائم، المفضلة، عدد مرات التشغيل (بدون ملفات الأغاني)'))),
    h('button.set-row', { style: { width: '100%', textAlign: 'start' }, onclick: importBackup }, ic('upload'), h('div.lbl', h('b', 'استرجاع نسخة احتياطية'), h('small', 'يطابق الأغاني بالاسم والحجم'))),
    h('button.set-row', { style: { width: '100%', textAlign: 'start', color: 'var(--danger)' }, onclick: async () => {
      if (!(await confirmDialog('تحذف كل الأغاني والقوائم من التطبيق؟ لا يمكن التراجع.', { ok: 'احذف الكل', danger: true }))) return;
      player.pause();
      await lib.deleteTracks(lib.list().map((t) => t.id));
      for (const pl of [...lib.playlists.values()]) await lib.deletePlaylist(pl.id);
      await db.clear('history');
      toast('تم حذف المكتبة');
    } }, ic('trash'), h('div.lbl', h('b', 'حذف كل المكتبة'))),
  ));

  p.append(...group('حول',
    h('a.set-row', { href: '#/guide' }, ic('info'), h('div.lbl', h('b', 'دليل الاستخدام')), ic('chevL')),
    h('a.set-row', { href: '#/stats' }, ic('stats'), h('div.lbl', h('b', 'إحصائيات الاستماع')), ic('chevL')),
    h('div.set-row', ic('note'), h('div.lbl', h('b', 'دندنة'), h('small', `الإصدار ${VERSION}`))),
  ));
}

async function exportBackup() {
  const data = {
    app: 'dandana', version: 1, exportedAt: new Date().toISOString(),
    tracks: lib.list().map((t) => ({
      fileName: t.fileName, size: t.size, ytId: t.ytId, title: t.title, artist: t.artist, album: t.album,
      liked: t.liked, likedAt: t.likedAt, plays: t.plays, lastPlayed: t.lastPlayed, skips: t.skips, lyrics: t.lyrics, addedAt: t.addedAt,
    })),
    playlists: [...lib.playlists.values()].map((pl) => ({
      name: pl.name, createdAt: pl.createdAt,
      items: pl.trackIds.map((id) => lib.tracks.get(id)).filter(Boolean).map((t) => ({ fileName: t.fileName, size: t.size, ytId: t.ytId })),
    })),
    settings: { ...lib.settings, serverKey: '' },
  };
  const name = `dandana-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'نسخة دندنة الاحتياطية' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(file), download: name });
  document.body.append(a); a.click(); a.remove();
}

function importBackup() {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (data.app !== 'dandana') throw new Error('ليس ملف نسخة احتياطية من دندنة');
      const byKey = new Map(), byYt = new Map();
      for (const t of lib.tracks.values()) { byKey.set(t.fileName + '|' + t.size, t); if (t.ytId) byYt.set(t.ytId, t); }
      const find = (x) => (x.ytId && byYt.get(x.ytId)) || byKey.get(x.fileName + '|' + x.size);
      let n = 0;
      for (const x of data.tracks || []) {
        const t = find(x);
        if (!t) continue;
        await lib.updateTrack(t.id, {
          title: x.title || t.title, artist: x.artist ?? t.artist, album: x.album ?? t.album,
          liked: x.liked || t.liked, likedAt: x.likedAt || t.likedAt, plays: Math.max(t.plays || 0, x.plays || 0),
          lastPlayed: Math.max(t.lastPlayed || 0, x.lastPlayed || 0) || null, skips: x.skips || t.skips, lyrics: x.lyrics || t.lyrics,
        }, { silent: true });
        n++;
      }
      let pn = 0;
      for (const pl of data.playlists || []) {
        const ids = pl.items.map(find).filter(Boolean).map((t) => t.id);
        if (!ids.length) continue;
        const exist = [...lib.playlists.values()].find((x) => x.name === pl.name);
        if (exist) await lib.addToPlaylist(exist.id, ids); else await lib.createPlaylist(pl.name, ids);
        pn++;
      }
      if (data.settings && data.settings.radioFavs) await lib.setSetting('radioFavs', data.settings.radioFavs);
      lib.emit('tracks');
      toast(`تم استرجاع بيانات ${songsCount(n)} و${pn} قائمة`);
    } catch (e) { toast(e.message, { error: true }); }
  };
  input.click();
}

// ================================================================ STATS

export function stats(root) {
  const p = page(root);
  p.append(head('إحصائياتك', { back: '#/home' }));
  const body = h('div', h('div.spinner'));
  p.append(body);
  (async () => {
    const now = Date.now();
    const hist = await db.historySince(now - 365 * 86400e3);
    body.innerHTML = '';
    const st = lib.stats();
    const totalSec = hist.reduce((s, x) => s + (x.sec || 0), 0);
    const week = hist.filter((x) => x.at > now - 7 * 86400e3);
    const weekSec = week.reduce((s, x) => s + (x.sec || 0), 0);
    const kpi = (v, l) => h('div.kpi', h('b', v), h('small', l));
    body.append(h('div.kpis',
      kpi(String(st.count), 'أغنية في المكتبة'),
      kpi(fmtDuration(st.dur) || '0', 'مدة المكتبة'),
      kpi(fmtDuration(weekSec) || '0 دقيقة', 'استماع هذا الأسبوع'),
      kpi(String(week.length), 'تشغيل هذا الأسبوع'),
      kpi(fmtDuration(totalSec) || '0 دقيقة', 'استماع هذه السنة'),
      kpi(fmtBytes(st.size), 'حجم الملفات')));

    // last 14 days
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 86400e3); d.setHours(0, 0, 0, 0);
      days.push({ start: d.getTime(), label: d.getDate(), sec: 0 });
    }
    for (const x of hist) for (const d of days) if (x.at >= d.start && x.at < d.start + 86400e3) d.sec += x.sec || 0;
    const max = Math.max(60, ...days.map((d) => d.sec));
    body.append(section('آخر 14 يوم', null, h('div.card',
      h('div.bars', days.map((d) => h('div', { style: { height: Math.max(2, (d.sec / max) * 100) + '%' }, title: fmtDuration(d.sec) }))),
      h('div.bars-x', days.map((d) => h('span', String(d.label)))))));

    const month = hist.filter((x) => x.at > now - 30 * 86400e3);
    const src = month.length >= 10 ? month : hist;
    const byArtist = new Map(), bySong = new Map();
    for (const x of src) {
      if (x.artist) byArtist.set(x.artist, (byArtist.get(x.artist) || 0) + 1);
      bySong.set(x.trackId, (bySong.get(x.trackId) || 0) + 1);
    }
    const topA = [...byArtist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topS = [...bySong.entries()].filter(([id]) => lib.tracks.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!topA.length && !topS.length) { body.append(emptyState('stats', 'لا توجد بيانات بعد', 'استمع لأغانيك وستظهر إحصائياتك هنا.')); return; }
    const label = src === month ? 'آخر 30 يوم' : 'كل الوقت';
    if (topA.length) {
      const mx = topA[0][1];
      body.append(section(`أكثر الفنانين · ${label}`, null, h('div', topA.map(([name, n], i) => {
        const a = lib.artists().find((x) => x.name === name);
        return h('div.rank', { onclick: () => a && go('#/artist/' + encodeURIComponent(a.key)) }, h('span.n', String(i + 1)), coverEl({ name, art: a && a.art }, { cls: 'round' }),
          h('div.grow', h('div.ellipsis', { style: { fontWeight: '650' } }, name), h('div.bar', h('i', { style: { width: (n / mx) * 100 + '%' } }))), h('small.muted', String(n)));
      }))));
    }
    if (topS.length) {
      const ids = topS.map(([id]) => id);
      body.append(section(`أكثر الأغاني · ${label}`, null, h('div.list', topS.map(([id, n], i) => trackRow(lib.tracks.get(id), {
        num: i + 1, extra: h('small.muted', String(n)), onPlay: () => player.playTracks(ids, i, { context: 'الأكثر استماعاً', shuffle: false }),
      })))));
    }
  })();
}

// ================================================================ GUIDE

export function guide(root) {
  const p = page(root);
  p.append(head('دليل الاستخدام', { back: '#/home' }));
  const origin = location.origin + location.pathname.replace(/index\.html$/, '');
  p.append(h('div.guide',
    h('h2', '١) تثبيت التطبيق على الآيفون'),
    h('ol',
      h('li', 'افتح الرابط في سفاري: ', h('code', origin)),
      h('li', 'اضغط زر المشاركة (المربع والسهم) ← «إضافة إلى الشاشة الرئيسية».'),
      h('li', 'افتح «دندنة» من أيقونتها، ومن هناك أضف أغانيك.')),
    h('p', 'مهم: الأغاني تتخزن داخل التطبيق المثبّت نفسه. لو حذفت الأيقونة من الشاشة الرئيسية تنحذف الأغاني معها، فخلّي نسخة من ملفاتك الأصلية.'),

    h('h2', '٢) إضافة أغانيك (حتى 500 أغنية وأكثر)'),
    h('ul',
      h('li', 'من «مكتبتي» اضغط ＋ واختر الملفات (صوت أو فيديو) من «الملفات» أو ألبوم الصور.'),
      h('li', 'للكميات الكبيرة: حط الأغاني في مجلد داخل تطبيق «الملفات» ← اضغط مطولاً على المجلد ← «ضغط». بعدها اختر ملف ZIP من التطبيق، وراح يستخرج كل الأغاني تلقائياً.'),
      h('li', 'التطبيق يقرأ اسم الأغنية والفنان والغلاف من الملف نفسه، وإذا ما فيه يستنتجها من اسم الملف (مثل «عمرو دياب - تملي معاك.mp3»).'),
      h('li', 'تقدر تعدّل أي معلومة أو تختار غلاف من الصور: اضغط ⋯ بجانب الأغنية ← «عدّل المعلومات».')),

    h('h2', '٣) التحميل من يوتيوب وتيك توك وإنستغرام — بدون كمبيوتر'),
    h('p', 'التحميل مدمج في التطبيق ويشتغل مباشرة: يعتمد على خوادم «cobalt» المجانية (برنامج تحميل مفتوح المصدر يشغّله متطوعون). لو خادم فشل، التطبيق يجرّب اللي بعده تلقائياً.'),
    h('ol',
      h('li', 'في تطبيق يوتيوب (أو تيك توك/إنستغرام): «مشاركة» ← «نسخ الرابط».'),
      h('li', 'في دندنة: «اكتشف» ← زر اللصق 📋.'),
      h('li', 'اختر: صوت MP3، أو فيديو 360/480/720/1080. يتحفظ في مكتبتك ويشتغل بدون إنترنت.')),
    h('p', 'ملاحظة صريحة: هذه الخوادم مجانية ويديرها متطوعون، ويوتيوب يحجب بعضها من وقت لآخر، فبعض الأغاني ممكن تفشل أحياناً. جرّب بعد شوية، أو استعمل خادم البيت (الفقرة ٥).'),

    h('h2', '٤) البحث والتصفح داخل التطبيق — مفتاح يوتيوب المجاني'),
    h('p', 'للبحث في يوتيوب من داخل دندنة، وريلز يوتيوب، والأغاني الجديدة في «على ذوقي»، تحتاج «مفتاح» مجاني من جوجل (واجهة يوتيوب الرسمية). مرة وحدة، من الآيفون:'),
    h('ol',
      h('li', 'افتح ', h('code', 'console.cloud.google.com'), ' وسجّل بحساب جوجل.'),
      h('li', 'من الأعلى: «Select a project» ← «New project» ← اكتب أي اسم ← Create.'),
      h('li', 'ابحث في الأعلى عن ', h('code', 'YouTube Data API v3'), ' ← افتحها ← Enable.'),
      h('li', 'من القائمة: «APIs & Services» ← «Credentials» ← «Create credentials» ← «API key».'),
      h('li', 'انسخ المفتاح (يبدأ بـ AIza) وحطه في: الإعدادات ← «مفتاح يوتيوب» ← «حفظ واختبار».')),
    h('p', 'الحصة المجانية تكفي حوالي 100 بحث في اليوم، وتتجدد يومياً. المفتاح يتخزن في جهازك فقط.'),

    h('h2', '٥) خادم البيت (اختياري — الأكثر ثباتاً)'),
    h('p', 'لو تبي تحميل ثابت 100% وأسرع، تقدر تشغّل «خادم دندنة» على كمبيوتر في البيت. يوتيوب ما يحجب إنترنت البيت.'),
    h('ol',
      h('li', 'ثبّت على الكمبيوتر: ', h('code', 'winget install Python.Python.3.12 Gyan.FFmpeg DenoLand.Deno Cloudflare.cloudflared'), ' (ويندوز) أو ', h('code', 'brew install python ffmpeg deno cloudflared'), ' (ماك).'),
      h('li', 'شغّل ', h('code', 'start.bat'), ' أو ', h('code', './start.sh'), ' من مجلد ', h('code', 'dandana/server'), '، وفي نافذة ثانية:')),
    h('div.code', 'cloudflared tunnel --url http://localhost:8765'),
    h('p', 'انسخ رابط ', h('code', '.trycloudflare.com'), ' وحطه في الإعدادات ← «خادم البيت».'),

    h('h2', '٦) الثيمات'),
    h('p', 'اضغط أيقونة الألوان 🎨 في الرئيسية أو من الإعدادات: 10 ثيمات كاملة (ليل، أسود، طرب، بحر، زمرّد، ورد، بنفسج، غروب، نهار، رمل) أو «تلقائي» حسب وضع الجهاز، مع اختيار لون الأزرار.'),

    h('h2', '٧) ريلز، على ذوقي، والراديو'),
    h('ul',
      h('li', 'ريلز: اسحب لفوق ولتحت. «مكتبتي» تعرض مقاطع من أغانيك وفيديوهاتك، و«يوتيوب» يجيب مقاطع قصيرة لفنانينك المفضلين (يحتاج مفتاح يوتيوب). ضغطتين = مفضلة.'),
      h('li', 'على ذوقي: يحلل الفنانين اللي تسمعهم أكثر واللي حطيتهم مفضلة، ويقترح أغاني جديدة مش موجودة عندك. «شغّل على ذوقي» يشغّل ميكس لا ينتهي.'),
      h('li', 'الراديو: محطات ليبية وعربية وعالمية مباشرة، واضغط ❤️ لحفظ المحطة.')),

    h('h2', '٨) مميزات أخرى'),
    h('ul',
      h('li', 'الكلمات المتزامنة مع الأغنية (زر الميكروفون في المشغّل).'),
      h('li', 'مؤقت النوم، سرعة التشغيل، تكرار وعشوائي ذكي ما يكرر نفس الفنان ورا بعض.'),
      h('li', 'التحكم من شاشة القفل وسماعات البلوتوث.'),
      h('li', 'قوائم تشغيل، قوائم ذكية (الأكثر استماعاً، لم تسمعها بعد…)، وإحصائيات استماعك.'),
      h('li', 'نسخة احتياطية للقوائم والمفضلة من الإعدادات.')),
  ));
}
