'use strict';
/** ينزّل القطع العربية من خطوط جوجل ويضمّنها في ملف CSS واحد (base64) */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'assets', 'fonts.css');
const FAMILIES = [
  'Readex+Pro:wght@600;700',
  'IBM+Plex+Sans+Arabic:wght@400;600',
  'Cairo:wght@400;500;600;700;800'   // خط واجهة المنظومة
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const get = (url, binary = false) => new Promise((resolve, reject) => {
  https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      return get(res.headers.location, binary).then(resolve, reject);
    }
    if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
  }).on('error', reject);
});

(async () => {
  const seen = new Set();
  const parts = [];
  for (const fam of FAMILIES) {
    const css = await get(`https://fonts.googleapis.com/css2?family=${fam}&display=swap&subset=arabic`);
    for (const block of css.match(/@font-face\s*\{[\s\S]*?\}/g) || []) {
      const range = /unicode-range:\s*([^;]+);/.exec(block);
      if (!range || !range[1].includes('U+0600')) continue;   // القطعة العربية فقط
      const family = /font-family:\s*'([^']+)'/.exec(block)[1];
      const weight = /font-weight:\s*(\d+)/.exec(block)[1];
      const key = family + weight;
      if (seen.has(key)) continue;
      seen.add(key);
      const url = /url\((https:\/\/[^)]+)\)/.exec(block)[1];
      const buf = await get(url, true);
      parts.push(`@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};`
        + `src:url(data:font/woff2;base64,${buf.toString('base64')}) format('woff2');}`);
      console.log(`  ✓ ${family} ${weight} — ${Math.round(buf.length / 1024)} KB`);
    }
  }
  if (!parts.length) throw new Error('لم يتم العثور على أي قطعة عربية');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, parts.join('\n'), 'utf8');
  console.log(`\n  الملف: assets/fonts.css — ${Math.round(fs.statSync(OUT).size / 1024)} KB\n`);
})().catch((e) => { console.error('فشل تنزيل الخطوط:', e.message); process.exit(1); });
