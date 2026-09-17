import { z } from 'zod';

/**
 * مخططات التحقق — مصدر واحد للعميل والخادم.
 *
 * التحقق في المتصفح للراحة فقط؛ الخادم يعيد التحقق دائماً بالمخطط نفسه، لأن
 * أي أحد يستطيع تجاوز نموذج HTML.
 */

const trimmed = (max: number) => z.string().trim().max(max);

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 \-]{7,20}$/, 'رقم الهاتف غير صحيح');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('صيغة البريد الإلكتروني غير صحيحة'));

export const passwordSchema = z
  .string()
  .min(8, 'كلمة المرور يجب أن تكون ٨ محارف على الأقل')
  .max(72, 'كلمة المرور طويلة جداً');

/* ── المصادقة ───────────────────────────────────────────────────────────── */

export const registerSchema = z.object({
  fullName: trimmed(80).min(2, 'الاسم قصير جداً'),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  restaurantName: trimmed(80).min(2, 'اسم المطعم قصير جداً'),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'أدخل كلمة المرور'),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((value) => value.password === value.confirm, {
    message: 'كلمتا المرور غير متطابقتين',
    path: ['confirm'],
  });

/* ── المطعم ─────────────────────────────────────────────────────────────── */

const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === '' || /^https?:\/\//i.test(v), 'الرابط يجب أن يبدأ بـ http أو https')
  .optional();

const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\+?[0-9 \-]{7,20}$/.test(v), 'رقم الهاتف غير صحيح')
  .optional();

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'الرابط قصير جداً')
  .max(60, 'الرابط طويل جداً')
  .regex(
    /^[a-z0-9؀-ۿ]([a-z0-9؀-ۿ-]*[a-z0-9؀-ۿ])?$/u,
    'الرابط يقبل الأحرف والأرقام والشرطة فقط، ولا يبدأ أو ينتهي بشرطة',
  );

export const restaurantProfileSchema = z.object({
  name: trimmed(80).min(2, 'اسم المطعم قصير جداً'),
  slug: slugSchema,
  tagline: trimmed(120).optional(),
  description: trimmed(1000).optional(),
  phone: optionalPhone,
  whatsapp: optionalPhone,
  instagram: trimmed(100).optional(),
  facebook: trimmed(200).optional(),
  tiktok: trimmed(100).optional(),
  maps_url: optionalUrl,
  address: trimmed(200).optional(),
  currency: z.string().length(3),
  timezone: trimmed(60).min(1),
  show_unavailable: z.boolean(),
  show_prices: z.boolean(),
  accept_complaints: z.boolean(),
});

export const themeSchema = z.object({
  preset: z.enum(['elegant', 'modern', 'luxury', 'minimal', 'dark', 'classic']),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'لون غير صالح'),
  secondary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'لون غير صالح'),
  background_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'لون غير صالح'),
  text_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'لون غير صالح'),
  card_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'لون غير صالح'),
  font_family: z.enum(['tajawal', 'cairo', 'system']),
  border_radius: z.coerce.number().int().min(0).max(32),
  button_style: z.enum(['solid', 'soft', 'outline']),
  default_dark: z.boolean(),
});

/* ── المنيو ─────────────────────────────────────────────────────────────── */

export const categorySchema = z.object({
  name: trimmed(60).min(1, 'اكتب اسم القسم'),
  description: trimmed(300).optional(),
  icon: trimmed(40).optional(),
  is_visible: z.boolean().default(true),
});

const price = z.coerce
  .number({ error: 'أدخل سعراً صحيحاً' })
  .min(0, 'السعر لا يكون سالباً')
  .max(999999, 'السعر كبير جداً');

/**
 * سعر اختياري قادم من نموذج HTML.
 *
 * الحقل الفارغ يصل كسلسلة فارغة، وz.coerce.number يحوّلها إلى صفر لا إلى
 * «لا قيمة» — فيصبح «بلا خصم» خصماً بسعر صفر ويُرفض برسالة مُربكة. نحوّل
 * الفارغ إلى undefined قبل أي تحويل رقمي.
 */
const optionalPrice = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  price.optional(),
);

export const productSchema = z
  .object({
    name: trimmed(80).min(1, 'اكتب اسم الصنف'),
    description: trimmed(500).optional(),
    category_id: z.uuid('اختر القسم'),
    base_price: price,
    compare_at_price: optionalPrice,
    image_url: z.string().trim().max(500).optional(),
    badges: z.array(z.enum(['new', 'popular', 'offer', 'spicy', 'vegetarian'])).max(2, 'شارتان كحد أقصى'),
    is_available: z.boolean().default(true),
    is_visible: z.boolean().default(true),
  })
  .refine(
    (value) => value.compare_at_price === undefined || value.compare_at_price > value.base_price,
    { message: 'السعر قبل الخصم يجب أن يكون أعلى من السعر الحالي', path: ['compare_at_price'] },
  );

