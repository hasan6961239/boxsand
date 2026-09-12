#!/usr/bin/env node
/**
 * Diagnostic: prints what each parallel-market source actually publishes
 * around the city names, so the extraction rules can be tuned against real
 * pages instead of guesses. Run it from CI — it only reads.
 */
import { fetchText, htmlToText, normalizeArabic } from './lib/util.mjs';
import { CITIES, extractCityRates, extractNationalRates, PARALLEL_SOURCES } from './sources.mjs';

const CONTEXT = 190;

async function textOf(source) {
  if (source.id === 'telegram-lydollar') {
    const html = await fetchText(source.url);
    const msgs = [...html.matchAll(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => htmlToText(m[1]));
    return msgs.slice(-6).reverse().join('\n──────\n');
  }
  return htmlToText(await fetchText(source.url));
}

for (const source of PARALLEL_SOURCES) {
  console.log(`\n${'='.repeat(78)}\n### ${source.id}  —  ${source.url}\n${'='.repeat(78)}`);
  let text;
  try { text = await textOf(source); }
  catch (err) { console.log('FETCH FAILED:', err.message); continue; }

  console.log(`length: ${text.length} chars`);
  const hay = normalizeArabic(text);

  let anyCity = false;
  for (const [key, city] of Object.entries(CITIES)) {
    const hits = [];
    for (const alias of city.aliases) {
      const needle = normalizeArabic(alias);
      let i = hay.indexOf(needle);
      while (i !== -1 && hits.length < 3) { hits.push(i); i = hay.indexOf(needle, i + 1); }
    }
    if (!hits.length) { console.log(`\n-- ${city.ar}: NOT MENTIONED`); continue; }
    anyCity = true;
    console.log(`\n-- ${city.ar}: ${hits.length} mention(s)`);
    for (const i of hits.slice(0, 2)) {
      console.log(`   …${hay.slice(Math.max(0, i - 60), i + CONTEXT).replace(/\n/g, ' ⏎ ')}…`);
    }
  }

  if (!anyCity) {
    console.log('\n>>> No city is named anywhere on this page. First 700 chars of what we got:');
    console.log(text.slice(0, 700).replace(/\n/g, ' ⏎ '));
  }

  console.log('\nextractCityRates ->', JSON.stringify(extractCityRates(text)));
  console.log('extractNationalRates ->', JSON.stringify(extractNationalRates(text)));
}
