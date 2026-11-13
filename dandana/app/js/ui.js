// Shared UI pieces: track rows, menus, playlist picker, editor, importer,
// YouTube action sheet.
import * as lib from './library.js';
import * as api from './api.js';
import * as taste from './taste.js';
import { player } from './player.js';
import { coverEl, storeArt } from './art.js';
import { collect, importAll } from './importer.js';
import {
  h, ic, btn, iconBtn, toast, sheet, actionSheet, confirmDialog, promptDialog, onLongPress,
  fmtTime, fmtCount, songsCount, $,
} from './util.js';

export const go = (hash) => { location.hash = hash; };

export function isCurrentTrack(id) {
  return player.current && player.current.trackId === id;
}

// ---------------------------------------------------------------- rows

export function trackRow(t, { onPlay, num, selectable, selected, onSelect, extra } = {}) {
  const row = h('div.trow', { dataset: { id: t.id } });
  if (selectable) {
    row.classList.toggle('sel', !!selected);
    row.append(h('span.check', ic('check')));
  } else if (num != null) {
    row.append(h('span.num', String(num)));
  }
  row.append(coverEl(t));
  const sub = h('div.s');
  if (isCurrentTrack(t.id)) sub.append(h('span.eq' + (player.playing ? '' : '.paused'), h('i'), h('i'), h('i')));
  if (t.kind === 'video') sub.append(h('span.badge-vid', 'فيديو'));
  if (t.liked) sub.append(h('span.liked', ic('heartf')));
  sub.append(h('span.ellipsis', [t.artist || 'فنان غير معروف', t.duration ? fmtTime(t.duration) : ''].filter(Boolean).join(' · ')));
  row.append(h('div.meta', h('div.t', t.title || t.fileName), sub));
  if (extra) row.append(extra);
  if (!selectable) row.append(iconBtn('more', (e) => { e.stopPropagation(); trackMenu(t); }, 'خيارات', 'sm'));
  row.classList.toggle('playing', isCurrentTrack(t.id));
  row.addEventListener('click', () => {
    if (selectable) { row.classList.toggle('sel'); onSelect && onSelect(t.id, row.classList.contains('sel')); return; }
    onPlay && onPlay(t);
  });
  if (!selectable) onLongPress(row, () => trackMenu(t));
  return row;
}

/** Re-mark the playing row inside a container after track changes. */
export function markPlaying(container) {
  for (const r of container.querySelectorAll('.trow[data-id]')) {
    const on = isCurrentTrack(r.dataset.id);
    r.classList.toggle('playing', on);
    const eq = r.querySelector('.eq');
    if (on && !eq) r.querySelector('.s')?.prepend(h('span.eq', h('i'), h('i'), h('i')));
    if (!on && eq) eq.remove();
    if (eq) eq.classList.toggle('paused', !player.playing);
  }
}

export function tile(t, { onClick, sub, round } = {}) {
  const el = h('div.tile' + (round ? '.artist' : ''), coverEl(t, { size: 'full', cls: round ? 'round' : '' }),
    h('div.t', t.title || t.name), sub != null ? h('div.s', sub) : null);
  el.addEventListener('click', () => onClick && onClick(t));
  if (t.id && lib.tracks.has(t.id)) onLongPress(el, () => trackMenu(t));
  return el;
}

// ---------------------------------------------------------------- menus

export function trackMenu(t) {
  const header = h('div.action-head', coverEl(t), h('div.grow',
    h('div.t.ellipsis', t.title), h('div.s.ellipsis', [t.artist, t.album].filter(Boolean).join(' · ') || '—')));
  actionSheet([
    { icon: 'play', label: 'شغّل الآن', fn: () => player.playTracks([t.id], 0, { context: t.title }) },
    { icon: 'playnext', label: 'شغّل التالي', fn: () => { player.playNext({ type: 'track', id: t.id }); toast('ستُشغَّل بعد الأغنية الحالية'); } },
    { icon: 'queue', label: 'أضف لقائمة الانتظار', fn: () => { player.addToQueue({ type: 'track', id: t.id }); toast('أُضيفت لقائمة الانتظار'); } },
    { icon: 'listplus', label: 'أضف لقائمة تشغيل', fn: () => addToPlaylistSheet([t.id]) },
    { icon: t.liked ? 'heartf' : 'heart', label: t.liked ? 'أزل من المفضلة' : 'أضف للمفضلة', fn: async () => { const on = await lib.toggleLike(t.id); toast(on ? 'أُضيفت للمفضلة ❤️' : 'أُزيلت من المفضلة'); } },
    { icon: 'sparkle', label: 'أغانٍ مشابهة', fn: () => similarSheet(t) },
    t.artist ? { icon: 'user', label: `اذهب إلى ${t.artist}`, fn: () => go('#/artist/' + encodeURIComponent(lib.artistKey(t.artist))) } : null,
    t.album ? { icon: 'disc', label: 'اذهب للألبوم', fn: () => go('#/album/' + encodeURIComponent(lib.albums().find((a) => a.tracks.includes(t))?.key || '')) } : null,
    { icon: 'edit', label: 'عدّل المعلومات', fn: () => editTrack(t) },
    t.ytId ? { icon: 'link', label: 'افتح في يوتيوب', fn: () => window.open(`https://www.youtube.com/watch?v=${t.ytId}`, '_blank') } : null,
    { icon: 'trash', label: 'احذف من المكتبة', danger: true, fn: () => deleteTracksFlow([t.id]) },
  ], { header });
}

