// Reads title/artist/album/cover/duration straight from the file bytes:
// ID3v2.2–2.4 + ID3v1 (MP3), MP4 atoms (M4A/MP4), FLAC metadata blocks.
// Arabic MP3s from the 2000s often store Windows-1256 text in frames marked
// as Latin-1 — decodeLegacy() detects and fixes that.

const td = (enc) => { try { return new TextDecoder(enc); } catch { return null; } };
const UTF8 = td('utf-8');
const UTF8_FATAL = (() => { try { return new TextDecoder('utf-8', { fatal: true }); } catch { return null; } })();
const CP1256 = td('windows-1256');
const LATIN1 = td('iso-8859-1') || td('windows-1252');
const UTF16LE = td('utf-16le');
const UTF16BE = td('utf-16be');

function decodeLegacy(bytes) {
  let hi = false;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) { hi = true; break; }
  if (!hi) return String.fromCharCode(...bytes);
  if (UTF8_FATAL) { try { return UTF8_FATAL.decode(bytes); } catch { /* not utf-8 */ } }
  if (CP1256) {
    const s = CP1256.decode(bytes);
    if (/[؀-ۿ]/.test(s)) return s;
  }
  return LATIN1 ? LATIN1.decode(bytes) : String.fromCharCode(...bytes);
}

function clean(s) {
  return (s || '').replace(/\u0000/g, '').replace(/﻿/g, '').replace(/\s+/g, ' ').trim();
}

// Junk that download sites stamp into tags.
const JUNK = /(www\.|https?:|\.com\b|\.net\b|\.org\b|\.info\b|mp3\s*quran|6rb|\bmazika|ringtone|music\s*download|تحميل|حصريا علي|منتديات|\bmp3\b\s*$)/i;
export function sane(s) {
  s = clean(s);
  if (!s) return '';
  if (JUNK.test(s)) {
    const stripped = s.replace(/(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:com|net|org|info|me|tv|co)(?:\/\S*)?/gi, '').replace(/[-|_]{1,}\s*$/g, '').trim();
    return stripped.length >= 2 && !JUNK.test(stripped) ? stripped : '';
  }
  if (/^(unknown|track\s*\d*|untitled|artist|<unknown>|مجهول)$/i.test(s)) return '';
  return s;
}

// ---------------------------------------------------------------- ID3v2

const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

