import http from 'node:http';
import path from 'node:path';
import { config, allowedOrigins } from '../config.js';
import { createLogger } from '../logger.js';
import { createContext } from './context.js';
import { fail, json, sendHtml } from './respond.js';
import { errors } from './errors.js';
import { applyPanelHeaders, applyCors } from './middleware/securityHeaders.js';
import { enforce } from './middleware/ratelimit.js';
import { loadSession, verifyCsrf } from './middleware/auth.js';
import { serveFromDirectory, sendFile } from './static.js';
import { createPlatformRouter } from '../routes/index.js';
import { serveSite, isPanelHost } from '../services/sites.js';

const log = createLogger('http');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Two listeners, one process.
 *
 *   PORT       dashboard + API (+ hosted sites when addressed by hostname)
 *   SITES_PORT hosted sites only — this listener has no route to the API at all
 *
 * The split is a security boundary, not tidiness: a different port is a
 * different browser origin, so JavaScript in a site you uploaded cannot reach
 * the dashboard's cookies or call the API, even when there is no DNS to give
 * each project its own hostname.
 */

function requestLogger(ctx, status) {
  const ms = ctx.durationMs().toFixed(1);
  const line = `${ctx.method} ${ctx.path} ${status} ${ms}ms`;
  if (status >= 500) log.error(line, { ip: ctx.ip });
  else if (status >= 400) log.debug(line, { ip: ctx.ip });
  else log.debug(line);
}

/** Serve the dashboard SPA, falling back to index.html for client routes. */
async function servePanelApp(ctx) {
  const urlPath = ctx.path === '/' ? '/index.html' : ctx.path;

  const served = await serveFromDirectory(ctx, config.frontendDir, urlPath, {
    cacheControl: urlPath === '/index.html' ? 'no-cache' : 'public, max-age=300',
    tryHtmlExtension: false,
  });
  if (served) return true;

  // Anything that is not a file and does not look like an asset request is a
  // client-side route: hand back index.html and let the frontend router decide.
  if (!path.extname(urlPath) && !urlPath.startsWith('/api/')) {
    return sendFile(ctx, path.join(config.frontendDir, 'index.html'), { cacheControl: 'no-cache' });
  }
  return false;
}

async function handlePanelRequest(router, req, res) {
  const ctx = createContext(req, res);
  let status = 200;

  try {
    // A hostname that names a project is served as that site, even on the panel
    // port: behind the tunnel, panel.example.com and site.example.com arrive at
    // the same socket and are told apart only by the Host header. Origin
    // isolation still holds, because they are different hostnames.
    if (!isPanelHost(ctx.host)) {
      enforce(ctx, 'site', ctx.ip);
      const handled = await serveSite(ctx);
      if (handled) {
        requestLogger(ctx, res.statusCode);
        return;
      }
      applyPanelHeaders(res);
      sendHtml(res, '<!doctype html><title>Not found</title><h1>404</h1>', 404);
      return;
    }

    applyPanelHeaders(res);

    const isApi = ctx.path.startsWith('/api/') || ctx.path === '/health';

    if (isApi) {
      const preflight = applyCors(ctx, allowedOrigins());
      if (preflight) {
        res.writeHead(204);
        res.end();
        return;
      }
      if (ctx.method === 'OPTIONS') {
        res.writeHead(204, { Allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' });
        res.end();
        return;
      }
      enforce(ctx, 'api', ctx.ip);
    }

    const match = router.find(ctx.method, ctx.path);

    if (match?.methodNotAllowed) {
      res.setHeader('Allow', match.methodNotAllowed.join(', '));
      throw errors.badRequest('METHOD_NOT_ALLOWED', `Use ${match.methodNotAllowed.join(' or ')} on this endpoint`);
    }

    if (match?.handler) {
      ctx.params = match.params;
      // Session first: CSRF needs to know which session's token to expect.
      loadSession(ctx);
      if (!SAFE_METHODS.has(ctx.method)) verifyCsrf(ctx);
      await match.handler(ctx);
      status = res.statusCode;
      requestLogger(ctx, status);
      return;
    }

    if (isApi) throw errors.notFound('ENDPOINT_NOT_FOUND', 'No such API endpoint');

    if (await servePanelApp(ctx)) {
      requestLogger(ctx, res.statusCode);
      return;
    }

    status = 404;
    sendHtml(res, '<!doctype html><title>Not found</title><h1>404</h1><p>No such page.</p>', 404);
    requestLogger(ctx, status);
  } catch (err) {
    fail(res, err, { method: ctx.method, path: ctx.path, ip: ctx.ip });
    requestLogger(ctx, res.statusCode);
  }
}

async function handleSiteRequest(req, res) {
  const ctx = createContext(req, res);
  try {
    if (!['GET', 'HEAD'].includes(ctx.method)) {
      // Hosted sites are static files. Anything else is either a misdirected
      // API call or someone probing, and neither deserves a body.
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Only GET and HEAD are supported for hosted sites\n');
      return;
    }

    enforce(ctx, 'site', ctx.ip);

    const handled = await serveSite(ctx);
    if (handled) {
      requestLogger(ctx, res.statusCode);
      return;
    }

    sendHtml(res, siteIndexPage(), 404, { 'Cache-Control': 'no-store' });
    requestLogger(ctx, 404);
  } catch (err) {
    fail(res, err, { method: ctx.method, path: ctx.path, ip: ctx.ip, listener: 'sites' });
  }
}

/** Landing page for the sites port when the URL names no project. */
function siteIndexPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NOVA HOST — sites</title>
<style>
 :root{color-scheme:dark light}
 body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
      font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#0b0e14;color:#e6e9ef}
 .card{max-width:32rem;text-align:center}
 h1{font-size:1.5rem;margin:0 0 .75rem}
 p{color:#9aa4b2;line-height:1.7}
 code{background:#161b26;padding:.15em .45em;border-radius:5px}
 @media(prefers-color-scheme:light){body{background:#f7f8fa;color:#14181f}p{color:#5a6472}code{background:#e8eaef}}
</style></head>
<body><div class="card">
 <h1>This port serves hosted sites</h1>
 <p>Open a project at <code>/s/&lt;project&gt;/</code>, or use its own hostname.</p>
 <p>The dashboard is on port ${config.port}.</p>
</div></body></html>`;
}

export function createServers() {
  const router = createPlatformRouter();

  const panelServer = http.createServer((req, res) => {
    handlePanelRequest(router, req, res).catch((err) => {
      log.error('unhandled panel error', { error: err.message, stack: err.stack });
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Server error' } }));
      }
    });
  });

  const siteServer = http.createServer((req, res) => {
    handleSiteRequest(req, res).catch((err) => {
      log.error('unhandled site error', { error: err.message });
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error\n');
      }
    });
  });

  // An idle phone connection can hang around for a long time; these keep
  // sockets from accumulating without cutting off a slow upload mid-flight.
  for (const server of [panelServer, siteServer]) {
    server.keepAliveTimeout = 30_000;
    server.headersTimeout = 40_000;
    server.requestTimeout = 0; // uploads are bounded by size, not by time
  }

  return { panelServer, siteServer, router };
}

export { json };
