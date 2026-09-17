#!/usr/bin/env node
/**
 * مجموعة هجمات — تحاول اختراق العزل فعلياً لا تقرأ السياسات.
 *
 * كل اختبار هنا يلبس ثوب مهاجم: صاحب مطعم يريد بيانات غيره، أو زائر يريد
 * صلاحية ليست له، أو مستخدم يريد ترقية نفسه. النجاح يعني أن قاعدة البيانات
 * رفضت المحاولة.
 *
 *   node scripts/local-db.mjs start && node scripts/db-attack.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { url as localUrl } from './local-db.mjs';

const DB_URL = process.env.SUFRA_TEST_DB_URL ?? localUrl;
const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations');
const BOOTSTRAP = join(import.meta.dirname, '..', 'supabase', 'test', 'bootstrap.sql');

let passed = 0;
const failures = [];

const ok = (name, note = '') => {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}${note ? `  \x1b[2m${note}\x1b[0m` : ''}`);
};
const fail = (name, detail) => {
  failures.push({ name, detail });
  console.log(`  \x1b[31m✗ صمد الهجوم:\x1b[0m ${name}\n      ${detail}`);
};
const group = (title) => console.log(`\n\x1b[1m${title}\x1b[0m`);

/** يتوقّع أن تُرفض المحاولة بخطأ صريح. */
async function blocked(client, name, sql, params = []) {
  await client.query('savepoint atk');
  try {
    await client.query(sql, params);
    fail(name, 'نجحت العملية — الهجوم مرّ!');
  } catch {
    ok(name);
  }
  await client.query('rollback to savepoint atk');
}

/** يتوقّع أن تمرّ العملية بلا خطأ لكن بلا أثر — وهو الرفض الصحيح للقراءة والتحديث. */
async function noEffect(client, name, sql, params = []) {
  await client.query('savepoint atk');
  try {
    const result = await client.query(sql, params);
    if (result.rowCount === 0) ok(name);
    else fail(name, `أصاب ${result.rowCount} صفاً`);
  } catch {
    ok(name, 'رُفض بخطأ');
  }
  await client.query('rollback to savepoint atk');
}

async function as(client, role, userId = null) {
  await client.query('reset role');
  await client.query('select set_config($1, $2, false)', [
    'request.jwt.claims',
    JSON.stringify(userId ? { sub: userId, role } : { role }),
  ]);
  await client.query(`set role ${role}`);
}

