#!/usr/bin/env node
/**
 * يزرع مطعم العرض التجريبي «مطعم الذوق» على الرابط /menu/demo.
 *
 *   npm run db:seed
 *
 * السكربت قابل لإعادة التشغيل: يمسح منيو المطعم التجريبي ثم يعيد بناءه، ولا
 * يمسّ أي مطعم آخر. كلمة مرور الحساب التجريبي تُقرأ من متغير بيئة، وإن لم
 * تُحدَّد وُلّدت عشوائياً وطُبعت مرة واحدة — ولا تُكتب في أي ملف.
 */
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, require_ } from './_env.mjs';

loadEnv();

const supabase = createClient(
  require_('NEXT_PUBLIC_SUPABASE_URL'),
  require_('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const EMAIL = process.env.SEED_DEMO_EMAIL || 'demo@example.com';
const GENERATED = !process.env.SEED_DEMO_PASSWORD;
const PASSWORD = process.env.SEED_DEMO_PASSWORD || `demo-${randomBytes(9).toString('base64url')}`;

const die = (label, error) => {
  if (error) {
    console.error(`\x1b[31m${label}:\x1b[0m`, error.message ?? error);
    process.exit(1);
  }
};

// ── ١) حساب صاحب المطعم التجريبي ──────────────────────────────────────────
let ownerId;
{
  const { data, error } = await supabase.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'صاحب مطعم الذوق', phone: '0910000000' },
  });
  if (error) {
    if (!/already|exists|registered/i.test(error.message)) die('تعذّر إنشاء الحساب التجريبي', error);
    const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    ownerId = list?.users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase())?.id;
    if (!ownerId) die('الحساب التجريبي موجود لكن تعذّر العثور عليه', new Error('not found'));
    if (!GENERATED) await supabase.auth.admin.updateUserById(ownerId, { password: PASSWORD });
  } else {
    ownerId = data.user.id;
  }
}

// ── ٢) المطعم ─────────────────────────────────────────────────────────────
const RESTAURANT = {
  owner_id: ownerId,
  name: 'مطعم الذوق',
  slug: 'demo',
  tagline: 'مذاق البيت، بروح المطاعم',
  description:
    'مطعم عائلي في قلب المدينة نقدّم فيه المشاوي الطازجة والبرجر المحضّر يومياً والبيتزا على الحطب. ' +
    'نختار موادنا كل صباح، ونطبخ كل طبق عند الطلب.',
  logo_url: '/demo/logo.svg',
  cover_url: '/demo/cover.svg',
  phone: '0912345678',
  whatsapp: '0912345678',
  instagram: 'althawq.restaurant',
  facebook: 'althawq.restaurant',
  maps_url: 'https://maps.google.com/?q=Tripoli',
  address: 'شارع الجمهورية، طرابلس',
  currency: 'LYD',
  timezone: 'Africa/Tripoli',
  status: 'active',
};

let restaurantId;
{
  const { data: existing } = await supabase.from('restaurants').select('id').eq('slug', 'demo').maybeSingle();
  if (existing) {
    restaurantId = existing.id;
    const { error } = await supabase.from('restaurants').update(RESTAURANT).eq('id', restaurantId);
    die('تعذّر تحديث المطعم التجريبي', error);
  } else {
    const { data, error } = await supabase
      .from('restaurants')
      .insert({ ...RESTAURANT, short_id: 'thawq7' })
      .select('id')
      .single();
    die('تعذّر إنشاء المطعم التجريبي', error);
    restaurantId = data.id;
  }
}

// منيو نظيف في كل تشغيل — الحذف يتتالى إلى الأصناف والأحجام والإضافات.
await supabase.from('categories').delete().eq('restaurant_id', restaurantId);
await supabase.from('offers').delete().eq('restaurant_id', restaurantId);
await supabase.from('opening_hours').delete().eq('restaurant_id', restaurantId);

// ── ٣) الثيم وأوقات العمل ─────────────────────────────────────────────────
die('الثيم', (await supabase.from('restaurant_themes').upsert({
  restaurant_id: restaurantId,
  preset: 'elegant',
  primary_color: '#1F6F5C',
  secondary_color: '#C89A4A',
  background_color: '#FBF9F6',
  text_color: '#1A1713',
  card_color: '#FFFFFF',
  border_radius: 20,
  button_style: 'solid',
}).select()).error);

const hours = [];
for (let weekday = 0; weekday <= 6; weekday++) {
  if (weekday === 5) continue; // الجمعة: مساءً فقط
  hours.push({ restaurant_id: restaurantId, weekday, opens_at: '11:00', closes_at: '16:00' });
  hours.push({ restaurant_id: restaurantId, weekday, opens_at: '18:30', closes_at: '01:00' });
}
hours.push({ restaurant_id: restaurantId, weekday: 5, opens_at: '17:00', closes_at: '01:00' });
die('أوقات العمل', (await supabase.from('opening_hours').insert(hours)).error);

