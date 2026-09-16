import { CURRENCIES } from './config';

/**
 * ينسّق السعر بأرقام لاتينية ويُخفي الكسور الصفرية.
 *   25    → «٢٥ د.ل» تُعرض 25 د.ل
 *   25.5  → 25.50 د.ل
 */
export function formatPrice(value: number | string | null | undefined, currency = 'LYD'): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return '—';

  const symbol = CURRENCIES[currency]?.symbol ?? currency;
  const hasFraction = Math.round(amount * 100) % 100 !== 0;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);

  return `${formatted} ${symbol}`;
}

/** نسبة الخصم بين السعر القديم والحالي، أو null إن لم يوجد خصم حقيقي. */
export function discountPercent(price: number, compareAt: number | null | undefined): number | null {
  if (!compareAt || compareAt <= price) return null;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

/** أقل سعر بين الأحجام، لعرض «يبدأ من». */
export function priceRange(
  basePrice: number,
  variants: { price: number }[],
): { from: number; to: number | null } {
  if (variants.length === 0) return { from: basePrice, to: null };
  const prices = variants.map((v) => v.price);
  const from = Math.min(...prices);
  const to = Math.max(...prices);
  return { from, to: to > from ? to : null };
}
