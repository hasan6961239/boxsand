/** قراءة .env.local ثم .env دون أي اعتماد خارجي. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

export function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }
  return process.env;
}

export function require_(name, hint) {
  const value = process.env[name];
  if (!value) {
    console.error(`\x1b[31mمتغير البيئة ${name} غير موجود.\x1b[0m${hint ? `\n${hint}` : ''}`);
    process.exit(1);
  }
  return value;
}