export async function deleteTracksFlow(ids) {
  const ok = await confirmDialog(ids.length === 1 ? 'تحذف هذه الأغنية من التطبيق؟' : `تحذف ${songsCount(ids.length)} من التطبيق؟`, { ok: 'احذف', danger: true });
  if (!ok) return false;
  await lib.deleteTracks(ids);
  toast('تم الحذف');
  return true;
}

export function addToPlaylistSheet(ids) {
  sheet((close) => {
    const wrap = h('div.actions');
    wrap.append(h('button.action', {
      onclick: async () => {
        close();
        const name = await promptDialog('قائمة جديدة', { placeholder: 'اسم القائمة' });
        if (!name) return;
        await lib.createPlaylist(name, ids);
        toast(`أُنشئت «${name}»`);
      },
    }, ic('plus'), h('span', 'قائمة جديدة…')));
    const pls = [...lib.playlists.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const p of pls) {
      wrap.append(h('button.action', {
        onclick: async () => {
          close();
          const n = await lib.addToPlaylist(p.id, ids);
          toast(n ? `أُضيفت إلى «${p.name}»` : 'موجودة مسبقاً في القائمة');
        },
      }, ic('queue'), h('span', p.name), h('small', String(p.trackIds.length))));
    }
    return wrap;
  }, { title: 'أضف إلى قائمة' });
}

export function editTrack(t) {
  sheet((close) => {
    const title = h('input.input', { value: t.title || '' });
    const artist = h('input.input', { value: t.artist || '' });
    const album = h('input.input', { value: t.album || '' });
    const lyrics = h('textarea.input', { placeholder: 'الكلمات (اختياري)' });
    lyrics.value = t.lyrics || '';
    const cover = coverEl(t, { size: 'full' });
    cover.style.cssText = 'width:96px;height:96px;border-radius:14px;font-size:34px';
    const picker = h('input', { type: 'file', accept: 'image/*', hidden: true });
    let newArt = null;
    picker.onchange = async () => {
      const f = picker.files[0];
      if (!f) return;
      newArt = await storeArt(f, f.type);
      if (newArt) { cover.replaceWith(coverEl({ ...t, art: newArt }, { size: 'full' })); toast('تم تجهيز الغلاف'); }
    };
    return h('div',
      h('div.row.gap', { style: { marginBottom: '14px' } }, cover, h('div.grow',
        btn('folder', 'غلاف من الصور', () => picker.click(), 'sm'), picker,
        h('p.muted', { style: { fontSize: '12px', marginTop: '6px' } }, 'تقدر تختار أي صورة من ألبوم الصور'))),
      h('label.field', h('span', 'اسم الأغنية'), title),
      h('label.field', h('span', 'الفنان'), artist),
      h('label.field', h('span', 'الألبوم'), album),
      h('label.field', h('span', 'الكلمات'), lyrics),
      h('div.row.gap', { style: { marginTop: '6px' } },
        h('button.btn.primary.wide', {
          onclick: async () => {
            const patch = { title: title.value.trim() || t.title, artist: artist.value.trim(), album: album.value.trim(), lyrics: lyrics.value.trim() || null };
            if (patch.lyrics !== t.lyrics) { patch.lyricsData = null; patch.lyricsChecked = false; }
            if (newArt) patch.art = newArt;
            await lib.updateTrack(t.id, patch);
            close();
            toast('تم الحفظ');
          },
        }, 'حفظ'),
        h('button.btn.ghost.wide', { onclick: close }, 'إلغاء')),
    );
  }, { title: 'تعديل المعلومات' });
}

// ---------------------------------------------------------------- similar

