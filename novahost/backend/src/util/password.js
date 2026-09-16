import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/**
 * scrypt parameters.
 *
 * N=16384 (2^14) costs roughly 16 MB of memory per hash. On the Exynos 1380 a
 * single hash lands around 80-150 ms, which is a good trade: slow enough to make
 * offline cracking expensive, fast enough that logging in from a phone does not
 * feel broken. 2^15 would double both and is not worth it for a single-user
 * platform whose real exposure is the network, not the hash.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

// scrypt's memory use is roughly 128 * N * r bytes; Node caps it below that by
// default and throws, so raise the ceiling explicitly.
const MAXMEM = 256 * N * R;

/** Returns `scrypt$N$r$p$salt$hash`, all binary parts base64. */
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('password must be a non-empty string');
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEYLEN, {
    N, r: R, p: P, maxmem: MAXMEM,
  });
  return ['scrypt', N, R, P, salt.toString('base64'), derived.toString('base64')].join('$');
}

/** Constant-time verification. Never throws on malformed input — returns false. */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Guard against a tampered database row asking us to allocate gigabytes.
  if (n < 1024 || n > 1048576 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let salt, expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived;
  try {
    derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N: n, r, p, maxmem: 256 * n * r,
    });
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Password policy. Deliberately length-first rather than a symbol-class puzzle:
 * length is what actually resists guessing, and character-class rules push
 * people toward "Passw0rd!".
 */
export function checkPasswordStrength(password) {
  const errors = [];
  if (typeof password !== 'string') return { ok: false, errors: ['PASSWORD_REQUIRED'] };
  if (password.length < 10) errors.push('PASSWORD_TOO_SHORT');
  if (password.length > 200) errors.push('PASSWORD_TOO_LONG');
  if (/^\s|\s$/.test(password)) errors.push('PASSWORD_WHITESPACE_EDGES');

  const common = [
    'password', '12345678', 'qwertyui', 'letmein', 'admin123', 'welcome1',
    'passw0rd', 'iloveyou', '123456789', 'novahost',
  ];
  const lower = password.toLowerCase();
  if (common.some((c) => lower.includes(c))) errors.push('PASSWORD_TOO_COMMON');

  return { ok: errors.length === 0, errors };
}
