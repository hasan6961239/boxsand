// Streaming ZIP reader over a File/Blob: reads only the central directory up
// front, then slices each entry on demand — so a 3 GB archive made with the
// iPhone Files app ("Compress") never has to fit in memory. Supports ZIP64.

const cp1256 = (() => { try { return new TextDecoder('windows-1256'); } catch { return null; } })();
const utf8f = (() => { try { return new TextDecoder('utf-8', { fatal: true }); } catch { return null; } })();
const utf8 = new TextDecoder('utf-8');

function decodeName(bytes, isUtf8) {
  if (isUtf8) return utf8.decode(bytes);
  try { return utf8f ? utf8f.decode(bytes) : utf8.decode(bytes); } catch { /* fall through */ }
  return cp1256 ? cp1256.decode(bytes) : utf8.decode(bytes);
}

const u64 = (dv, o) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296;

export async function listZip(file) {
  const tailLen = Math.min(file.size, 65557);
  const tailBuf = await file.slice(file.size - tailLen).arrayBuffer();
  const tail = new DataView(tailBuf);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('الملف ليس أرشيف ZIP صالحاً');
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOff = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tail.getUint32(loc, true) === 0x07064b50) {
      const z64off = u64(tail, loc + 8);
      const z = new DataView(await file.slice(z64off, z64off + 56).arrayBuffer());
      if (z.getUint32(0, true) === 0x06064b50) {
        count = u64(z, 32); cdSize = u64(z, 40); cdOff = u64(z, 48);
      }
    }
  }
  const cdBuf = await file.slice(cdOff, cdOff + cdSize).arrayBuffer();
  const cd = new DataView(cdBuf);
  const bytes = new Uint8Array(cdBuf);
  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cdSize; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    let comp = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true);
    const xlen = cd.getUint16(p + 30, true);
    const clen = cd.getUint16(p + 32, true);
    let off = cd.getUint32(p + 42, true);
    const name = decodeName(bytes.subarray(p + 46, p + 46 + nlen), flags & 0x800);
    let x = p + 46 + nlen;
    const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = cd.getUint16(x, true), sz = cd.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
        if (comp === 0xffffffff) { comp = u64(cd, q); q += 8; }
        if (off === 0xffffffff) { off = u64(cd, q); q += 8; }
      }
      x += 4 + sz;
    }
    p = xend + clen;
    if (name.endsWith('/') || flags & 1) continue; // folders, encrypted
    if (/(^|\/)(__MACOSX|\.)/.test(name)) continue; // macOS resource forks, dotfiles
    entries.push({ name, size, comp, method, off });
  }
  return entries;
}

export async function entryBlob(file, e, type = '') {
  const lh = new DataView(await file.slice(e.off, e.off + 30).arrayBuffer());
  if (lh.getUint32(0, true) !== 0x04034b50) throw new Error('ترويسة تالفة داخل الأرشيف');
  const start = e.off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
  const raw = file.slice(start, start + e.comp, type);
  if (e.method === 0) return raw;
  if (e.method === 8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('هذا الجهاز لا يدعم فك ضغط ZIP — حدّث iOS');
    const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return new Blob([buf], { type });
  }
  throw new Error('طريقة ضغط غير مدعومة');
}
