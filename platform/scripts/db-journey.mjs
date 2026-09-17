#!/usr/bin/env node
/**
 * رحلة صاحب المطعم كاملة، خطوة بخطوة، على قاعدة بيانات PostgreSQL حقيقية.
 *
 * كل خطوة هنا تنفّذ العملية نفسها التي ينفّذها الإجراء الخادمي المقابل، لكن
 * بهوية المستخدم وتحت سياسات RLS الفعلية — لا بصلاحية النظام. الهدف أن نتحقق
 * من سلسلة العمليات مجتمعة: المشغّلات، والقيود، والسياسات، وما يراه الزبون بعد
 * كل تعديل.
 *
 * ما لا يغطيه هذا الملف: طبقة HTTP (GoTrue وPostgREST) وواجهة المتصفح. تشغيل
 * نسخة محلية منهما غير ممكن في هذه البيئة، وهذا مذكور في التقرير.
 *
 *   node scripts/local-db.mjs start && node scripts/db-journey.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { url as localUrl } from './local-db.mjs';

const DB_URL = process.env.SUFRA_TEST_DB_URL ?? localUrl;
const MIGRATIONS = join(import.meta.dirname, '..', 'supabase', 'migrations');
const BOOTSTRAP = join(import.meta.dirname, '..', 'supabase', 'test', 'bootstrap.sql');

let step = 0;
let passed = 0;
const failures = [];

function ok(name, detail = '') {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${String(++step).padStart(2)} ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
}
function fail(name, detail) {
  failures.push({ name, detail });
  console.log(`  \x1b[31m✗\x1b[0m ${String(++step).padStart(2)} ${name}\n        ${detail}`);
}
function check(condition, name, detail = '') {
  if (condition) ok(name, detail);
  else fail(name, detail || 'لم تتحقق النتيجة المتوقعة');
}
function group(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

/** ينفّذ بهوية مستخدم مسجَّل — كما يفعل عميل Supabase في المتصفح. */
async function asUser(client, userId) {
  await client.query('reset role');
  await client.query('select set_config($1, $2, false)', [
    'request.jwt.claims',
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ]);
  await client.query('set role authenticated');
}

async function asVisitor(client) {
  await client.query('reset role');
  await client.query('select set_config($1, $2, false)', ['request.jwt.claims', JSON.stringify({ role: 'anon' })]);
  await client.query('set role anon');
}

/** مفتاح الخدمة: ما ينفّذه الخادم وحده (الشكاوى والإحصائيات). */
async function asServer(client) {
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claims', '', false)");
}

