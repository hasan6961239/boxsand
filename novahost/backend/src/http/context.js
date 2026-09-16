import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { errors } from './errors.js';

const JSON_BODY_LIMIT = 1024 * 1024; // 1 MB is generous for metadata-only payloads.

function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Client IP.
 *
 * With TRUST_PROXY off we use the socket address, which cannot be forged.
 * With it on we prefer CF-Connecting-IP: Cloudflare overwrites that header on
 * every request, whereas X-Forwarded-For can be appended to by the client and
 * is only trustworthy from the right-hand side.
 */
function clientIp(req) {
  if (config.trustProxy) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
      const first = xff.split(',')[0].trim();
      if (first) return first;
    }
  }
  const addr = req.socket?.remoteAddress ?? '';
  // Normalise the IPv4-mapped IPv6 form so rate-limit keys and logs match.
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr;
}

/** Host header without the port, lowercased. Empty string when absent. */
function requestHost(req) {
  const raw = req.headers['x-forwarded-host'] ?? req.headers.host ?? '';
  const value = Array.isArray(raw) ? raw[0] : raw;
  const host = String(value).trim().toLowerCase();
  if (!host) return '';
  // Strip the port, taking care not to mangle a bare IPv6 literal.
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.lastIndexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

export function createContext(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    url = new URL('http://localhost/');
  }

  const ctx = {
    req,
    res,
    method: req.method.toUpperCase(),
    url,
    path: url.pathname,
    query: url.searchParams,
    host: requestHost(req),
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    params: {},
    // Filled in by middleware.
    user: null,
    session: null,
    startedAt: process.hrtime.bigint(),

    get cookies() {
      if (!this._cookies) this._cookies = parseCookies(req.headers.cookie);
      return this._cookies;
    },

    header(name) {
      const value = req.headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    },

    /** A query parameter as a trimmed string, or the fallback. */
    q(name, fallback = '') {
      const value = url.searchParams.get(name);
      return value === null ? fallback : value.trim();
    },

    qInt(name, fallback, { min = -Infinity, max = Infinity } = {}) {
      const raw = url.searchParams.get(name);
      if (raw === null || raw === '') return fallback;
      const n = Number(raw);
      if (!Number.isInteger(n)) return fallback;
      return Math.min(Math.max(n, min), max);
    },

    /**
     * Read and parse a JSON body, enforcing a hard size limit.
     * The limit is checked while reading, not only against Content-Length,
     * because a chunked request can lie about its length.
     */
    async json({ limit = JSON_BODY_LIMIT, required = true } = {}) {
      const type = String(req.headers['content-type'] ?? '');
      if (!type.includes('application/json')) {
        if (!required) return {};
        throw errors.unsupportedMedia('Send this request as application/json');
      }

      const declared = Number(req.headers['content-length'] ?? 0);
      if (Number.isFinite(declared) && declared > limit) {
        throw errors.tooLarge('BODY_TOO_LARGE', 'Request body is too large');
      }

      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) {
          req.destroy();
          throw errors.tooLarge('BODY_TOO_LARGE', 'Request body is too large');
        }
        chunks.push(chunk);
      }
      if (size === 0) {
        if (required) throw errors.badRequest('EMPTY_BODY', 'Request body is empty');
        return {};
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw errors.badRequest('INVALID_BODY', 'Request body must be a JSON object');
        }
        return parsed;
      } catch (err) {
        if (err?.code) throw err;
        throw errors.badRequest('INVALID_JSON', 'Request body is not valid JSON');
      }
    },

    /**
     * Stream the raw request body straight to a file.
     *
     * Uploads never pass through memory: a 64 MB zip buffered in RAM on a phone
     * that is also running a launcher is how you get an OOM kill. The size cap
     * is enforced chunk by chunk, so an attacker cannot lie in Content-Length
     * and then send more.
     */
    async streamToFile(targetPath, { maxBytes }) {
      const declared = Number(req.headers['content-length'] ?? 0);
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw errors.tooLarge('UPLOAD_TOO_LARGE', `Upload exceeds the ${Math.round(maxBytes / 1048576)} MB limit`);
      }

      let written = 0;
      let overflow = false;
      const out = fs.createWriteStream(targetPath, { flags: 'w' });

      async function* guard(source) {
        for await (const chunk of source) {
          written += chunk.length;
          if (written > maxBytes) {
            overflow = true;
            throw errors.tooLarge('UPLOAD_TOO_LARGE', `Upload exceeds the ${Math.round(maxBytes / 1048576)} MB limit`);
          }
          yield chunk;
        }
      }

      try {
        await pipeline(req, guard, out);
      } catch (err) {
        await fs.promises.rm(targetPath, { force: true }).catch(() => {});
        if (overflow) {
          req.destroy();
          throw errors.tooLarge('UPLOAD_TOO_LARGE', `Upload exceeds the ${Math.round(maxBytes / 1048576)} MB limit`);
        }
        throw err;
      }

      if (written === 0) {
        await fs.promises.rm(targetPath, { force: true }).catch(() => {});
        throw errors.badRequest('EMPTY_UPLOAD', 'The upload contained no data');
      }
      return written;
    },

    /** Read the whole body as a Buffer (used for small file-manager writes). */
    async buffer({ limit }) {
      const declared = Number(req.headers['content-length'] ?? 0);
      if (Number.isFinite(declared) && declared > limit) {
        throw errors.tooLarge('BODY_TOO_LARGE', 'File is too large');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) {
          req.destroy();
          throw errors.tooLarge('BODY_TOO_LARGE', 'File is too large');
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },

    setCookie(name, value, options = {}) {
      const parts = [`${name}=${encodeURIComponent(value)}`];
      parts.push(`Path=${options.path ?? '/'}`);
      if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
      if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
      if (options.httpOnly !== false) parts.push('HttpOnly');
      if (options.secure ?? config.secureCookies) parts.push('Secure');
      parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
      // Domain is deliberately never set: a host-only cookie is not sent to
      // project subdomains, which is what keeps an uploaded site from seeing
      // the dashboard session.
      const existing = res.getHeader('Set-Cookie');
      const cookie = parts.join('; ');
      if (Array.isArray(existing)) res.setHeader('Set-Cookie', [...existing, cookie]);
      else if (existing) res.setHeader('Set-Cookie', [existing, cookie]);
      else res.setHeader('Set-Cookie', cookie);
    },

    clearCookie(name) {
      ctx.setCookie(name, '', { maxAge: 0 });
    },

    durationMs() {
      return Number(process.hrtime.bigint() - ctx.startedAt) / 1e6;
    },
  };

  return ctx;
}
