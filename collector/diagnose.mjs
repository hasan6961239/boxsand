#!/usr/bin/env node
/**
 * Diagnostic: prints the exact sentences the article sources publish around
 * each city name, plus what the extractor makes of them, so the per-city rules
 * can be tuned against real text. Read-only; run from CI.
 */
import { fetchText, htmlToText, normalizeArabic } from './lib/util.mjs';
import { CITIES, extractCityRates, extractNationalRates } from './sources.mjs';

const FEEDS = [
  { id: 'almashhadlibya', listUrl: 'https://almashhadlibya.com/economic-news/currency-prices', match: (u) => /almashhadlibya\.com\/economic-news\/.*\d{5,}/.test(u) },
  { id: 'libyaakhbar', listUrl: 'https://www.libyaakhbar.com/latestnews/currency-prices', match: (u) => /libyaakhbar\.com\/business-news\/\d+\.html/.test(u) },
];

function absoluteLinks(html, baseUrl) {
  const out = new Set();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try { out.add(new URL(m[1], baseUrl).toString()); } catch { /* skip */ }
  }
  return [...out];
}

for (const feed of FEEDS) {
  console.log(`\n${'#'.repeat(80)}\n# ${feed.id}\n${'#'.repeat(80)}`);
  let links;
  try { links = absoluteLinks(await fetchText(feed.listUrl), feed.listUrl).filter(feed.match).slice(0, 3); }
  catch (err) { console.log('LIST FAILED:', err.message); continue; }
  console.log('articles:', links.length);

  for (const link of links) {
    console.log(`\n${'─'.repeat(76)}\nARTICLE ${link}`);
    let text;
    try { text = htmlToText(await fetchText(link, { retries: 1, timeout: 12000 })); }
    catch (err) { console.log('  fetch failed:', err.message); continue; }

    const hay = normalizeArabic(text);
    for (const [, city] of Object.entries(CITIES)) {
      const positions = [];
      for (const alias of city.aliases) {
        const needle = normalizeArabic(alias);
        let i = hay.indexOf(needle);
        while (i !== -1 && positions.length < 4) { positions.push(i); i = hay.indexOf(needle, i + 1); }
      }
      if (!positions.length) { console.log(`  ${city.ar}: NOT MENTIONED`); continue; }
      console.log(`  ${city.ar}: ${positions.length} mention(s)`);
      for (const i of positions.slice(0, 3)) {
        console.log(`    « ${hay.slice(Math.max(0, i - 85), i + 150).replace(/\n/g, ' ⏎ ')} »`);
      }
    }
    console.log('  -> cities:', JSON.stringify(extractCityRates(text)));
    console.log('  -> national:', JSON.stringify(extractNationalRates(text)));
  }
}
