import { randomUUID, randomBytes } from 'node:crypto';

/** Primary key for projects, users, domains … */
export function uuid() {
  return randomUUID();
}

/**
 * Deployment ids are meant to be read by a human in a log line, so they carry
 * the date and a short random suffix: dep_20260916_a7f3c1.
 * The random suffix (not a counter) keeps ids unique even if two deploys start
 * in the same second, and keeps them unguessable from outside.
 */
export function deploymentId(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `dep_${y}${m}${d}_${randomBytes(3).toString('hex')}`;
}

/** URL-safe random token (session cookies, CSRF, verification tokens). */
export function token(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

/** Short id for things a user may retype, avoiding look-alike characters. */
export function shortId(len = 8) {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  const buf = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}
