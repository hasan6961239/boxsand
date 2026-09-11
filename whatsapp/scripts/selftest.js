#!/usr/bin/env node
// فحص سريع للإعدادات قبل التشغيل الفعلي.
import { config, googleReady, findUser, can } from '../src/config.js';
import { parseLocal } from '../src/tools/reminders.js';
import { buildSystemPrompt, localIsoNow } from '../src/prompt.js';
import { declarationsFor } from '../src/tools/index.js';

const checks = [];
const ok = (label, value, hint = '') => checks.push({ label, value, hint });

ok('مفتاح Gemini', Boolean(config.env.geminiKey), 'ضعه في .env');
ok('رقم المالك', Boolean(config.owner.phone), 'حدّده في config/config.json');
ok('عدد المستخدمين المصرّح لهم', config.users.length >= 1);
ok('جوجل مربوط', googleReady, 'شغّل: npm run auth:google');
ok('المنطقة الزمنية', config.env.timezone);

const now = localIsoNow();
ok('الوقت المحلي', now);

const sample = '2026-09-12T17:00';
const parsed = parseLocal(sample);
ok('تحويل الوقت المحلي', `${sample} → ${new Date(parsed).toISOString()}`);

const owner = findUser(config.owner.phone);
ok('صلاحيات المالك على التقويم', can(owner, 'تعديل_التقويم'));
ok('عدد الأدوات المتاحة للمالك', declarationsFor(owner).length);

const member = config.users.find((u) => u.role !== 'المالك');
if (member) ok(`عدد الأدوات المتاحة لـ${member.name}`, declarationsFor(member).length);

const prompt = buildSystemPrompt(owner);
ok('طول البرومبت (حرف)', prompt.length);

console.log('\n─── فحص الإعدادات ───');
for (const c of checks) {
  const status = c.value === true ? '✅' : c.value === false ? '❌' : '  ';
  console.log(`${status} ${c.label}: ${c.value}${c.value === false && c.hint ? ` — ${c.hint}` : ''}`);
}
console.log('─────────────────────\n');

const failed = checks.filter((c) => c.value === false && c.hint);
process.exit(failed.length ? 1 : 0);
