'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X, UtensilsCrossed, Check } from 'lucide-react';
import { formatPrice, discountPercent } from '@/lib/money';
import { BADGE_LABELS } from '@/lib/config';
import { cn } from '@/lib/cn';
import type { PublicProduct } from '@/types/database';

interface Props {
  product: PublicProduct | null;
  currency: string;
  showPrices: boolean;
  onClose: () => void;
}

/**
 * ورقة تفاصيل الصنف.
 *
 * تنزلق من الأسفل على الهاتف لأن الإبهام هناك، وتظهر في الوسط على الشاشات
 * الكبيرة. الاختيارات هنا للعرض وحساب السعر فقط — لا سلّة ولا طلب بعد، لكن
 * البنية جاهزة لإضافتهما دون إعادة كتابة.
 */
export function ProductSheet({ product, currency, showPrices, onClose }: Props) {
  const reduce = useReducedMotion();
  const [variantId, setVariantId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  // إعادة الضبط عند فتح صنف مختلف، وإلا تسرّبت اختيارات الصنف السابق
  useEffect(() => {
    if (!product) return;
    const firstAvailable = product.variants.find((variant) => variant.is_available);
    setVariantId(firstAvailable?.id ?? product.variants[0]?.id ?? null);
    setSelected({});
  }, [product]);

  useEffect(() => {
    if (!product) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [product, onClose]);

  const total = useMemo(() => {
    if (!product) return 0;
    const variant = product.variants.find((item) => item.id === variantId);
    let sum = variant ? variant.price : product.price;

    for (const group of product.option_groups) {
      for (const optionId of selected[group.id] ?? []) {
        const option = group.options.find((item) => item.id === optionId);
        if (option) sum += Number(option.price_delta);
      }
    }
    return sum;
  }, [product, variantId, selected]);

  function toggleOption(groupId: string, optionId: string, max: number) {
    setSelected((current) => {
      const list = current[groupId] ?? [];
      if (list.includes(optionId)) {
        return { ...current, [groupId]: list.filter((id) => id !== optionId) };
      }
      // اختيار واحد: يستبدل. متعدد: يضيف حتى الحد ثم يتجاهل.
      if (max === 1) return { ...current, [groupId]: [optionId] };
      if (list.length >= max) return current;
      return { ...current, [groupId]: [...list, optionId] };
    });
  }

  const discount = product ? discountPercent(product.price, product.compare_at_price) : null;

  return (
    <AnimatePresence>
      {product && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={product.name}
        >
          <motion.div
            className="absolute inset-0 bg-black/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          <motion.div
            className="relative flex max-h-[92vh] w-full flex-col overflow-hidden sm:max-h-[88vh] sm:max-w-md"
            style={{
              backgroundColor: 'var(--r-card)',
              borderTopLeftRadius: 'calc(var(--r-radius) * 1.4)',
              borderTopRightRadius: 'calc(var(--r-radius) * 1.4)',
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
            }}
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
          >
            <div className="relative shrink-0">
              <div
                className="relative aspect-[16/10] w-full"
                style={{ backgroundColor: 'rgb(var(--r-text-rgb) / 0.06)' }}
              >
                {product.image_url ? (
                  <Image
                    src={product.image_url}
                    alt={product.name}
                    fill
                    sizes="(max-width: 640px) 100vw, 448px"
                    className="object-cover"
                    unoptimized={product.image_url.startsWith('/')}
                  />
                ) : (
                  <span
                    className="grid h-full place-items-center"
                    style={{ color: 'rgb(var(--r-text-rgb) / 0.2)' }}
                    aria-hidden
                  >
                    <UtensilsCrossed className="size-12" />
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="إغلاق"
                data-autofocus
                className="absolute end-3 top-3 grid size-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
              >
                <X className="size-4.5" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
              <div className="flex flex-wrap items-center gap-1.5">
                {product.badges.map((badge) => (
                  <span
                    key={badge}
                    className="rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold"
                    style={{
                      color: 'var(--r-primary)',
                      backgroundColor: 'rgb(var(--r-primary-rgb) / 0.12)',
                    }}
                  >
                    {BADGE_LABELS[badge]?.label ?? badge}
                  </span>
                ))}
              </div>

              <h2 className="mt-2 text-xl font-extrabold" style={{ color: 'var(--r-text)' }}>
                {product.name}
              </h2>

              {product.description && (
                <p className="mt-2 text-sm leading-relaxed" style={{ color: 'rgb(var(--r-text-rgb) / 0.68)' }}>
                  {product.description}
                </p>
              )}

              {showPrices && product.compare_at_price && (
                <p className="mt-3 flex items-center gap-2">
                  <span className="nums text-sm line-through" style={{ color: 'rgb(var(--r-text-rgb) / 0.42)' }}>
                    {formatPrice(product.compare_at_price, currency)}
                  </span>
                  {discount !== null && (
                    <span className="rounded-full bg-[#C4544A] px-2 py-0.5 text-xs font-bold text-white">
                      خصم <span className="ltr-nums">{discount}%</span>
                    </span>
                  )}
                </p>
              )}

              {!product.is_available && (
                <p
                  className="mt-3 rounded-xl px-3.5 py-2.5 text-sm font-medium"
                  style={{ backgroundColor: 'rgb(196 84 74 / 0.12)', color: '#C4544A' }}
                >
                  هذا الصنف غير متوفر حالياً.
                </p>
              )}

              {product.variants.length > 0 && (
                <fieldset className="mt-5">
                  <legend className="text-sm font-bold" style={{ color: 'var(--r-text)' }}>
                    الحجم
                  </legend>
                  <div className="mt-2 space-y-1.5">
                    {product.variants.map((variant) => (
                      <label
                        key={variant.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 border p-3 transition-colors',
                          !variant.is_available && 'cursor-not-allowed opacity-50',
                        )}
                        style={{
                          borderRadius: 'calc(var(--r-radius) * 0.65)',
                          borderColor:
                            variantId === variant.id ? 'var(--r-primary)' : 'rgb(var(--r-text-rgb) / 0.12)',
                          backgroundColor:
                            variantId === variant.id ? 'rgb(var(--r-primary-rgb) / 0.07)' : 'transparent',
                        }}
                      >
                        <input
                          type="radio"
                          name="variant"
                          value={variant.id}
                          checked={variantId === variant.id}
                          disabled={!variant.is_available}
                          onChange={() => setVariantId(variant.id)}
                          className="sr-only"
                        />
                        <span
                          className="grid size-5 shrink-0 place-items-center rounded-full border-2"
                          style={{
                            borderColor:
                              variantId === variant.id ? 'var(--r-primary)' : 'rgb(var(--r-text-rgb) / 0.25)',
                          }}
                          aria-hidden
                        >
                          {variantId === variant.id && (
                            <span className="size-2.5 rounded-full" style={{ backgroundColor: 'var(--r-primary)' }} />
                          )}
                        </span>
                        <span className="flex-1 text-sm" style={{ color: 'var(--r-text)' }}>
                          {variant.name}
                          {!variant.is_available && (
                            <span className="ms-2 text-xs" style={{ color: '#C4544A' }}>غير متوفر</span>
                          )}
                        </span>
                        {showPrices && (
                          <span className="nums text-sm font-bold" style={{ color: 'var(--r-primary)' }}>
                            {formatPrice(variant.price, currency)}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              {product.option_groups.map((group) => (
                <fieldset key={group.id} className="mt-5">
                  <legend className="text-sm font-bold" style={{ color: 'var(--r-text)' }}>
                    {group.name}
                    <span className="ms-2 text-xs font-normal" style={{ color: 'rgb(var(--r-text-rgb) / 0.5)' }}>
                      {group.max_select === 1
                        ? 'اختر واحداً'
                        : `اختر حتى ${group.max_select}`}
                    </span>
                  </legend>

                  <div className="mt-2 space-y-1.5">
                    {group.options.map((option) => {
                      const checked = (selected[group.id] ?? []).includes(option.id);
                      return (
                        <label
                          key={option.id}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 border p-3 transition-colors',
                            !option.is_available && 'cursor-not-allowed opacity-50',
                          )}
                          style={{
                            borderRadius: 'calc(var(--r-radius) * 0.65)',
                            borderColor: checked ? 'var(--r-primary)' : 'rgb(var(--r-text-rgb) / 0.12)',
                            backgroundColor: checked ? 'rgb(var(--r-primary-rgb) / 0.07)' : 'transparent',
                          }}
                        >
                          <input
                            type={group.max_select === 1 ? 'radio' : 'checkbox'}
                            name={`group-${group.id}`}
                            checked={checked}
                            disabled={!option.is_available}
                            onChange={() => toggleOption(group.id, option.id, group.max_select)}
                            className="sr-only"
                          />
                          <span
                            className={cn(
                              'grid size-5 shrink-0 place-items-center border-2',
                              group.max_select === 1 ? 'rounded-full' : 'rounded-md',
                            )}
                            style={{
                              borderColor: checked ? 'var(--r-primary)' : 'rgb(var(--r-text-rgb) / 0.25)',
                              backgroundColor: checked && group.max_select > 1 ? 'var(--r-primary)' : 'transparent',
                            }}
                            aria-hidden
                          >
                            {checked && group.max_select === 1 && (
                              <span className="size-2.5 rounded-full" style={{ backgroundColor: 'var(--r-primary)' }} />
                            )}
                            {checked && group.max_select > 1 && (
                              <Check className="size-3.5" style={{ color: 'var(--r-primary-fg)' }} />
                            )}
                          </span>
                          <span className="flex-1 text-sm" style={{ color: 'var(--r-text)' }}>
                            {option.name}
                          </span>
                          {showPrices && Number(option.price_delta) !== 0 && (
                            <span className="nums text-sm" style={{ color: 'rgb(var(--r-text-rgb) / 0.6)' }}>
                              {Number(option.price_delta) > 0 ? '+' : ''}
                              {formatPrice(option.price_delta, currency)}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>

            {showPrices && (
              <div
                className="shrink-0 border-t px-5 pt-4"
                style={{
                  borderColor: 'rgb(var(--r-text-rgb) / 0.1)',
                  paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
                }}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm" style={{ color: 'rgb(var(--r-text-rgb) / 0.6)' }}>
                    السعر
                  </span>
                  <span className="nums text-xl font-extrabold" style={{ color: 'var(--r-primary)' }}>
                    {formatPrice(total, currency)}
                  </span>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
