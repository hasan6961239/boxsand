/**
 * Source adapters.
 *
 * Every adapter is isolated: it either resolves with data or throws, and the
 * orchestrator records the outcome per source. One dead site never takes the
 * run down, and the dashboard shows which sources were live.
 */
import { fetchText, fetchJson, htmlToText, findNearNumber, normalizeArabic, parseNum, round } from './lib/util.mjs';

/* ------------------------------------------------------------------ labels */

export const CITIES = {
  tripoli:  { ar: 'طرابلس', en: 'Tripoli',  market: 'سوق المشير',  aliases: ['طرابلس', 'Tripoli', 'المشير'] },
  benghazi: { ar: 'بنغازي', en: 'Benghazi', market: 'سوق فينيسيا', aliases: ['بنغازي', 'Benghazi', 'فينيسيا', 'بنغاري'] },
  misrata:  { ar: 'مصراتة', en: 'Misrata',  market: 'سوق مصراتة',  aliases: ['مصراتة', 'مصراته', 'Misrata', 'Misurata'] },
};

const CURRENCY_ALIASES = {
  USD: ['الدولار', 'دولار', 'الأمريكي', 'الامريكي', 'USD', 'Dollar'],
  EUR: ['اليورو', 'يورو', 'الأوروبي', 'الاوروبي', 'EUR', 'Euro'],
  GBP: ['الإسترليني', 'الاسترليني', 'الجنيه', 'باوند', 'GBP', 'Pound'],
};

/** Plausible LYD-per-unit bands — anything outside is a mis-parse, not a rate. */
const BANDS = {
  USD: { min: 3, max: 30 },
  EUR: { min: 3, max: 35 },
  GBP: { min: 4, max: 45 },
};

/* ------------------------------------------------- per-city text extraction */

/**
 * Split free text into spans owned by a currency, then read each city inside
 * its span. Libyan rate pages are laid out either currency-major ("الدولار:
 * طرابلس 9.27 بنغازي 9.26") or city-major; we run both passes and keep the
 * one that resolved more cities.
 */
export function extractCityRates(text) {
  const byCurrency = passCurrencyMajor(text);
  const byCity = passCityMajor(text);
  const out = {};
  for (const code of Object.keys(BANDS)) {
    const a = byCurrency[code] || {};
    const b = byCity[code] || {};
    out[code] = Object.keys(a).length >= Object.keys(b).length ? a : b;
  }
  return out;
}

function markerPositions(hay, aliases) {
  const hits = [];
  for (const alias of aliases) {
    const needle = normalizeArabic(alias);
    let i = hay.indexOf(needle);
    while (i !== -1) { hits.push(i); i = hay.indexOf(needle, i + 1); }
  }
  return hits.sort((x, y) => x - y);
}

function passCurrencyMajor(text) {
  const hay = normalizeArabic(text);
  // Every currency mention is a boundary; a span runs to the next one.
  const marks = [];
  for (const [code, aliases] of Object.entries(CURRENCY_ALIASES)) {
    for (const pos of markerPositions(hay, aliases)) marks.push({ pos, code });
  }
  marks.sort((a, b) => a.pos - b.pos);

  const result = {};
  for (let i = 0; i < marks.length; i++) {
    const { pos, code } = marks[i];
    const end = Math.min(marks[i + 1]?.pos ?? hay.length, pos + 600);
    const span = hay.slice(pos, end);
    for (const [key, city] of Object.entries(CITIES)) {
      if (result[code]?.[key] != null) continue;
      const val = findNearNumber(span, city.aliases, { ...BANDS[code], window: 90 });
      if (val != null) (result[code] ||= {})[key] = val;
    }
  }
  return result;
}

function passCityMajor(text) {
  const hay = normalizeArabic(text);
  const marks = [];
  for (const [key, city] of Object.entries(CITIES)) {
    for (const pos of markerPositions(hay, city.aliases)) marks.push({ pos, key });
  }
  marks.sort((a, b) => a.pos - b.pos);

  const result = {};
  for (let i = 0; i < marks.length; i++) {
    const { pos, key } = marks[i];
    const end = Math.min(marks[i + 1]?.pos ?? hay.length, pos + 400);
    const span = hay.slice(pos, end);
    for (const [code, aliases] of Object.entries(CURRENCY_ALIASES)) {
      if (result[code]?.[key] != null) continue;
      const val = findNearNumber(span, aliases, { ...BANDS[code], window: 90 });
      if (val != null) (result[code] ||= {})[key] = val;
    }
  }
  return result;
}

/** Market-wide rate with no city attached — the national headline number. */
export function extractNationalRates(text) {
  const out = {};
  for (const [code, aliases] of Object.entries(CURRENCY_ALIASES)) {
    const val = findNearNumber(text, aliases, { ...BANDS[code], window: 70 });
    if (val != null) out[code] = val;
  }
  return out;
}

/* ------------------------------------------------------ parallel-market feeds */

/**
 * Telegram renders public channels as plain HTML at /s/<channel> with no auth,
 * which makes the live trading-floor channels the most dependable scrape target.
 */
const TELEGRAM_CHANNELS = ['lydollar'];

const PARALLEL_PAGES = [
  'https://almashhadlibya.com/economic-news/currency-prices',
  'https://www.libyaakhbar.com/latestnews/currency-prices',
  'https://www.eanlibya.com/exchangerate/',
];

