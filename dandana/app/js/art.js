// Cover art: resize once on import (512px + 160px thumb), dedupe identical
// covers across an album, hand out cached object URLs.
import * as db from './db.js';
import { hash, h, placeholderArt, lazyObserve } from './util.js';

const urls = new Map();

async function decode(blob) {
  if (self.createImageBitmap) {
    try { return await createImageBitmap(blob); } catch { /* fall back */ }
  }
  return new Promise((res, rej) => {
    const img = new Image();
    const u = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(u); res(img); };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('img')); };
    img.src = u;
  });
}

function resize(img, max, quality = 0.82) {
  const w = img.width, hh = img.height;
  const s = Math.min(1, max / Math.max(w, hh));
  // square-crop thumbnails; keep aspect for the full size
  const c = document.createElement('canvas');
  if (max <= 200) {
    const side = Math.min(w, hh);
    c.width = c.height = Math.round(Math.min(max, side));
    c.getContext('2d').drawImage(img, (w - side) / 2, (hh - side) / 2, side, side, 0, 0, c.width, c.height);
  } else {
    c.width = Math.round(w * s); c.height = Math.round(hh * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  }
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', quality));
}

function fingerprint(bytes) {
  let s = bytes.length + ':';
  const step = Math.max(1, Math.floor(bytes.length / 2048));
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(bytes[i]);
  return 'a' + hash(s).toString(36) + bytes.length.toString(36);
}

/** Store an image (Uint8Array or Blob) → art id, or null. */
export async function storeArt(input, mime = 'image/jpeg') {
  try {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
    if (bytes.length < 200) return null;
    const id = fingerprint(bytes);
    if (await db.get('art', id)) return id;
    const img = await decode(new Blob([bytes], { type: mime }));
    const [full, thumb] = await Promise.all([resize(img, 600), resize(img, 160)]);
    if (img.close) img.close();
    if (!full || !thumb) return null;
    await db.put('art', { id, full, thumb });
    return id;
  } catch (e) {
    console.warn('art', e);
    return null;
  }
}

export async function artURL(id, size = 'thumb') {
  if (!id) return null;
  const k = id + ':' + size;
  if (urls.has(k)) return urls.get(k);
  const rec = await db.get('art', id);
  if (!rec) return null;
  const u = URL.createObjectURL(rec[size] || rec.full);
  urls.set(k, u);
  return u;
}

/** Grab a frame from a video blob as a cover. Muted video may load without a gesture. */
export function videoFrame(blob, at = 0.15) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('playsinline', '');
    const u = URL.createObjectURL(blob);
    let settled = false;
    const finish = (val) => {
      if (settled) return; settled = true;
      clearTimeout(timer);
      v.removeAttribute('src'); v.load();
      URL.revokeObjectURL(u);
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), 6000);
    v.onloadedmetadata = () => {
      const d = isFinite(v.duration) ? v.duration : 0;
      try { v.currentTime = Math.min(d * at, 30) || 0.5; } catch { finish(null); }
    };
    v.onseeked = () => {
      try {
        const c = document.createElement('canvas');
        const s = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
        c.width = Math.round(v.videoWidth * s) || 320; c.height = Math.round(v.videoHeight * s) || 180;
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => finish(b ? { blob: b, duration: v.duration, width: v.videoWidth, height: v.videoHeight } : null), 'image/jpeg', 0.8);
      } catch { finish(null); }
    };
    v.onerror = () => finish(null);
    v.src = u;
  });
}

/** Average color of a cover, darkened — used to tint the player. */
export async function dominantColor(url) {
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      const wgt = 1 + (mx - mn) / 40; // favour saturated pixels
      r += d[i] * wgt; g += d[i + 1] * wgt; b += d[i + 2] * wgt; n += wgt;
    }
    return [r / n, g / n, b / n].map((v) => Math.round(v));
  } catch {
    return null;
  }
}

/** A cover element (img when art exists, gradient + glyph otherwise). */
export function coverEl(t, { size = 'thumb', cls = '', eager = false } = {}) {
  const el = h('div.cover' + (cls ? '.' + cls : ''));
  const seed = (t && (t.album || t.title || t.name)) || 'x';
  el.style.background = placeholderArt(seed);
  const letter = ((t && (t.title || t.name)) || '♪').trim().charAt(0);
  el.append(h('span.cover-letter', letter));
  const artId = t && (t.art || t.artId);
  const remote = t && (t.artUrl || t.thumbnail || t.cover);
  const setImg = (u) => {
    if (!u) return;
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', draggable: false });
    img.onload = () => el.classList.add('has-img');
    img.onerror = () => img.remove();
    img.src = u;
    el.append(img);
  };
  if (artId) {
    if (eager) artURL(artId, size).then(setImg);
    else lazyObserve(el, () => artURL(artId, size).then(setImg));
  } else if (remote) setImg(remote);
  return el;
}