function unsync(b) {
  const out = new Uint8Array(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    out[j++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

function decodeText(enc, b) {
  if (!b.length) return '';
  switch (enc) {
    case 1: {
      if (b[0] === 0xff && b[1] === 0xfe) return UTF16LE.decode(b.subarray(2));
      if (b[0] === 0xfe && b[1] === 0xff) return UTF16BE.decode(b.subarray(2));
      return UTF16LE.decode(b);
    }
    case 2: return UTF16BE.decode(b);
    case 3: return UTF8.decode(b);
    default: return decodeLegacy(b);
  }
}

// Index after a null terminator for the given encoding.
function termEnd(enc, b, start) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return [i, i + 2];
  } else {
    for (let i = start; i < b.length; i++) if (b[i] === 0) return [i, i + 1];
  }
  return [b.length, b.length];
}

function textFrame(b) {
  const enc = b[0];
  const s = decodeText(enc, b.subarray(1));
  return clean(s.split('\u0000').filter(Boolean).join(' / '));
}

function parseID3(b, out) {
  const ver = b[3];
  const flags = b[5];
  let size = syncsafe(b, 6);
  let body = b.subarray(10, 10 + size);
  if (flags & 0x80 && ver < 4) body = unsync(body);
  let pos = 0;
  if (flags & 0x40) {
    const ext = ver === 4 ? syncsafe(body, 0) : be32(body, 0) + 4;
    pos = ext;
  }
  const idLen = ver === 2 ? 3 : 4;
  const hdr = ver === 2 ? 6 : 10;
  while (pos + hdr <= body.length) {
    const id = String.fromCharCode(...body.subarray(pos, pos + idLen));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    let fsize = ver === 2
      ? (body[pos + 3] << 16) | (body[pos + 4] << 8) | body[pos + 5]
      : ver === 4 ? syncsafe(body, pos + 4) : be32(body, pos + 4);
    const fflags = ver >= 3 ? body[pos + 9] : 0;
    let data = body.subarray(pos + hdr, pos + hdr + fsize);
    pos += hdr + fsize;
    if (fsize <= 0) continue;
    if (ver === 4 && fflags & 0x02) data = unsync(data);
    if (ver >= 3 && fflags & 0x0c) continue; // compressed/encrypted
    if (ver === 4 && fflags & 0x01) data = data.subarray(4); // data length indicator
    try {
      switch (id) {
        case 'TIT2': case 'TT2': out.title ||= textFrame(data); break;
        case 'TPE1': case 'TP1': out.artist ||= textFrame(data); break;
        case 'TALB': case 'TAL': out.album ||= textFrame(data); break;
        case 'TPE2': case 'TP2': out.albumArtist ||= textFrame(data); break;
        case 'TCON': case 'TCO': out.genre ||= textFrame(data).replace(/^\((\d+)\)$/, ''); break;
        case 'TYER': case 'TDRC': case 'TYE': out.year ||= textFrame(data).slice(0, 4); break;
        case 'TRCK': case 'TRK': out.trackNo ||= parseInt(textFrame(data), 10) || null; break;
        case 'TLEN': case 'TLE': { const ms = parseInt(textFrame(data), 10); if (ms > 1000) out.duration ||= ms / 1000; break; }
        case 'USLT': case 'ULT': {
          const enc = data[0];
          const [, after] = termEnd(enc, data, 4);
          out.lyrics ||= clean(decodeText(enc, data.subarray(after)).replace(/\r/g, '\n')) || null;
          break;
        }
        case 'APIC': {
          if (out.picture && out._picType === 3) break;
          const enc = data[0];
          let i = 1;
          while (i < data.length && data[i] !== 0) i++;
          const mime = String.fromCharCode(...data.subarray(1, i)) || 'image/jpeg';
          const ptype = data[i + 1];
          const [, after] = termEnd(enc, data, i + 2);
          if (!out.picture || ptype === 3) {
            out.picture = { mime: mime.includes('/') ? mime : 'image/' + mime.toLowerCase(), data: data.slice(after) };
            out._picType = ptype;
          }
          break;
        }
        case 'PIC': {
          if (out.picture) break;
          const enc = data[0];
          const fmt = String.fromCharCode(...data.subarray(1, 4)).toLowerCase();
          const [, after] = termEnd(enc, data, 5);
          out.picture = { mime: fmt === 'png' ? 'image/png' : 'image/jpeg', data: data.slice(after) };
          break;
        }
        default: break;
      }
    } catch { /* malformed frame — keep going */ }
  }
  return 10 + size + (flags & 0x10 ? 10 : 0);
}

function parseID3v1(b, out) {
  if (b[0] !== 0x54 || b[1] !== 0x41 || b[2] !== 0x47) return;
  const f = (s, e) => clean(decodeLegacy(b.subarray(s, e)).split('\u0000')[0]);
  out.title ||= f(3, 33);
  out.artist ||= f(33, 63);
  out.album ||= f(63, 93);
}

// MP3 duration without decoding: Xing/Info/VBRI frame count, else CBR estimate.
const BR = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mp3Duration(b, offset, fileSize) {
  for (let i = offset; i < Math.min(b.length - 4, offset + 64 * 1024); i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const verBits = (b[i + 1] >> 3) & 3; // 3=V1, 2=V2, 0=V2.5
    const layer = (b[i + 1] >> 1) & 3; // 1 = Layer III
    if (verBits === 1 || layer !== 1) continue;
    const brIdx = b[i + 2] >> 4, srIdx = (b[i + 2] >> 2) & 3;
    if (brIdx === 0 || brIdx === 15 || srIdx === 3) continue;
    const sr = SR[verBits][srIdx];
    const kbps = BR[verBits === 3 ? 1 : 2][brIdx];
    const mono = (b[i + 3] >> 6) === 3;
    const spf = verBits === 3 ? 1152 : 576;
    const sideInfo = verBits === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const x = i + 4 + sideInfo;
    const tag = String.fromCharCode(b[x], b[x + 1], b[x + 2], b[x + 3]);
    if ((tag === 'Xing' || tag === 'Info') && b[x + 7] & 1) {
      const frames = be32(b, x + 8);
      if (frames) return (frames * spf) / sr;
    }
    const v = i + 36;
    if (String.fromCharCode(b[v], b[v + 1], b[v + 2], b[v + 3]) === 'VBRI') {
      const frames = be32(b, v + 14);
      if (frames) return (frames * spf) / sr;
    }
    return ((fileSize - i) * 8) / (kbps * 1000);
  }
  return null;
}

// ---------------------------------------------------------------- MP4

async function readAtomHeaders(blob, start, end) {
  const atoms = [];
  let pos = start;
  while (pos + 8 <= end && atoms.length < 64) {
    const h = new Uint8Array(await blob.slice(pos, pos + 16).arrayBuffer());
    let size = be32(h, 0);
    const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
    let hdr = 8;
    if (size === 1) { size = be32(h, 8) * 4294967296 + be32(h, 12); hdr = 16; }
    else if (size === 0) size = end - pos;
    if (size < 8) break;
    atoms.push({ type, pos, size, hdr });
    pos += size;
  }
  return atoms;
}

function childAtoms(b, start, end) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = be32(b, pos);
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    let hdr = 8;
    if (size === 1) { size = be32(b, pos + 8) * 4294967296 + be32(b, pos + 12); hdr = 16; }
    else if (size === 0) size = end - pos;
    if (size < 8 || pos + size > end) break;
    out.push({ type, start: pos + hdr, end: pos + size });
    pos += size;
  }
  return out;
}