// ── ٤) المنيو ─────────────────────────────────────────────────────────────
const MENU = [
  {
    name: 'المقبلات', icon: '🥗',
    products: [
      { name: 'سلطة الذوق', description: 'خس وطماطم وخيار وجرجير مع صوص الليمون والزيتون.', price: 12, image: 'salad', badges: ['vegetarian'] },
      { name: 'شوربة العدس', description: 'عدس أصفر مطبوخ على نار هادئة مع الكمون والليمون.', price: 9, image: 'soup', badges: ['vegetarian'] },
      { name: 'حمّص بالطحينة', description: 'حمّص مخفوق مع الطحينة وزيت الزيتون والصنوبر.', price: 10, image: 'salad', badges: ['vegetarian'] },
    ],
  },
  {
    name: 'البرجر', icon: '🍔',
    products: [
      {
        name: 'برجر الذوق الخاص', description: 'لحم بقري طازج ١٨٠ غم، جبنة شيدر، خس، طماطم، وصوص البيت السري.',
        price: 28, compare_at: 34, image: 'burger', badges: ['popular', 'offer'],
        variants: [ { name: 'قطعة واحدة', price: 28 }, { name: 'قطعتان', price: 42 } ],
        options: [
          { name: 'إضافات', min: 0, max: 4, items: [
            { name: 'جبنة إضافية', price: 5 }, { name: 'لحم إضافي', price: 10 },
            { name: 'بيكون بقري', price: 7 }, { name: 'صوص حار', price: 2 },
          ] },
          { name: 'الطبق الجانبي', min: 1, max: 1, items: [
            { name: 'بطاطس مقلية', price: 0 }, { name: 'بطاطس بالجبنة', price: 6 }, { name: 'سلطة صغيرة', price: 4 },
          ] },
        ],
      },
      { name: 'برجر الدجاج المقرمش', description: 'صدر دجاج مقرمش مع مايونيز الثوم والخس.', price: 24, image: 'burger', badges: ['new'] },
      { name: 'برجر حار', description: 'لحم بقري مع هالبينو وصوص الشيبوتلي وجبنة بيبر جاك.', price: 29, image: 'burger', badges: ['spicy'] },
    ],
  },
  {
    name: 'البيتزا', icon: '🍕',
    products: [
      {
        name: 'بيتزا مارجريتا', description: 'صلصة طماطم إيطالية، موزاريلا طازجة، وريحان.',
        price: 26, image: 'pizza', badges: ['vegetarian'],
        variants: [ { name: 'صغيرة ٢٤سم', price: 26 }, { name: 'وسط ٣٠سم', price: 38 }, { name: 'كبيرة ٤٠سم', price: 52 } ],
      },
      {
        name: 'بيتزا الأربع مواسم', description: 'زيتون، فطر، فلفل، وزيتون أسود على عجينة رقيقة.',
        price: 32, image: 'pizza',
        variants: [ { name: 'صغيرة ٢٤سم', price: 32 }, { name: 'وسط ٣٠سم', price: 45 }, { name: 'كبيرة ٤٠سم', price: 60 } ],
      },
      { name: 'بيتزا البيبروني', description: 'بيبروني بقري وموزاريلا مع رشة أوريجانو.', price: 35, image: 'pizza', badges: ['popular'] },
    ],
  },
  {
    name: 'المشاوي', icon: '🍢',
    products: [
      { name: 'مشاوي مشكّلة', description: 'كباب، شيش طاووق، وريش غنم مع الأرز والسلطة.', price: 85, image: 'grill', badges: ['popular'] },
      { name: 'شيش طاووق', description: 'قطع دجاج متبّلة بالزبادي والليمون مشوية على الفحم.', price: 45, image: 'grill' },
      { name: 'كباب لحم', description: 'لحم مفروم طازج مع البقدونس والبصل.', price: 52, image: 'grill' },
      { name: 'شاورما لحم', description: 'شاورما على الطريقة الشامية مع الطحينة والمخلل.', price: 30, image: 'shawarma', badges: ['popular'] },
    ],
  },
  {
    name: 'المكرونة', icon: '🍝',
    products: [
      { name: 'مكرونة بولونيز', description: 'صلصة لحم مطبوخة ببطء مع البارميزان.', price: 34, image: 'pasta' },
      { name: 'مكرونة ألفريدو', description: 'كريمة، دجاج، وفطر مع جبنة البارميزان.', price: 36, image: 'pasta' },
    ],
  },
  {
    name: 'الحلويات', icon: '🍰',
    products: [
      { name: 'تشيز كيك التوت', description: 'تشيز كيك كريمي مع صوص التوت الطازج.', price: 18, image: 'cake', badges: ['new'] },
      { name: 'كيك الشوكولاتة الساخن', description: 'كيك بقلب شوكولاتة سائل مع كرة آيس كريم.', price: 20, image: 'dessert', badges: ['popular'] },
      { name: 'أم علي', description: 'حلوى شرقية دافئة بالحليب والمكسرات.', price: 15, image: 'dessert' },
    ],
  },
  {
    name: 'المشروبات', icon: '🥤',
    products: [
      { name: 'قهوة عربية', description: 'قهوة محمّصة على الطريقة العربية مع الهيل.', price: 8, image: 'coffee' },
      { name: 'إسبريسو', description: 'جرعة إسبريسو من حبوب مختارة.', price: 7, image: 'coffee' },
      {
        name: 'عصير برتقال طازج', description: 'برتقال معصور عند الطلب، بلا سكر مضاف.',
        price: 12, image: 'juice', badges: ['vegetarian'],
        variants: [ { name: 'كوب ٣٠٠مل', price: 12 }, { name: 'كوب ٥٠٠مل', price: 17 } ],
      },
      { name: 'ماء معدني', description: 'قارورة ٥٠٠ مل.', price: 2, image: 'water' },
    ],
  },
];