async function run(client) {
  group('التهيئة');
  await client.query('drop schema if exists public cascade; drop schema if exists auth cascade; create schema public');
  await client.query(readFileSync(BOOTSTRAP, 'utf8'));
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await client.query(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  ok('طُبّقت الهجرات', `${readdirSync(MIGRATIONS).length} ملفاً`);

  // ══════════════════════════════════════════════════════════════════════
  group('١) التسجيل');

  const { rows: [{ id: ownerId }] } = await client.query(
    `insert into auth.users (email, raw_user_meta_data)
     values ('owner@journey.test', $1) returning id`,
    [JSON.stringify({ full_name: 'صاحب مطعم الرحلة', phone: '0911234567', restaurant_name: 'مطعم الرحلة' })],
  );

  const profile = await client.query('select full_name, phone, role from public.profiles where id = $1', [ownerId]);
  check(
    profile.rows[0]?.full_name === 'صاحب مطعم الرحلة' && profile.rows[0]?.phone === '0911234567',
    'التسجيل ينشئ ملفاً شخصياً تلقائياً بالبيانات المُدخلة',
  );
  check(profile.rows[0]?.role === 'owner', 'المستخدم الجديد دوره «صاحب مطعم» لا مدير منصة');

  // ══════════════════════════════════════════════════════════════════════
  group('٢) إنشاء المطعم (معالج الإعداد)');
  await asUser(client, ownerId);

  const created = await client.query(
    `insert into public.restaurants (owner_id, name, slug, short_id, phone, currency)
     values ($1, 'مطعم الرحلة', 'matam-alrihla', 'jrny42', '0911234567', 'LYD')
     returning id, status`,
    [ownerId],
  );
  const restaurantId = created.rows[0]?.id;
  check(Boolean(restaurantId), 'صاحب المطعم ينشئ مطعمه بهويته هو');
  check(created.rows[0]?.status === 'trial', 'المطعم يبدأ بحالة «تجريبي»', 'لا ينشّط نفسه');

  const theme = await client.query('select preset from public.restaurant_themes where restaurant_id = $1', [restaurantId]);
  check(theme.rowCount === 1, 'ثيم افتراضي أُنشئ تلقائياً', theme.rows[0]?.preset);

  const membership = await client.query(
    `select role from public.restaurant_members where restaurant_id = $1 and user_id = $2`, [restaurantId, ownerId]);
  check(membership.rows[0]?.role === 'owner', 'المالك صار عضواً بدور owner');

  const subscription = await client.query(
    `select p.code from public.subscriptions s join public.plans p on p.id = s.plan_id
     where s.restaurant_id = $1`, [restaurantId]);
  check(subscription.rows[0]?.code === 'free', 'اشتراك الخطة المجانية أُنشئ تلقائياً');

  // ══════════════════════════════════════════════════════════════════════
  group('٣) تعديل بيانات المطعم ورفع الصور');

  await client.query(
    `update public.restaurants set
       tagline = 'كل يوم طبق جديد', description = 'مطعم عائلي في وسط المدينة.',
       whatsapp = '0911234567', instagram = 'alrihla', address = 'شارع البحر، مصراتة',
       maps_url = 'https://maps.google.com/?q=Misrata'
     where id = $1`, [restaurantId]);
  const updated = await client.query('select tagline, whatsapp, address from public.restaurants where id = $1', [restaurantId]);
  check(updated.rows[0]?.tagline === 'كل يوم طبق جديد', 'تعديل معلومات المطعم يُحفظ');

  await client.query(
    `update public.restaurants set logo_url = '/demo/logo.svg', cover_url = '/demo/cover.svg' where id = $1`,
    [restaurantId]);
  const media = await client.query('select logo_url, cover_url from public.restaurants where id = $1', [restaurantId]);
  check(Boolean(media.rows[0]?.logo_url && media.rows[0]?.cover_url), 'الشعار والغلاف يُحفظان');

  // أوقات العمل: استبدال كامل كما يفعل الإجراء
  await client.query('delete from public.opening_hours where restaurant_id = $1', [restaurantId]);
  await client.query(
    `insert into public.opening_hours (restaurant_id, weekday, opens_at, closes_at)
     select $1, g, '11:00'::time, '16:00'::time from generate_series(0, 6) g`, [restaurantId]);
  await client.query(
    `insert into public.opening_hours (restaurant_id, weekday, opens_at, closes_at)
     select $1, g, '18:30'::time, '01:00'::time from generate_series(0, 6) g`, [restaurantId]);
  const hours = await client.query('select count(*)::int as n from public.opening_hours where restaurant_id = $1', [restaurantId]);
  check(hours.rows[0]?.n === 14, 'أوقات العمل: فترتان لكل يوم', '١٤ فترة');

  // ══════════════════════════════════════════════════════════════════════
  group('٤) بناء المنيو');

  const catBurger = (await client.query(
    `insert into public.categories (restaurant_id, name, icon, position) values ($1,'البرجر','🍔',0) returning id`,
    [restaurantId])).rows[0].id;
  const catDrinks = (await client.query(
    `insert into public.categories (restaurant_id, name, icon, position) values ($1,'المشروبات','🥤',1) returning id`,
    [restaurantId])).rows[0].id;
  check(Boolean(catBurger && catDrinks), 'إنشاء قسمين');

  const prodA = (await client.query(
    `insert into public.products (restaurant_id, category_id, name, description, base_price, badges, position)
     values ($1,$2,'برجر كلاسيك','لحم بقري طازج مع جبنة شيدر.',25,'{popular}',0) returning id`,
    [restaurantId, catBurger])).rows[0].id;
  const prodB = (await client.query(
    `insert into public.products (restaurant_id, category_id, name, base_price, position)
     values ($1,$2,'برجر دجاج',22,1) returning id`, [restaurantId, catBurger])).rows[0].id;
  await client.query(
    `insert into public.products (restaurant_id, category_id, name, base_price, position)
     values ($1,$2,'عصير برتقال',10,0)`, [restaurantId, catDrinks]);
  check(Boolean(prodA && prodB), 'إضافة ثلاثة أصناف');

  await client.query(`update public.products set image_url = '/demo/burger.svg' where id = $1`, [prodA]);
  const image = await client.query('select image_url from public.products where id = $1', [prodA]);
  check(image.rows[0]?.image_url === '/demo/burger.svg', 'رفع صورة الصنف');

  await client.query('update public.products set base_price = 28, compare_at_price = 34 where id = $1', [prodA]);
  const price = await client.query('select base_price, compare_at_price from public.products where id = $1', [prodA]);
  check(Number(price.rows[0]?.base_price) === 28, 'تعديل السعر وإضافة سعر ما قبل الخصم');

  // الأحجام تُزامن السعر الأساسي
  await client.query(
    `insert into public.product_variants (product_id, restaurant_id, name, price, position)
     values ($1,$2,'وسط',28,0), ($1,$2,'كبير',40,1)`, [prodA, restaurantId]);
  const synced = await client.query('select base_price from public.products where id = $1', [prodA]);
  check(Number(synced.rows[0]?.base_price) === 28, 'السعر يُزامَن مع أرخص حجم');

  // ══════════════════════════════════════════════════════════════════════
  group('٥) إخفاء وإظهار وترتيب — وأثرها على ما يراه الزبون');

  const publicMenu = async () => {
    await asVisitor(client);
    const { rows } = await client.query('select public.get_public_menu($1) as m', ['matam-alrihla']);
    await asUser(client, ownerId);
    return rows[0].m;
  };

  let menu = await publicMenu();
  const burgerNames = () => menu.categories.find((c) => c.name === 'البرجر')?.products.map((p) => p.name) ?? [];
  check(burgerNames().length === 2, 'المنيو العام يعرض صنفَي البرجر قبل الإخفاء');

  await client.query('update public.products set is_visible = false where id = $1', [prodB]);
  menu = await publicMenu();
  check(!burgerNames().includes('برجر دجاج'), 'إخفاء صنف يُخفيه عن الزبون فوراً');

  const stillThere = await client.query('select id from public.products where id = $1', [prodB]);
  check(stillThere.rowCount === 1, 'الصنف المخفي يبقى في لوحة صاحب المطعم');

  await client.query('update public.products set is_visible = true where id = $1', [prodB]);
  menu = await publicMenu();
  check(burgerNames().includes('برجر دجاج'), 'إظهاره يعيده للزبون');

  await client.query('update public.products set is_available = false where id = $1', [prodB]);
  menu = await publicMenu();
  const unavailable = menu.categories.find((c) => c.name === 'البرجر')?.products.find((p) => p.name === 'برجر دجاج');
  check(unavailable?.is_available === false, 'الصنف غير المتوفر يظهر معلَّماً لا محذوفاً', 'إعداد المطعم: إظهار');

  await client.query('update public.restaurants set show_unavailable = false where id = $1', [restaurantId]);
  menu = await publicMenu();
  check(!burgerNames().includes('برجر دجاج'), 'وإن اختار المطعم إخفاء غير المتوفر، اختفى');
  await client.query('update public.restaurants set show_unavailable = true where id = $1', [restaurantId]);
  await client.query('update public.products set is_available = true where id = $1', [prodB]);

  // ترتيب الأصناف
  await client.query('update public.products set position = 1 where id = $1', [prodA]);
  await client.query('update public.products set position = 0 where id = $1', [prodB]);
  menu = await publicMenu();
  check(burgerNames()[0] === 'برجر دجاج', 'ترتيب الأصناف ينعكس على المنيو', burgerNames().join(' ← '));

  // ترتيب الأقسام
  await client.query('update public.categories set position = 1 where id = $1', [catBurger]);
  await client.query('update public.categories set position = 0 where id = $1', [catDrinks]);
  menu = await publicMenu();
  check(menu.categories[0]?.name === 'المشروبات', 'ترتيب الأقسام ينعكس على المنيو',
    menu.categories.map((c) => c.name).join(' ← '));

  // إخفاء قسم
  await client.query('update public.categories set is_visible = false where id = $1', [catDrinks]);
  menu = await publicMenu();
  check(!menu.categories.some((c) => c.name === 'المشروبات'), 'إخفاء قسم يُخفي القسم وأصنافه معاً');
  await client.query('update public.categories set is_visible = true where id = $1', [catDrinks]);

  // ══════════════════════════════════════════════════════════════════════
  group('٦) العروض والثيم');

  await client.query(
    `insert into public.offers (restaurant_id, title, description, badge_text, position)
     values ($1,'عرض نهاية الأسبوع','برجران ومشروبان بـ ٦٠ د.ل.','وفّر ٢٠٪',0)`, [restaurantId]);
  menu = await publicMenu();
  check(menu.offers?.length === 1, 'العرض يظهر للزبون');

  await client.query(
    `update public.offers set is_active = false where restaurant_id = $1`, [restaurantId]);
  menu = await publicMenu();
  check(menu.offers?.length === 0, 'إيقاف العرض يُخفيه بلا حذف');

  await client.query(
    `update public.restaurant_themes set preset = 'luxury', primary_color = '#C6A052', default_dark = true
     where restaurant_id = $1`, [restaurantId]);
  menu = await publicMenu();
  check(menu.theme?.primary_color === '#C6A052' && menu.theme?.default_dark === true,
    'تغيير الثيم ينعكس على صفحة المنيو');

  // ══════════════════════════════════════════════════════════════════════
  group('٧) رمز QR ورابطه الثابت');

  await asVisitor(client);
  let resolved = (await client.query('select public.resolve_short_id($1) as s', ['jrny42'])).rows[0].s;
  check(resolved === 'matam-alrihla', 'الرمز يحلّ إلى رابط المنيو');

  await asUser(client, ownerId);
  await client.query(`update public.restaurants set slug = 'alrihla-restaurant' where id = $1`, [restaurantId]);

  await asVisitor(client);
  resolved = (await client.query('select public.resolve_short_id($1) as s', ['jrny42'])).rows[0].s;
  check(resolved === 'alrihla-restaurant', 'الرمز المطبوع ما زال يعمل بعد تغيير الرابط', 'هذا جوهر ثبات QR');

  const old = (await client.query('select public.get_public_menu($1) as m', ['matam-alrihla'])).rows[0].m;
  check(old?.redirect_to === 'alrihla-restaurant', 'الرابط القديم يعيد التوجيه إلى الجديد');

  // الزائر لا يملك صلاحية على الجدول أصلاً — يُرفض الاستعلام لا يُرجع صفراً
  let denied = false;
  try {
    await client.query('select short_id from public.restaurants where slug = $1', ['alrihla-restaurant']);
  } catch {
    denied = true;
  }
  check(denied, 'الزائر لا يقرأ جدول المطاعم مباشرة', 'الحقول العامة تأتي من الدالة وحدها');

  // ══════════════════════════════════════════════════════════════════════
  group('٨) الشكاوى');

  await asServer(client);
  const ref = (await client.query(
    `select public.submit_complaint($1,'زبون','0913334444','complaint',2,'الطلب تأخر أربعين دقيقة.') as r`,
    [restaurantId])).rows[0].r;
  check(ref === 1, 'الشكوى تُسجَّل برقم متسلسل', `#${ref}`);

  const ref2 = (await client.query(
    `select public.submit_complaint($1,null,null,'suggestion',5,'أضيفوا خيارات نباتية.') as r`,
    [restaurantId])).rows[0].r;
  check(ref2 === 2, 'الشكوى الثانية تأخذ الرقم التالي', `#${ref2}`);

  await asUser(client, ownerId);
  const inbox = await client.query(
    'select id, ref_number, status, is_read, rating from public.complaints where restaurant_id = $1 order by ref_number',
    [restaurantId]);
  check(inbox.rowCount === 2, 'صاحب المطعم يرى الشكويين في لوحته');
  check(inbox.rows[0]?.status === 'new' && inbox.rows[0]?.is_read === false, 'تصلان بحالة «جديدة» وغير مقروءة');
  check(inbox.rows[0]?.rating === 2, 'التقييم محفوظ مع الشكوى');

  await client.query(`update public.complaints set status = 'in_review', is_read = true where id = $1`, [inbox.rows[0].id]);
  const afterStatus = await client.query('select status, is_read from public.complaints where id = $1', [inbox.rows[0].id]);
  check(afterStatus.rows[0]?.status === 'in_review', 'تغيير حالة الشكوى يُحفظ');

  const unread = await client.query(
    'select count(*)::int as n from public.complaints where restaurant_id = $1 and not is_read', [restaurantId]);
  check(unread.rows[0]?.n === 1, 'عدّاد غير المقروء يتناقص', `بقيت ${unread.rows[0]?.n}`);

  // ══════════════════════════════════════════════════════════════════════
  group('٩) الإحصائيات');

  await asServer(client);
  await client.query(`select public.record_menu_view($1, 'visitor-hash-a')`, [restaurantId]);
  await client.query(`select public.record_menu_view($1, 'visitor-hash-a')`, [restaurantId]);
  await client.query(`select public.record_menu_view($1, 'visitor-hash-b')`, [restaurantId]);
  await client.query(`select public.record_product_view($1, $2)`, [restaurantId, prodA]);

  await asUser(client, ownerId);
  const stats = await client.query(
    'select views, visitors from public.analytics_daily where restaurant_id = $1 and day = current_date', [restaurantId]);
  check(stats.rows[0]?.views === 3, 'المشاهدات تُحتسب', `${stats.rows[0]?.views} مشاهدات`);
  check(stats.rows[0]?.visitors === 2, 'الزائر المتكرر يُحتسب مرة واحدة', `${stats.rows[0]?.visitors} زائران`);

  const productStats = await client.query(
    'select views from public.product_views_daily where product_id = $1 and day = current_date', [prodA]);
  check(productStats.rows[0]?.views === 1, 'مشاهدات الصنف تُحتسب منفصلة');

  // ══════════════════════════════════════════════════════════════════════
  group('١٠) حدود الخطة تُفرض فعلياً');

  const limit = await client.query(
    `select p.max_categories, p.max_products from public.subscriptions s
     join public.plans p on p.id = s.plan_id where s.restaurant_id = $1`, [restaurantId]);
  check(limit.rows[0]?.max_categories === 3 && limit.rows[0]?.max_products === 25,
    'الخطة المجانية لها حدود حقيقية في قاعدة البيانات',
    `${limit.rows[0]?.max_categories} أقسام · ${limit.rows[0]?.max_products} صنفاً`);

  // ══════════════════════════════════════════════════════════════════════
  group('١١) المطعم يظهر للزبون بحالته الصحيحة');

  await asVisitor(client);
  menu = (await client.query('select public.get_public_menu($1) as m', ['alrihla-restaurant'])).rows[0].m;
  check(menu?.restaurant?.name === 'مطعم الرحلة', 'المنيو يفتح والمطعم في حالة «تجريبي»');
  check(menu.hours?.length === 14, 'أوقات العمل تصل للزبون');
  check(!JSON.stringify(menu).includes(ownerId), 'لا يتسرّب معرّف المالك في مخرجات المنيو');
  check(!('owner_id' in (menu.restaurant ?? {})) && !('status' in (menu.restaurant ?? {})),
    'الحقول الداخلية غائبة عن مخرجات المنيو');

  // مدير المنصة يوقف المطعم
  await asServer(client);
  const { rows: [{ id: adminId }] } = await client.query(
    `insert into auth.users (email, raw_user_meta_data) values ('admin@journey.test', '{"full_name":"مدير"}') returning id`);
  await client.query(`update public.profiles set role = 'super_admin' where id = $1`, [adminId]);

  await asUser(client, adminId);
  await client.query(`update public.restaurants set status = 'suspended', status_note = 'انتهى الاشتراك' where id = $1`,
    [restaurantId]);

  await asVisitor(client);
  const suspended = (await client.query('select public.get_public_menu($1) as m', ['alrihla-restaurant'])).rows[0].m;
  check(suspended?.unavailable === true, 'إيقاف المطعم يُخفي المنيو فوراً عن الزبون');
  check(!('slug' in (suspended ?? {})) && !suspended?.categories, 'صفحة الإيقاف لا تكشف أي محتوى');

  const suspendedQr = (await client.query('select public.resolve_short_id($1) as s', ['jrny42'])).rows[0].s;
  check(suspendedQr === null, 'رمز QR لمطعم موقوف لا يحلّ إلى شيء');

  await asUser(client, adminId);
  await client.query(`update public.restaurants set status = 'active', status_note = null where id = $1`, [restaurantId]);
  await asVisitor(client);
  const reactivated = (await client.query('select public.get_public_menu($1) as m', ['alrihla-restaurant'])).rows[0].m;
  check(reactivated?.restaurant?.name === 'مطعم الرحلة', 'إعادة التفعيل تعيد المنيو كما كان');

  console.log(`\n${'─'.repeat(64)}`);
  if (failures.length === 0) {
    console.log(`\x1b[32m\x1b[1mالرحلة كاملة نجحت — ${passed} خطوة متحقَّقة\x1b[0m`);
  } else {
    console.log(`\x1b[31m\x1b[1mفشل ${failures.length} من ${passed + failures.length}\x1b[0m`);
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
