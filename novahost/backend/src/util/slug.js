/**
 * Slug generation.
 *
 * A slug becomes a DNS label (my-site.example.com), so it must obey RFC 1123:
 * lowercase letters, digits and hyphens only, 1-63 characters, no leading or
 * trailing hyphen. That is stricter than a typical URL slug and it is why
 * Arabic project names cannot be used verbatim in the hostname.
 */

const MAX_SLUG = 63;

/** Hostnames the platform needs for itself — a project may never claim them. */
export const RESERVED_SLUGS = new Set([
  'www', 'api', 'panel', 'dashboard', 'admin', 'app', 'assets', 'static',
  'cdn', 'mail', 'smtp', 'imap', 'pop', 'ftp', 'ns', 'ns1', 'ns2', 'dns',
  'localhost', 'local', 'test', 'internal', 'system', 'health', 'status',
  'login', 'logout', 'setup', 'auth', 'files', 'storage', 'backup', 'backups',
  'deploy', 'deployments', 'projects', 'settings', 'logs', 'server', 's',
]);

/**
 * Transliterate the Arabic letters that have an unambiguous Latin equivalent.
 * This is deliberately simple: it produces a *starting point* the user can edit
 * in the UI, not a linguistically correct romanisation.
 */
const ARABIC_MAP = {
  ا: 'a', أ: 'a', إ: 'i', آ: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'h',
  خ: 'kh', د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 's', ض: 'd',
  ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm',
  ن: 'n', ه: 'h', و: 'w', ي: 'y', ى: 'a', ة: 'h', ء: '', ؤ: 'w', ئ: 'y',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

export function slugify(input) {
  if (typeof input !== 'string') return '';

  // Strip Arabic diacritics (tashkeel) before transliterating.
  let s = input.normalize('NFKD').replace(/[ً-ْٰـ]/g, '');

  let out = '';
  for (const ch of s) {
    if (ARABIC_MAP[ch] !== undefined) out += ARABIC_MAP[ch];
    else out += ch;
  }

  out = out
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop combining accents: é -> e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')     // everything else becomes a separator
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return out.slice(0, MAX_SLUG).replace(/-+$/g, '');
}

/** True when the string is directly usable as a DNS label and not reserved. */
export function isValidSlug(slug) {
  if (typeof slug !== 'string') return false;
  if (slug.length < 1 || slug.length > MAX_SLUG) return false;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) return false;
  if (RESERVED_SLUGS.has(slug)) return false;
  // An all-numeric label would be ambiguous with an IPv4 octet in some resolvers.
  if (/^\d+$/.test(slug)) return false;
  return true;
}

/**
 * Turn a name into a slug that is guaranteed valid, falling back to a random
 * label when transliteration yields nothing usable (e.g. a purely emoji name).
 */
export function slugifyOrFallback(input, fallback) {
  const s = slugify(input);
  if (isValidSlug(s)) return s;
  if (s.length > 0 && !RESERVED_SLUGS.has(s) && /^[a-z0-9-]+$/.test(s)) {
    const fixed = `site-${s}`.slice(0, MAX_SLUG).replace(/-+$/g, '');
    if (isValidSlug(fixed)) return fixed;
  }
  return fallback;
}

/**
 * Append -2, -3 … until `taken(candidate)` returns false.
 * `taken` is synchronous on purpose: it is backed by a single indexed SELECT.
 */
export function uniqueSlug(base, taken) {
  if (!taken(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`;
    const candidate = base.slice(0, MAX_SLUG - suffix.length).replace(/-+$/g, '') + suffix;
    if (!taken(candidate)) return candidate;
  }
  throw new Error('could not allocate a unique slug');
}