async function parseMP4(blob, out) {
  const top = await readAtomHeaders(blob, 0, blob.size);
  const moov = top.find((a) => a.type === 'moov');
  if (!moov || moov.size > 64 * 1024 * 1024) return;
  const b = new Uint8Array(await blob.slice(moov.pos, moov.pos + moov.size).arrayBuffer());
  const kids = childAtoms(b, moov.hdr, b.length);
  let hasVideo = false;
  for (const k of kids) {
    if (k.type === 'mvhd') {
      const v = b[k.start];
      const ts = v === 1 ? be32(b, k.start + 20) : be32(b, k.start + 12);
      const dur = v === 1 ? be32(b, k.start + 24) * 4294967296 + be32(b, k.start + 28) : be32(b, k.start + 16);
      if (ts) out.duration ||= dur / ts;
    } else if (k.type === 'trak') {
      const mdia = childAtoms(b, k.start, k.end).find((x) => x.type === 'mdia');
      if (mdia) {
        const hdlr = childAtoms(b, mdia.start, mdia.end).find((x) => x.type === 'hdlr');
        if (hdlr && String.fromCharCode(...b.subarray(hdlr.start + 8, hdlr.start + 12)) === 'vide') {
          const tkhd = childAtoms(b, k.start, k.end).find((x) => x.type === 'tkhd');
          let w = 0, h_ = 0;
          if (tkhd) {
            const off = b[tkhd.start] === 1 ? 88 : 76;
            w = be32(b, tkhd.start + off) / 65536; h_ = be32(b, tkhd.start + off + 4) / 65536;
          }
          if (w > 16 && h_ > 16) { hasVideo = true; out.width = w; out.height = h_; }
        }
      }
    } else if (k.type === 'udta') {
      const meta = childAtoms(b, k.start, k.end).find((x) => x.type === 'meta');
      if (!meta) continue;
      const ilst = childAtoms(b, meta.start + 4, meta.end).find((x) => x.type === 'ilst');
      if (!ilst) continue;
      for (const item of childAtoms(b, ilst.start, ilst.end)) {
        const data = childAtoms(b, item.start, item.end).find((x) => x.type === 'data');
        if (!data) continue;
        const kind = be32(b, data.start) & 0xffffff;
        const val = b.subarray(data.start + 8, data.end);
        const str = () => clean(UTF8.decode(val));
        switch (item.type) {
          case '©nam': out.title ||= str(); break;
          case '©ART': out.artist ||= str(); break;
          case '©alb': out.album ||= str(); break;
          case 'aART': out.albumArtist ||= str(); break;
          case '©gen': out.genre ||= str(); break;
          case '©day': out.year ||= str().slice(0, 4); break;
          case '©lyr': out.lyrics ||= str() || null; break;
          case 'covr': if (!out.picture) out.picture = { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: val.slice() }; break;
          default: break;
        }
      }
    }
  }
  out.hasVideo = hasVideo;
}

// ---------------------------------------------------------------- FLAC

