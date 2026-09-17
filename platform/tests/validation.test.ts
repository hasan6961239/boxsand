import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  slugSchema, productSchema, complaintSchema, registerSchema,
  openingHourSchema, optionGroupSchema, slugify, fieldErrors, isAllowedImageUrl, toSafeJsonLd,
} from '@/lib/validation';

describe('slugify', () => {
  it('يحوّل الاسم العربي إلى رابط صالح', () => {
    expect(slugify('مطعم الذوق')).toBe('مطعم-الذوق');
    expect(slugify('  مطعم   الذوق  ')).toBe('مطعم-الذوق');
  });

  it('يحوّل الاسم الإنجليزي إلى حروف صغيرة', () => {
    expect(slugify('Burger House')).toBe('burger-house');
  });

  it('يُزيل الرموز والشرطات الزائدة', () => {
    expect(slugify('مطعم!! -- الذوق ###')).toBe('مطعم-الذوق');
    expect(slugify('---abc---')).toBe('abc');
  });

  it('يقصّ الروابط الطويلة إلى ٦٠ محرفاً', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe('slugSchema', () => {
  it('يقبل العربية والإنجليزية والأرقام والشرطة', () => {
    expect(slugSchema.safeParse('مطعم-الذوق').success).toBe(true);
    expect(slugSchema.safeParse('burger-house-2').success).toBe(true);
  });

  it('يرفض ما يبدأ أو ينتهي بشرطة', () => {
    expect(slugSchema.safeParse('-abc').success).toBe(false);
    expect(slugSchema.safeParse('abc-').success).toBe(false);
  });

  it('يرفض المسافات والمحارف الخاصة', () => {
    expect(slugSchema.safeParse('burger house').success).toBe(false);
    expect(slugSchema.safeParse('burger/house').success).toBe(false);
    expect(slugSchema.safeParse('burger?x=1').success).toBe(false);
  });

  it('يخفض حالة الأحرف بدل رفضها', () => {
    const result = slugSchema.safeParse('BurgerHouse');
    expect(result.success && result.data).toBe('burgerhouse');
  });

  it('يرفض القصير جداً والطويل جداً', () => {
    expect(slugSchema.safeParse('ab').success).toBe(false);
    expect(slugSchema.safeParse('a'.repeat(61)).success).toBe(false);
  });
});

describe('productSchema', () => {
  const valid = {
    name: 'برجر', category_id: '11111111-1111-4111-8111-111111111111',
    base_price: 25, badges: [], is_available: true, is_visible: true,
  };

  it('يقبل صنفاً صحيحاً', () => {
    expect(productSchema.safeParse(valid).success).toBe(true);
  });

  it('يقبل السعر نصاً قادماً من نموذج HTML', () => {
    const result = productSchema.safeParse({ ...valid, base_price: '25.50' });
    expect(result.success && result.data.base_price).toBe(25.5);
  });

  it('يرفض السعر السالب وغير الرقمي', () => {
    expect(productSchema.safeParse({ ...valid, base_price: -1 }).success).toBe(false);
    expect(productSchema.safeParse({ ...valid, base_price: 'مجاني' }).success).toBe(false);
  });

  it('يرفض سعر الخصم الأقل من السعر الحالي — وهو خطأ شائع', () => {
    const result = productSchema.safeParse({ ...valid, compare_at_price: 20 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error).compare_at_price).toContain('أعلى');
    }
  });

  it('يقبل ترك سعر الخصم فارغاً', () => {
    expect(productSchema.safeParse({ ...valid, compare_at_price: '' }).success).toBe(true);
  });

  it('يرفض أكثر من شارتين', () => {
    expect(productSchema.safeParse({ ...valid, badges: ['new', 'popular', 'spicy'] }).success).toBe(false);
  });

  it('يرفض شارة غير معروفة', () => {
    expect(productSchema.safeParse({ ...valid, badges: ['halal'] }).success).toBe(false);
  });

  it('يرفض معرّف قسم ليس UUID', () => {
    expect(productSchema.safeParse({ ...valid, category_id: 'abc' }).success).toBe(false);
  });
});

describe('complaintSchema', () => {
  const valid = {
    restaurantId: '11111111-1111-4111-8111-111111111111',
    type: 'complaint',
    message: 'الطلب تأخر كثيراً',
  };

  it('يقبل رسالة بلا اسم ولا هاتف', () => {
    expect(complaintSchema.safeParse(valid).success).toBe(true);
  });

  it('يرفض الرسالة الفارغة أو القصيرة جداً', () => {
    expect(complaintSchema.safeParse({ ...valid, message: '' }).success).toBe(false);
    expect(complaintSchema.safeParse({ ...valid, message: 'ok' }).success).toBe(false);
  });

  it('يرفض الرسالة الأطول من ألفي محرف', () => {
    expect(complaintSchema.safeParse({ ...valid, message: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('يقبل التقييم بين ١ و٥ ويرفض ما عداه', () => {
    expect(complaintSchema.safeParse({ ...valid, rating: 5 }).success).toBe(true);
    expect(complaintSchema.safeParse({ ...valid, rating: 0 }).success).toBe(false);
    expect(complaintSchema.safeParse({ ...valid, rating: 6 }).success).toBe(false);
  });

  it('يرفض حقل الشرك حين يُملأ — علامة روبوت', () => {
    expect(complaintSchema.safeParse({ ...valid, website: 'http://spam' }).success).toBe(false);
  });

  it('يرفض نوعاً غير معروف', () => {
    expect(complaintSchema.safeParse({ ...valid, type: 'order' }).success).toBe(false);
  });
});

describe('registerSchema', () => {
  const valid = {
    fullName: 'محمد علي', email: 'a@b.co', phone: '0912345678',
    password: 'kalimat-sirr-1', restaurantName: 'مطعم الذوق',
  };

  it('يقبل بيانات صحيحة ويخفض حالة البريد', () => {
    const result = registerSchema.safeParse({ ...valid, email: 'A@B.CO' });
    expect(result.success && result.data.email).toBe('a@b.co');
  });

  it('يرفض كلمة مرور أقصر من ٨ محارف', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'قصيرة' }).success).toBe(false);
  });

  it('يرفض بريداً غير صالح', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  it('يرفض رقم هاتف غير صالح', () => {
    expect(registerSchema.safeParse({ ...valid, phone: '12' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, phone: 'اتصل بي' }).success).toBe(false);
  });
});

describe('openingHourSchema', () => {
  it('يقبل صيغة الوقت HH:MM فقط', () => {
    expect(openingHourSchema.safeParse({ weekday: 0, opens_at: '11:00', closes_at: '23:00' }).success).toBe(true);
    expect(openingHourSchema.safeParse({ weekday: 0, opens_at: '11:0', closes_at: '23:00' }).success).toBe(false);
  });

  it('يرفض يوماً خارج ٠–٦', () => {
    expect(openingHourSchema.safeParse({ weekday: 7, opens_at: '11:00', closes_at: '23:00' }).success).toBe(false);
  });
});

describe('optionGroupSchema', () => {
  it('يرفض حداً أدنى أكبر من الأقصى', () => {
    expect(optionGroupSchema.safeParse({ name: 'إضافات', min_select: 3, max_select: 1 }).success).toBe(false);
  });

  it('يقبل تساوي الحدّين', () => {
    expect(optionGroupSchema.safeParse({ name: 'إضافات', min_select: 1, max_select: 1 }).success).toBe(true);
  });
});

describe('isAllowedImageUrl', () => {
  const original = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co';
  });
  afterAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = original;
  });

  it('يقبل غياب الصورة', () => {
    expect(isAllowedImageUrl(null)).toBe(true);
    expect(isAllowedImageUrl('')).toBe(true);
  });

  it('يقبل المسار المحلي', () => {
    expect(isAllowedImageUrl('/demo/burger.svg')).toBe(true);
  });

  it('يقبل دلو التخزين في المشروع نفسه', () => {
    expect(isAllowedImageUrl('https://abcdefgh.supabase.co/storage/v1/object/public/restaurant-media/x/y.webp')).toBe(true);
  });

  it('يرفض أي نطاق خارجي', () => {
    expect(isAllowedImageUrl('https://evil.example/pixel.png')).toBe(false);
    expect(isAllowedImageUrl('https://other.supabase.co/storage/v1/object/public/a.webp')).toBe(false);
  });

  it('يرفض مسارات Supabase غير العامة', () => {
    expect(isAllowedImageUrl('https://abcdefgh.supabase.co/rest/v1/profiles')).toBe(false);
  });

  it('يرفض البروتوكولات الخطرة والروابط المشوَّهة', () => {
    expect(isAllowedImageUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedImageUrl('//evil.example/x.png')).toBe(false);
    expect(isAllowedImageUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false);
  });
});

