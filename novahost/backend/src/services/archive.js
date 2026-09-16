import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { walkDir } from '../util/fsx.js';
import { AppError } from '../http/errors.js';

/**
 * ZIP writer — used to package a backup or export a project for download.
 *
 * Each entry is read fully into memory, deflated, then written. That bounds
 * memory at one file rather than one archive, and it avoids data descriptors,
 * so the output opens in Windows Explorer, macOS Archive Utility and unzip
 * alike. Files above MAX_ENTRY_BYTES are stored uncompressed and streamed
 * instead, so a large asset cannot blow up the heap on a phone.
 */

const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer, seed = 0) {
  let crc = ~seed;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return ~crc >>> 0;
}

/** MS-DOS date/time, which is what the ZIP format stores. */
function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, date: day };
}

function localHeader({ nameBuf, method, crc, compressedSize, size, dos }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6); // UTF-8 names
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(dos.time, 10);
  header.writeUInt16LE(dos.date, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader({ nameBuf, method, crc, compressedSize, size, dos, offset, isDirectory }) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x800, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(dos.time, 12);
  header.writeUInt16LE(dos.date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(nameBuf.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(isDirectory ? 0x41ed0010 : 0x81a40000, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

/** Extensions where deflate costs CPU and saves nothing. */
const ALREADY_COMPRESSED = /\.(png|jpe?g|gif|webp|avif|mp4|webm|mp3|ogg|woff2?|zip|gz|pdf)$/i;

/**
 * Write `entries` into `targetFile` as a ZIP.
 * @param {Array<{name: string, file?: string, data?: Buffer|string}>} entries
 */
export async function writeZipFile(targetFile, entries) {
  const out = fs.createWriteStream(targetFile);
  // Each entry contributes TWO buffers to the central directory: the fixed
  // 46-byte header and the file name that follows it. The entry count is
  // tracked separately for exactly that reason.
  const central = [];
  let entryCount = 0;
  let offset = 0;

  const write = (chunk) => new Promise((resolve, reject) => {
    out.write(chunk, (err) => (err ? reject(err) : resolve()));
  });

  try {
    for (const entry of entries) {
      const name = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
      const nameBuf = Buffer.from(name, 'utf8');
      const isDirectory = name.endsWith('/');

      let stat = null;
      if (entry.file) {
        stat = await fsp.stat(entry.file);
      }
      const dos = dosDateTime(stat ? new Date(stat.mtimeMs) : new Date());

      if (isDirectory) {
        const header = localHeader({ nameBuf, method: 0, crc: 0, compressedSize: 0, size: 0, dos });
        await write(header);
        await write(nameBuf);
        central.push(centralHeader({ nameBuf, method: 0, crc: 0, compressedSize: 0, size: 0, dos, offset, isDirectory: true }), nameBuf);
        entryCount += 1;
        offset += header.length + nameBuf.length;
        continue;
      }

      const size = entry.data !== undefined ? Buffer.byteLength(entry.data) : stat.size;
      const useStreaming = size > MAX_ENTRY_BYTES && entry.file;

      if (useStreaming) {
        // Two passes: checksum first so the header can be written up front,
        // then copy the bytes. Uncompressed, because anything this large is
        // almost certainly media that would not compress anyway.
        let crc = 0;
        for await (const chunk of fs.createReadStream(entry.file)) crc = crc32(chunk, crc);

        const header = localHeader({ nameBuf, method: 0, crc, compressedSize: size, size, dos });
        await write(header);
        await write(nameBuf);
        for await (const chunk of fs.createReadStream(entry.file)) await write(chunk);

        central.push(centralHeader({ nameBuf, method: 0, crc, compressedSize: size, size, dos, offset, isDirectory: false }), nameBuf);
        entryCount += 1;
        offset += header.length + nameBuf.length + size;
        continue;
      }

      const raw = entry.data !== undefined
        ? Buffer.from(entry.data)
        : await fsp.readFile(entry.file);
      const crc = crc32(raw);

      const shouldDeflate = raw.length > 64 && !ALREADY_COMPRESSED.test(name);
      const body = shouldDeflate ? zlib.deflateRawSync(raw, { level: 6 }) : raw;
      const method = shouldDeflate ? 8 : 0;

      const header = localHeader({ nameBuf, method, crc, compressedSize: body.length, size: raw.length, dos });
      await write(header);
      await write(nameBuf);
      await write(body);

      central.push(centralHeader({
        nameBuf, method, crc, compressedSize: body.length, size: raw.length, dos, offset, isDirectory: false,
      }), nameBuf);
      entryCount += 1;
      offset += header.length + nameBuf.length + body.length;
    }

    const centralBuf = Buffer.concat(central);
    await write(centralBuf);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entryCount, 8);
    eocd.writeUInt16LE(entryCount, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    await write(eocd);
  } finally {
    await new Promise((resolve) => out.end(resolve));
  }

  const { size } = await fsp.stat(targetFile);
  return { file: targetFile, size, entries: entryCount };
}

/** Collect a directory tree into entries for writeZipFile. */
export async function entriesFromDirectory(root, prefix = '', { maxFiles = 50_000 } = {}) {
  const found = await walkDir(root, { maxEntries: maxFiles + 1 });
  if (found.length > maxFiles) {
    throw new AppError('TOO_MANY_FILES', `That folder has more than ${maxFiles} files`, { status: 413 });
  }
  const entries = [];
  for (const item of found) {
    if (item.type === 'symlink') continue; // never archive a link
    const name = prefix ? `${prefix}/${item.path}` : item.path;
    if (item.type === 'dir') entries.push({ name: `${name}/` });
    else entries.push({ name, file: path.join(root, item.path) });
  }
  return entries;
}
