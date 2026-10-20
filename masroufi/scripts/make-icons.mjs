// Renders the app icon, maskable icon, notification badge and iOS launch
// screens to PNG with headless Chromium. Run once after changing the artwork:
//   node scripts/make-icons.mjs
// (uses the Playwright that ships with the dev container; not a build step)

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const PW = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const root = fileURLToPath(new URL('..', import.meta.url));
const icons = join(root, 'src/assets/icons');
const splashDir = join(root, 'src/assets/splash');
await mkdir(icons, { recursive: true });
await mkdir(splashDir, { recursive: true });

// Wallet + coin mark on an emerald gradient.
const mark = (fg = '#fff', coin = '#FCD34D', coinInk = '#065F46') => `
  <g transform="translate(256 262)">
    <rect x="-150" y="-104" width="300" height="214" rx="46" fill="${fg}" opacity="0.98"/>
    <path d="M-150 -40 h300" stroke="#059669" stroke-opacity="0.18" stroke-width="10"/>
    <rect x="-118" y="-150" width="210" height="70" rx="26" fill="${fg}" opacity="0.55"/>
    <rect x="14" y="-14" width="136" height="88" rx="30" fill="#059669" opacity="0.13"/>
    <circle cx="82" cy="30" r="50" fill="${coin}"/>
    <circle cx="82" cy="30" r="50" fill="none" stroke="#fff" stroke-opacity="0.6" stroke-width="6"/>
    <text x="82" y="52" text-anchor="middle" font-family="IBM Plex Sans Arabic, sans-serif" font-weight="700" font-size="60" fill="${coinInk}">د</text>
  </g>`;

const bg = (rx) => `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#34D399"/>
      <stop offset="0.45" stop-color="#10B981"/>
      <stop offset="1" stop-color="#047857"/>
    </linearGradient>
    <radialGradient id="hl" cx="0.85" cy="0.1" r="0.7">
      <stop offset="0" stop-color="#fff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="${rx}" fill="url(#g)"/>
  <rect width="512" height="512" rx="${rx}" fill="url(#hl)"/>`;

const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${inner}</svg>`;

const ICON = svg(bg(0) + mark());
const FAVICON = svg(bg(112) + mark());
const MASKABLE = svg(bg(0) + `<g transform="translate(256 256) scale(0.78) translate(-256 -256)">${mark()}</g>`);
const BADGE = svg(`<g transform="translate(256 256) scale(1.25) translate(-256 -262)">${mark('#fff', '#fff', '#000')}</g>`);

const fontCss = `@font-face{font-family:'IBM Plex Sans Arabic';font-weight:700;src:url(data:font/woff2;base64,${(await readFile(join(root, 'src/assets/fonts/plex-arabic-700-arabic.woff2'))).toString('base64')}) format('woff2')}`;

const browser = await chromium.launch();
const page = await browser.newPage();

async function shot(markup, size, file, { transparent = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><head><style>${fontCss}html,body{margin:0;background:${transparent ? 'transparent' : '#fff'}}svg{width:${size}px;height:${size}px;display:block}</style></head><body>${markup}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(icons, file), omitBackground: transparent });
}

await shot(ICON, 180, 'apple-touch-icon.png');
await shot(ICON, 192, 'icon-192.png');
await shot(ICON, 512, 'icon-512.png');
await shot(MASKABLE, 512, 'maskable-512.png');
await shot(BADGE, 72, 'badge-72.png', { transparent: true });
await writeFile(join(icons, 'favicon.svg'), FAVICON.replace('font-family="IBM Plex Sans Arabic, sans-serif"', 'font-family="sans-serif"'));

// iOS launch screens (portrait), light + dark
const DEVICES = [
  [440, 956, 3], [430, 932, 3], [402, 874, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3],
  [414, 896, 3], [375, 812, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2],
];
const links = [];
for (const [w, h, r] of DEVICES) {
  for (const dark of [false, true]) {
    const name = `splash-${w * r}x${h * r}${dark ? '-dark' : ''}.png`;
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><head><style>${fontCss}
      html,body{margin:0;height:100%;background:${dark ? '#0A0E0D' : '#F3F6F5'};font-family:'IBM Plex Sans Arabic'}
      .c{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
      .i{width:104px;height:104px;border-radius:30px;overflow:hidden;box-shadow:0 18px 40px -14px rgba(16,185,129,.6)}
      .i svg{width:104px;height:104px;display:block}
      .t{font-weight:700;font-size:26px;color:${dark ? '#EAF2EE' : '#0E1915'}}
    </style></head><body><div class="c"><div class="i">${ICON}</div><div class="t">مصروفي</div></div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const shotPage = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: r });
    await shotPage.setContent(await page.content());
    await shotPage.evaluate(() => document.fonts.ready);
    await shotPage.screenshot({ path: join(splashDir, name) });
    await shotPage.close();
    links.push(`<link rel="apple-touch-startup-image" href="assets/splash/${name}" media="(prefers-color-scheme: ${dark ? 'dark' : 'light'}) and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)">`);
  }
}
await writeFile(join(splashDir, 'links.html'), links.join('\n  ') + '\n');
await browser.close();
console.log('icons + splash written');
