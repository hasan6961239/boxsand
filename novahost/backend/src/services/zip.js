import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../http/errors.js';
import { ensureDir, safeJoin } from '../util/fsx.js';

/**
 * A ZIP reader written for this project rather than pulled from npm.
 *
 * The reason is control. Extracting an archive someone uploaded is the single
 * most dangerous operation the platform performs, and the defences that matter
 * are the ones a general-purpose library leaves to the caller: total
 * uncompressed size, entry count, compression ratio, per-file size, symlink
 * entries and path escapes. Here they are enforced in one place, before a byte
 * is written, and every rejection produces a message that names the actual
 * limit that was hit.
 *
 * Format references: PKWARE APPNOTE 6.3.x, sections 4.3.6 (local header),
 * 4.3.12 (central directory) and 4.3.16 (end of central directory).
 */

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Uncompressed bytes we are willing to hold in memory while scanning. */
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;

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

function zipError(code, message) {
  return new AppError(code, message, { status: 422 });
}

async function readRange(handle, start, length) {
  if (length <= 0) return Buffer.alloc(0);
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, start);
  return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
}

/**
 * Validate an entry name from the archive.
 * Returns the cleaned relative path, or throws with the specific reason.
 */
export function validateEntryName(rawName) {
  const name = String(rawName);

  if (name.length === 0) throw zipError('ZIP_INVALID_ENTRY', 'The archive contains an entry with no name');
  if (name.length > 1024) throw zipError('ZIP_NAME_TOO_LONG', `Path is too long: ${name.slice(0, 80)}…`);

  // A NUL can truncate a path at the syscall boundary while looking innocent in
  // any log or UI that displays it.
  if (name.includes('\0')) throw zipError('ZIP_INVALID_ENTRY', 'The archive contains a file name with a null byte');

  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw zipError('ZIP_INVALID_ENTRY', `Control character in file name: ${JSON.stringify(name.slice(0, 60))}`);
    }
  }

  // The ZIP spec mandates forward slashes. A backslash is either a Windows
  // separator smuggled in, or a literal backslash in a file name — both are
  // refused rather than guessed at.
  if (name.includes('\\')) {
    throw zipError('ZIP_INVALID_ENTRY', `Backslash in path is not allowed: ${name.slice(0, 80)}`);
  }
  if (/^[a-zA-Z]:/.test(name)) {
    throw zipError('ZIP_PATH_TRAVERSAL', `Absolute Windows path is not allowed: ${name.slice(0, 80)}`);
  }
  if (name.startsWith('/')) {
    throw zipError('ZIP_PATH_TRAVERSAL', `Absolute path is not allowed: ${name.slice(0, 80)}`);
  }

  const isDirectory = name.endsWith('/');
  const segments = name.split('/').filter((s) => s.length > 0);

  for (const segment of segments) {
    if (segment === '..') {
      throw zipError('ZIP_PATH_TRAVERSAL', `Path escapes the project folder: ${name.slice(0, 80)}`);
    }
    if (segment === '.') continue;
    if (segment.length > 255) {
      throw zipError('ZIP_NAME_TOO_LONG', `File name segment is too long: ${segment.slice(0, 60)}…`);
    }
    // Reserved device names on Windows. Harmless on Android, but a project
    // downloaded and opened on the laptop should not be a minefield.
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(segment)) {
      throw zipError('ZIP_RESERVED_NAME', `Reserved file name: ${segment}`);
    }
  }

  const cleaned = segments.filter((s) => s !== '.').join('/');
  if (cleaned.length === 0 && !isDirectory) {
    throw zipError('ZIP_INVALID_ENTRY', 'The archive contains an entry with an empty path');
  }
  return { path: cleaned, isDirectory };
}

/** Unix file type bits live in the top 16 of external_attributes when host==3. */
function isSymlinkEntry(versionMadeBy, externalAttributes) {
  const hostSystem = (versionMadeBy >> 8) & 0xff;
  if (hostSystem !== 3) return false; // 3 = Unix
  const mode = (externalAttributes >>> 16) & 0xffff;
  return (mode & 0xf000) === 0xa000; // S_IFLNK
}

async function findEndOfCentralDirectory(handle, fileSize) {
  const scanLength = Math.min(fileSize, EOCD_SIZE + MAX_COMMENT);
  const start = fileSize - scanLength;
  const buffer = await readRange(handle, start, scanLength);

  for (let i = buffer.length - EOCD_SIZE; i >= 0; i--) {
    if (buffer.readUInt32LE(i) !== SIG_EOCD) continue;
    const commentLength = buffer.readUInt16LE(i + 20);
    // A valid EOCD is the last record in the file; the comment must run to the end.
    if (i + EOCD_SIZE + commentLength !== buffer.length) continue;
    return {
      absoluteOffset: start + i,
      entryCount: buffer.readUInt16LE(i + 10),
      centralDirSize: buffer.readUInt32LE(i + 12),
      centralDirOffset: buffer.readUInt32LE(i + 16),
      bufferStart: start,
      buffer,
      localIndex: i,
    };
  }
  return null;
}