let categoryCount = 0;
let productCount = 0;

for (const [categoryIndex, category] of MENU.entries()) {
  const { data: cat, error: catError } = await supabase
    .from('categories')
    .insert({ restaurant_id: restaurantId, name: category.name, icon: category.icon, position: categoryIndex })
    .select('id')
    .single();
  die(`القسم ${category.name}`, catError);
  categoryCount++;

  for (const [productIndex, product] of category.products.entries()) {
    const { data: prod, error: prodError } = await supabase
      .from('products')
      .insert({
        restaurant_id: restaurantId,
        category_id: cat.id,
        name: product.name,
        description: product.description,
        base_price: product.price,
        compare_at_price: product.compare_at ?? null,
        image_url: `/demo/${product.image}.svg`,
        badges: product.badges ?? [],
        position: productIndex,
      })
      .select('id')
      .single();
    die(`الصنف ${product.name}`, prodError);
    productCount++;

    if (product.variants) {
      die('الأحجام', (await supabase.from('product_variants').insert(
        product.variants.map((v, i) => ({
          product_id: prod.id, restaurant_id: restaurantId, name: v.name, price: v.price, position: i,
        })),
      )).error);
    }

    for (const [groupIndex, group] of (product.options ?? []).entries()) {
      const { data: grp, error: grpError } = await supabase
        .from('option_groups')
        .insert({
          product_id: prod.id, restaurant_id: restaurantId, name: group.name,
          min_select: group.min, max_select: group.max, position: groupIndex,
        })
        .select('id')
        .single();
      die(`مجموعة الإضافات ${group.name}`, grpError);

      die('الإضافات', (await supabase.from('options').insert(
        group.items.map((item, i) => ({
          group_id: grp.id, restaurant_id: restaurantId, name: item.name, price_delta: item.price, position: i,
        })),
      )).error);
    }
  }
}

// ── ٥) العروض ─────────────────────────────────────────────────────────────
die('العروض', (await supabase.from('offers').insert([
  {
    restaurant_id: restaurantId, title: 'عرض العائلة', badge_text: 'وفّر ٢٥٪',
    description: 'مشاوي مشكّلة + ٤ مشروبات + حلوى بسعر ١٢٠ د.ل بدل ١٦٠.',
    image_url: '/demo/grill.svg', position: 0,
  },
  {
    restaurant_id: restaurantId, title: 'فطور العمل', badge_text: 'يومياً ١١–١',
    description: 'برجر أو شاورما + بطاطس + مشروب بـ ٣٥ د.ل.',
    image_url: '/demo/burger.svg', position: 1,
  },
])).error);

// ── ٦) شكاوى تجريبية ──────────────────────────────────────────────────────
const { count: complaintCount } = await supabase
  .from('complaints').select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId);

if (!complaintCount) {
  die('الشكاوى', (await supabase.from('complaints').insert([
    { restaurant_id: restaurantId, customer_name: 'أحمد', customer_phone: '0913334444', type: 'suggestion',
      rating: 4, message: 'الأكل ممتاز، لكن أتمنى إضافة خيارات نباتية أكثر في المشاوي.' },
    { restaurant_id: restaurantId, customer_name: 'سارة', type: 'complaint', rating: 2,
      message: 'انتظرت الطلب أكثر من ٤٠ دقيقة يوم الخميس رغم أن المطعم لم يكن مزدحماً.' },
    { restaurant_id: restaurantId, type: 'note', rating: 5,
      message: 'برجر الذوق الخاص أفضل برجر جرّبته في المدينة. استمروا!' },
  ])).error);
}

console.log(`
\x1b[32m\x1b[1mتمت البذرة.\x1b[0m

  المطعم      مطعم الذوق
  المنيو      ${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/menu/demo
  الأقسام     ${categoryCount}
  الأصناف     ${productCount}

  دخول لوحة التحكم التجريبية
  البريد      ${EMAIL}
  كلمة المرور ${GENERATED ? `\x1b[33m${PASSWORD}\x1b[0m  (وُلّدت الآن — احفظها، لن تُعرض مرة أخرى)` : '(كما في SEED_DEMO_PASSWORD)'}
`);