export const variantSchema = z.object({
  name: trimmed(40).min(1, 'اكتب اسم الحجم'),
  price,
  is_available: z.boolean().default(true),
});

export const optionGroupSchema = z
  .object({
    name: trimmed(60).min(1, 'اكتب اسم المجموعة'),
    min_select: z.coerce.number().int().min(0).max(20),
    max_select: z.coerce.number().int().min(1).max(20),
  })
  .refine((v) => v.min_select <= v.max_select, {
    message: 'الحد الأدنى لا يتجاوز الحد الأقصى',
    path: ['min_select'],
  });

export const optionSchema = z.object({
  name: trimmed(60).min(1, 'اكتب اسم الإضافة'),
  price_delta: z.coerce.number().min(-999999).max(999999),
  is_available: z.boolean().default(true),
});

export const offerSchema = z.object({
  title: trimmed(80).min(2, 'اكتب عنوان العرض'),
  description: trimmed(300).optional(),
  badge_text: trimmed(20).optional(),
  image_url: z.string().trim().max(500).optional(),
  is_active: z.boolean().default(true),
});

export const openingHourSchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  opens_at: z.string().regex(/^\d{2}:\d{2}$/, 'صيغة الوقت غير صحيحة'),
  closes_at: z.string().regex(/^\d{2}:\d{2}$/, 'صيغة الوقت غير صحيحة'),
});

/* ── الشكاوى ────────────────────────────────────────────────────────────── */

export const complaintSchema = z.object({
  restaurantId: z.uuid(),
  name: trimmed(80).optional(),
  phone: optionalPhone,
  type: z.enum(['complaint', 'suggestion', 'note']),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  message: trimmed(2000).min(3, 'اكتب رسالتك'),
  /* حقل شرك: يملؤه الروبوت ويتركه الإنسان فارغاً */
  website: z.string().max(0).optional(),
});

export const complaintStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(['new', 'in_review', 'resolved', 'closed']),
});

/* ── مساعدات ────────────────────────────────────────────────────────────── */

export type FieldErrors = Record<string, string>;

/** يحوّل أخطاء Zod إلى خريطة «اسم الحقل → رسالة» تفهمها النماذج مباشرة. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/** يولّد slug من نص عربي أو إنجليزي. */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 60);
}

/**
 * يقبل عناوين الصور من مصدرين فقط: دلو التخزين في Supabase، أو مسار محلي
 * داخل المشروع (صور العرض التجريبي).
 *
 * بدون هذا الفحص يستطيع صاحب مطعم — عبر استدعاء مباشر لا عبر النموذج — أن
 * يضع عنوان صورة على أي نطاق، فيحمّل متصفح كل زبون موارد من خادم غريب
 * يسجّل عناوينهم. الرافع يضع دائماً عنواناً من Supabase، فالتقييد لا يمنع
 * أي استعمال مشروع.
 */
export function isAllowedImageUrl(value: string | null | undefined): boolean {
  if (!value) return true;                      // لا صورة = مقبول
  if (value.startsWith('/') && !value.startsWith('//')) return true;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return false;

  try {
    const candidate = new URL(value);
    const allowed = new URL(supabaseUrl);
    return (
      candidate.protocol === 'https:' &&
      candidate.hostname === allowed.hostname &&
      candidate.pathname.startsWith('/storage/v1/object/public/')
    );
  } catch {
    return false;
  }
}

/**
 * يسلسِل كائناً لإدراجه داخل وسم `<script>`.
 *
 * `JSON.stringify` وحده لا يكفي لثلاثة محارف:
 *   «<»       اسم مطعم يحتوي «</script>» ينهي الوسم مبكّراً فيصير ما بعده
 *             HTML تنفيذياً.
 *   U+2028/9  فاصلا سطر في JavaScript، يكسران السكربت وإن كانا JSON صالحاً.
 *
 * التهريب لا يغيّر القيمة: «\\u003c» تمثيل مشروع للمحرف نفسه، فيعود النص
 * كما هو عند التحليل.
 */
const UNSAFE_IN_SCRIPT = /[<\u2028\u2029]/g;

const SCRIPT_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

export function toSafeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(UNSAFE_IN_SCRIPT, (char) => SCRIPT_ESCAPES[char] ?? char);
}
