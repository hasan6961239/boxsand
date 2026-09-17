import { describe, expect, it } from 'vitest';
import { formatPrice, discountPercent, priceRange } from '@/lib/money';

describe('formatPrice', () => {
  it('يُخفي الكسور الصفرية', () => {
    expect(formatPrice(25)).toBe('25 د.ل');
    expect(formatPrice(25.0)).toBe('25 د.ل');
  });

  it('يُظهر الكسور حين توجد', () => {
    expect(formatPrice(25.5)).toBe('25.50 د.ل');
    expect(formatPrice(0.75)).toBe('0.75 د.ل');
  });

  it('يستخدم أرقاماً لاتينية لا عربية-هندية', () => {
    expect(formatPrice(1234)).toBe('1,234 د.ل');
  });

  it('يقبل السعر نصاً — وهو ما تُرجعه numeric من PostgreSQL', () => {
    expect(formatPrice('18.00')).toBe('18 د.ل');
  });

  it('يبدّل رمز العملة', () => {
    expect(formatPrice(10, 'USD')).toBe('10 $');
    expect(formatPrice(10, 'SAR')).toBe('10 ر.س');
  });

  it('يعرض شرطة بدل NaN عند القيم الغائبة أو الفاسدة', () => {
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(undefined)).toBe('—');
    expect(formatPrice('abc')).toBe('—');
  });

  it('يعرض العملة غير المعروفة برمزها كما هو بدل أن ينهار', () => {
    expect(formatPrice(5, 'XYZ')).toBe('5 XYZ');
  });
});

describe('discountPercent', () => {
  it('يحسب نسبة الخصم مقرَّبة', () => {
    expect(discountPercent(28, 34)).toBe(18);
    expect(discountPercent(25, 50)).toBe(50);
  });

  it('يُرجع null حين لا يوجد خصم حقيقي', () => {
    expect(discountPercent(30, null)).toBeNull();
    expect(discountPercent(30, undefined)).toBeNull();
    expect(discountPercent(30, 30)).toBeNull();
    expect(discountPercent(30, 20)).toBeNull();
  });
});

describe('priceRange', () => {
  it('بلا أحجام يُرجع السعر الأساسي بلا مدى', () => {
    expect(priceRange(25, [])).toEqual({ from: 25, to: null });
  });

  it('يُرجع أقل وأكثر سعر بين الأحجام', () => {
    expect(priceRange(26, [{ price: 26 }, { price: 38 }, { price: 52 }])).toEqual({ from: 26, to: 52 });
  });

  it('حجم واحد ليس مدى', () => {
    expect(priceRange(26, [{ price: 30 }])).toEqual({ from: 30, to: null });
  });
});
