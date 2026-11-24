// Download relay for Dandana, running on Netlify's edge next to the app.
//
// Some cobalt servers work but don't send CORS headers, so a web page can't
// call them. This relay forwards the app's request to an allowed cobalt
// server and streams the file back from the same site — so the browser has
// nothing to block. The cobalt server does the downloading; this only passes
// bytes along. Tunnel links are HMAC-signed so the relay can't be used as an
// open proxy for arbitrary URLs.

// Set at deploy time (never committed): RELAY_SECRET env var, or the
// placeholder below replaced by the deploy step with a random value.
const SECRET = (globalThis.Netlify && Netlify.env.get('RELAY_SECRET')) || '__RELAY_SECRET__';
const HOSTS = ['rue-cobalt.xenon.zone', 'cobaltapi.cjs.nz', 'api.cobalt.liubquanti.click'];

const enc = new TextEncoder();
let keyP;
const key = () => (keyP ||= crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const mac = async (s) => b64u(await crypto.subtle.sign('HMAC', await key(), enc.encode(s)));
const sign = async (u) => `/relay/tunnel?u=${encodeURIComponent(u)}&s=${await mac(u)}`;
async function verify(u, s) {
  const want = await mac(u);
  if (!s || s.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ s.charCodeAt(i);
  return diff === 0;
}
/** Only cobalt download links on the allowed servers can be relayed. */
function tunnelAllowed(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && HOSTS.includes(x.host) && x.pathname.startsWith('/tunnel');
  } catch {
    return false;
  }
}
const json = (d, status = 200) => new Response(JSON.stringify(d), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === '/relay/health') return json({ ok: true, hosts: HOSTS });

  if (path === '/relay/cobalt' && req.method === 'POST') {
    let input;
    try { input = await req.json(); } catch { return json({ status: 'error', error: { code: 'relay.bad_body' } }, 400); }
    let target;
    try { target = new URL(input.instance); } catch { return json({ status: 'error', error: { code: 'relay.bad_instance' } }, 400); }
    if (target.protocol !== 'https:' || !HOSTS.includes(target.host)) return json({ status: 'error', error: { code: 'relay.host_not_allowed' } }, 403);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 35000);
    let r;
    try {
      r = await fetch(target.origin + '/', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Dandana)' },
        body: JSON.stringify(input.body || {}),
        signal: ctl.signal,
      });
    } catch {
      return json({ status: 'error', error: { code: 'relay.unreachable' } }, 502);
    } finally {
      clearTimeout(timer);
    }
    let d;
    try { d = await r.json(); } catch { return json({ status: 'error', error: { code: 'relay.bad_reply', context: { status: r.status } } }, 502); }
    const wrap = async (u) => (tunnelAllowed(u) ? sign(u) : u);
    if (d && typeof d.url === 'string') d.url = await wrap(d.url);
    if (d && typeof d.audio === 'string') d.audio = await wrap(d.audio);
    if (d && Array.isArray(d.picker)) for (const p of d.picker) if (p && typeof p.url === 'string') p.url = await wrap(p.url);
    return json(d, r.status);
  }

  if (path === '/relay/tunnel' && (req.method === 'GET' || req.method === 'HEAD')) {
    const u = url.searchParams.get('u');
    if (!u || !tunnelAllowed(u) || !(await verify(u, url.searchParams.get('s')))) return new Response('forbidden', { status: 403 });
    const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; Dandana)' };
    const range = req.headers.get('range');
    if (range) headers.Range = range;
    let up;
    try { up = await fetch(u, { headers, method: req.method }); } catch { return new Response('upstream unreachable', { status: 502 }); }
    const out = new Headers({ 'cache-control': 'no-store' });
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'estimated-content-length']) {
      const v = up.headers.get(k);
      if (v) out.set(k, v);
    }
    return new Response(up.body, { status: up.status, headers: out });
  }

  return json({ error: 'not found' }, 404);
};

export const config = { path: '/relay/*' };