/**
 * Resolve the ZIP64 records when any EOCD field is saturated.
 * Files above 4 GB or with more than 65535 entries are far outside what this
 * platform accepts anyway, but reading the real values means we reject them
 * with an honest message instead of extracting a truncated archive.
 */
async function readZip64(handle, eocd) {
  const locatorOffset = eocd.absoluteOffset - 20;
  if (locatorOffset < 0) return null;
  const locator = await readRange(handle, locatorOffset, 20);
  if (locator.length !== 20 || locator.readUInt32LE(0) !== SIG_EOCD64_LOCATOR) return null;

  const eocd64Offset = Number(locator.readBigUInt64LE(8));
  const record = await readRange(handle, eocd64Offset, 56);
  if (record.length < 56 || record.readUInt32LE(0) !== SIG_EOCD64) return null;

  return {
    entryCount: Number(record.readBigUInt64LE(32)),
    centralDirSize: Number(record.readBigUInt64LE(40)),
    centralDirOffset: Number(record.readBigUInt64LE(48)),
  };
}

/**
 * Parse the central directory and apply every structural limit.
 *
 * Sizes are taken from the central directory, never from local headers: when
 * an archive is written as a stream the local header carries zeros and the real
 * sizes appear in a trailing data descriptor. Reading the central directory
 * sidesteps that entirely and is also the copy an attacker cannot desynchronise
 * from what we actually extract.
 */
