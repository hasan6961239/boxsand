#!/usr/bin/env node
/**
 * يشغّل PostgreSQL محلياً في مجلد مؤقت لاختبار الهجرات وسياسات RLS اختباراً
 * حقيقياً. للتطوير والاختبار فقط — لا علاقة له بالإنتاج ولا بـ Supabase.
 *
 *   node scripts/local-db.mjs start | stop | url
 *
 * خادم PostgreSQL يرفض العمل بصلاحية root، فإن شُغّل السكربت كـ root نفّذ
 * الأوامر بهوية مستخدم النظام postgres.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, chownSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA_DIR = process.env.SUFRA_TEST_PGDATA ?? join(tmpdir(), 'sufra-pgdata');
const PORT = process.env.SUFRA_TEST_PGPORT ?? '54329';
const BIN = process.env.SUFRA_PG_BIN ?? '/usr/lib/postgresql/16/bin';
const AS_POSTGRES = process.getuid?.() === 0;

export const url = `postgresql://postgres@127.0.0.1:${PORT}/sufra_test`;

function sh(command, { quiet = false } = {}) {
  const res = AS_POSTGRES
    ? spawnSync('su', ['postgres', '-s', '/bin/sh', '-c', command], { stdio: quiet ? 'ignore' : 'inherit' })
    : spawnSync('/bin/sh', ['-c', command], { stdio: quiet ? 'ignore' : 'inherit' });
  if (res.status !== 0) throw new Error(`فشل الأمر (${res.status}): ${command}`);
}

function start() {
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    if (AS_POSTGRES) chownSync(DATA_DIR, 102, 104);
    sh(`${BIN}/initdb -D ${DATA_DIR} -U postgres --auth=trust -E UTF8 --locale=C`, { quiet: true });
  }
  const running = spawnSync(`${BIN}/pg_isready`, ['-h', '127.0.0.1', '-p', PORT]).status === 0;
  if (!running) {
    sh(
      `${BIN}/pg_ctl -D ${DATA_DIR} -l ${DATA_DIR}/server.log ` +
        `-o "-p ${PORT} -k ${DATA_DIR} -c listen_addresses=127.0.0.1" -w start`,
      { quiet: true },
    );
  }
  const admin = `postgresql://postgres@127.0.0.1:${PORT}/postgres`;
  const exists = execFileSync('psql', [admin, '-tAc', "select 1 from pg_database where datname='sufra_test'"])
    .toString()
    .trim();
  if (exists !== '1') execFileSync('psql', [admin, '-q', '-c', 'create database sufra_test']);
  return url;
}

function stop({ purge = false } = {}) {
  if (existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    try {
      sh(`${BIN}/pg_ctl -D ${DATA_DIR} -m immediate -w stop`, { quiet: true });
    } catch {
      /* الخادم متوقف أصلاً */
    }
  }
  if (purge) rmSync(DATA_DIR, { recursive: true, force: true });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === 'start') console.log(start());
  else if (cmd === 'stop') stop({ purge: process.argv.includes('--purge') });
  else if (cmd === 'url') console.log(url);
  else {
    console.error('الاستخدام: node scripts/local-db.mjs start|stop|url');
    process.exit(1);
  }
}

export { start, stop };
