/**
 * ثوابت المنصة.
 *
 * اسم المنصة هنا هو القيمة الاحتياطية فقط: الاسم الفعلي يُقرأ من جدول
 * platform_settings ويُعدَّل من لوحة الأدمن بلا إعادة نشر.
 */
export const PLATFORM = {
  name: 'سُفرة',
  nameLatin: 'Sufra',
  tagline: 'منيو مطعمك الرقمي، في دقائق',
  description:
    'أنشئ منيو مطعمك الإلكتروني، شاركه عبر QR Code، وأدر أصنافك وأسعارك بنفسك من لوحة تحكم بسيطة.',
} as const;

const LOCAL_FALLBACK = 'http://localhost:3000';

/**
 * عنوان الموقع — يدخل في روابط QR ووسوم المشاركة وخريطة الموقع.
 *
 * ترتيب المصادر مقصود:
 *  ١) NEXT_PUBLIC_SITE_URL — المصدر الصحيح، ويُدمَج في حزمة المتصفح أيضاً.
 *  ٢) عنوان الصفحة في المتصفح — يصحّح روابط اللوحة تلقائياً لو نُسي المتغيّر.
 *  ٣) URL من Netlify — متاح على الخادم وقت البناء فقط (لا يُدمَج في الحزمة
 *     لأن اسمه لا يبدأ بـ NEXT_PUBLIC_).
 *  ٤) localhost — للتطوير وحده.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, '');

  if (typeof window !== 'undefined') return window.location.origin;

  return (process.env.URL || LOCAL_FALLBACK).replace(/\/+$/, '');
}

/**
 * هل عنوان الموقع مضبوط فعلاً؟
 *
 * يُستعمل لمنع كارثة صامتة: رمز QR يُولَّد بعنوان localhost ثم يُطبع ويُلصق
 * على الطاولات. الملصق لا يُصلَح بعد ذلك، فالتحذير قبل الطباعة أرخص بكثير.
 */
export function isSiteUrlConfigured(): boolean {
  const url = siteUrl();
  return !url.includes('localhost') && !url.includes('127.0.0.1');
}

export const CURRENCIES: Record<string, { code: string; label: string; symbol: string }> = {
  LYD: { code: 'LYD', label: 'دينار ليبي', symbol: 'د.ل' },
  USD: { code: 'USD', label: 'دولار أمريكي', symbol: '$' },
  EUR: { code: 'EUR', label: 'يورو', symbol: '€' },
  SAR: { code: 'SAR', label: 'ريال سعودي', symbol: 'ر.س' },
  AED: { code: 'AED', label: 'درهم إماراتي', symbol: 'د.إ' },
  EGP: { code: 'EGP', label: 'جنيه مصري', symbol: 'ج.م' },
  TND: { code: 'TND', label: 'دينار تونسي', symbol: 'د.ت' },
  TRY: { code: 'TRY', label: 'ليرة تركية', symbol: '₺' },
};

export const WEEKDAYS = [
  'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت',
] as const;

export const BADGE_LABELS: Record<string, { label: string; className: string }> = {
  new: { label: 'جديد', className: 'bg-info-soft text-info' },
  popular: { label: 'الأكثر طلباً', className: 'bg-accent-soft text-accent' },
  offer: { label: 'عرض', className: 'bg-danger-soft text-danger' },
  spicy: { label: 'حار', className: 'bg-danger-soft text-danger' },
  vegetarian: { label: 'نباتي', className: 'bg-success-soft text-success' },
};

export const COMPLAINT_TYPES: Record<string, string> = {
  complaint: 'شكوى',
  suggestion: 'اقتراح',
  note: 'ملاحظة',
};

export const COMPLAINT_STATUSES: Record<string, { label: string; className: string }> = {
  new: { label: 'جديدة', className: 'bg-info-soft text-info' },
  in_review: { label: 'قيد المراجعة', className: 'bg-warning-soft text-warning' },
  resolved: { label: 'تم الحل', className: 'bg-success-soft text-success' },
  closed: { label: 'مغلقة', className: 'bg-surface-3 text-muted' },
};

export const RESTAURANT_STATUSES: Record<string, { label: string; className: string }> = {
  trial: { label: 'تجريبي', className: 'bg-info-soft text-info' },
  active: { label: 'نشط', className: 'bg-success-soft text-success' },
  suspended: { label: 'موقوف', className: 'bg-warning-soft text-warning' },
  disabled: { label: 'معطّل', className: 'bg-danger-soft text-danger' },
};

/** حدود رفع الصور — مطابقة لحد الدلو في قاعدة البيانات. */
export const UPLOAD = {
  maxBytes: 5 * 1024 * 1024,        // قبل الضغط
  maxStoredBytes: 2 * 1024 * 1024,  // بعد الضغط، وهو حد الدلو نفسه
  accept: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
  maxDimension: 1600,
} as const;
