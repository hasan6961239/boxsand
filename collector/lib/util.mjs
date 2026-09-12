/**
 * Shared helpers for the rate collector.
 *
 * Everything here is dependency-free so the workflow can run on a bare Node
 * runtime with no `npm install` step.
 */

/** Arabic-Indic and Extended Arabic-Indic digits -> ASCII. */
const DIGIT_MAP = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٫': '.', // Arabic decimal separator
  '٬': ',', // Arabic thousands separator
};

export function normalizeDigits(s) {
  return String(s).replace(/[٠-٩۰-۹٫٬]/g, (d) => DIGIT_MAP[d] ?? d);
}

/** Arabic letter normalization so city/currency aliases match loosely. */
export function normalizeArabic(s) {
  return normalizeDigits(s)
    .replace(/[ً-ْـ]/g, '')            // harakat + tatweel
    .replace(/[آأإٱ]/g, 'ا') // alef variants -> ا
    .replace(/ى/g, 'ي')                     // alef maqsura -> ي
    .replace(/ة/g, 'ه');                    // ta marbuta -> ه
}

/** Strip markup and collapse whitespace, keeping a readable text stream. */
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * fetch with a timeout, a browser-ish UA (several Libyan news sites reject the
 * default Node agent) and bounded retries on transient failures.
 */
export async function fetchText(url, { timeout = 15000, retries = 2, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
        headers: {
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'accept-language': 'ar,en;q=0.8',
          accept: 'text/html,application/json,*/*',
          ...headers,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, { ...opts, headers: { accept: 'application/json', ...(opts?.headers || {}) } }));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Parse a loose numeric token ("9,27" / "٩.٢٧" / "9.27 د.ل") into a number. */
export function parseNum(raw) {
  if (raw == null) return null;
  let s = normalizeDigits(String(raw)).replace(/[^\d.,-]/g, '');
  if (!s) return null;
  // "9,27" is a decimal comma; "4,383" with a 3-digit group is a thousands separator.
  if (s.includes(',') && !s.includes('.')) {
    s = /,\d{3}(?!\d)/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Round to `d` decimals without float dust. */
export function round(n, d = 4) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/**
 * Pull a plausible rate out of free text by proximity to a label.
 *
 * Libyan rate pages share no stable markup, so instead of CSS selectors we
 * look for the label (city or currency) and take the closest number that falls
 * inside the expected band for that quote.
 */
export function findNearNumber(text, aliases, { min, max, window = 160 } = {}) {
  const hay = normalizeArabic(text);
  const candidates = [];
  for (const alias of aliases) {
    const needle = normalizeArabic(alias);
    if (!needle) continue;
    let idx = hay.indexOf(needle);
    while (idx !== -1) {
      const from = Math.max(0, idx - Math.round(window / 3));
      const slice = hay.slice(from, idx + needle.length + window);
      const anchor = idx - from + needle.length;
      for (const m of slice.matchAll(/\d{1,4}(?:[.,]\d{1,4})?/g)) {
        const val = parseNum(m[0]);
        if (val == null || val < min || val > max) continue;
        // Numbers that follow the label win over numbers that precede it.
        const offset = m.index - anchor;
        candidates.push({ val, score: offset >= 0 ? offset : Math.abs(offset) * 2.5 });
      }
      idx = hay.indexOf(needle, idx + 1);
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0].val;
}

/** Median of the numeric values — resistant to one bad scrape. */
export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