export function similarSheet(t) {
  sheet((close) => {
    const body = h('div', h('div.spinner'));
    (async () => {
      try {
        let rows = [];
        if (api.hasServer()) {
          const items = await taste.ytMix({ ytId: t.ytId, artist: t.artist, title: t.title });
          body.innerHTML = '';
          body.append(h('div.btn-row', btn('play', 'شغّل الميكس', () => {
            close();
            player.playItems(items.map(ytToItem), 0, { context: `ميكس ${t.title}` });
          }, 'primary')));
          rows = items.map((it) => ytRow(it, () => { close(); ytSheet(it); }));
        } else if (t.artist) {
          const items = await taste.artistTop(t.artist, 20);
          body.innerHTML = '';
          body.append(h('p.muted', { style: { fontSize: '13px', marginBottom: '8px' } }, 'مقاطع تجريبية (30 ثانية). اضبط خادم التحميل في الإعدادات لتشغيل الأغاني كاملة وتحميلها.'));
          rows = items.map((r) => recRow(r, () => { close(); player.playItems([{ type: 'preview', url: r.preview, title: r.title, artist: r.artist, cover: r.coverBig || r.cover }]); }));
        } else {
          body.innerHTML = '';
          body.append(h('p.muted', 'أضف اسم الفنان لهذه الأغنية لنقدر نقترح لك أغاني مشابهة.'));
        }
        if (rows.length) body.append(h('div.list', rows));
        else if (!body.querySelector('p')) body.append(h('p.muted', 'لم أجد اقتراحات.'));
      } catch (e) {
        body.innerHTML = '';
        body.append(h('p.muted', e.message || 'تعذّر جلب الاقتراحات'));
      }
    })();
    return body;
  }, { title: `مشابهة لـ ${t.title}` });
}

export function recRow(r, onClick, extra) {
  const row = h('div.trow', coverEl({ title: r.title, cover: r.cover }),
    h('div.meta', h('div.t', r.title), h('div.s', h('span.ellipsis', [r.artist, r.reason].filter(Boolean).join(' · ')))),
    extra || null);
  row.addEventListener('click', onClick);
  return row;
}

// ---------------------------------------------------------------- YouTube

export const ytToItem = (it) => ({ type: 'yt', ytId: it.id, title: it.title, artist: it.channel, thumbnail: it.thumbnail, duration: it.duration });

export function ytRow(it, onClick) {
  const have = lib.findByYt(it.id);
  const row = h('div.yrow',
    h('div.thumb', h('img', { src: it.thumbnail, loading: 'lazy', alt: '' }), it.duration ? h('span.dur', fmtTime(it.duration)) : null),
    h('div.grow',
      h('div.t', it.title),
      h('div.s', [it.channel, it.views ? fmtCount(it.views) + ' مشاهدة' : ''].filter(Boolean).join(' · ')),
      have ? h('div.have', ic('check'), 'في مكتبتك') : null));
  row.addEventListener('click', () => onClick(it));
  onLongPress(row, () => onClick(it));
  return row;
}

/** The "tap a video → options" sheet. */
export function ytSheet(it) {
  const vid = it.id || api.ytId(it.url);
  const thumb = it.thumbnail || (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '');
  sheet((close) => {
    const preview = h('div.preview', h('img', { src: thumb, alt: '' }),
      h('div.playov', h('span', ic('play'))));
    preview.addEventListener('click', () => {
      preview.innerHTML = '';
      player.pause();
      preview.append(h('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&playsinline=1&rel=0`,
        allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true,
      }));
    }, { once: true });
    const dl = (kind, quality, format) => {
      close();
      api.startDownload({ id: vid, url: it.url, title: it.title, channel: it.channel, thumbnail: thumb, kind, quality, format });
      toast('بدأ التحميل — تابعه من «التحميلات»', { action: { label: 'عرض', fn: () => go('#/downloads') } });
    };
    const q = (iconName, title, sub, fn, rec) => h('button.qbtn' + (rec ? '.rec' : ''), { onclick: fn }, ic(iconName), h('div', h('b', title), h('small', sub)));
    const have = lib.findByYt(vid);
    return h('div.ysheet', preview,
      h('h3', it.title || 'مقطع يوتيوب'),
      h('div.ch', [it.channel, it.duration ? fmtTime(it.duration) : ''].filter(Boolean).join(' · ')),
      have ? h('div.banner', ic('check'), h('div', h('b', 'موجودة في مكتبتك'), have.kind === 'video' ? 'كفيديو' : 'كصوت')) : null,
      h('div.qlabel', 'صوت فقط'),
      h('div.qgrid',
        q('note', 'M4A', 'أفضل جودة للآيفون', () => dl('audio', null, 'm4a'), lib.settings.audioFormat === 'm4a'),
        q('note', 'MP3', '192 كيلوبت', () => dl('audio', null, 'mp3'), lib.settings.audioFormat === 'mp3')),
      h('div.qlabel', 'فيديو'),
      h('div.qgrid',
        ['360', '480', '720', '1080'].map((r) => q('video', r + 'p', { 360: 'حجم صغير', 480: 'متوسط', 720: 'HD', 1080: 'Full HD' }[r], () => dl('video', r), lib.settings.videoQuality === r))),
      h('div.actions', { style: { marginTop: '6px' } },
        h('button.action', { onclick: () => { close(); player.playItems([ytToItem(it)], 0, { context: 'يوتيوب' }); } }, ic('play'), h('span', 'شغّل الآن بدون تحميل')),
        h('button.action', { onclick: () => { close(); player.addToQueue(ytToItem(it)); toast('أُضيف لقائمة الانتظار'); } }, ic('queue'), h('span', 'أضف لقائمة الانتظار')),
        h('button.action', { onclick: async () => {
          close();
          try {
            const items = await api.related(vid, 30);
            player.playItems([ytToItem(it), ...items.map(ytToItem)], 0, { context: 'ميكس يوتيوب' });
          } catch (e) { toast(e.message, { error: true }); }
        } }, ic('sparkle'), h('span', 'شغّل ميكس مشابه')),
        h('button.action', { onclick: () => window.open(`https://www.youtube.com/watch?v=${vid}`, '_blank') }, ic('link'), h('span', 'افتح في يوتيوب')),
      ));
  });
}

