// Import pipeline: files / ZIP archives → tags + cover + duration → IndexedDB.
import * as db from './db.js';
import * as lib from './library.js';
import { readTags, parseFileName, normLite, sane } from './tags.js';
import { listZip, entryBlob } from './zip.js';
import { storeArt, videoFrame } from './art.js';
import { uid } from './util.js';

const AUDIO = /\.(mp3|m4a|aac|wav|flac|aif|aiff|caf|alac|m4b|opus|ogg|oga|amr)$/i;
const VIDEO = /\.(mp4|m4v|mov|webm|mkv|3gp)$/i;
const MIME = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac',
  aif: 'audio/aiff', aiff: 'audio/aiff', caf: 'audio/x-caf', opus: 'audio/ogg', ogg: 'audio/ogg', oga: 'audio/ogg', amr: 'audio/amr',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp',
};

const ext = (n) => (n.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
export const isMediaName = (n) => AUDIO.test(n) || VIDEO.test(n);

/** Expand a FileList (with ZIPs) into import items. */
export async function collect(files, onStatus) {
  const items = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
      onStatus && onStatus(`جاري قراءة الأرشيف ${f.name}…`);
      const entries = await listZip(f);
      for (const e of entries) {
        if (!isMediaName(e.name)) continue;
        const parts = e.name.split('/');
        const name = parts.pop();
        items.push({
          name, size: e.size, folder: parts.pop() || '',
          get: () => entryBlob(f, e, MIME[ext(name)] || ''),
        });
      }
    } else if (isMediaName(f.name) || /^(audio|video)\//.test(f.type)) {
      items.push({ name: f.name, size: f.size, folder: '', type: f.type, get: async () => f });
    }
  }
  return items;
}

/** Copy a picked file into a Blob the database owns (iOS file handles can go stale). */
async function ownBlob(blob, type) {
  if (blob.size <= 300 * 1024 * 1024) {
    return new Blob([await blob.arrayBuffer()], { type });
  }
  return blob.slice(0, blob.size, type);
}

let probeBroken = 0;
function probe(blob, video) {
  if (probeBroken >= 3) return Promise.resolve(null);
  return new Promise((resolve) => {
    const el = document.createElement(video ? 'video' : 'audio');
    el.preload = 'metadata'; el.muted = true;
    const u = URL.createObjectURL(blob);
    const done = (v) => {
      clearTimeout(t); el.removeAttribute('src'); el.load(); URL.revokeObjectURL(u);
      if (v == null) probeBroken++; else probeBroken = 0;
      resolve(v);
    };
    const t = setTimeout(() => done(null), 2500);
    el.onloadedmetadata = () => done(isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    el.src = u;
  });
}

/**
 * Import one item. Returns {track} or {skipped:'dup'|'error', error}.
 * extra: metadata overrides (YouTube downloads pass source/ytId/title/artist).
 */
export async function importOne(item, extra = {}, knownArtists = null) {
  if (!extra.force) {
    const dup = lib.findDuplicate(item.name, item.size);
    if (dup) return { skipped: 'dup', track: dup };
  }
  const e = ext(item.name);
  const mime = item.type || MIME[e] || '';
  let blob = await item.get();
  blob = await ownBlob(blob, mime || blob.type);
  const tags = await readTags(blob, item.name);
  let kind = VIDEO.test(item.name) || /^video\//.test(mime) ? 'video' : 'audio';
  if (kind === 'video' && tags.hasVideo === false && e !== 'webm' && e !== 'mkv') kind = 'audio';

  const fromName = parseFileName(item.name, knownArtists);
  const title = extra.title || tags.title || fromName.title;
  const artist = extra.artist ?? (tags.artist || fromName.artist || '');
  const genericFolder = /^(music|songs|audio|mp3|my music|اغاني|أغاني|اغانيي|أغانيي|موسيقى)$/i.test(item.folder || '');
  const album = extra.album || tags.album || (item.folder && !genericFolder && item.folder !== artist ? sane(item.folder) : '');

  let duration = tags.duration || extra.duration || null;
  let width = tags.width || extra.width || null, height = tags.height || extra.height || null;
  let artId = null;
  if (tags.picture) artId = await storeArt(tags.picture.data, tags.picture.mime);
  if (!artId && extra.artBlob) artId = await storeArt(extra.artBlob);
  if (kind === 'video' && (!artId || !duration)) {
    const fr = await videoFrame(blob);
    if (fr) {
      if (!artId) artId = await storeArt(fr.blob);
      duration ||= isFinite(fr.duration) ? fr.duration : null;
      width ||= fr.width; height ||= fr.height;
    }
  }
  if (!duration) duration = await probe(blob, kind === 'video');

  const id = uid();
  const track = {
    id, title: title || item.name, artist: artist || '', album: album || '', albumArtist: tags.albumArtist || '',
    genre: tags.genre || '', year: tags.year || '', trackNo: tags.trackNo || null,
    duration, kind, mime: mime || blob.type, size: item.size, fileName: item.name,
    width, height, art: artId, lyrics: tags.lyrics || null,
    addedAt: Date.now(), plays: 0, skips: 0, liked: false,
    source: extra.source || 'file', ytId: extra.ytId || null,
  };
  await db.putAtomic([['media', { id, blob }], ['tracks', track]]);
  track._n = lib.searchKey(track);
  lib.tracks.set(id, track);
  return { track };
}

/**
 * Bulk import with progress. onProgress({done,total,added,skipped,failed,current}).
 */
export async function importAll(items, onProgress, signal) {
  const known = new Set(lib.list().map((t) => normLite(t.artist)).filter(Boolean));
  const res = { total: items.length, done: 0, added: 0, skipped: 0, failed: 0, errors: [] };
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  for (const item of items) {
    if (signal && signal.aborted) break;
    onProgress && onProgress({ ...res, current: item.name });
    try {
      const r = await importOne(item, {}, known);
      if (r.skipped === 'dup') res.skipped++;
      else { res.added++; if (r.track.artist) known.add(normLite(r.track.artist)); }
    } catch (e) {
      console.error('import', item.name, e);
      res.failed++;
      res.errors.push(`${item.name}: ${e.message || e}`);
      if (e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message))) {
        res.errors.push('امتلأت مساحة التخزين المسموحة للتطبيق.');
        break;
      }
    }
    res.done++;
    if (res.done % 10 === 0) lib.emit('tracks');
  }
  lib.emit('tracks');
  onProgress && onProgress({ ...res, current: '' });
  return res;
}
