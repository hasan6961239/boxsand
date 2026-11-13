// Radio Browser (community directory, no key, CORS enabled).
import { fetchTimeout, shuffle } from './util.js';

const MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];
let good = null;

async function rb(path) {
  const order = good ? [good, ...MIRRORS.filter((m) => m !== good)] : shuffle(MIRRORS);
  let last;
  for (const m of order) {
    try {
      const r = await fetchTimeout(m + path, {}, 9000);
      if (!r.ok) throw new Error(r.status);
      good = m;
      return await r.json();
    } catch (e) { last = e; }
  }
  throw new Error('تعذّر الوصول لدليل المحطات' + (last ? '' : ''));
}

export const CATEGORIES = [
  { id: 'ly', label: 'ليبيا', q: { countrycode: 'LY' } },
  { id: 'arabic', label: 'عربي', q: { tag: 'arabic' } },
  { id: 'tarab', label: 'طرب', q: { tag: 'tarab' } },
  { id: 'eg', label: 'مصر', q: { countrycode: 'EG' } },
  { id: 'tn', label: 'تونس', q: { countrycode: 'TN' } },
  { id: 'sa', label: 'السعودية', q: { countrycode: 'SA' } },
  { id: 'ae', label: 'الإمارات', q: { countrycode: 'AE' } },
  { id: 'lb', label: 'لبنان', q: { countrycode: 'LB' } },
  { id: 'dz', label: 'الجزائر', q: { countrycode: 'DZ' } },
  { id: 'ma', label: 'المغرب', q: { countrycode: 'MA' } },
  { id: 'iq', label: 'العراق', q: { countrycode: 'IQ' } },
  { id: 'kw', label: 'الكويت', q: { countrycode: 'KW' } },
  { id: 'quran', label: 'قرآن', q: { tag: 'quran' } },
  { id: 'khaleeji', label: 'خليجي', q: { tag: 'khaleeji' } },
];

export async function stations(q = {}, limit = 80) {
  const p = new URLSearchParams({
    hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: String(limit), ...q,
  });
  const list = await rb('/json/stations/search?' + p);
  const seen = new Set();
  return list.filter((s) => {
    const k = (s.name || '').trim().toLowerCase();
    if (!s.url_resolved && !s.url) return false;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const searchStations = (name) => stations({ name }, 60);

export function click(uuid) {
  if (!uuid) return;
  rb('/json/url/' + uuid).catch(() => {});
}