// ---------------------------------------------------------------- import

export function openImport() {
  const input = $('#file-input');
  input.value = '';
  input.onchange = () => {
    const files = [...input.files];
    if (files.length) runImport(files);
  };
  input.click();
}

export async function runImport(files) {
  const ov = $('#importer');
  ov.classList.remove('hidden');
  ov.innerHTML = '';
  const ctl = new AbortController();
  const R = 50, C = 2 * Math.PI * R;
  const arc = h('circle', {});
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.innerHTML = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="9"/>
    <circle class="arc" cx="60" cy="60" r="${R}" fill="none" stroke="var(--accent)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" style="transition:stroke-dashoffset .3s"/>`;
  void arc;
  const pct = h('b', '0%');
  const title = h('h3', 'جاري تجهيز الملفات…');
  const cur = h('p', '');
  const st = h('div.stats');
  const cancel = h('button.btn.ghost', { onclick: () => ctl.abort() }, 'إيقاف');
  ov.append(h('div.imp', h('div.ring', svg, pct), title, cur, st, cancel));
  let items;
  try {
    items = await collect(files, (s) => { cur.textContent = s; });
  } catch (e) {
    ov.classList.add('hidden');
    toast(e.message || 'تعذّر قراءة الملفات', { error: true });
    return;
  }
  if (!items.length) {
    ov.classList.add('hidden');
    toast('لم أجد ملفات صوت أو فيديو', { error: true });
    return;
  }
  title.textContent = `جاري إضافة ${songsCount(items.length)}`;
  const res = await importAll(items, (p) => {
    const f = p.total ? p.done / p.total : 0;
    svg.querySelector('.arc').setAttribute('stroke-dashoffset', String(C * (1 - f)));
    pct.textContent = `${p.done}/${p.total}`;
    cur.textContent = p.current || '';
    st.innerHTML = '';
    st.append(h('span', 'أُضيف ', h('b', String(p.added))), h('span', 'مكرر ', h('b', String(p.skipped))));
    if (p.failed) st.append(h('span', 'فشل ', h('b', String(p.failed))));
  }, ctl.signal);
  title.textContent = ctl.signal.aborted ? 'تم الإيقاف' : 'اكتمل الاستيراد 🎉';
  cur.textContent = res.errors.length ? res.errors.slice(0, 3).join('\n') : 'أغانيك جاهزة في المكتبة.';
  cancel.textContent = 'تم';
  cancel.className = 'btn primary';
  cancel.onclick = () => { ov.classList.add('hidden'); if (location.hash !== '#/library') go('#/library'); };
}

export function playAllButtons(getIds, context) {
  return h('div.btn-row',
    btn('play', 'تشغيل', () => { const ids = getIds(); if (ids.length) player.playTracks(ids, 0, { context, shuffle: false }); }, 'primary'),
    btn('shuffle', 'عشوائي', () => { const ids = getIds(); if (ids.length) player.playTracks(ids, -1, { context, shuffle: true }); }));
}
