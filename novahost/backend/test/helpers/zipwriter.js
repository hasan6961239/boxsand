import zlib from 'node:zlib';

/**
 * A minimal ZIP writer used only by the test suite.
 *
 * It exists so the tests can build *malicious* archives — path traversal,
 * symlink entries, zip bombs — which is impossible with a normal zip tool. It
 * deliberately lets the caller write an entry name verbatim, without the
 * validation the reader applies.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return ~crc >>> 0;
}

/**
 * @param {Array<{name: string, data?: string|Buffer, directory?: boolean,
 *                deflate?: boolean, symlink?: boolean, crcOverride?: number}>} entries
 * @returns {Buffer}
 */
export function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const isDirectory = entry.directory === true || entry.name.endsWith('/');
    const raw = isDirectory ? Buffer.alloc(0) : Buffer.from(entry.data ?? '', 'utf8');

    const useDeflate = entry.deflate === true && raw.length > 0;
    const stored = useDeflate ? zlib.deflateRawSync(raw, { level: 9 }) : raw;
    const method = useDeflate ? 8 : 0;
    const crc = entry.crcOverride ?? crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x800, 6);        // flags: bit 11 = UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0x21, 12);        // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra length

    localParts.push(local, nameBuf, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    // High byte of "version made by" is the host system: 3 = Unix, which is
    // what makes the external-attribute mode bits meaningful.
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra
    central.writeUInt16LE(0, 32);         // comment
    central.writeUInt16LE(0, 34);         // disk number
    central.writeUInt16LE(0, 36);         // internal attrs

    // External attributes: Unix mode in the top 16 bits.
    // 0xA1FF0000 = S_IFLNK | 0777, 0x81A40000 = regular 0644, dir 0755.
    let externalAttrs;
    if (entry.symlink) externalAttrs = 0xa1ff0000;
    else if (isDirectory) externalAttrs = 0x41ed0000 | 0x10;
    else externalAttrs = 0x81a40000;
    central.writeUInt32LE(externalAttrs >>> 0, 38);
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + stored.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

/** A plausible small website, used as the "happy path" fixture. */
export function buildSampleSite({ prefix = '' } = {}) {
  const p = prefix ? `${prefix}/` : '';
  return buildZip([
    ...(prefix ? [{ name: `${prefix}/`, directory: true }] : []),
    { name: `${p}index.html`, data: '<!doctype html><title>Hello</title><h1>Hello</h1>', deflate: true },
    { name: `${p}about.html`, data: '<!doctype html><title>About</title>', deflate: true },
    { name: `${p}css/`, directory: true },
    { name: `${p}css/style.css`, data: 'body{font-family:system-ui;background:#111;color:#eee}', deflate: true },
    { name: `${p}js/app.js`, data: 'console.log("hello from nova host");', deflate: true },
    { name: `${p}assets/data.json`, data: '{"ok":true}' },
  ]);
}