describe('toSafeJsonLd', () => {
  it('ينتج JSON صالحاً للحالة العادية', () => {
    const output = toSafeJsonLd({ name: 'مطعم الذوق', price: 25 });
    expect(JSON.parse(output)).toEqual({ name: 'مطعم الذوق', price: 25 });
  });

  it('يهرّب «<» فلا يُغلق وسم script مبكّراً', () => {
    const output = toSafeJsonLd({ name: '</script><img src=x onerror=alert(1)>' });
    expect(output).not.toContain('</script>');
    expect(output).not.toContain('<img');
    expect(output).toContain('\\u003c');
  });

  it('يبقى الناتج بعد التهريب مطابقاً للأصل عند التحليل', () => {
    const evil = '</script><script>alert(1)</script>';
    expect(JSON.parse(toSafeJsonLd({ name: evil })).name).toBe(evil);
  });

  it('يهرّب فواصل الأسطر التي تكسر JavaScript', () => {
    const output = toSafeJsonLd({ name: 'a b c' });
    expect(output).toContain('\\u2028');
    expect(output).toContain('\\u2029');
  });

  it('يتعامل مع بنية المنيو المتشعّبة', () => {
    const menu = {
      '@type': 'Restaurant',
      name: 'مطعم <b>الذوق</b>',
      hasMenu: { hasMenuSection: [{ name: 'البرجر', hasMenuItem: [{ name: '</script>' }] }] },
    };
    const output = toSafeJsonLd(menu);
    expect(output).not.toContain('</script>');
    expect(output).not.toContain('<b>');
    expect(JSON.parse(output)).toEqual(menu);
  });
});