export async function readArchive(zipPath, limits) {
  const {
    maxEntries = 5000,
    maxUncompressedBytes = 256 * 1024 * 1024,
    maxSingleFileBytes = 64 * 1024 * 1024,
    maxCompressionRatio = 120,
  } = limits ?? {};

  const handle = await fsp.open(zipPath, 'r');
  try {
    const { size: fileSize } = await handle.stat();
    if (fileSize < EOCD_SIZE) {
      throw zipError('ZIP_INVALID', 'That file is not a valid ZIP archive (too small)');
    }

    // Reject the obvious non-zip before doing anything clever with offsets.
    const head = await readRange(handle, 0, 4);
    const headSig = head.length === 4 ? head.readUInt32LE(0) : 0;
    if (headSig !== SIG_LOCAL && headSig !== SIG_EOCD && headSig !== SIG_CENTRAL) {
      throw zipError('ZIP_INVALID', 'That file is not a valid ZIP archive');
    }

    let eocd = await findEndOfCentralDirectory(handle, fileSize);
    if (!eocd) throw zipError('ZIP_INVALID', 'That file is not a valid ZIP archive (no central directory)');

    let { entryCount, centralDirSize, centralDirOffset } = eocd;
    if (entryCount === 0xffff || centralDirSize === 0xffffffff || centralDirOffset === 0xffffffff) {
      const zip64 = await readZip64(handle, eocd);
      if (!zip64) throw zipError('ZIP_UNSUPPORTED', 'This ZIP64 archive is not supported');
      ({ entryCount, centralDirSize, centralDirOffset } = zip64);
    }

    if (entryCount > maxEntries) {
      throw zipError('ZIP_TOO_MANY_FILES', `The archive has ${entryCount} files; the limit is ${maxEntries}`);
    }
    if (centralDirSize > MAX_CENTRAL_DIRECTORY_BYTES) {
      throw zipError('ZIP_INVALID', 'The archive index is implausibly large');
    }
    if (centralDirOffset + centralDirSize > fileSize) {
      throw zipError('ZIP_INVALID', 'The archive is truncated or corrupt');
    }

    const central = await readRange(handle, centralDirOffset, centralDirSize);
    const entries = [];
    let totalUncompressed = 0;
    let totalCompressed = 0;
    let cursor = 0;

    for (let index = 0; index < entryCount; index++) {
      if (cursor + CENTRAL_HEADER_SIZE > central.length) {
        throw zipError('ZIP_INVALID', 'The archive index is truncated');
      }
      if (central.readUInt32LE(cursor) !== SIG_CENTRAL) {
        throw zipError('ZIP_INVALID', 'The archive index is corrupt');
      }

      const versionMadeBy = central.readUInt16LE(cursor + 4);
      const flags = central.readUInt16LE(cursor + 8);
      const method = central.readUInt16LE(cursor + 10);
      const crc = central.readUInt32LE(cursor + 16);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const externalAttributes = central.readUInt32LE(cursor + 38);
      const localOffset = central.readUInt32LE(cursor + 42);

      const nameStart = cursor + CENTRAL_HEADER_SIZE;
      if (nameStart + nameLength > central.length) {
        throw zipError('ZIP_INVALID', 'The archive index is truncated');
      }
      const rawName = central.subarray(nameStart, nameStart + nameLength).toString('utf8');
      cursor = nameStart + nameLength + extraLength + commentLength;

      // Bit 0 marks an encrypted entry. We cannot read it, and silently writing
      // the ciphertext to disk would produce a broken site with no explanation.
      if (flags & 0x1) {
        throw zipError('ZIP_ENCRYPTED', 'Password-protected archives are not supported');
      }
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw zipError('ZIP_UNSUPPORTED', 'ZIP64 entries larger than 4 GB are not supported');
      }
      if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
        throw zipError('ZIP_UNSUPPORTED', `Unsupported compression method (${method}) in ${rawName.slice(0, 60)}`);
      }
      if (isSymlinkEntry(versionMadeBy, externalAttributes)) {
        throw zipError('ZIP_SYMLINK', `Symbolic links are not allowed in uploads: ${rawName.slice(0, 80)}`);
      }

      const { path: cleanPath, isDirectory } = validateEntryName(rawName);

      if (!isDirectory) {
        if (uncompressedSize > maxSingleFileBytes) {
          throw zipError(
            'ZIP_FILE_TOO_LARGE',
            `"${cleanPath}" is ${Math.round(uncompressedSize / 1048576)} MB; the per-file limit is ${Math.round(maxSingleFileBytes / 1048576)} MB`,
          );
        }
        if (localOffset + LOCAL_HEADER_SIZE > fileSize) {
          throw zipError('ZIP_INVALID', 'The archive is truncated or corrupt');
        }
        totalUncompressed += uncompressedSize;
        totalCompressed += compressedSize;

        if (totalUncompressed > maxUncompressedBytes) {
          throw zipError(
            'ZIP_TOO_LARGE',
            `Extracting would use ${Math.round(totalUncompressed / 1048576)} MB; the limit is ${Math.round(maxUncompressedBytes / 1048576)} MB`,
          );
        }
      }

      entries.push({
        name: cleanPath,
        rawName,
        isDirectory: isDirectory || (cleanPath.length === 0),
        method,
        crc,
        compressedSize,
        uncompressedSize,
        localOffset,
      });
    }

    // Zip-bomb guard. A normal website compresses somewhere between 1:1 and
    // 20:1; a bomb is thousands to one. Comparing totals rather than individual
    // files avoids false positives on a single highly-compressible JSON file.
    if (totalCompressed > 0) {
      const ratio = totalUncompressed / totalCompressed;
      if (ratio > maxCompressionRatio) {
        throw zipError(
          'ZIP_BOMB',
          `Refusing to extract: the archive expands ${Math.round(ratio)}× (limit ${maxCompressionRatio}×)`,
        );
      }
    }

    const files = entries.filter((e) => !e.isDirectory);
    if (files.length === 0) {
      throw zipError('ZIP_EMPTY', 'The archive contains no files');
    }

    return { entries, files, totalUncompressed, totalCompressed, fileSize };
  } finally {
    await handle.close();
  }
}

/**
 * Find the single top-level folder to strip, if there is one.
 *
 * "Compress this folder" in every file manager produces my-site/index.html
 * rather than index.html, and a user who then sees a 404 has no way to know
 * why. If — and only if — every entry sits under one folder, we treat that
 * folder as the site root.
 */
export function detectRootPrefix(files) {
  if (files.length === 0) return '';
  let prefix = null;
  for (const file of files) {
    const slash = file.name.indexOf('/');
    if (slash === -1) return ''; // A file at the top level: nothing to strip.
    const top = file.name.slice(0, slash);
    if (prefix === null) prefix = top;
    else if (prefix !== top) return '';
  }
  // Only strip when it actually helps, i.e. an entry file appears underneath.
  const stripped = files.map((f) => f.name.slice(prefix.length + 1));
  const hasEntry = stripped.some((name) => /^index\.html?$/i.test(name));
  return hasEntry ? prefix : '';
}

/** Transform that counts bytes, enforces a ceiling and computes CRC-32. */
function createGuard(limitBytes, onOverflow) {
  let written = 0;
  let crc = 0;
  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      written += chunk.length;
      if (written > limitBytes) {
        callback(onOverflow(written));
        return;
      }
      crc = crc32(chunk, crc);
      callback(null, chunk);
    },
  });
  return {
    stream,
    get bytes() { return written; },
    get crc() { return crc; },
  };
}

