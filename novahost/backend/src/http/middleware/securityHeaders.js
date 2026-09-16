import { config } from '../../config.js';

/**
 * Security headers.
 *
 * Two profiles, because the two servers have opposite jobs:
 *
 *   panel — locked down hard. Everything it needs comes from its own origin,
 *           so the CSP can forbid outside script, frames and form targets.
 *
 *   site  — the pages are yours and may legitimately load a CDN font or call an
 *           API, so imposing a CSP would break them for no security gain (the
 *           isolation that matters is the separate origin, not a header). We
 *           still send the headers that cost nothing and prevent real attacks.
 */

const PANEL_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Inline styles are needed for the theme variables set on the root element.
  // This is the weakest of the unsafe-* directives: it cannot execute script.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export function applyPanelHeaders(res) {
  res.setHeader('Content-Security-Policy', PANEL_CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
  if (config.secureCookies) {
    // Only meaningful over HTTPS, and actively harmful to send over plain HTTP
    // on a LAN address you may later want to reach without TLS.
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
}

export function applySiteHeaders(res, { isPrivate = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  if (isPrivate) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  // A hosted site is never a legitimate frame for the dashboard.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

/**
 * CORS for the API.
 *
 * The dashboard is served from the same origin as the API, so it needs no CORS
 * at all — which is why there is no wildcard here. We answer preflights only
 * for origins we actually recognise, so that a future CLI on localhost works
 * without opening the API to every website on the internet.
 */
export function applyCors(ctx, allowedOriginSet) {
  const origin = ctx.header('origin');
  if (!origin) return false;
  if (!allowedOriginSet.has(origin)) return false;

  ctx.res.setHeader('Access-Control-Allow-Origin', origin);
  ctx.res.setHeader('Access-Control-Allow-Credentials', 'true');
  ctx.res.setHeader('Vary', 'Origin');
  if (ctx.method === 'OPTIONS') {
    ctx.res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    ctx.res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Requested-With');
    ctx.res.setHeader('Access-Control-Max-Age', '600');
    return true;
  }
  return false;
}
