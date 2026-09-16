import path from 'node:path';
import fsp from 'node:fs/promises';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import * as projectsRepo from '../db/repo/projects.js';
import * as domainsRepo from '../db/repo/domains.js';
import { sendFile } from '../http/static.js';
import { applySiteHeaders } from '../http/middleware/securityHeaders.js';
import { sendHtml } from '../http/respond.js';
import { safeJoin, pathExists } from '../util/fsx.js';
import * as storage from './storage.js';

const log = createLogger('sites');

/**
 * Turning a request into a project.
 *
 * Four addressing modes are supported at once, because the platform has to work
 * in four different situations without being reconfigured:
 *
 *   slug.example.com        production, through the tunnel
 *   slug.localhost          the laptop, no DNS setup at all (Chrome and Safari
 *                           both resolve *.localhost to 127.0.0.1)
 *   slug.192-168-1-14.sslip.io
 *                           real subdomains on the LAN via a free wildcard DNS
 *                           service, when you want origin isolation without a
 *                           domain. Needs working DNS, so not offline.
 *   /s/slug/...             the universal fallback: plain IP, no DNS, offline.
 *
 * Custom domains are looked up last, since they need a database query.
 */

const WILDCARD_DNS_SUFFIXES = ['.sslip.io', '.nip.io', '.traefik.me', '.localtest.me'];

export function slugFromHost(host) {
  if (!host) return null;
  const clean = String(host).toLowerCase();

  if (config.sitesDomain && clean.endsWith(`.${config.sitesDomain}`)) {
    const label = clean.slice(0, -(config.sitesDomain.length + 1));
    // Exactly one label deep. Anything deeper would not be covered by
    // Cloudflare's free Universal SSL certificate anyway.
    if (label && !label.includes('.')) return label;
    return null;
  }

  if (clean.endsWith('.localhost')) {
    const label = clean.slice(0, -'.localhost'.length);
    if (label && !label.includes('.')) return label;
    return null;
  }

  for (const suffix of WILDCARD_DNS_SUFFIXES) {
    if (clean.endsWith(suffix)) {
      const withoutSuffix = clean.slice(0, -suffix.length);
      const labels = withoutSuffix.split('.');
      // slug.192-168-1-14.sslip.io -> the slug is everything before the address
      if (labels.length >= 2) return labels[0];
      return null;
    }
  }

  return null;
}

/** True when this host is the dashboard rather than a site. */
export function isPanelHost(host) {
  if (!host) return true;
  const clean = String(host).toLowerCase();
  if (config.panelHost && clean === config.panelHost) return true;
  if (clean === 'localhost' || clean === '127.0.0.1' || clean === '[::1]') return true;
  // A bare IP address is always the panel: sites need a name to be addressed by.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) return true;
  if (clean.startsWith('[')) return true;
  if (config.sitesDomain && clean === config.sitesDomain) return true;
  return false;
}

/**
 * Resolve a request to a project and a path within it.
 * Returns null when the host/path pair does not name a project.
 */
export function resolveRequest({ host, urlPath }) {
  // Path mode first: an explicit /s/<slug>/ always wins, so it keeps working
  // even when the request also carries a site hostname.
  const pathMatch = /^\/s\/([a-z0-9][a-z0-9-]*)(\/.*)?$/i.exec(urlPath);
  if (pathMatch) {
    const project = projectsRepo.findBySlug(pathMatch[1].toLowerCase());
    if (!project) return { notFound: true, slug: pathMatch[1] };
    return {
      project,
      relativePath: pathMatch[2] || '/',
      mode: 'path',
      basePath: `/s/${project.slug}/`,
    };
  }

  const slug = slugFromHost(host);
  if (slug) {
    const project = projectsRepo.findBySlug(slug);
    if (!project) return { notFound: true, slug };
    return { project, relativePath: urlPath, mode: 'host', basePath: '/' };
  }

  const domain = domainsRepo.findByHostname(host);
  if (domain) {
    const project = projectsRepo.findById(domain.project_id);
    if (project) {
      return { project, relativePath: urlPath, mode: 'domain', basePath: '/', domain };
    }
  }

  return null;
}

