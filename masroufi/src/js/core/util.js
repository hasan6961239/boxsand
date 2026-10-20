// Shared helpers: ids, money (stored as integer milli-dinars), local dates, formatting.
// Pure module — imported by both the app and the Netlify functions, so no DOM here.

/* ---------------------------------------------------------------- ids */

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

export function uid(prefix = '') {
  const t = Date.now().toString(36);
  const r = new Uint8Array(8);
  globalThis.crypto.getRandomValues(r);
  let s = '';
  for (const b of r) s += B36[b % 36];
  return prefix + t + s;
}

/* -------------------------------------------------------------- money */

// One dinar = 1000 dirham. Every amount in the data is an integer number of
// dirhams ("milli"), so sums never drift the way 0.1 + 0.2 does.
export const MILLI = 1000;

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function latinDigits(s) {
  return String(s ?? '')
    .replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d))
    .replace(/[۰-۹]/g, (d) => FA_DIGITS.indexOf(d))
    .replace(/[٫,]/g, (c) => (c === '٫' ? '.' : c))
    .replace(/٬/g, ',');
}

/** "1,250.5" | "١٢٥٠٫٥" | 1250.5 → 1250500. Returns NaN for junk. */
export function toMilli(input) {
  if (typeof input === 'number') return Math.round(input * MILLI);
  let s = latinDigits(input).trim().replace(/[\s,]/g, '');
  if (!s) return NaN;
  let neg = false;
  if (s[0] === '-' || s[0] === '−') { neg = true; s = s.slice(1); }
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return NaN;
  const [i = '0', f = ''] = s.split('.');
  const frac = (f + '000').slice(0, 3);
  const extra = f.length > 3 ? Number(f[3]) >= 5 : false;
  const v = Number(i || '0') * MILLI + Number(frac) + (extra ? 1 : 0);
  return neg ? -v : v;
}

export const fromMilli = (m) => (m || 0) / MILLI;

/** Plain number string for inputs: 12500 → "12.5" */
export function milliToInput(m) {
  if (!m) return '';
  const neg = m < 0;
  const a = Math.abs(m);
  const i = Math.floor(a / MILLI);
  const f = String(a % MILLI).padStart(3, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + i + (f ? '.' + f : '');
}

let fmtPrefs = { digits: 'latin' };
export function setFormatPrefs(p) { fmtPrefs = { ...fmtPrefs, ...p }; }

function localizeDigits(s) {
  if (fmtPrefs.digits !== 'arab') return s;
  return s.replace(/\d/g, (d) => AR_DIGITS[d]).replace(/\./g, '٫').replace(/,/g, '٬');
}

/** Group thousands and keep up to 3 decimals (trailing zeros dropped). */
export function fmtNumber(m, { decimals = 'auto' } = {}) {
  const neg = m < 0;
  const a = Math.abs(Math.round(m || 0));
  const i = Math.floor(a / MILLI);
  let f = String(a % MILLI).padStart(3, '0');
  if (decimals === 'auto') f = f.replace(/0+$/, '');
  else if (decimals === 0) f = '';
  const int = String(i).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return localizeDigits((neg ? '-' : '') + int + (f ? '.' + f : ''));
}

export const CURRENCY = 'د.ل';

/**
 * Money for display. sign: 'auto' (only "-" when negative), 'always' (+/-), 'none'.
 * compact: 12.5K style for tight places like chart axes.
 */
export function fmtMoney(m, { sign = 'auto', currency = true, compact = false, decimals = 'auto' } = {}) {
  const v = Math.round(m || 0);
  let body;
  let suffix = '';
  if (compact && Math.abs(v) >= 10000 * MILLI) {
    const k = Math.abs(v) / MILLI / 1000;
    body = localizeDigits((k >= 100 ? Math.round(k) : Math.round(k * 10) / 10).toString());
    suffix = ' ألف';
  } else {
    body = fmtNumber(Math.abs(v), { decimals });
  }
  const s = v < 0 ? (sign === 'none' ? '' : '-') : (sign === 'always' && v > 0 ? '+' : '');
  // LRI…PDI keeps "-1,250.5" in one left-to-right run inside Arabic text.
  return '⁦' + s + body + '⁩' + suffix + (currency ? ' ' + CURRENCY : '');
}

export function fmtPlain(n) {
  return localizeDigits(String(n));
}

export function fmtPercent(p) {
  return localizeDigits(String(Math.round(p))) + '%';
}

/* -------------------------------------------------------------- dates */
// Dates in records are local calendar days, 'YYYY-MM-DD'. Month keys are 'YYYY-MM'.

const pad = (n) => String(n).padStart(2, '0');

export function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today in the device's zone, or in an IANA zone (server side). */
export function today(tz) {
  if (!tz) return dateStr(new Date());
  return zonedParts(Date.now(), tz).date;
}

/** {date:'YYYY-MM-DD', time:'HH:MM', minutes} for an instant in an IANA zone. */
export function zonedParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const hh = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hh}:${p.minute}`, minutes: Number(hh) * 60 + Number(p.minute) };
}

export function nowTime() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse 'YYYY-MM-DD' as a local date at noon (immune to DST edges). */
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1, 12);
}

export const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1-based

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

export function diffDays(a, b) {
  // whole days from a to b (b - a)
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

export const monthKey = (s) => s.slice(0, 7);

export function addMonths(key, n) {
  let [y, m] = key.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((((m - 1) % 12) + 12) % 12) + 1;
  return `${y}-${pad(m)}`;
}

/** Day-of-month clamped to the month's length: (2026-02, 31) → '2026-02-28'. */
export function dayInMonth(key, day) {
  const [y, m] = key.split('-').map(Number);
  return `${key}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