export async function parallelFromTelegram() {
  const merged = {};
  const seen = [];
  for (const channel of TELEGRAM_CHANNELS) {
    const html = await fetchText(`https://t.me/s/${channel}`);
    // Newest messages sit last in the preview feed; read the tail only.
    const messages = [...html.matchAll(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g)]
      .map((m) => htmlToText(m[1]));
    const recent = messages.slice(-6).reverse();
    seen.push(`${channel}:${messages.length}msg`);
    for (const msg of recent) {
      const found = extractCityRates(msg);
      const national = extractNationalRates(msg);
      for (const code of Object.keys(BANDS)) {
        merged[code] ||= {};
        for (const [city, val] of Object.entries(found[code] || {})) merged[code][city] ??= val;
        if (national[code] != null) merged[code].national ??= national[code];
      }
    }
  }
  if (!Object.values(merged).some((c) => Object.keys(c).length)) throw new Error('no rates parsed from telegram');
  return { rates: merged, detail: seen.join(', ') };
}

export async function parallelFromNewsPage(url) {
  const text = htmlToText(await fetchText(url));
  const found = extractCityRates(text);
  const national = extractNationalRates(text);
  const merged = {};
  for (const code of Object.keys(BANDS)) {
    merged[code] = { ...(found[code] || {}) };
    if (national[code] != null) merged[code].national ??= national[code];
  }
  if (!Object.values(merged).some((c) => Object.keys(c).length)) throw new Error(`no rates parsed from ${url}`);
  return { rates: merged, detail: `${text.length} chars` };
}

export const PARALLEL_SOURCES = [
  { id: 'telegram-lydollar', label: 'قناة سوق المشير (تلغرام)', url: 'https://t.me/s/lydollar', weight: 3, run: parallelFromTelegram },
  ...PARALLEL_PAGES.map((url) => ({
    id: new URL(url).hostname.replace(/^www\./, ''),
    label: new URL(url).hostname.replace(/^www\./, ''),
    url,
    weight: 1,
    run: () => parallelFromNewsPage(url),
  })),
];

/* ------------------------------------------------------------ official rates */

export async function officialFromCbl() {
  const pages = ['https://cbl.gov.ly/currency-exchange-rates/', 'https://cbl.gov.ly/en/exchange-rates/'];
  let lastErr;
  for (const url of pages) {
    try {
      const text = htmlToText(await fetchText(url));
      const usd = findNearNumber(text, ['دولار امريكي', 'الدولار الأمريكي', 'USD', 'US Dollar', 'الدولار'], { min: 1, max: 20, window: 80 });
      const eur = findNearNumber(text, ['اليورو', 'يورو', 'EUR', 'Euro'], { min: 1, max: 25, window: 80 });
      const gbp = findNearNumber(text, ['الإسترليني', 'الاسترليني', 'GBP', 'Sterling'], { min: 1, max: 30, window: 80 });
      if (usd == null) throw new Error('USD not found on CBL page');
      return { rates: { USD: usd, EUR: eur, GBP: gbp }, detail: url };
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

/** International USD->LYD reference, used to cross-check and to fill gaps. */
export async function fxFromErApi() {
  const j = await fetchJson('https://open.er-api.com/v6/latest/USD');
  if (!j?.rates?.LYD) throw new Error('LYD missing from er-api');
  return { rates: { LYD: j.rates.LYD, EUR: j.rates.EUR, GBP: j.rates.GBP }, detail: j.time_last_update_utc || '' };
}

export async function fxFromJsdelivr() {
  const j = await fetchJson('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
  const r = j?.usd;
  if (!r?.lyd) throw new Error('LYD missing from currency-api');
  return { rates: { LYD: r.lyd, EUR: r.eur, GBP: r.gbp }, detail: j.date || '' };
}

/* -------------------------------------------------------------- metals spot */

export async function metalsFromGoldApi() {
  const [xau, xag] = await Promise.all([
    fetchJson('https://api.gold-api.com/price/XAU'),
    fetchJson('https://api.gold-api.com/price/XAG').catch(() => null),
  ]);
  const gold = parseNum(xau?.price);
  if (!gold) throw new Error('no XAU price');
  return { rates: { XAU: gold, XAG: parseNum(xag?.price) }, detail: xau?.updatedAt || '' };
}

export async function metalsFromGoldPriceOrg() {
  const j = await fetchJson('https://data-asg.goldprice.org/dbXRates/USD');
  const item = j?.items?.[0];
  const gold = parseNum(item?.xauPrice);
  if (!gold) throw new Error('no xauPrice');
  return { rates: { XAU: gold, XAG: parseNum(item?.xagPrice) }, detail: j?.date || '' };
}

/** PAX Gold is a 1:1 gold-backed token — a usable last-resort spot proxy. */
export async function metalsFromPaxg() {
  const j = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=pax-gold&vs_currencies=usd');
  const gold = parseNum(j?.['pax-gold']?.usd);
  if (!gold) throw new Error('no PAXG price');
  return { rates: { XAU: gold, XAG: null }, detail: 'PAXG proxy' };
}

/* ------------------------------------------------------------ gold pricing */

const TROY_OUNCE_G = 31.1034768;

/** Karat purities used by Libyan jewellers. */
export const KARATS = [
  { k: 24, purity: 0.999, label: 'عيار 24' },
  { k: 22, purity: 0.916, label: 'عيار 22' },
  { k: 21, purity: 0.875, label: 'عيار 21' },
  { k: 18, purity: 0.750, label: 'عيار 18' },
  { k: 14, purity: 0.585, label: 'عيار 14' },
];

/** Per-gram gold in LYD for each karat at a given USD/LYD rate. */
export function goldTable(xauUsdPerOz, lydPerUsd) {
  if (!xauUsdPerOz || !lydPerUsd) return null;
  const perGramUsd = xauUsdPerOz / TROY_OUNCE_G;
  const out = {};
  for (const { k, purity } of KARATS) out[k] = round(perGramUsd * purity * lydPerUsd, 2);
  return out;
}

export { TROY_OUNCE_G, BANDS, CURRENCY_ALIASES };
