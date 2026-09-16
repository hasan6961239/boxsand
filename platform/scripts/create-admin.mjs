#!/usr/bin/env node
/**
 * ينشئ مدير منصة (Super Admin) أو يرقّي مستخدماً موجوداً.
 *
 *   npm run create:admin -- --email you@example.com --password "…" --name "اسمك"
 *
 * كلمة المرور تُمرَّر كوسيط أو عبر متغير بيئة — لا تُكتب في أي ملف داخل المشروع.
 */
import { createClient } from '@supabase/supabase-js';
import { loadEnv, require_ } from './_env.mjs';

loadEnv();

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, token, i, arr) => {
    if (token.startsWith('--')) acc.push([token.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const email = args.email ?? process.env.ADMIN_EMAIL;
const password = args.password ?? process.env.ADMIN_PASSWORD;
const name = args.name ?? process.env.ADMIN_NAME ?? 'مدير المنصة';

if (!email || !password) {
  console.error('الاستخدام: npm run create:admin -- --email you@example.com --password "كلمة-مرور-قوية" --name "اسمك"');
  process.exit(1);
}
if (password.length < 10) {
  console.error('كلمة المرور قصيرة — استخدم ١٠ محارف على الأقل.');
  process.exit(1);
}

const supabase = createClient(
  require_('NEXT_PUBLIC_SUPABASE_URL'),
  require_('SUPABASE_SERVICE_ROLE_KEY', 'من: Supabase → Project Settings → API → service_role'),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let userId;
const { data: created, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: name },
});

if (error) {
  if (!/already|exists|registered/i.test(error.message)) {
    console.error('تعذّر إنشاء المستخدم:', error.message);
    process.exit(1);
  }
  const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  userId = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  if (!userId) {
    console.error('المستخدم موجود لكن تعذّر العثور عليه.');
    process.exit(1);
  }
  console.log('المستخدم موجود — سيُرقّى إلى مدير منصة.');
} else {
  userId = created.user.id;
  console.log('أُنشئ المستخدم.');
}

const { error: upErr } = await supabase
  .from('profiles')
  .update({ role: 'super_admin', full_name: name })
  .eq('id', userId);

if (upErr) {
  console.error('تعذّرت الترقية:', upErr.message);
  process.exit(1);
}

console.log(`\n\x1b[32mجاهز.\x1b[0m  ${email} أصبح مدير منصة.\nسجّل الدخول ثم افتح /admin`);