async function run(client) {
  await client.query('drop schema if exists public cascade; drop schema if exists auth cascade; create schema public');
  await client.query(readFileSync(BOOTSTRAP, 'utf8'));
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await client.query(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }

  const mkUser = async (email, name) =>
    (await client.query(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
      [email, JSON.stringify({ full_name: name })],
    )).rows[0].id;

  const attacker = await mkUser('attacker@x.test', 'المهاجم');
  const victim = await mkUser('victim@x.test', 'الضحية');
  const admin = await mkUser('boss@x.test', 'مدير المنصة');
  await client.query(`update public.profiles set role = 'super_admin' where id = $1`, [admin]);

  const mkRestaurant = async (owner, name, slug, short) =>
    (await client.query(
      `insert into public.restaurants (owner_id, name, slug, short_id, status)
       values ($1,$2,$3,$4,'active') returning id`,
      [owner, name, slug, short],
    )).rows[0].id;

  const attackerRest = await mkRestaurant(attacker, 'مطعم المهاجم', 'atk-a', 'atka01');
  const victimRest = await mkRestaurant(victim, 'مطعم الضحية', 'atk-b', 'atkb01');

  const mkCategory = async (rid, name) =>
    (await client.query(`insert into public.categories (restaurant_id, name) values ($1,$2) returning id`, [rid, name]))
      .rows[0].id;
  const attackerCat = await mkCategory(attackerRest, 'قسم المهاجم');
  const victimCat = await mkCategory(victimRest, 'قسم الضحية');

  const mkProduct = async (rid, cid, name, price) =>
    (await client.query(
      `insert into public.products (restaurant_id, category_id, name, base_price) values ($1,$2,$3,$4) returning id`,
      [rid, cid, name, price],
    )).rows[0].id;
  const attackerProd = await mkProduct(attackerRest, attackerCat, 'صنف المهاجم', 10);
  const victimProd = await mkProduct(victimRest, victimCat, 'صنف الضحية', 100);

  const victimGroup = (await client.query(
    `insert into public.option_groups (product_id, restaurant_id, name) values ($1,$2,'إضافات') returning id`,
    [victimProd, victimRest])).rows[0].id;

  await client.query(
    `insert into public.complaints (restaurant_id, message) values ($1, 'رسالة خاصة بالضحية')`, [victimRest]);

  // ══════════════════════════════════════════════════════════════════════
  group('الهجوم ١ — الكتابة في مطعم آخر عبر المفاتيح الأجنبية');
  await client.query('begin');
  await as(client, 'authenticated', attacker);

  await blocked(client, 'إلحاق حجم بصنف مطعم آخر (كان يغيّر سعره!)',
    `insert into public.product_variants (product_id, restaurant_id, name, price) values ($1,$2,'دخيل',1)`,
    [victimProd, attackerRest]);

  await blocked(client, 'إلحاق مجموعة إضافات بصنف مطعم آخر',
    `insert into public.option_groups (product_id, restaurant_id, name) values ($1,$2,'دخيل')`,
    [victimProd, attackerRest]);

  await blocked(client, 'إلحاق خيار بمجموعة مطعم آخر',
    `insert into public.options (group_id, restaurant_id, name, price_delta) values ($1,$2,'دخيل',0)`,
    [victimGroup, attackerRest]);

  await blocked(client, 'جعل قسمه فرعاً لقسم في مطعم آخر',
    `insert into public.categories (restaurant_id, parent_id, name) values ($1,$2,'دخيل')`,
    [attackerRest, victimCat]);

  await blocked(client, 'إضافة صنف داخل قسم مطعم آخر',
    `insert into public.products (restaurant_id, category_id, name, base_price) values ($1,$2,'دخيل',5)`,
    [attackerRest, victimCat]);

  await blocked(client, 'نقل صنفه إلى مطعم آخر',
    `update public.products set restaurant_id = $1 where id = $2`, [victimRest, attackerProd]);

  await blocked(client, 'إضافة نفسه عضواً في مطعم آخر',
    `insert into public.restaurant_members (restaurant_id, user_id, role) values ($1,$2,'owner')`,
    [victimRest, attacker]);

  await blocked(client, 'إضافة عرض لمطعم آخر',
    `insert into public.offers (restaurant_id, title) values ($1,'دخيل')`, [victimRest]);

  await blocked(client, 'إضافة وقت عمل لمطعم آخر',
    `insert into public.opening_hours (restaurant_id, weekday, opens_at, closes_at) values ($1,0,'01:00','02:00')`,
    [victimRest]);

  await blocked(client, 'تغيير ثيم مطعم آخر',
    `insert into public.restaurant_themes (restaurant_id, primary_color) values ($1,'#000000')
     on conflict (restaurant_id) do update set primary_color = '#000000'`, [victimRest]);

  // ══════════════════════════════════════════════════════════════════════
  group('الهجوم ٢ — التعديل والحذف في مطعم آخر');

  await noEffect(client, 'تعديل سعر صنف مطعم آخر',
    `update public.products set base_price = 1 where id = $1 returning id`, [victimProd]);
  await noEffect(client, 'حذف صنف مطعم آخر',
    `delete from public.products where id = $1 returning id`, [victimProd]);
  await noEffect(client, 'حذف قسم مطعم آخر',
    `delete from public.categories where id = $1 returning id`, [victimCat]);
  await noEffect(client, 'إخفاء منيو مطعم آخر',
    `update public.categories set is_visible = false where restaurant_id = $1 returning id`, [victimRest]);
  await noEffect(client, 'تغيير حالة شكاوى مطعم آخر',
    `update public.complaints set status = 'closed' where restaurant_id = $1 returning id`, [victimRest]);
  await noEffect(client, 'تعديل بيانات مطعم آخر',
    `update public.restaurants set name = 'مسروق' where id = $1 returning id`, [victimRest]);

  // ══════════════════════════════════════════════════════════════════════
  group('الهجوم ٣ — قراءة بيانات مطعم آخر');

  await noEffect(client, 'قراءة صف مطعم آخر',
    `select id from public.restaurants where id = $1`, [victimRest]);
  await noEffect(client, 'قراءة أصناف مطعم آخر',
    `select id from public.products where restaurant_id = $1`, [victimRest]);
  await noEffect(client, 'قراءة شكاوى مطعم آخر',
    `select id from public.complaints where restaurant_id = $1`, [victimRest]);
  await noEffect(client, 'قراءة إحصائيات مطعم آخر',
    `select restaurant_id from public.analytics_daily where restaurant_id = $1`, [victimRest]);
  await noEffect(client, 'قراءة اشتراك مطعم آخر',
    `select id from public.subscriptions where restaurant_id = $1`, [victimRest]);
  await noEffect(client, 'قراءة أعضاء مطعم آخر',
    `select id from public.restaurant_members where restaurant_id = $1`, [victimRest]);
  await noEffect(client, 'قراءة الملف الشخصي للضحية',
    `select id from public.profiles where id = $1`, [victim]);
  await blocked(client, 'قراءة تجزئات الزوار',
    `select * from public.analytics_visitors`);
  await noEffect(client, 'قراءة سجل العمليات',
    `select id from public.audit_logs`);

  // ══════════════════════════════════════════════════════════════════════
  group('الهجوم ٤ — تصعيد الصلاحية');

  await blocked(client, 'ترقية نفسه إلى مدير منصة',
    `update public.profiles set role = 'super_admin' where id = $1`, [attacker]);
  await blocked(client, 'حظر مستخدم آخر',
    `update public.profiles set is_blocked = true where id = $1`, [victim]);
  // السيناريو الواقعي: أوقفت الإدارة مطعمه، فيحاول إعادة تفعيله بنفسه.
  // (تحديثه إلى الحالة نفسها ليس تغييراً ولا يستدعي الحارس، فنوقفه أولاً.)
  await client.query('reset role');
  await client.query(`update public.restaurants set status = 'suspended' where id = $1`, [attackerRest]);
  await as(client, 'authenticated', attacker);

  await blocked(client, 'إعادة تفعيل مطعمه الموقوف بنفسه',
    `update public.restaurants set status = 'active' where id = $1`, [attackerRest]);
  await blocked(client, 'تعطيل مطعمه ثم رفعه إلى حالة أخرى',
    `update public.restaurants set status = 'trial' where id = $1`, [attackerRest]);
  await blocked(client, 'محو ملاحظة الإيقاف التي كتبتها الإدارة',
    `update public.restaurants set status = 'active', status_note = null where id = $1`, [attackerRest]);
  await blocked(client, 'نقل ملكية مطعمه',
    `update public.restaurants set owner_id = $1 where id = $2`, [victim, attackerRest]);
  await blocked(client, 'استدعاء ملخّص المنصة', `select public.admin_overview()`);
  await blocked(client, 'استدعاء قائمة كل المطاعم', `select * from public.admin_restaurants()`);
  await blocked(client, 'الكتابة في سجل العمليات',
    `select public.log_audit('fake','restaurant',null,null,'{}'::jsonb)`);
  await noEffect(client, 'تعديل إعدادات المنصة',
    `update public.platform_settings set platform_name = 'مخترَق' where id = true returning id`);
  await blocked(client, 'استدعاء عدّاد تحديد المعدل', `select public.hit_rate_limit('x',1,60)`);
  await blocked(client, 'تزوير الإحصائيات',
    `select public.record_menu_view($1,'fake')`, [attackerRest]);
  await blocked(client, 'إدراج شكوى مزوّرة على مطعم آخر',
    `insert into public.complaints (restaurant_id, message) values ($1,'تشويه')`, [victimRest]);

  await client.query('rollback');

  // ══════════════════════════════════════════════════════════════════════
  group('الهجوم ٥ — الزائر غير المسجَّل');
  await client.query('begin');
  await as(client, 'anon');

  await blocked(client, 'قراءة جدول المطاعم', `select * from public.restaurants`);
  await blocked(client, 'قراءة الملفات الشخصية', `select * from public.profiles`);
  await blocked(client, 'قراءة الشكاوى', `select * from public.complaints`);
  await blocked(client, 'إرسال شكوى مباشرة (تجاوز تحديد المعدل)',
    `insert into public.complaints (restaurant_id, message) values ($1,'سبام')`, [victimRest]);
  await blocked(client, 'استدعاء دالة إرسال الشكوى',
    `select public.submit_complaint($1,null,null,'complaint',null,'سبام')`, [victimRest]);
  await blocked(client, 'تزوير الإحصائيات', `select public.record_menu_view($1,'x')`, [victimRest]);
  await blocked(client, 'استدعاء ملخّص المنصة', `select public.admin_overview()`);
  await blocked(client, 'الكتابة في سجل العمليات',
    `select public.log_audit('x','y',null,null,'{}'::jsonb)`);
  await blocked(client, 'قراءة الاشتراكات', `select * from public.subscriptions`);
  await blocked(client, 'قراءة جدول تحديد المعدل', `select * from public.rate_limits`);
  await noEffect(client, 'تعديل إعدادات المنصة',
    `update public.platform_settings set platform_name = 'مخترَق' where id = true returning id`);

  await client.query('rollback');

  // ══════════════════════════════════════════════════════════════════════
  group('الهجوم ٦ — كشف المحتوى غير المنشور');
  await client.query('begin');

  await client.query(`update public.categories set is_visible = false where id = $1`, [victimCat]);
  await client.query(`insert into public.products (restaurant_id, category_id, name, base_price, is_visible)
                      values ($1,$2,'صنف مخفي',9,false)`, [victimRest, victimCat]);
  await as(client, 'anon');

  await noEffect(client, 'رؤية أصناف داخل قسم مخفي',
    `select id from public.products where restaurant_id = $1`, [victimRest]);
  await noEffect(client, 'رؤية الأقسام المخفية',
    `select id from public.categories where restaurant_id = $1`, [victimRest]);

  const hiddenMenu = (await client.query('select public.get_public_menu($1) as m', ['atk-b'])).rows[0].m;
  const leaked = JSON.stringify(hiddenMenu ?? {});
  leaked.includes('صنف مخفي')
    ? fail('المنيو العام يسرّب صنفاً مخفياً', 'ظهر في المخرجات')
    : ok('المنيو العام لا يسرّب الأصناف المخفية');
  leaked.includes(victim)
    ? fail('المنيو العام يسرّب معرّف المالك', 'ظهر في المخرجات')
    : ok('المنيو العام لا يسرّب معرّف المالك');
  await client.query('rollback');

  // ══════════════════════════════════════════════════════════════════════
  group('الهجوم ٧ — مطعم موقوف');
  await client.query('begin');
  await client.query(`update public.restaurants set status = 'disabled' where id = $1`, [victimRest]);
  await as(client, 'anon');

  const disabled = (await client.query('select public.get_public_menu($1) as m', ['atk-b'])).rows[0].m;
  disabled?.unavailable === true && !disabled?.categories
    ? ok('منيو المطعم المعطّل لا يُعرض ولا يكشف محتواه')
    : fail('المطعم المعطّل', JSON.stringify(disabled)?.slice(0, 120));

  const disabledQr = (await client.query('select public.resolve_short_id($1) as s', ['atkb01'])).rows[0].s;
  disabledQr === null ? ok('رمز QR لمطعم معطّل لا يحلّ إلى شيء') : fail('رمز QR', String(disabledQr));
  await client.query('rollback');

  // ══════════════════════════════════════════════════════════════════════
  group('الهجوم ٨ — حقن عبر المدخلات النصية');
  await client.query('begin');
  await as(client, 'authenticated', attacker);

  await blocked(client, 'رابط مطعم فيه محارف مسار',
    `update public.restaurants set slug = '../admin' where id = $1`, [attackerRest]);
  await blocked(client, 'رابط مطعم فيه مسافات ورموز',
    `update public.restaurants set slug = 'a b<script>' where id = $1`, [attackerRest]);
  await blocked(client, 'سعر سالب',
    `insert into public.products (restaurant_id, category_id, name, base_price) values ($1,$2,'x',-5)`,
    [attackerRest, attackerCat]);
  await blocked(client, 'أكثر من شارتين على صنف',
    `insert into public.products (restaurant_id, category_id, name, base_price, badges)
     values ($1,$2,'x',5,'{new,popular,spicy}')`, [attackerRest, attackerCat]);
  await blocked(client, 'رابط خرائط ببروتوكول javascript',
    `update public.restaurants set maps_url = 'javascript:alert(1)' where id = $1`, [attackerRest]);
  await blocked(client, 'لون ثيم ليس لوناً',
    `update public.restaurant_themes set primary_color = 'red; drop table' where restaurant_id = $1`, [attackerRest]);

  // اسم فيه HTML يُقبل كنص — والحماية عند العرض لا عند التخزين
  await client.query(`update public.restaurants set name = $1 where id = $2`,
    ['<script>alert(1)</script>', attackerRest]);
  const stored = (await client.query('select name from public.restaurants where id = $1', [attackerRest])).rows[0].name;
  stored === '<script>alert(1)</script>'
    ? ok('الاسم يُخزَّن كنص خام', 'الحماية عند العرض: React يهرّب، وJSON-LD يهرّب «<»')
    : fail('تخزين الاسم', String(stored));
  await client.query('rollback');

  // ══════════════════════════════════════════════════════════════════════
  group('الهجوم ٩ — مسار رفع الملفات');
  await client.query('begin');
  await as(client, 'authenticated', attacker);

  /*
   * سياسة التخزين تقرأ أول جزء من المسار وتعتبره معرّف المطعم. مسار خبيث مثل
   * «../victim/x.webp» أو «not-a-uuid/x.webp» يجب أن يسقط إلى null فتُرفض
   * الكتابة. (جدول storage.objects غير موجود محلياً، فنختبر منطق القرار نفسه.)
   */
  const pathDecision = async (folder) =>
    (await client.query('select coalesce(public.can_manage(public.safe_uuid($1)), false) as allowed', [folder]))
      .rows[0].allowed;

  (await pathDecision('..')) === false ? ok('مسار «..» يُرفض') : fail('مسار ..', 'سُمح');
  (await pathDecision('not-a-uuid')) === false ? ok('مسار ليس معرّفاً يُرفض') : fail('مسار نصي', 'سُمح');
  (await pathDecision('')) === false ? ok('مسار فارغ يُرفض') : fail('مسار فارغ', 'سُمح');
  (await pathDecision(victimRest)) === false ? ok('الكتابة في مجلد مطعم آخر تُرفض') : fail('مجلد الضحية', 'سُمح');
  (await pathDecision(attackerRest)) === true ? ok('الكتابة في مجلده هو مسموحة') : fail('مجلده', 'رُفض');

  const bucket = await client.query(
    `select 1 from pg_proc where proname = 'safe_uuid'`);
  bucket.rowCount === 1 ? ok('دالة التحويل الآمن للمسار موجودة') : fail('safe_uuid', 'غائبة');
  await client.query('rollback');

  console.log(`\n${'─'.repeat(64)}`);
  if (failures.length === 0) {
    console.log(`\x1b[32m\x1b[1mصُدَّت كل الهجمات — ${passed} محاولة\x1b[0m`);
  } else {
    console.log(`\x1b[31m\x1b[1m${failures.length} هجوم نجح من ${passed + failures.length}\x1b[0m`);
    process.exitCode = 1;
  }
}

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();
try {
  await run(client);
} catch (error) {
  console.error('\n\x1b[31mخطأ فادح:\x1b[0m', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