/**
 * Inject <base> so a site served under /s/<slug>/ resolves its relative links.
 *
 * This fixes relative URLs (css/style.css) but cannot fix absolute ones
 * (/css/style.css) — nothing in a <base> tag can. The absolute case is handled
 * by the Referer-based redirect in serveSite below, and the real answer is to
 * use a hostname. This is documented in NETWORKING.md rather than hidden.
 */
function injectBaseHref(html, basePath) {
  if (/<base\s/i.test(html)) return html;
  const tag = `<base href="${basePath}">`;
  const headMatch = /<head[^>]*>/i.exec(html);
  if (headMatch) {
    const at = headMatch.index + headMatch[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  const htmlMatch = /<html[^>]*>/i.exec(html);
  if (htmlMatch) {
    const at = htmlMatch.index + htmlMatch[0].length;
    return `${html.slice(0, at)}<head>${tag}</head>${html.slice(at)}`;
  }
  // No <head> and no <html>: the browser will build an implicit head, so the
  // tag just needs to land after the doctype. Putting anything before the
  // doctype would drop the page into quirks mode.
  const doctypeMatch = /<!doctype[^>]*>/i.exec(html);
  if (doctypeMatch) {
    const at = doctypeMatch.index + doctypeMatch[0].length;
    return `${html.slice(0, at)}<head>${tag}</head>${html.slice(at)}`;
  }
  return `<head>${tag}</head>${html}`;
}

function errorPage({ title, heading, detail, hint }) {
  // Built entirely from literals plus escaped values — no user HTML reaches here.
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark light; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background:#0b0e14; color:#e6e9ef; padding:24px; }
  .card { max-width:34rem; text-align:center; }
  h1 { font-size:3.5rem; margin:0 0 .25rem; letter-spacing:-.03em; }
  p  { color:#9aa4b2; line-height:1.6; margin:.5rem 0; }
  .hint { font-size:.875rem; color:#6b7480; margin-top:1.5rem; }
  code { background:#161b26; padding:.15em .4em; border-radius:4px; font-size:.9em; }
  @media (prefers-color-scheme: light) {
    body { background:#f7f8fa; color:#14181f; } p { color:#5a6472; }
    code { background:#e8eaef; } .hint { color:#8a93a0; }
  }
</style>
</head>
<body><div class="card">
  <h1>${esc(heading)}</h1>
  <p>${esc(detail)}</p>
  ${hint ? `<p class="hint">${hint}</p>` : ''}
</div></body>
</html>`;
}

async function sendSiteError(ctx, status, { title, heading, detail, hint }, siteRoot = null) {
  // Prefer the site's own error page when it ships one.
  if (status === 404 && siteRoot) {
    const custom = path.join(siteRoot, '404.html');
    if (await pathExists(custom)) {
      if (await sendFile(ctx, custom, { cacheControl: 'no-cache', status: 404 })) return;
    }
  }
  sendHtml(ctx.res, errorPage({ title, heading, detail, hint }), status, { 'Cache-Control': 'no-store' });
}

/**
 * Serve one request for a hosted site.
 * Returns true when it produced a response.
 */
export async function serveSite(ctx) {
  const resolved = resolveRequest({ host: ctx.host, urlPath: ctx.path });

  if (!resolved) {
    // Absolute-path rescue for path mode: a site at /s/blog/ that asks for
    // /css/style.css lands here. The Referer tells us which site it came from,
    // so redirect it into the right prefix instead of returning a 404 the user
    // has no way to diagnose.
    const referer = ctx.header('referer');
    if (referer) {
      try {
        const refPath = new URL(referer).pathname;
        const match = /^\/s\/([a-z0-9][a-z0-9-]*)\//i.exec(refPath);
        if (match && !ctx.path.startsWith('/s/')) {
          const target = `/s/${match[1]}${ctx.path}`;
          ctx.res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
          ctx.res.end();
          return true;
        }
      } catch { /* malformed referer: fall through to the 404 */ }
    }
    return false;
  }

  if (resolved.notFound) {
    await sendSiteError(ctx, 404, {
      title: 'Site not found',
      heading: '404',
      detail: `No project is published at "${resolved.slug}".`,
      hint: 'Check the address, or create the project in your NOVA HOST dashboard.',
    });
    return true;
  }

  const { project, relativePath, mode, basePath } = resolved;
  applySiteHeaders(ctx.res, { isPrivate: project.visibility === 'private' });

  if (!project.enabled) {
    await sendSiteError(ctx, 503, {
      title: 'Site paused',
      heading: '503',
      detail: `"${project.name}" is currently paused.`,
      hint: 'Re-enable it from the project settings in your dashboard.',
    });
    return true;
  }

  if (!project.current_deployment_id) {
    await sendSiteError(ctx, 404, {
      title: 'Nothing deployed yet',
      heading: '404',
      detail: `"${project.name}" exists but has no successful deployment yet.`,
      hint: 'Upload a ZIP from the dashboard to publish it.',
    });
    return true;
  }

  const siteRoot = storage.paths.deployment(project.id, project.current_deployment_id);

  let target;
  try {
    target = safeJoin(siteRoot, relativePath);
  } catch {
    await sendSiteError(ctx, 400, {
      title: 'Bad request',
      heading: '400',
      detail: 'That path is not valid.',
    });
    return true;
  }

  // Platform bookkeeping lives inside the deployment directory; it is not part
  // of the site and must not be downloadable.
  if (storage.INTERNAL_FILES.has(path.basename(target))) {
    await sendSiteError(ctx, 404, { title: 'Not found', heading: '404', detail: 'File not found.' }, siteRoot);
    return true;
  }

  let stat = null;
  try {
    stat = await fsp.lstat(target);
  } catch { /* handled below */ }

  // A directory URL without a trailing slash breaks every relative link inside
  // the page it is about to serve, so redirect rather than serve it wrong.
  if (stat?.isDirectory() && !ctx.path.endsWith('/')) {
    ctx.res.writeHead(301, { Location: `${ctx.path}/${ctx.url.search}`, 'Cache-Control': 'no-store' });
    ctx.res.end();
    return true;
  }

  const candidates = [];
  if (stat?.isDirectory()) {
    candidates.push(path.join(target, 'index.html'), path.join(target, 'index.htm'));
  } else {
    candidates.push(target);
    if (!path.extname(relativePath)) candidates.push(`${target}.html`);
  }

  for (const candidate of candidates) {
    const isHtml = /\.html?$/i.test(candidate);

    // HTML in path mode needs a <base> tag injected, which means reading it
    // rather than streaming it. Every other file streams straight from disk.
    if (isHtml && mode === 'path') {
      try {
        const raw = await fsp.readFile(candidate, 'utf8');
        const body = Buffer.from(injectBaseHref(raw, basePath), 'utf8');
        ctx.res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': body.length,
          'Cache-Control': 'no-cache',
        });
        ctx.res.end(ctx.method === 'HEAD' ? undefined : body);
        return true;
      } catch {
        continue;
      }
    }

    // Deployments are immutable, so their assets can be cached hard. HTML is
    // revalidated so a rollback takes effect immediately.
    const cacheControl = isHtml
      ? 'no-cache'
      : 'public, max-age=3600, stale-while-revalidate=86400';

    if (await sendFile(ctx, candidate, { cacheControl })) return true;
  }

  await sendSiteError(ctx, 404, {
    title: 'Not found',
    heading: '404',
    detail: `"${relativePath}" does not exist in this site.`,
  }, siteRoot);
  return true;
}

/** Every URL a project can be reached at — shown in the dashboard. */
export function projectUrls(project) {
  const urls = [];

  if (config.sitesDomain) {
    urls.push({ url: `https://${project.slug}.${config.sitesDomain}`, kind: 'subdomain', primary: true });
  }

  const sitesPort = config.sitesPort === 80 ? '' : `:${config.sitesPort}`;
  urls.push({
    url: `http://localhost${sitesPort}/s/${project.slug}/`,
    kind: 'path',
    primary: !config.sitesDomain,
  });

  for (const domain of domainsRepo.listByProject(project.id)) {
    urls.push({
      url: `https://${domain.hostname}`,
      kind: 'custom',
      verified: Boolean(domain.verified),
      primary: false,
    });
  }

  return urls;
}

export function logSiteRequest(ctx, status) {
  log.debug('site request', { host: ctx.host, path: ctx.path, status });
}
