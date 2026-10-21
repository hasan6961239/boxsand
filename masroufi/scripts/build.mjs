// Build: bundle JS + CSS with esbuild, copy static files, stamp the version
// into the service worker and index.html, and emit Netlify _headers (CSP).
//
//   node scripts/build.mjs            → dist/
//   node scripts/build.mjs --watch --serve [--port 8787]   → rebuild on change + local server

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');
const out = join(root, '.dist-tmp');
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const serve = args.includes('--serve');
const port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.PORT) || 8787;

const sha = (buf, n = 10) => createHash('sha256').update(buf).digest('hex').slice(0, n);

async function walk(dir) {
  const outList = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) outList.push(...(await walk(p)));
    else outList.push(p);
  }
  return outList;
}

async function cssEntry() {
  // app.css imports every css/screens/*.css so screens can own their styles
  const base = await readFile(join(src, 'css/app.css'), 'utf8');
  let screens = [];
  try {
    screens = (await readdir(join(src, 'css/screens'))).filter((f) => f.endsWith('.css')).sort();
  } catch { /* none */ }
  const tmp = join(src, 'css/.entry.css');
  await writeFile(tmp, base.replace('/*SCREENS*/', screens.map((f) => `@import './screens/${f}';`).join('\n')));
  return tmp;
}

async function build() {
  const t0 = Date.now();
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  await esbuild.build({
    entryPoints: [join(src, 'js/main.js')],
    outfile: join(out, 'app.js'),
    bundle: true,
    format: 'esm',
    minify: !watch,
    sourcemap: true,
    target: ['safari15', 'chrome100'],
    legalComments: 'none',
    define: { __DEV__: String(watch) },
    logLevel: 'warning',
  });
  const entry = await cssEntry();
  await esbuild.build({
    entryPoints: [entry],
    outfile: join(out, 'app.css'),
    bundle: true,
    minify: !watch,
    target: ['safari15', 'chrome100'],
    external: ['assets/*'],
    logLevel: 'warning',
  });
  await rm(entry, { force: true });

  await cp(join(src, 'assets'), join(out, 'assets'), { recursive: true });
  await cp(join(src, 'manifest.webmanifest'), join(out, 'manifest.webmanifest'));

  const version = sha(Buffer.concat([await readFile(join(out, 'app.js')), await readFile(join(out, 'app.css'))]));

  // index.html: version stamp + iOS splash screens + CSP hash of the inline theme script
  let html = await readFile(join(src, 'index.html'), 'utf8');
  html = html.replaceAll('__VERSION__', version);
  let splash = '';
  try {
    splash = (await readFile(join(src, 'assets/splash/links.html'), 'utf8')).trim();
  } catch { /* no splash images yet */ }
  html = html.replace('<!--SPLASH-->', splash);
  const inline = html.match(/<script>(\/\*THEME\*\/[\s\S]*?)<\/script>/)[1];
  const inlineHash = createHash('sha256').update(inline).digest('base64');
  await writeFile(join(out, 'index.html'), html);

  const assets = ['./', './index.html', `./app.js?v=${version}`, `./app.css?v=${version}`, './manifest.webmanifest'];
  for (const f of await walk(join(out, 'assets'))) {
    const rel = relative(out, f).split('\\').join('/');
    if (rel.includes('/splash/')) continue; // only fetched by iOS at install time
    assets.push('./' + rel);
  }
  const sw = (await readFile(join(src, 'sw.js'), 'utf8'))
    .replace("const VERSION = '__VERSION__';", `const VERSION = ${JSON.stringify(version)};`)
    .replace('const ASSETS = __ASSETS__;', `const ASSETS = ${JSON.stringify(assets)};`);
  await writeFile(join(out, 'sw.js'), sw);

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'sha256-${inlineHash}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
  await writeFile(join(out, '_headers'), [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: same-origin',
    '  Permissions-Policy: camera=(), microphone=(self), geolocation=()',
    '/sw.js',
    '  Cache-Control: no-cache',
    '/index.html',
    '  Cache-Control: no-cache',
    '/',
    '  Cache-Control: no-cache',
    '/manifest.webmanifest',
    '  Cache-Control: no-cache',
    '/assets/*',
    '  Cache-Control: public, max-age=604800',
    '',
  ].join('\n'));

  // swap in atomically-ish: a failed build above never touches the live dist/
  const { rename } = await import('node:fs/promises');
  await rm(dist + '-old', { recursive: true, force: true });
  try { await rename(dist, dist + '-old'); } catch { /* first build */ }
  await rename(out, dist);
  await rm(dist + '-old', { recursive: true, force: true });
  console.log(`built ${version} in ${Date.now() - t0}ms`);
  return version;
}

await build();

if (watch) {
  const { watch: fsWatch } = await import('node:fs');
  let t;
  let building = false;
  let pending = false;
  const run = async () => {
    if (building) { pending = true; return; }
    building = true;
    try {
      await build();
    } catch (e) {
      console.error(`BUILD FAILED (serving last good build): ${e.message}`);
    } finally {
      building = false;
      if (pending) { pending = false; run(); }
    }
  };
  fsWatch(src, { recursive: true }, (_, file) => {
    if (file && file.includes('.entry.css')) return;
    clearTimeout(t);
    t = setTimeout(run, 150);
  });
}

if (serve) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.map': 'application/json' };
  createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    // Local server has no Netlify Identity / functions: answer like a site without them.
    if (url.pathname.startsWith('/.netlify/') || url.pathname.startsWith('/api/')) {
      res.writeHead(url.pathname === '/api/config' ? 200 : 404, { 'content-type': 'application/json' });
      return res.end(url.pathname === '/api/config' ? '{}' : '{"error":"not available locally"}');
    }
    let p = join(dist, decodeURIComponent(url.pathname));
    try {
      if ((await stat(p)).isDirectory()) p = join(p, 'index.html');
    } catch {
      p = join(dist, 'index.html');
    }
    try {
      const body = await readFile(p);
      res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  }).listen(port, () => console.log(`serving dist on http://localhost:${port}`));
}
