#!/usr/bin/env node
/**
 * يطبّق الهجرات على قاعدة البيانات، بالترتيب ومرة واحدة لكل ملف.
 *
 *   npm run db:push
 *
 * يحتاج SUPABASE_DB_URL في .env.local (Project Settings → Database → URI).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { loadEnv, require_ } from './_env.mjs';

loadEnv();
const DB_URL = process.argv[2] ?? require_('SUPABASE_DB_URL', 'من: Supabase → Project Settings → Database → Connection string');
const DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');

const client = new pg.Client({
  connectionString: DB_URL,
  ssl: DB_URL.includes('localhost') || DB_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
});

await client.connect();
await client.query(`
  create table if not exists public.schema_migrations (
    filename    text primary key,
    applied_at  timestamptz not null default now()
  )
`);

const applied = new Set(
  (await client.query('select filename from public.schema_migrations')).rows.map((r) => r.filename),
);

let count = 0;
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
  if (applied.has(file)) {
    console.log(`\x1b[2m•  ${file} (مطبّقة)\x1b[0m`);
    continue;
  }
  process.stdout.write(`→  ${file} … `);
  try {
    await client.query('begin');
    await client.query(readFileSync(join(DIR, file), 'utf8'));
    await client.query('insert into public.schema_migrations (filename) values ($1)', [file]);
    await client.query('commit');
    console.log('\x1b[32mتمت\x1b[0m');
    count++;
  } catch (err) {
    await client.query('rollback');
    console.log('\x1b[31mفشلت\x1b[0m');
    console.error(`\n${err.message}\n`);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(count ? `\n\x1b[32mطُبّقت ${count} هجرة.\x1b[0m` : '\nقاعدة البيانات محدّثة أصلاً.');