export function weekday(s) {
  return parseDate(s).getDay(); // 0 = Sunday
}

export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function monthName(key) {
  return MONTHS[Number(key.slice(5, 7)) - 1];
}

/** 'YYYY-MM' → "أكتوبر 2026" (year dropped when it's the current year unless full). */
export function fmtMonth(key, { full = false, ref } = {}) {
  const y = key.slice(0, 4);
  const name = monthName(key);
  const cur = (ref || today()).slice(0, 4);
  return full || y !== cur ? `${name} ${fmtPlain(y)}` : name;
}

/**
 * Human date. style: 'short' (20 أكتوبر), 'long' (الثلاثاء 20 أكتوبر), 'relative'
 * (اليوم / أمس / بكرة / short). Year shown when not the current year.
 */
export function fmtDate(s, style = 'short', ref) {
  if (!s) return '';
  const t = ref || today();
  if (style === 'relative') {
    const d = diffDays(t, s);
    if (d === 0) return 'اليوم';
    if (d === -1) return 'أمس';
    if (d === 1) return 'بكرة';
  }
  const [y, m, day] = s.split('-');
  let out = `${fmtPlain(Number(day))} ${MONTHS[Number(m) - 1]}`;
  if (y !== t.slice(0, 4)) out += ` ${fmtPlain(y)}`;
  if (style === 'long') out = `${WEEKDAYS[weekday(s)]} ${out}`;
  return out;
}

/** "بعد 3 أيام" / "قبل يومين" / "اليوم" */
export function fmtIn(days) {
  if (days === 0) return 'اليوم';
  if (days === 1) return 'بكرة';
  if (days === -1) return 'أمس';
  const n = Math.abs(days);
  const unit = n === 2 ? 'يومين' : n <= 10 ? `${fmtPlain(n)} أيام` : `${fmtPlain(n)} يوم`;
  return days > 0 ? `بعد ${unit}` : `قبل ${unit}`;
}

export function fmtDays(n) {
  n = Math.abs(n);
  if (n === 1) return 'يوم';
  if (n === 2) return 'يومين';
  return n <= 10 ? `${fmtPlain(n)} أيام` : `${fmtPlain(n)} يوم`;
}

export function fmtTime(hhmm) {
  if (!hhmm) return '';
  let [h, m] = hhmm.split(':').map(Number);
  const pm = h >= 12;
  h = h % 12 || 12;
  return `${fmtPlain(h)}:${fmtPlain(pad(m))} ${pm ? 'م' : 'ص'}`;
}

/* -------------------------------------------------------------- misc */

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function sum(arr, f = (x) => x) {
  let s = 0;
  for (const x of arr) s += f(x) || 0;
  return s;
}

export function groupBy(arr, f) {
  const m = new Map();
  for (const x of arr) {
    const k = f(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Libyan mobile → international digits for wa.me / tel: (0912345678 → 218912345678). */
export function intlPhone(raw) {
  let s = latinDigits(raw || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s.slice(1);
  if (s.startsWith('00')) return s.slice(2);
  if (s.startsWith('218')) return s;
  if (s.startsWith('0')) return '218' + s.slice(1);
  if (s.length === 9 && s[0] === '9') return '218' + s;
  return s;
}

export function greeting(hour = new Date().getHours()) {
  if (hour < 5) return 'سهرانين';
  if (hour < 12) return 'صباح الخير';
  if (hour < 17) return 'نهارك سعيد';
  return 'مساء الخير';
}

/** Arabic-aware fold for search: strips tashkeel, unifies alef/ya/ta-marbuta. */
export function fold(s) {
  return latinDigits(String(s || ''))
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}
