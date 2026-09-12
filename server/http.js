'use strict';
// طبقة HTTP بسيطة مبنية على وحدات Node المدمجة (بدون أي مكتبات خارجية)
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json'
};

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const rx = new RegExp(
      '^' +
        pattern
          .replace(/\/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; })
          .replace(/\*/g, '.*') +
        '$'
    );
    this.routes.push({ method, rx, keys, handler });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  del(p, h) { return this.add('DELETE', p, h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.rx);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { handler: r.handler, params };
      }
    }
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 20 * 1024 * 1024) { reject(new Error('حجم الطلب كبير جداً')); req.destroy(); return; }
      data += c;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { resolve({ _raw: data }); }
    });
    req.on('error', reject);
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function serveStatic(res, rootDir, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(rootDir, safe);
  if (!file.startsWith(path.resolve(rootDir))) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback
      const idx = path.join(rootDir, 'index.html');
      return fs.readFile(idx, (e2, buf) => {
        if (e2) { res.writeHead(404); return res.end('غير موجود'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(buf);
      });
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createServer({ router, staticDir, onRequest }) {
  return http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    if (pathname.startsWith('/api/')) {
      const route = router.match(req.method, pathname);
      if (!route) return json(res, 404, { error: 'المسار غير موجود' });
      try {
        const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
        const ctx = { req, res, params: route.params, query: parsed.query, body };
        if (onRequest) await onRequest(ctx);
        const out = await route.handler(ctx);
        if (res.writableEnded) return;
        return json(res, 200, out === undefined ? { ok: true } : out);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('[خطأ]', err);
        return json(res, status, { error: err.message || 'خطأ في الخادم' });
      }
    }
    return serveStatic(res, staticDir, pathname);
  });
}

module.exports = { Router, createServer, json, HttpError, readBody };