/**
 * Extract an archive into `destDir`.
 *
 * destDir is expected to be a fresh directory the caller will rename into place
 * once this resolves. Every write goes through safeJoin, so even if a name
 * slipped past validateEntryName the write still cannot land outside destDir.
 */
export async function extractArchive(zipPath, destDir, {
  limits,
  stripRoot = true,
  onProgress = null,
} = {}) {
  const archive = await readArchive(zipPath, limits);
  const maxSingleFileBytes = limits?.maxSingleFileBytes ?? 64 * 1024 * 1024;
  const maxTotalBytes = limits?.maxUncompressedBytes ?? 256 * 1024 * 1024;

  const prefix = stripRoot ? detectRootPrefix(archive.files) : '';
  await ensureDir(destDir);

  const handle = await fsp.open(zipPath, 'r');
  const written = [];
  let totalBytes = 0;

  try {
    // Create directories first so a file never races its parent.
    for (const entry of archive.entries) {
      if (!entry.isDirectory) continue;
      const relative = prefix ? stripPrefix(entry.name, prefix) : entry.name;
      if (relative === null || relative === '') continue;
      await ensureDir(safeJoin(destDir, relative));
    }

    let index = 0;
    for (const entry of archive.files) {
      index += 1;
      const relative = prefix ? stripPrefix(entry.name, prefix) : entry.name;
      if (relative === null || relative === '') continue;

      const target = safeJoin(destDir, relative);
      await ensureDir(path.dirname(target));

      // Read the local header to find where the data actually starts: the name
      // and extra-field lengths there can differ from the central directory's.
      const localHeader = await readRange(handle, entry.localOffset, LOCAL_HEADER_SIZE);
      if (localHeader.length !== LOCAL_HEADER_SIZE || localHeader.readUInt32LE(0) !== SIG_LOCAL) {
        throw zipError('ZIP_INVALID', `Corrupt entry header for "${entry.name}"`);
      }
      const localNameLength = localHeader.readUInt16LE(26);
      const localExtraLength = localHeader.readUInt16LE(28);
      const dataStart = entry.localOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength;

      if (dataStart + entry.compressedSize > archive.fileSize) {
        throw zipError('ZIP_INVALID', `Entry "${entry.name}" runs past the end of the archive`);
      }

      const remainingBudget = maxTotalBytes - totalBytes;
      const perFileCeiling = Math.min(maxSingleFileBytes, Math.max(remainingBudget, 0));

      const guard = createGuard(perFileCeiling, (bytes) => {
        if (bytes > remainingBudget) {
          return zipError('ZIP_TOO_LARGE', `Extraction exceeded the ${Math.round(maxTotalBytes / 1048576)} MB limit`);
        }
        return zipError('ZIP_FILE_TOO_LARGE', `"${entry.name}" exceeds the per-file limit`);
      });

      const source = entry.compressedSize === 0
        ? emptyStream()
        : fs.createReadStream(zipPath, { start: dataStart, end: dataStart + entry.compressedSize - 1 });
      const sink = fs.createWriteStream(target, { flags: 'w', mode: 0o644 });

      try {
        if (entry.method === METHOD_DEFLATE) {
          await pipeline(source, zlib.createInflateRaw(), guard.stream, sink);
        } else {
          await pipeline(source, guard.stream, sink);
        }
      } catch (err) {
        await fsp.rm(target, { force: true }).catch(() => {});
        if (err instanceof AppError) throw err;
        // zlib failures mean the archive is damaged, not that we have a bug.
        throw zipError('ZIP_CORRUPT', `Could not extract "${entry.name}": the archive appears to be damaged`);
      }

      // The declared size and CRC are a free integrity check. A mismatch means
      // a truncated upload or a hand-edited archive — either way, stop.
      if (guard.bytes !== entry.uncompressedSize) {
        await fsp.rm(target, { force: true }).catch(() => {});
        throw zipError('ZIP_CORRUPT', `"${entry.name}" is not the size the archive declares`);
      }
      if (entry.crc !== 0 && guard.crc !== entry.crc) {
        await fsp.rm(target, { force: true }).catch(() => {});
        throw zipError('ZIP_CORRUPT', `Checksum mismatch for "${entry.name}" — the upload may be incomplete`);
      }

      totalBytes += guard.bytes;
      written.push({ path: relative, size: guard.bytes });

      if (onProgress && index % 25 === 0) onProgress({ done: index, total: archive.files.length });
    }
  } finally {
    await handle.close();
  }

  return {
    files: written,
    fileCount: written.length,
    totalBytes,
    strippedRoot: prefix || null,
  };
}

function stripPrefix(name, prefix) {
  if (name === prefix) return '';
  if (!name.startsWith(`${prefix}/`)) return name;
  return name.slice(prefix.length + 1);
}

function emptyStream() {
  return Readable.from([]);
}