async function parseFLAC(blob, out) {
  let pos = 4;
  for (let n = 0; n < 32; n++) {
    const h = new Uint8Array(await blob.slice(pos, pos + 4).arrayBuffer());
    if (h.length < 4) break;
    const last = h[0] & 0x80, type = h[0] & 0x7f;
    const len = (h[1] << 16) | (h[2] << 8) | h[3];
    if (type === 0 || type === 4 || type === 6) {
      const b = new Uint8Array(await blob.slice(pos + 4, pos + 4 + len).arrayBuffer());
      const dv = new DataView(b.buffer);
      if (type === 0) {
        const sr = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
        const total = (b[13] & 0x0f) * 4294967296 + be32(b, 14);
        if (sr) out.duration ||= total / sr;
      } else if (type === 4) {
        let p = 0;
        const vlen = dv.getUint32(p, true); p += 4 + vlen;
        const count = dv.getUint32(p, true); p += 4;
        for (let i = 0; i < count && p < b.length; i++) {
          const l = dv.getUint32(p, true); p += 4;
          const s = UTF8.decode(b.subarray(p, p + l)); p += l;
          const eq = s.indexOf('=');
          const k = s.slice(0, eq).toUpperCase(), v = clean(s.slice(eq + 1));
          if (k === 'TITLE') out.title ||= v;
          else if (k === 'ARTIST') out.artist ||= v;
          else if (k === 'ALBUM') out.album ||= v;
          else if (k === 'ALBUMARTIST') out.albumArtist ||= v;
          else if (k === 'LYRICS' || k === 'UNSYNCEDLYRICS') out.lyrics ||= v;
          else if (k === 'GENRE') out.genre ||= v;
        }
      } else if (type === 6 && !out.picture) {
        let p = 4;
        const ml = be32(b, p); p += 4;
        const mime = UTF8.decode(b.subarray(p, p + ml)); p += ml;
        const dl = be32(b, p); p += 4 + dl + 16;
        const plen = be32(b, p); p += 4;
        out.picture = { mime: mime || 'image/jpeg', data: b.slice(p, p + plen) };
      }
    }
    pos += 4 + len;
    if (last) break;
  }
}

// ---------------------------------------------------------------- entry

export async function readTags(blob, fileName = '') {
  const out = {};
  try {
    const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
    const sig = String.fromCharCode(...head.subarray(0, 4));
    const sig8 = String.fromCharCode(...head.subarray(4, 8));
    if (sig.startsWith('ID3')) {
      const size = syncsafe(head, 6) + 10;
      const cap = Math.min(size + 64 * 1024, 24 * 1024 * 1024, blob.size);
      const b = new Uint8Array(await blob.slice(0, cap).arrayBuffer());
      const end = parseID3(b, out);
      if (/\.mp3$/i.test(fileName) || blob.type === 'audio/mpeg' || !blob.type) {
        const fb = end + 4096 <= b.length ? b : new Uint8Array(await blob.slice(0, end + 65536).arrayBuffer());
        out.duration ||= mp3Duration(fb, end, blob.size);
      }
      // FLAC files occasionally carry an ID3 prefix
      if (String.fromCharCode(...b.subarray(end, end + 4)) === 'fLaC') await parseFLAC(blob.slice(end), out);
    } else if (['ftyp', 'moov', 'wide', 'free', 'mdat'].includes(sig8)) {
      await parseMP4(blob, out);
    } else if (sig === 'fLaC') {
      await parseFLAC(blob, out);
    } else if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
      const b = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
      out.duration ||= mp3Duration(b, 0, blob.size);
    } else if (sig === 'RIFF') {
      const b = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
      const dv = new DataView(b.buffer);
      let p = 12, byteRate = 0;
      while (p + 8 < b.length) {
        const id = String.fromCharCode(...b.subarray(p, p + 4));
        const sz = dv.getUint32(p + 4, true);
        if (id === 'fmt ') byteRate = dv.getUint32(p + 16, true);
        if (id === 'data' && byteRate) { out.duration = sz / byteRate; break; }
        p += 8 + sz + (sz & 1);
      }
    }
    if (!out.title && blob.size > 128 && /\.mp3$/i.test(fileName)) {
      const tail = new Uint8Array(await blob.slice(blob.size - 128).arrayBuffer());
      parseID3v1(tail, out);
    }
  } catch (e) {
    console.warn('tags', fileName, e);
  }
  out.title = sane(out.title);
  out.artist = sane(out.artist);
  out.album = sane(out.album);
  out.albumArtist = sane(out.albumArtist);
  if (out.duration && !(out.duration > 0 && out.duration < 86400)) out.duration = null;
  delete out._picType;
  return out;
}

