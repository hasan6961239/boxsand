import { timingSafeEqual } from 'node:crypto';
import { config, allowedOrigins } from '../../config.js';
import { errors } from '../errors.js';
import * as sessionsRepo from '../../db/repo/sessions.js';
import * as usersRepo from '../../db/repo/users.js';
import { isExpired } from '../../util/time.js';

/**
 * Attach the current session and user to the context, if any.
 * Never throws: an absent or stale cookie simply means "not signed in", and the
 * routes that care call requireAuth().
 */
export function loadSession(ctx) {
  const raw = ctx.cookies[config.sessionCookieName];
  if (!raw) return;

  let session;
  try {
    session = sessionsRepo.findByToken(raw);
  } catch {
    return;
  }
  if (!session) return;

  if (isExpired(session.expires_at)) {
    sessionsRepo.destroy(session.id);
    ctx.clearCookie(config.sessionCookieName);
    return;
  }

  ctx.session = session;
  ctx.user = {
    id: session.user_id,
    username: session.username,
    email: session.email,
    role: session.role,
    displayName: session.display_name || session.username,
    locale: session.locale,
    theme: session.theme,
  };

  sessionsRepo.touch(session.id, session.last_seen_at);
}

export function requireAuth(ctx) {
  if (!ctx.user) throw errors.unauthorised('Sign in to continue');
  return ctx.user;
}

export function requireAdmin(ctx) {
  const user = requireAuth(ctx);
  if (user.role !== 'admin') throw errors.forbidden('This action requires an admin account');
  return user;
}

/** True before the first account exists — the only time /api/setup is open. */
export function setupRequired() {
  return usersRepo.countUsers() === 0;
}

function safeCompare(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * CSRF protection for state-changing requests.
 *
 * Two independent checks, either of which alone would stop the common attack:
 *
 *   1. Origin / Referer must be one we recognise. A cross-site form post has
 *      an Origin the browser sets and the attacker cannot forge.
 *   2. X-CSRF-Token must equal the token bound to this session. A cross-origin
 *      page cannot read it, and it cannot set a custom header on a simple
 *      form post at all.
 *
 * Together with SameSite=Lax on the cookie that is three layers. Safe methods
 * are exempt because they must not change state in the first place.
 */
export function verifyCsrf(ctx) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(ctx.method)) return;
  if (!ctx.session) return; // Unauthenticated endpoints have nothing to protect.

  const origin = ctx.header('origin');
  const referer = ctx.header('referer');
  const allowed = allowedOrigins();

  if (origin) {
    if (!allowed.has(origin) && !isSameHostAsRequest(origin, ctx)) {
      throw errors.forbidden('Request blocked: unrecognised origin');
    }
  } else if (referer) {
    let refOrigin;
    try {
      refOrigin = new URL(referer).origin;
    } catch {
      throw errors.forbidden('Request blocked: malformed referer');
    }
    if (!allowed.has(refOrigin) && !isSameHostAsRequest(refOrigin, ctx)) {
      throw errors.forbidden('Request blocked: unrecognised referer');
    }
  }
  // A request with neither header is allowed through to the token check below:
  // non-browser clients (curl, the future CLI) legitimately send neither, and
  // they cannot be the vehicle of a cross-site request anyway.

  const provided = ctx.header('x-csrf-token');
  if (!provided || !safeCompare(provided, ctx.session.csrf_token)) {
    throw errors.forbidden('Request blocked: invalid CSRF token');
  }
}

/**
 * Accept an origin whose host matches the Host header of this very request.
 * This is what makes LAN access work: the dashboard opened at
 * http://192.168.1.14:8080 has an origin nobody could have configured ahead of
 * time, yet it is unquestionably same-origin.
 */
function isSameHostAsRequest(origin, ctx) {
  try {
    const url = new URL(origin);
    const originHost = url.hostname.toLowerCase();
    if (originHost !== ctx.host) return false;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const hostHeader = String(ctx.header('host') ?? '');
    const hostPort = hostHeader.includes(':') ? hostHeader.split(':').pop() : '80';
    return port === hostPort || url.protocol === 'https:';
  } catch {
    return false;
  }
}
