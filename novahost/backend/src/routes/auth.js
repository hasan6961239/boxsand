import { config } from '../config.js';
import { json, noContent } from '../http/respond.js';
import { errors } from '../http/errors.js';
import { enforce, refund } from '../http/middleware/ratelimit.js';
import { requireAuth } from '../http/middleware/auth.js';
import * as usersRepo from '../db/repo/users.js';
import * as sessionsRepo from '../db/repo/sessions.js';
import * as auditRepo from '../db/repo/audit.js';
import { hashPassword, verifyPassword, checkPasswordStrength } from '../util/password.js';
import { str, bool, email as validateEmail, enumValue } from '../util/validate.js';
import { createLogger } from '../logger.js';

const log = createLogger('auth');

function sessionCookieOptions(remember) {
  return {
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.secureCookies,
    path: '/',
    maxAge: remember ? config.sessionTtlHours * 3600 : undefined,
  };
}

export function register(router) {
  /**
   * Sign in.
   *
   * Two layers of throttling, deliberately different in kind:
   *   - per IP, in memory, to blunt a burst;
   *   - per account, in the database, so an attacker rotating through addresses
   *     still hits an escalating lockout that survives a restart.
   *
   * The response is identical for "no such user" and "wrong password", and
   * both paths do the same work, so the platform cannot be used to find out
   * which usernames exist.
   */
  router.post('/api/auth/login', async (ctx) => {
    enforce(ctx, 'login', ctx.ip);

    const body = await ctx.json();
    const identifier = str(body, 'username', { min: 1, max: 254 });
    const password = str(body, 'password', { min: 1, max: 200, trim: false });
    const remember = bool(body, 'remember', { fallback: true });

    const user = usersRepo.findByLogin(identifier);

    if (user?.locked_until && Date.parse(user.locked_until) > Date.now()) {
      const seconds = Math.ceil((Date.parse(user.locked_until) - Date.now()) / 1000);
      auditRepo.recordSecurityEvent({
        type: 'login_blocked', username: identifier, ip: ctx.ip, userAgent: ctx.userAgent,
        detail: 'account temporarily locked',
      });
      throw errors.rateLimited(`Too many failed attempts. Try again in ${seconds} seconds.`, seconds);
    }

    // Run the hash comparison even when the user does not exist, against a
    // throwaway value, so the response time does not reveal which case it was.
    const storedHash = user?.password_hash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';
    const ok = await verifyPassword(password, storedHash);

    if (!user || !ok) {
      if (user) usersRepo.recordLoginFailure(user.id);
      auditRepo.recordSecurityEvent({
        type: 'login_failed', username: identifier, ip: ctx.ip, userAgent: ctx.userAgent,
        detail: user ? 'wrong password' : 'unknown account',
      });
      log.warn('failed login', { ip: ctx.ip, identifier: identifier.slice(0, 40) });
      throw errors.unauthorised('Incorrect username or password');
    }

    const session = sessionsRepo.createSession({
      userId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      ttlHours: config.sessionTtlHours,
    });

    usersRepo.recordLoginSuccess(user.id);
    refund('login', ctx.ip); // a correct password should not count against you
    auditRepo.recordSecurityEvent({
      type: 'login_success', username: user.username, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    log.info('login', { user: user.username, ip: ctx.ip });

    ctx.setCookie(config.sessionCookieName, session.token, sessionCookieOptions(remember));

    json(ctx.res, {
      user: usersRepo.publicUser(user),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
  });

  router.post('/api/auth/logout', async (ctx) => {
    const raw = ctx.cookies[config.sessionCookieName];
    if (raw) {
      sessionsRepo.destroyByToken(raw);
      if (ctx.user) {
        auditRepo.recordSecurityEvent({
          type: 'logout', username: ctx.user.username, ip: ctx.ip, userAgent: ctx.userAgent,
        });
      }
    }
    ctx.clearCookie(config.sessionCookieName);
    noContent(ctx.res);
  });

  /** Who am I, plus the CSRF token this session must send on writes. */
  router.get('/api/auth/me', async (ctx) => {
    const user = requireAuth(ctx);
    const record = usersRepo.findById(user.id);
    json(ctx.res, {
      user: usersRepo.publicUser(record),
      csrfToken: ctx.session.csrf_token,
      expiresAt: ctx.session.expires_at,
    });
  });

  router.patch('/api/auth/profile', async (ctx) => {
    const user = requireAuth(ctx);
    const body = await ctx.json();

    const displayName = str(body, 'displayName', { required: false, max: 80 });
    const emailValue = validateEmail(body, 'email', { required: false });
    const locale = enumValue(body, 'locale', ['ar', 'en'], { required: false, fallback: null });
    const theme = enumValue(body, 'theme', ['dark', 'light', 'system'], { required: false, fallback: null });

    if (emailValue) {
      const existing = usersRepo.findByEmail(emailValue);
      if (existing && existing.id !== user.id) {
        throw errors.conflict('EMAIL_TAKEN', 'Another account already uses that email');
      }
    }

    const updated = usersRepo.updateProfile(user.id, {
      displayName, email: emailValue, locale, theme,
    });
    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'profile.update',
      targetType: 'user', targetId: user.id, ip: ctx.ip,
    });
    json(ctx.res, { user: usersRepo.publicUser(updated) });
  });

  /**
   * Change password.
   * Every other session is destroyed, because a password change is usually a
   * response to suspecting someone else has access.
   */
  router.post('/api/auth/password', async (ctx) => {
    const user = requireAuth(ctx);
    enforce(ctx, 'write', ctx.ip);

    const body = await ctx.json();
    const currentPassword = str(body, 'currentPassword', { min: 1, max: 200, trim: false });
    const newPassword = str(body, 'newPassword', { min: 1, max: 200, trim: false });

    const record = usersRepo.findById(user.id);
    if (!(await verifyPassword(currentPassword, record.password_hash))) {
      auditRepo.recordSecurityEvent({
        type: 'password_change_failed', username: user.username, ip: ctx.ip, userAgent: ctx.userAgent,
      });
      throw errors.unauthorised('Your current password is not correct');
    }

    const strength = checkPasswordStrength(newPassword);
    if (!strength.ok) {
      throw errors.validation(
        strength.errors.map((code) => ({ field: 'newPassword', code, message: code })),
        'Choose a stronger password',
      );
    }

    usersRepo.updatePassword(user.id, await hashPassword(newPassword));
    sessionsRepo.destroyAllForUser(user.id, { exceptId: ctx.session.id });

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'password.change',
      targetType: 'user', targetId: user.id, ip: ctx.ip,
    });
    auditRepo.recordSecurityEvent({
      type: 'password_changed', username: user.username, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    log.info('password changed', { user: user.username });

    json(ctx.res, { changed: true, otherSessionsSignedOut: true });
  });

  router.get('/api/auth/sessions', async (ctx) => {
    const user = requireAuth(ctx);
    const items = sessionsRepo.listForUser(user.id).map((row) => ({
      id: row.id,
      current: row.id === ctx.session.id,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
    }));
    json(ctx.res, { items });
  });

  router.delete('/api/auth/sessions/:id', async (ctx) => {
    const user = requireAuth(ctx);
    const target = sessionsRepo.listForUser(user.id).find((row) => row.id === ctx.params.id);
    if (!target) throw errors.notFound('SESSION_NOT_FOUND', 'That session does not exist');
    sessionsRepo.destroy(target.id);
    if (target.id === ctx.session.id) ctx.clearCookie(config.sessionCookieName);
    noContent(ctx.res);
  });
}