// ---------------------------------------------------------------- names

const NOISE = [
  /\((?:[^)]*?(?:official|video|audio|lyric|lyrics|clip|hd|hq|4k|1080p|720p|kbps|mp3|remaster(?:ed)?|visuali[sz]er|exclusive)[^)]*)\)/gi,
  /\[(?:[^\]]*?(?:official|video|audio|lyric|lyrics|clip|hd|hq|4k|1080p|720p|kbps|mp3|remaster(?:ed)?|exclusive)[^\]]*)\]/gi,
  /[(\[](?:[^)\]]*?(?:كليب|فيديو|حصري|حصريا|حصرياً|اوديو|أوديو|كلمات|بالكلمات|جودة عالية|نسخة أصلية|نسخه اصليه|اغنية|أغنية)[^)\]]*)[)\]]/g,
  /\b(?:official\s+(?:music\s+)?video|official\s+audio|official\s+lyric\s+video|lyric\s+video|music\s+video|full\s+hd|hd\s+version)\b/gi,
  /(?:^|\s)(?:كليب|حصريا|حصرياً|فيديو كليب|بالكلمات)(?=\s|$)/g,
  /#\S+/g,
  /\b\d{2,3}\s?k(?:bps)?\b/gi,
  /(?:^|\s)(?:حالات\s*(?:واتس|واتساب|وتس)(?:\s*اب)?|ستوري|ستوريات|شاشه سوداء|شاشة سوداء|تصميم)(?=\s|$)/g,
  /[(\[]\s*[)\]]/g,
];

export function stripNoise(s) {
  let t = s || '';
  for (const re of NOISE) t = t.replace(re, ' ');
  return t.replace(/[\s\-–—|_:]+$/g, '').replace(/^[\s\-–—|_:]+/g, '').replace(/\s{2,}/g, ' ').trim();
}

export function parseFileName(name, knownArtists = null) {
  let base = name.replace(/^.*[\\/]/, '').replace(/\.[^.]{2,5}$/, '');
  base = base.replace(/(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:com|net|org|info|me|tv|co)\b/gi, ' ');
  base = base.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  base = stripNoise(base);
  base = base.replace(/^\s*(?:\d{1,3}|[٠-٩]{1,3})\s*[-.)_\s]\s*(?=\D)/, '');
  const parts = base.split(/\s+[-–—]\s+|\s*[-–—]{2,}\s*|\s+\|\s+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) {
    let artist = parts[0], title = parts.slice(1).join(' - ');
    if (knownArtists) {
      const isA = (s) => knownArtists.has(normLite(s));
      if (!isA(artist) && isA(parts[parts.length - 1])) {
        artist = parts[parts.length - 1];
        title = parts.slice(0, -1).join(' - ');
      }
    }
    return { artist: sane(artist), title: sane(title) || base };
  }
  return { artist: '', title: base || name };
}

export function normLite(s) {
  return (s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
}

/** "Amr Diab - Tamally Maak | Official Video | عمرو دياب - تملي معاك" → Arabic artist/title. */
export function cleanYouTubeTitle(title, channel = '', meta = {}) {
  if (meta.track && meta.artist) return { title: meta.track, artist: meta.artist.split(',')[0].trim() };
  const t = (title || '').replace(/@/g, '').replace(/[｜]/g, '|');
  const segs = t.split(/\s*\|\s*/).map(stripNoise).filter(Boolean);
  const dash = /\s[-–—]\s/;
  const pick = segs.find((s) => /[؀-ۿ]/.test(s) && dash.test(s)) || segs.find((s) => dash.test(s)) ||
    segs.find((s) => /[؀-ۿ]/.test(s)) || segs[0] || t;
  const parts = pick.split(dash).map((x) => stripNoise(x)).filter(Boolean);
  if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(' - ') };
  return { artist: cleanChannel(meta.artist || channel), title: stripNoise(pick) || title };
}

export function cleanChannel(c) {
  return (c || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\b(official|music|channel|tv|records?)\b/gi, '')
    .replace(/(?:^|\s)(?:قناة|الرسمية|الرسميه)(?=\s|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
