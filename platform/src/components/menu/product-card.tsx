'use client';

import Image from 'next/image';
import { motion, useReducedMotion } from 'motion/react';
import { UtensilsCrossed } from 'lucide-react';
import { formatPrice, discountPercent, priceRange } from '@/lib/money';
import { BADGE_LABELS } from '@/lib/config';
import { cn } from '@/lib/cn';
import type { PublicProduct } from '@/types/database';

interface Props {
  product: PublicProduct;
  currency: string;
  showPrices: boolean;
  index: number;
  onOpen: (product: PublicProduct) => void;
}

/** ألوان الشارات على المنيو تتبع لون المطعم لا ألوان المنصة. */
const BADGE_TONE: Record<string, string> = {
  new: 'var(--r-primary)',
  popular: 'var(--r-secondary)',
  offer: '#C4544A',
  spicy: '#C4544A',
  vegetarian: '#2F9E5E',
};

export function ProductCard({ product, currency, showPrices, index, onOpen }: Props) {
  const reduce = useReducedMotion();
  const range = priceRange(product.price, product.variants);
  const discount = discountPercent(product.price, product.compare_at_price);
  const unavailable = !product.is_available;

  return (
    <motion.li
      initial={reduce ? undefined : { opacity: 0, y: 14 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{
        duration: 0.38,
        // تأخير متدرّج داخل القسم الواحد فقط، ومحدود بـ 5 عناصر حتى لا
        // ينتظر الزبون ظهور الصنف العشرين
        delay: reduce ? 0 : Math.min(index, 5) * 0.05,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(product)}
        className={cn(
          'no-tap-flash flex w-full items-stretch gap-3 p-2.5 text-start transition-transform duration-200',
          'active:scale-[0.985]',
          unavailable && 'opacity-55',
        )}
        style={{
          backgroundColor: 'var(--r-card)',
          borderRadius: 'var(--r-radius)',
          boxShadow: '0 1px 2px rgb(var(--r-text-rgb) / 0.05), 0 4px 12px rgb(var(--r-text-rgb) / 0.04)',
        }}
      >
        <div className="min-w-0 flex-1 py-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-bold sm:text-[0.9375rem]" style={{ color: 'var(--r-text)' }}>
              {product.name}
            </h3>
            {product.badges.map((badge) => (
              <span
                key={badge}
                className="rounded-full px-1.5 py-px text-[0.625rem] font-semibold"
                style={{
                  color: BADGE_TONE[badge] ?? 'var(--r-primary)',
                  backgroundColor: `color-mix(in srgb, ${BADGE_TONE[badge] ?? 'var(--r-primary)'} 14%, transparent)`,
                }}
              >
                {BADGE_LABELS[badge]?.label ?? badge}
              </span>
            ))}
          </div>

          {product.description && (
            <p
              className="mt-1 line-clamp-2 text-xs leading-relaxed"
              style={{ color: 'rgb(var(--r-text-rgb) / 0.58)' }}
            >
              {product.description}
            </p>
          )}

          {showPrices && (
            <p className="mt-2 flex flex-wrap items-baseline gap-2">
              <span className="nums text-sm font-bold" style={{ color: 'var(--r-primary)' }}>
                {range.to ? `من ${formatPrice(range.from, currency)}` : formatPrice(product.price, currency)}
              </span>
              {product.compare_at_price && (
                <span
                  className="nums text-xs line-through"
                  style={{ color: 'rgb(var(--r-text-rgb) / 0.42)' }}
                >
                  {formatPrice(product.compare_at_price, currency)}
                </span>
              )}
              {discount !== null && (
                <span className="ltr-nums rounded-full bg-[#C4544A] px-1.5 py-px text-[0.625rem] font-bold text-white">
                  −{discount}%
                </span>
              )}
            </p>
          )}

          {unavailable && (
            <p className="mt-1.5 text-xs font-medium" style={{ color: '#C4544A' }}>
              غير متوفر حالياً
            </p>
          )}
        </div>

        <div
          className="relative size-[5.25rem] shrink-0 overflow-hidden sm:size-24"
          style={{
            borderRadius: 'calc(var(--r-radius) * 0.72)',
            backgroundColor: 'rgb(var(--r-text-rgb) / 0.05)',
          }}
        >
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt=""
              fill
              sizes="(max-width: 640px) 96px, 112px"
              loading="lazy"
              className="object-cover"
              unoptimized={product.image_url.startsWith('/')}
            />
          ) : (
            <span
              className="grid h-full place-items-center"
              style={{ color: 'rgb(var(--r-text-rgb) / 0.22)' }}
              aria-hidden
            >
              <UtensilsCrossed className="size-6" />
            </span>
          )}
        </div>
      </button>
    </motion.li>
  );
}
