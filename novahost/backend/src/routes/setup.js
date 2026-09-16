import { config } from '../config.js';
import { json } from '../http/respond.js';
import { errors, AppError } from '../http/errors.js';
import { enforce } from '../http/middleware/ratelimit.js';
import { setupRequired } from '../http/middleware/auth.js';
import * as usersRepo from '../db/repo/users.js';
import * as sessionsRepo from '../db/repo/sessions.js';
import * as auditRepo from '../db/repo/audit.js';
import { hashPassword, checkPasswordStrength } from '../util/password.js';
import { str, email as validateEmail } from '../util/validate.js';
import { createLogger } from '../logger.js';

const log = createLogger('setup');

/**
 * First-run setup.
 *
 * The endpoint is open only while the users table is empty. After the first
 * account exists every call returns 410 Gone, so the route effectively deletes
 * itself — there is no flag to forget to turn off, and no window where someone
 * who finds the URL can create a second admin.
 */
export function register(router) {
  router.get('/api/setup/status', async (ctx) => {
    json(ctx.res, {
      setupRequired: setupRequired(),
      appName: config.appName,
    });
  });

  router.post('/api/setup', async (ctx) => {
    enforce(ctx, 'setup', ctx.ip);

    if (!setupRequired()) {
      throw new AppError(
        'SETUP_ALREADY_DONE',
        'Setup has already been completed. Sign in instead.',
        { status: 410 },
      );
    }

    const body = await ctx.json();
    const username = str(body, 'username', {
      min: 3, max: 32, pattern: /^[a-zA-Z0-9._-]+$/,
    }).toLowerCase();
    const emailValue = validateEmail(body, 'email');
    const password = str(body, 'password', { min: 1, max: 200, trim: false });

    const strength = checkPasswordStrength(password);
    if (!strength.ok) {
      throw errors.validation(
        strength.errors.map((code) => ({ field: 'password', code, message: code })),
        'Choose a stronger password',
      );
    }

    const user = usersRepo.createUser({
      username,
      email: emailValue,
      passwordHash: await hashPassword(password),
      role: 'admin',
      displayName: str(body, 'displayName', { required: false, max: 80 }) ?? username,
    });

    const session = sessionsRepo.createSession({
      userId: user.id, ip: ctx.ip, userAgent: ctx.userAgent, ttlHours: config.sessionTtlHours,
    });

    auditRepo.record({
      actorId: user.id, actorName: user.username, action: 'setup.complete',
      targetType: 'user', targetId: user.id, targetName: user.username, ip: ctx.ip,
    });
    auditRepo.recordSecurityEvent({
      type: 'setup', username: user.username, ip: ctx.ip, userAgent: ctx.userAgent,
      detail: 'first admin account created',
    });
    log.info('admin account created', { username: user.username });

    ctx.setCookie(config.sessionCookieName, session.token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: config.secureCookies,
      path: '/',
      maxAge: config.sessionTtlHours * 3600,
    });

    json(ctx.res, {
      user: usersRepo.publicUser(user),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    }, 201);
  });
}
