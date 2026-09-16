#!/usr/bin/env node
/**
 * يولّد صور العرض التجريبي محلياً (SVG) بدل تحميل صور من الإنترنت.
 * فائدتها أنها لا تنكسر بلا اتصال، وخفيفة جداً، ومتناسقة مع هوية المنصة.
 *
 *   node scripts/make-demo-images.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'public', 'demo');
mkdirSync(OUT, { recursive: true });

const plate = (accent) => `
  <ellipse cx="400" cy="335" rx="215" ry="55" fill="#000" opacity=".07"/>
  <circle cx="400" cy="300" r="185" fill="#fff" opacity=".92"/>
  <circle cx="400" cy="300" r="185" fill="none" stroke="${accent}" stroke-opacity=".18" stroke-width="3"/>
  <circle cx="400" cy="300" r="150" fill="none" stroke="${accent}" stroke-opacity=".12" stroke-width="2"/>`;

const dishes = {
  burger: { from: '#F6C177', to: '#E8873B', accent: '#8A4B12', art: `
    <rect x="288" y="212" width="224" height="58" rx="29" fill="#D99A4E"/>
    <rect x="292" y="262" width="216" height="26" rx="13" fill="#7FAE5A"/>
    <rect x="288" y="282" width="224" height="38" rx="12" fill="#8A4B12"/>
    <path d="M292 316h216l-12 26a26 26 0 0 1-24 16H328a26 26 0 0 1-24-16z" fill="#E0A85C"/>
    <circle cx="340" cy="232" r="5" fill="#fff" opacity=".85"/><circle cx="392" cy="224" r="5" fill="#fff" opacity=".85"/>
    <circle cx="444" cy="234" r="5" fill="#fff" opacity=".85"/><circle cx="470" cy="248" r="5" fill="#fff" opacity=".85"/>` },
  pizza: { from: '#FFD9A0', to: '#E4632F', accent: '#9C3A15', art: `
    <path d="M400 168 543 402a166 166 0 0 1-286 0z" fill="#F0B457"/>
    <path d="M400 206 512 390a140 140 0 0 1-224 0z" fill="#E4632F" opacity=".55"/>
    <circle cx="372" cy="330" r="17" fill="#B62A22"/><circle cx="436" cy="316" r="15" fill="#B62A22"/>
    <circle cx="404" cy="372" r="13" fill="#B62A22"/><circle cx="350" cy="372" r="10" fill="#7FAE5A"/>
    <circle cx="452" cy="366" r="10" fill="#7FAE5A"/>` },
  shawarma: { from: '#F3D3A0', to: '#C87F3C', accent: '#7A4A1C', art: `
    <path d="M330 200h140l-26 208a44 44 0 0 1-88 0z" fill="#F2E3C6"/>
    <path d="M348 236h104l-8 60H356z" fill="#C0682C" opacity=".8"/>
    <path d="M356 318h88l-6 48H362z" fill="#7FAE5A" opacity=".7"/>
    <path d="M330 200h140" stroke="#E4CBA0" stroke-width="14" stroke-linecap="round"/>` },
  grill: { from: '#F0B99B', to: '#A23E2A', accent: '#6E2417', art: `
    <rect x="296" y="236" width="208" height="30" rx="15" fill="#8C3A24"/>
    <rect x="296" y="286" width="208" height="30" rx="15" fill="#A0492C"/>
    <rect x="296" y="336" width="208" height="30" rx="15" fill="#8C3A24"/>
    <rect x="264" y="222" width="14" height="158" rx="7" fill="#C9C9CE"/>
    <rect x="522" y="222" width="14" height="158" rx="7" fill="#C9C9CE"/>` },
  salad: { from: '#DDF0C9', to: '#5E9B4B', accent: '#2F5E28', art: `
    <circle cx="352" cy="300" r="46" fill="#77B85C"/><circle cx="430" cy="276" r="40" fill="#8FC96F"/>
    <circle cx="444" cy="344" r="36" fill="#63A64B"/><circle cx="366" cy="356" r="32" fill="#8FC96F"/>
    <circle cx="400" cy="312" r="26" fill="#E05B4B"/><circle cx="470" cy="312" r="18" fill="#E8A13C"/>` },
  soup: { from: '#FBE3B4', to: '#D08A35', accent: '#7E4E12', art: `
    <path d="M286 288h228a114 114 0 0 1-114 108 114 114 0 0 1-114-108z" fill="#EDB25E"/>
    <ellipse cx="400" cy="290" rx="114" ry="22" fill="#F7D79A"/>
    <path d="M368 214c14 16-14 30 0 46M400 204c14 16-14 30 0 46M432 214c14 16-14 30 0 46"
      stroke="#fff" stroke-opacity=".7" stroke-width="7" stroke-linecap="round" fill="none"/>` },
  pasta: { from: '#FFE7BE', to: '#D9603F', accent: '#8C2F1C', art: `
    <circle cx="400" cy="308" r="120" fill="#F2C266"/>
    <path d="M300 300c40-26 160-26 200 0M304 330c40-26 152-26 192 0M312 358c38-24 138-24 176 0"
      stroke="#E3A63F" stroke-width="12" stroke-linecap="round" fill="none"/>
    <circle cx="372" cy="296" r="18" fill="#C6402B"/><circle cx="436" cy="330" r="16" fill="#C6402B"/>` },
  dessert: { from: '#FBD9E3', to: '#B4537C', accent: '#7A2F4F', art: `
    <path d="M320 300h160l-18 104a30 30 0 0 1-30 26h-64a30 30 0 0 1-30-26z" fill="#F5E3EC"/>
    <path d="M312 276c0-36 40-62 88-62s88 26 88 62z" fill="#E77FA6"/>
    <circle cx="400" cy="196" r="20" fill="#C0396B"/>
    <path d="M320 300h160l-4 26H324z" fill="#C97BA0"/>` },
  cake: { from: '#F6E0C8', to: '#8C5A3C', accent: '#5A3524', art: `
    <rect x="300" y="286" width="200" height="110" rx="16" fill="#F0DCC4"/>
    <rect x="300" y="286" width="200" height="30" fill="#8C5A3C"/>
    <rect x="300" y="336" width="200" height="22" fill="#A9714C" opacity=".6"/>
    <rect x="392" y="222" width="16" height="56" rx="8" fill="#E4677F"/>
    <ellipse cx="400" cy="216" rx="9" ry="14" fill="#F5B93E"/>` },
  coffee: { from: '#E8D6C3', to: '#6B4226', accent: '#3E2417', art: `
    <path d="M304 262h176v78a88 88 0 0 1-176 0z" fill="#F3EAE0"/>
    <path d="M316 274h152v66a76 76 0 0 1-152 0z" fill="#6B4226"/>
    <ellipse cx="392" cy="276" rx="76" ry="14" fill="#A5744C"/>
    <path d="M480 282h26a34 34 0 0 1 0 68h-26" stroke="#F3EAE0" stroke-width="18" fill="none" stroke-linecap="round"/>
    <rect x="296" y="404" width="192" height="16" rx="8" fill="#F3EAE0"/>` },
  juice: { from: '#FFE9AE', to: '#E8892E', accent: '#96500F', art: `
    <path d="M338 212h124l-16 190a34 34 0 0 1-34 30h-24a34 34 0 0 1-34-30z" fill="#FFF3DA"/>
    <path d="M346 264h108l-13 138a26 26 0 0 1-26 22h-30a26 26 0 0 1-26-22z" fill="#F2A03C"/>
    <rect x="424" y="164" width="12" height="80" rx="6" fill="#E05B4B" transform="rotate(14 430 204)"/>
    <circle cx="372" cy="300" r="10" fill="#fff" opacity=".5"/>` },
  water: { from: '#DCEDF7', to: '#3E7FA8', accent: '#1F4E68', art: `
    <path d="M348 214h104l-12 196a34 34 0 0 1-34 30h-12a34 34 0 0 1-34-30z" fill="#EAF4FA"/>
    <path d="M354 288h92l-10 122a26 26 0 0 1-26 22h-20a26 26 0 0 1-26-22z" fill="#6FB2D6"/>
    <ellipse cx="400" cy="288" rx="46" ry="10" fill="#A9D4EA"/>` },
};

function svg({ from, to, accent, art }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600" role="img">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#bg)"/>
  <circle cx="120" cy="90" r="150" fill="#fff" opacity=".10"/>
  <circle cx="700" cy="530" r="180" fill="#000" opacity=".06"/>
  ${plate(accent)}
  ${art}
</svg>`;
}

for (const [name, spec] of Object.entries(dishes)) {
  writeFileSync(join(OUT, `${name}.svg`), svg(spec));
}

// غلاف المطعم التجريبي
writeFileSync(join(OUT, 'cover.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">
  <defs>
    <linearGradient id="c" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#14503F"/><stop offset=".55" stop-color="#1F6F5C"/><stop offset="1" stop-color="#C89A4A"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#c)"/>
  <g fill="#fff" opacity=".07">
    <circle cx="240" cy="180" r="260"/><circle cx="1380" cy="760" r="320"/><circle cx="1180" cy="120" r="140"/>
  </g>
  <g stroke="#fff" stroke-opacity=".14" stroke-width="2" fill="none">
    <circle cx="800" cy="450" r="250"/><circle cx="800" cy="450" r="190"/>
  </g>
</svg>`);

// شعار المطعم التجريبي
writeFileSync(join(OUT, 'logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
  <rect width="240" height="240" rx="56" fill="#14503F"/>
  <circle cx="120" cy="120" r="74" fill="none" stroke="#C89A4A" stroke-width="6"/>
  <path d="M86 88v40a18 18 0 0 0 18 18v46M104 88v34M86 88v34" stroke="#fff" stroke-width="7"
    stroke-linecap="round" fill="none"/>
  <path d="M154 88c-12 0-20 16-20 34s8 24 14 24v46" stroke="#fff" stroke-width="7"
    stroke-linecap="round" fill="none"/>
</svg>`);

console.log(`أُنشئت ${Object.keys(dishes).length + 2} صورة في public/demo`);
