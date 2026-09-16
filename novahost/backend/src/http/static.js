import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { contentTypeFor } from './mime.js';
import { safeJoin } from '../util/fsx.js';

/**
 * Static file serving.
 *
 * Node is doing the job an nginx would normally do. For a personal platform
 * serving static sites that is the right call: one process to start, stop,
 * supervise and read logs from, instead of two that can disagree about which
 * directory is live. The cost is some throughput we do not need — and with
 * Cloudflare caching in front, most requests never reach the phone anyway.
 */

/** Weak validator built from size + mtime. Cheap, and correct for our writes. */
function makeEtag(stat) {
  const material = `${stat.size}-${Math.floor(stat.mtimeMs)}`;
  return `W/"${createHash('sha1').update(material).digest('base64url').slice(0, 20)}"`;
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (startRaw === '' && endRaw === '') return null;

  let start;
  let end;
  if (startRaw === '') {
    // Suffix form: "bytes=-500" means the last 500 bytes.
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? size - 1 : Number(endRaw);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

/**
 * Send one file. Returns true when the response has been written.
 *
 * `absPath` must already be inside the intended root — callers use safeJoin.
 * We lstat rather than stat so a symlink is never followed: a link placed in a
 * project directory must not be able to expose a file from outside it.
 */
export async function sendFile(ctx, absPath, {
  cacheControl = 'no-cache',
  headers = {},
  download = false,
  downloadName = null,
  status = 200,
} = {}) {
  const { req, res } = ctx;

  let stat;
  try {
    stat = await fsp.lstat(absPath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const etag = makeEtag(stat);
  const lastModified = new Date(stat.mtimeMs).toUTCString();
  const type = contentTypeFor(absPath);

  const baseHeaders = {
    'Content-Type': type,
    'Last-Modified': lastModified,
    ETag: etag,
    'Cache-Control': cacheControl,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  };

  if (download) {
    const name = (downloadName ?? path.basename(absPath)).replace(/["\\]/g, '');
    baseHeaders['Content-Disposition'] =
      `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }

  // Conditional request: ETag first, then date, as the HTTP spec requires.
  const ifNoneMatch = status === 200 ? req.headers['if-none-match'] : null;
  const ifModifiedSince = status === 200 ? req.headers['if-modified-since'] : null;
  if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim() === etag)) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl });
    res.end();
    return true;
  }
  if (!ifNoneMatch && ifModifiedSince) {
    const since = Date.parse(ifModifiedSince);
    if (Number.isFinite(since) && Math.floor(stat.mtimeMs / 1000) * 1000 <= since) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl });
      res.end();
      return true;
    }
  }

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, stat.size);
    if (!range) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, ...baseHeaders });
      res.end();
      return true;
    }
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
      'Content-Length': length,
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    const stream = fs.createReadStream(absPath, { start: range.start, end: range.end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return true;
  }

  res.writeHead(status, { ...baseHeaders, 'Content-Length': stat.size });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  const stream = fs.createReadStream(absPath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
  return true;
}

/**
 * Serve `urlPath` from `root`, with directory-index resolution.
 * Returns false when nothing matched so the caller can render its own 404.
 */
export async function serveFromDirectory(ctx, root, urlPath, options = {}) {
  let target;
  try {
    target = safeJoin(root, urlPath);
  } catch {
    return false;
  }

  let stat;
  try {
    stat = await fsp.lstat(target);
  } catch {
    // Try the extensionless form used by many static exports: /about -> about.html
    if (options.tryHtmlExtension !== false && !path.extname(urlPath)) {
      const withHtml = `${target}.html`;
      if (await sendFile(ctx, withHtml, options)) return true;
    }
    return false;
  }

  if (stat.isDirectory()) {
    for (const indexName of options.indexFiles ?? ['index.html', 'index.htm']) {
      const candidate = path.join(target, indexName);
      if (await sendFile(ctx, candidate, options)) return true;
    }
    return false;
  }

  return sendFile(ctx, target, options);
}
