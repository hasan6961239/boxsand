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
    // RSS wraps article text in CDATA. Unwrap it first: the tag stripper below
    // would otherwise treat "<![CDATA[ … ]]>" as one tag and delete the text.
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
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

/**
 * Text-extraction proxies used when a site refuses the runner directly.
 *
 * Several Libyan news sites sit behind bot protection that answers datacentre
 * IPs with 403 no matter how browser-like the headers are. These public
 * readers fetch the page from their own infrastructure and hand back its text,
 * which is all the extractor needs.
 */
const READER_PROXIES = [
  (url) => `https://r.jina.ai/${url}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
];

/** Responses worth retrying through a reader rather than giving up on. */
const BLOCKED = /HTTP (401|403|405|406|409|429|451|503)/;

/**
 * Fetch a page, falling back to a reader proxy when the site blocks us.
 * Returns `{ text, via }` so the run can report which route worked.
 */
export async function fetchPage(url, opts = {}) {
  try {
    return { text: await fetchText(url, { retries: 1, ...opts }), via: 'direct' };
  } catch (err) {
    if (!BLOCKED.test(String(err?.message ?? ''))) throw err;

    // Record why each route failed. Without this the source health table only
    // ever says "403" and there is no way to tell a blocked reader from a
    // reader that answered with an empty page.
    const attempts = [`direct ${err.message}`];
    for (const build of READER_PROXIES) {
      const proxied = build(url);
      const host = new URL(proxied).hostname.replace(/^(www|api|r)\./, '');
      try {
        const text = await fetchText(proxied, { retries: 0, timeout: 25000 });
        if (text && text.length > 200) return { text, via: host };
        attempts.push(`${host} empty`);
      } catch (proxyErr) {
        attempts.push(`${host} ${String(proxyErr?.message ?? proxyErr).slice(0, 24)}`);
      }
    }
    throw new Error(attempts.join(' · '));
  }
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
export function findNearNumber(text, aliases, { min, max, window = 160, requireDecimal = false } = {}) {
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
      // Exchange rates are always quoted with decimals (9.39, 10.89). Requiring
      // one rejects the bare integers that page furniture is full of — menu
      // counts, years, "منذ 3 ايام" — which otherwise parse as plausible rates.
      const pattern = requireDecimal ? /\d{1,4}[.,]\d{1,4}/g : /\d{1,4}(?:[.,]\d{1,4})?/g;
      for (const m of slice.matchAll(pattern)) {
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
