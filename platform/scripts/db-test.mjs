#!/usr/bin/env node
/**
 * اختبارات العزل بين المطاعم — تُنفَّذ على قاعدة PostgreSQL حقيقية.
 *
 * كل اختبار هنا يحاول اختراقاً فعلياً: صاحب مطعم يقرأ بيانات مطعم آخر، زائر
 * يرسل شكوى مباشرة، مستخدم يرقّي نفسه إلى مدير. النجاح يعني أن قاعدة البيانات
 * رفضت المحاولة — لا أن الواجهة أخفت الزر.
 *
 *   node scripts/local-db.mjs start && node scripts/db-test.mjs
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

function ok(name) {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
}
function fail(name, detail) {
  failures.push({ name, detail });
  console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${detail}`);
}
function group(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function expectRows(client, name, sql, params, expected) {
  try {
    const res = await client.query(sql, params);
    if (res.rowCount === expected) ok(name);
    else fail(name, `توقّعنا ${expected} صفاً فجاء ${res.rowCount}`);
  } catch (err) {
    fail(name, `خطأ غير متوقع: ${err.message}`);
  }
}

/**
 * يتوقّع أن ترفض قاعدة البيانات العملية بخطأ صريح.
 *
 * نستخدم SAVEPOINT لا ROLLBACK: في PostgreSQL يُلغي ROLLBACK أمر SET ROLE
 * أيضاً، فتعود بقية الاختبارات إلى صلاحية postgres وتنجح كلها زوراً. هذا ما
 * أخفى ١٥ فشلاً في أول تشغيل لهذه المجموعة.
 */
async function expectDenied(client, name, sql, params) {
  await client.query('savepoint guard');
  try {
    await client.query(sql, params);
    fail(name, 'نجحت العملية — وكان يجب أن تُرفض!');
    await client.query('rollback to savepoint guard');
  } catch {
    ok(name);
    await client.query('rollback to savepoint guard');
  }
}

/**
 * التحديث والحذف تحت RLS لا يرميان خطأ — يمرّان على صفر صفوف. هذا هو الرفض
 * الصحيح لهما، ويجب اختباره بعدد الصفوف لا بوجود استثناء.
 */
async function expectNoRows(client, name, sql, params) {
  await client.query('savepoint guard');
  try {
    const res = await client.query(sql, params);
    if (res.rowCount === 0) ok(name);
    else fail(name, `أُصيب ${res.rowCount} صفاً — وكان يجب ألا يُصاب أي صف!`);
  } catch {
    ok(name);
  }
  await client.query('rollback to savepoint guard');
}

async function as(client, role, userId = null) {
  await client.query('reset role');
  await client.query('select set_config($1, $2, false)', [
    'request.jwt.claims',
    userId ? JSON.stringify({ sub: userId, role }) : JSON.stringify({ role }),
  ]);
  await client.query(`set role ${role}`);
}

