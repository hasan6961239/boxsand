// Dev helper: open the built app in an iPhone-sized Chromium and screenshot
// a list of routes. Usage:
//   node tests/e2e/shoot.mjs [--port 8787] [--dark] [--out dir] [--seed] /route1 /route2 ...
// Prints console errors. Requires `npm run dev` (or build + --serve) running.

const PW = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium, devices } = await import(PW);
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const port = opt('--port', '8787');
const out = opt('--out', '/tmp/shots');
const dark = args.includes('--dark');
const routes = args.filter((a, i) => a.startsWith('/') && args[i - 1] !== '--out');
const full = args.includes('--full');

const { mkdirSync } = await import('node:fs');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], colorScheme: dark ? 'dark' : 'light', locale: 'ar-LY', timezoneId: 'Africa/Tripoli' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
// --seed fills demo data (dev builds only) so every screen has content
await page.goto(`http://localhost:${port}/${args.includes('--seed') ? '?seed=demo' : ''}`);
await page.waitForTimeout(1200);
for (const r of routes.length ? routes : ['/']) {
  await page.evaluate((r) => { location.hash = '#' + r; }, r);
  await page.waitForTimeout(900);
  const file = `${out}/${r.replace(/\W+/g, '_') || 'root'}${dark ? '-dark' : ''}.png`;
  if (full) {
    // capture the whole scrolling page body, not just the viewport
    const h = await page.evaluate(() => { const sc = document.querySelector('.page:last-child .page-scroll'); return sc ? sc.scrollHeight + 120 : innerHeight; });
    await page.setViewportSize({ width: 390, height: Math.min(4000, Math.max(844, h)) });
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: file });
  if (full) await page.setViewportSize({ width: 390, height: 844 });
  console.log('shot', file);
}
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