async function main() {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  group('تهيئة قاعدة بيانات نظيفة');
  await client.query('drop schema if exists public cascade; drop schema if exists auth cascade; create schema public');
  await client.query(readFileSync(BOOTSTRAP, 'utf8'));
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await client.query(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  ok(`طُبّقت ${readdirSync(MIGRATIONS).length} هجرة`);

  // ── بيانات الاختبار (بصلاحية النظام) ────────────────────────────────────
  const mk = async (email, name) => {
    const { rows } = await client.query(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
      [email, JSON.stringify({ full_name: name })],
    );
    return rows[0].id;
  };
  const userA = await mk('a@test.local', 'صاحب مطعم أ');
  const userB = await mk('b@test.local', 'صاحب مطعم ب');
  const admin = await mk('admin@test.local', 'مدير المنصة');
  await client.query(`update public.profiles set role = 'super_admin' where id = $1`, [admin]);

  const mkRestaurant = async (owner, name, slug, short, status = 'active') => {
    const { rows } = await client.query(
      `insert into public.restaurants (owner_id, name, slug, short_id, status, phone)
       values ($1,$2,$3,$4,$5,'0910000000') returning id`,
      [owner, name, slug, short, status],
    );
    return rows[0].id;
  };
  const restA = await mkRestaurant(userA, 'مطعم أ', 'restaurant-a', 'aaa111');
  const restB = await mkRestaurant(userB, 'مطعم ب', 'restaurant-b', 'bbb222');
  const restOff = await mkRestaurant(userB, 'مطعم معطّل', 'restaurant-off', 'ccc333', 'disabled');

  const mkCategory = async (rid, name, visible = true) => {
    const { rows } = await client.query(
      `insert into public.categories (restaurant_id, name, is_visible) values ($1,$2,$3) returning id`,
      [rid, name, visible],
    );
    return rows[0].id;
  };
  const catA = await mkCategory(restA, 'البرجر');
  const catAHidden = await mkCategory(restA, 'قسم مخفي', false);
  const catB = await mkCategory(restB, 'البيتزا');
  const catOff = await mkCategory(restOff, 'أي قسم');

  const mkProduct = async (rid, cid, name, price, visible = true) => {
    const { rows } = await client.query(
      `insert into public.products (restaurant_id, category_id, name, base_price, is_visible)
       values ($1,$2,$3,$4,$5) returning id`,
      [rid, cid, name, price, visible],
    );
    return rows[0].id;
  };
  const prodA = await mkProduct(restA, catA, 'برجر كلاسيك', 25);
  await mkProduct(restA, catA, 'صنف مخفي', 30, false);
  await mkProduct(restA, catAHidden, 'صنف في قسم مخفي', 15);
  const prodB = await mkProduct(restB, catB, 'بيتزا مارجريتا', 40);
  await mkProduct(restOff, catOff, 'صنف في مطعم معطّل', 10);

  await client.query(
    `insert into public.complaints (restaurant_id, message, type) values ($1, 'شكوى تجريبية لمطعم أ', 'complaint')`,
    [restA],
  );
  ok('أُنشئت بيانات الاختبار');

  // ══════════════════════════════════════════════════════════════════════
  group('١) صاحب مطعم أ — لا يرى ولا يمس مطعم ب');
  await client.query('begin');
  await as(client, 'authenticated', userA);

  await expectRows(client, 'يرى مطعمه هو', 'select id from public.restaurants where id = $1', [restA], 1);
  await expectRows(client, 'لا يرى مطعم ب إطلاقاً', 'select id from public.restaurants where id = $1', [restB], 0);
  await expectRows(client, 'قائمة المطاعم تُرجع مطعمه فقط', 'select id from public.restaurants', [], 1);
  await expectRows(client, 'يرى أصناف مطعمه (الظاهر والمخفي)', 'select id from public.products where restaurant_id = $1', [restA], 3);
  await expectRows(client, 'لا يرى أصناف مطعم ب', 'select id from public.products where restaurant_id = $1', [restB], 0);
  await expectRows(client, 'يرى شكاوى مطعمه', 'select id from public.complaints where restaurant_id = $1', [restA], 1);
  await expectRows(client, 'لا يرى شكاوى مطعم ب', 'select id from public.complaints where restaurant_id = $1', [restB], 0);

  await expectNoRows(client, 'لا يستطيع تعديل صنف في مطعم ب',
    `update public.products set name = 'اختراق' where id = $1 returning id`, [prodB]);
  await expectNoRows(client, 'لا يستطيع حذف صنف من مطعم ب',
    `delete from public.products where id = $1 returning id`, [prodB]);
  await expectNoRows(client, 'لا يستطيع تغيير حالة شكوى في مطعم ب',
    `update public.complaints set status = 'closed' where restaurant_id = $1 returning id`, [restB]);

  await expectDenied(client, 'لا يستطيع إضافة صنف إلى مطعم ب',
    `insert into public.products (restaurant_id, category_id, name, base_price) values ($1,$2,'دخيل',10)`, [restB, catB]);
  await expectDenied(client, 'لا يستطيع إضافة صنف لمطعمه في قسم مطعم ب',
    `insert into public.products (restaurant_id, category_id, name, base_price) values ($1,$2,'دخيل',10)`, [restA, catB]);
  await expectDenied(client, 'لا يستطيع تغيير حالة مطعمه بنفسه',
    `update public.restaurants set status = 'suspended' where id = $1`, [restA]);
  await expectDenied(client, 'لا يستطيع نقل ملكية مطعمه',
    `update public.restaurants set owner_id = $2 where id = $1`, [restA, userB]);
  await expectDenied(client, 'لا يستطيع ترقية نفسه إلى مدير منصة',
    `update public.profiles set role = 'super_admin' where id = $1`, [userA]);
  await expectRows(client, 'لا يرى ملف صاحب مطعم ب الشخصي', 'select id from public.profiles where id = $1', [userB], 0);
  await expectRows(client, 'لا يقرأ سجل العمليات', 'select * from public.audit_logs', [], 0);
  await expectDenied(client, 'لا يقرأ تجزئات الزوار', 'select * from public.analytics_visitors', []);

  const okWrite = await client.query(
    `insert into public.products (restaurant_id, category_id, name, base_price) values ($1,$2,'صنف جديد',12) returning id`,
    [restA, catA],
  );
  if (okWrite.rowCount === 1) ok('يستطيع الإضافة إلى مطعمه هو'); else fail('الإضافة لمطعمه', 'فشلت!');
  await client.query('rollback');

  // ══════════════════════════════════════════════════════════════════════
  group('٢) الزائر العام (anon)');
  await client.query('begin');
  await as(client, 'anon');

  await expectDenied(client, 'لا يملك أي صلاحية على جدول المطاعم', 'select * from public.restaurants', []);
  await expectDenied(client, 'لا يستطيع إرسال شكوى مباشرة (لتحديد المعدل خادمياً)',
    `insert into public.complaints (restaurant_id, message) values ($1, 'سبام')`, [restA]);
  await expectDenied(client, 'لا يستطيع تزوير الإحصائيات',
    `select public.record_menu_view($1, 'x', current_date)`, [restA]);
  await expectDenied(client, 'لا يقرأ الملفات الشخصية', 'select * from public.profiles', []);

  await expectRows(client, 'يرى الأصناف الظاهرة لمطعم منشور', 'select id from public.products where restaurant_id = $1', [restA], 1);
  await expectRows(client, 'لا يرى الصنف المخفي', `select id from public.products where name = 'صنف مخفي'`, [], 0);
  await expectRows(client, 'لا يرى صنفاً داخل قسم مخفي', `select id from public.products where name = 'صنف في قسم مخفي'`, [], 0);
  await expectRows(client, 'لا يرى شيئاً من مطعم معطّل', 'select id from public.products where restaurant_id = $1', [restOff], 0);
  await expectRows(client, 'لا يرى الأقسام المخفية', 'select id from public.categories where restaurant_id = $1', [restA], 1);
  await expectRows(client, 'يقرأ خطط الاشتراك (صفحة الأسعار)', 'select id from public.plans', [], 3);
  await client.query('rollback');

  // ══════════════════════════════════════════════════════════════════════
  group('٣) دالة المنيو العام');
  await client.query('begin');
  await as(client, 'anon');

  const menu = (await client.query('select public.get_public_menu($1) as m', ['restaurant-a'])).rows[0].m;
  menu?.restaurant?.name === 'مطعم أ' ? ok('تُرجع بيانات المطعم') : fail('بيانات المطعم', JSON.stringify(menu)?.slice(0, 120));
  !('owner_id' in (menu?.restaurant ?? {})) ? ok('لا تسرّب owner_id') : fail('تسريب', 'owner_id ظاهر في الناتج!');
  JSON.stringify(menu).includes(userA) === false ? ok('لا يظهر أي معرّف مستخدم') : fail('تسريب', 'معرّف المستخدم ظاهر!');
  menu?.categories?.length === 1 ? ok('القسم المخفي غائب') : fail('الأقسام', `العدد ${menu?.categories?.length}`);
  menu?.categories?.[0]?.products?.length === 1 ? ok('الصنف المخفي غائب') : fail('الأصناف', `العدد ${menu?.categories?.[0]?.products?.length}`);
  menu?.theme?.primary_color ? ok('الثيم مُرفق') : fail('الثيم', 'غائب');

  const off = (await client.query('select public.get_public_menu($1) as m', ['restaurant-off'])).rows[0].m;
  off?.unavailable === true ? ok('المطعم المعطّل يُرجع «غير متاح»') : fail('المطعم المعطّل', JSON.stringify(off)?.slice(0, 120));

  const missing = (await client.query('select public.get_public_menu($1) as m', ['la-youjad'])).rows[0].m;
  missing === null ? ok('رابط غير موجود يُرجع null') : fail('رابط غير موجود', JSON.stringify(missing));

  const short = (await client.query('select public.resolve_short_id($1) as s', ['aaa111'])).rows[0].s;
  short === 'restaurant-a' ? ok('المعرّف القصير يحلّ إلى الرابط الحالي') : fail('المعرّف القصير', String(short));
  await client.query('rollback');

  // ══════════════════════════════════════════════════════════════════════
  group('٤) ثبات رابط QR بعد تغيير الـ slug');
  await client.query('begin');
  await client.query(`update public.restaurants set slug = 'restaurant-a-new' where id = $1`, [restA]);
  await as(client, 'anon');
  const redirect = (await client.query('select public.get_public_menu($1) as m', ['restaurant-a'])).rows[0].m;
  redirect?.redirect_to === 'restaurant-a-new' ? ok('الرابط القديم يعيد التوجيه إلى الجديد') : fail('التوجيه', JSON.stringify(redirect));
  const short2 = (await client.query('select public.resolve_short_id($1) as s', ['aaa111'])).rows[0].s;
  short2 === 'restaurant-a-new' ? ok('QR المطبوع ما زال يعمل بعد تغيير الرابط') : fail('QR', String(short2));
  await client.query('rollback');

  // ══════════════════════════════════════════════════════════════════════
  group('٥) مدير المنصة');
  await client.query('begin');
  await as(client, 'authenticated', admin);
  await expectRows(client, 'يرى كل المطاعم', 'select id from public.restaurants', [], 3);
  await expectRows(client, 'يرى كل الشكاوى', 'select id from public.complaints', [], 1);
  await expectRows(client, 'يرى كل الملفات الشخصية', 'select id from public.profiles', [], 3);
  const st = await client.query(`update public.restaurants set status = 'suspended' where id = $1 returning id`, [restB]);
  st.rowCount === 1 ? ok('يستطيع تعطيل أي مطعم') : fail('التعطيل', 'فشل');
  await client.query('rollback');

  // ══════════════════════════════════════════════════════════════════════
  group('٦) سلامة البيانات');
  await client.query('begin');
  await client.query(`insert into public.product_variants (product_id, restaurant_id, name, price) values ($1,$2,'وسط',30)`, [prodA, restA]);
  await client.query(`insert into public.product_variants (product_id, restaurant_id, name, price) values ($1,$2,'صغير',18)`, [prodA, restA]);
  const price = (await client.query('select base_price from public.products where id = $1', [prodA])).rows[0].base_price;
  Number(price) === 18 ? ok('سعر الصنف يُزامَن مع أرخص حجم') : fail('مزامنة السعر', `القيمة ${price}`);

  const c1 = await client.query(`insert into public.complaints (restaurant_id, message) values ($1,'أولى') returning ref_number`, [restB]);
  const c2 = await client.query(`insert into public.complaints (restaurant_id, message) values ($1,'ثانية') returning ref_number`, [restB]);
  c1.rows[0].ref_number === 1 && c2.rows[0].ref_number === 2
    ? ok('ترقيم الشكاوى متسلسل داخل كل مطعم')
    : fail('ترقيم الشكاوى', `${c1.rows[0].ref_number}, ${c2.rows[0].ref_number}`);

  const theme = await client.query('select preset from public.restaurant_themes where restaurant_id = $1', [restA]);
  theme.rowCount === 1 ? ok('كل مطعم يحصل على ثيم افتراضي') : fail('الثيم الافتراضي', 'غائب');
  const sub = await client.query('select status from public.subscriptions where restaurant_id = $1', [restA]);
  sub.rowCount === 1 ? ok('كل مطعم يبدأ على الخطة المجانية') : fail('الاشتراك الافتراضي', 'غائب');

  try {
    await client.query(`insert into public.restaurants (owner_id, name, slug, short_id) values ($1,'x','UPPER-case','zzz999')`, [userA]);
    fail('رفض الرابط غير الصالح', 'قُبل رابط بحروف كبيرة');
  } catch { ok('يرفض الرابط غير الصالح'); }
  await client.query('rollback');

  await client.query('begin');
  const arabic = await client.query(
    `insert into public.restaurants (owner_id, name, slug, short_id) values ($1,'مطعم الذوق','مطعم-الذوق','ddd444') returning slug`,
    [userA],
  );
  arabic.rows[0].slug === 'مطعم-الذوق' ? ok('يقبل الروابط العربية') : fail('الروابط العربية', 'رُفضت');
  await client.query('rollback');

  // ══════════════════════════════════════════════════════════════════════
  group('٧) الشكاوى العامة وتحديد المعدل');
  await client.query('begin');
  await as(client, 'anon');
  await expectDenied(client, 'الزائر لا يستطيع استدعاء دالة إرسال الشكوى',
    `select public.submit_complaint($1, null, null, 'complaint', null, 'محاولة')`, [restA]);
  await expectDenied(client, 'الزائر لا يستطيع استدعاء عدّاد تحديد المعدل',
    `select public.hit_rate_limit('x', 5, 60)`, []);
  await expectDenied(client, 'الزائر لا يقرأ جدول تحديد المعدل', 'select * from public.rate_limits', []);
  await client.query('rollback');

  await client.query('begin');
  const ref = (await client.query(
    `select public.submit_complaint($1, 'زبون', '0911111111', 'suggestion', 5, 'رسالة عبر الخادم') as r`,
    [restA],
  )).rows[0].r;
  typeof ref === 'number' ? ok('الخادم يستطيع إدراج شكوى ويحصل على رقمها') : fail('إدراج شكوى', String(ref));

  await expectDenied(client, 'ترفض الدالة الشكاوى إلى مطعم معطّل',
    `select public.submit_complaint($1, null, null, 'complaint', null, 'رسالة')`, [restOff]);

  await client.query(`update public.restaurants set accept_complaints = false where id = $1`, [restB]);
  await expectDenied(client, 'ترفض الدالة الشكاوى حين يوقفها المطعم',
    `select public.submit_complaint($1, null, null, 'complaint', null, 'رسالة')`, [restB]);

  const allowed = [];
  for (let i = 0; i < 5; i++) {
    allowed.push((await client.query(`select public.hit_rate_limit('test-key', 3, 3600) as a`)).rows[0].a);
  }
  JSON.stringify(allowed) === JSON.stringify([true, true, true, false, false])
    ? ok('تحديد المعدل يسمح بثلاث محاولات ثم يرفض')
    : fail('تحديد المعدل', JSON.stringify(allowed));
  await client.query('rollback');

  await client.end();

  console.log(`\n${'─'.repeat(60)}`);
  if (failures.length === 0) {
    console.log(`\x1b[32m\x1b[1mنجحت كل الاختبارات (${passed})\x1b[0m`);
  } else {
    console.log(`\x1b[31m\x1b[1mفشل ${failures.length} من ${passed + failures.length}\x1b[0m`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\x1b[31mخطأ فادح:\x1b[0m', err);
  process.exitCode = 1;
});
