'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { Search, X, Moon, Sun, MessageSquareHeart, MapPin, Clock, SearchX } from 'lucide-react';
import { MenuHero } from './menu-hero';
import { ProductCard } from './product-card';
import { ProductSheet } from './product-sheet';
import { ComplaintDialog } from './complaint-dialog';
import { buildThemeVars, mergeTheme, themeIsDark } from '@/lib/theme';
import { groupByWeekday, getOpenState } from '@/lib/hours';
import { WEEKDAYS } from '@/lib/config';
import { cn } from '@/lib/cn';
import type { PublicMenu, PublicProduct } from '@/types/database';

type Filter = 'all' | 'offer' | 'popular' | 'new' | 'vegetarian';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'الكل' },
  { id: 'offer', label: 'عروض' },
  { id: 'popular', label: 'الأكثر طلباً' },
  { id: 'new', label: 'جديد' },
  { id: 'vegetarian', label: 'نباتي' },
];

export function MenuView({ menu, platformName }: { menu: PublicMenu; platformName: string }) {
  const { restaurant, categories, offers, hours } = menu;
  const theme = useMemo(() => mergeTheme(menu.theme), [menu.theme]);

  const [dark, setDark] = useState(() => themeIsDark(theme));
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [active, setActive] = useState(categories[0]?.id ?? '');
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  // تجاهل مراقب التمرير أثناء الانتقال البرمجي إلى قسم، وإلا تسابق الاثنان
  const jumping = useRef(false);

  const storageKey = `sufra-menu-dark:${restaurant.id}`;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) setDark(stored === '1');
    } catch {
      // التخزين محجوب في التصفح الخاص — نبقى على تفضيل المطعم
    }
  }, [storageKey]);

  function toggleDark() {
    setDark((current) => {
      const next = !current;
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* تجاهل */
      }
      return next;
    });
  }

  /* تسجيل مشاهدة واحدة لكل فتح للصفحة. */
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId: restaurant.id }),
      signal: controller.signal,
      keepalive: true,
    }).catch(() => {
      // فشل التتبّع لا يعني شيئاً للزبون
    });
    return () => controller.abort();
  }, [restaurant.id]);

  /* البحث مؤجَّل: الكتابة السريعة لا تعيد ترشيح المنيو عند كل حرف. */
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim().toLowerCase()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 120);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const searching = debounced.length > 0 || filter !== 'all';

  const visible = useMemo(() => {
    return categories
      .map((category) => ({
        ...category,
        products: category.products.filter((product) => {
          if (filter === 'offer' && !product.compare_at_price && !product.badges.includes('offer')) return false;
          if (filter === 'popular' && !product.badges.includes('popular')) return false;
          if (filter === 'new' && !product.badges.includes('new')) return false;
          if (filter === 'vegetarian' && !product.badges.includes('vegetarian')) return false;
          if (!debounced) return true;
          return (
            product.name.toLowerCase().includes(debounced) ||
            (product.description ?? '').toLowerCase().includes(debounced)
          );
        }),
      }))
      .filter((category) => category.products.length > 0);
  }, [categories, debounced, filter]);

  const resultCount = visible.reduce((sum, category) => sum + category.products.length, 0);

  /* تتبّع القسم الظاهر لتمييزه في شريط الأقسام. */
  useEffect(() => {
    if (searching) return;
    const sections = categories
      .map((category) => document.getElementById(`cat-${category.id}`))
      .filter((element): element is HTMLElement => element !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (jumping.current) return;
        const top = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id.replace('cat-', ''));
      },
      { rootMargin: '-140px 0px -65% 0px', threshold: 0 },
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [categories, searching]);

  /* إبقاء القسم النشط مرئياً داخل الشريط الأفقي. */
  useEffect(() => {
    const chip = navRef.current?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    chip?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [active]);

  const jumpTo = useCallback((categoryId: string) => {
    setActive(categoryId);
    jumping.current = true;
    document.getElementById(`cat-${categoryId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      jumping.current = false;
    }, 700);
  }, []);

  const openState = getOpenState(hours, restaurant.timezone);
  const vars = buildThemeVars(theme, dark) as React.CSSProperties;

  return (
    <div
      dir="rtl"
      style={{
        ...vars,
        backgroundColor: 'var(--r-bg)',
        color: 'var(--r-text)',
        scrollPaddingTop: '8.5rem',
        minHeight: '100dvh',
      }}
    >
      {/* شريط علوي يظهر بعد التمرير فقط، حتى لا يزاحم الغلاف في البداية */}
      <AnimatePresence>
        {scrolled && (
          <motion.div
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="fixed inset-x-0 top-0 z-30 backdrop-blur-xl"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--r-card) 88%, transparent)',
              borderBottom: '1px solid rgb(var(--r-text-rgb) / 0.08)',
            }}
          >
            <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4">
              {restaurant.logo_url && (
                <span className="relative size-8 shrink-0 overflow-hidden rounded-lg">
                  <Image
                    src={restaurant.logo_url}
                    alt=""
                    fill
                    sizes="32px"
                    className="object-contain"
                    unoptimized={restaurant.logo_url.startsWith('/')}
                  />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{restaurant.name}</span>
              <IconAction label="بحث" onClick={() => { setSearchOpen(true); window.setTimeout(() => searchRef.current?.focus(), 80); }}>
                <Search className="size-4.5" aria-hidden />
              </IconAction>
              <IconAction label={dark ? 'الوضع الفاتح' : 'الوضع الليلي'} onClick={toggleDark}>
                {dark ? <Sun className="size-4.5" aria-hidden /> : <Moon className="size-4.5" aria-hidden />}
              </IconAction>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* مبدّل الوضع في الأعلى قبل التمرير */}
      <div className="absolute end-4 top-4 z-20">
        <button
          type="button"
          onClick={toggleDark}
          aria-label={dark ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الليلي'}
          className="grid size-10 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/50"
        >
          {dark ? <Sun className="size-4.5" aria-hidden /> : <Moon className="size-4.5" aria-hidden />}
        </button>
      </div>

      {/*
        البطاقات تبدأ شفافة ويكشفها JavaScript عند التمرير. لو تعطّل — حاجب
        إعلانات، شبكة قطعت السكربت، متصفح قديم — لبقي المنيو فارغاً بصرياً
        رغم أن محتواه في HTML. هذا السطر يُظهرها فوراً في تلك الحالة.
      */}
      <noscript>
        <style>{'[data-reveal]{opacity:1!important;transform:none!important}'}</style>
      </noscript>

      <main id="main">
        <MenuHero restaurant={restaurant} hours={hours} onShowHours={() => setHoursOpen(true)} />

        {offers.length > 0 && !searching && (
          <section className="mx-auto mt-6 max-w-3xl" aria-label="العروض">
            <h2 className="px-4 text-base font-bold">العروض</h2>
            <div className="scroll-x mt-3 flex gap-3 px-4 pb-2">
              {offers.map((offer) => (
                <article
                  key={offer.id}
                  className="w-64 shrink-0 overflow-hidden"
                  style={{
                    backgroundColor: 'var(--r-card)',
                    borderRadius: 'var(--r-radius)',
                    boxShadow: '0 2px 10px rgb(var(--r-text-rgb) / 0.06)',
                  }}
                >
                  <div className="relative aspect-[16/8]" style={{ backgroundColor: 'rgb(var(--r-text-rgb) / 0.06)' }}>
                    {offer.image_url && (
                      <Image
                        src={offer.image_url}
                        alt=""
                        fill
                        sizes="256px"
                        loading="lazy"
                        className="object-cover"
                        unoptimized={offer.image_url.startsWith('/')}
                      />
                    )}
                    {offer.badge_text && (
                      <span className="absolute end-2 top-2 rounded-full bg-[#C4544A] px-2 py-0.5 text-[0.6875rem] font-bold text-white">
                        {offer.badge_text}
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <h3 className="text-sm font-bold">{offer.title}</h3>
                    {offer.description && (
                      <p
                        className="mt-1 line-clamp-2 text-xs leading-relaxed"
                        style={{ color: 'rgb(var(--r-text-rgb) / 0.6)' }}
                      >
                        {offer.description}
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* شريط الأقسام والبحث — لاصق تحت الشريط العلوي */}
        <div
          className="sticky top-0 z-20 mt-6 backdrop-blur-xl"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--r-bg) 90%, transparent)',
            paddingTop: scrolled ? '3.5rem' : undefined,
            borderBottom: '1px solid rgb(var(--r-text-rgb) / 0.07)',
          }}
        >
          <div className="mx-auto max-w-3xl px-4 py-2.5">
            {searchOpen ? (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
                    style={{ color: 'rgb(var(--r-text-rgb) / 0.45)' }}
                    aria-hidden
                  />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="ابحث عن صنف…"
                    aria-label="ابحث في المنيو"
                    className="w-full border py-2.5 pe-3 ps-10 text-sm outline-none transition-colors focus:border-[var(--r-primary)]"
                    style={{
                      borderRadius: 'calc(var(--r-radius) * 0.7)',
                      borderColor: 'rgb(var(--r-text-rgb) / 0.14)',
                      backgroundColor: 'var(--r-card)',
                      color: 'var(--r-text)',
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { setSearchOpen(false); setQuery(''); }}
                  className="px-2 text-sm"
                  style={{ color: 'rgb(var(--r-text-rgb) / 0.6)' }}
                >
                  إلغاء
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div ref={navRef} className="scroll-x flex flex-1 gap-1.5">
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      data-chip={category.id}
                      onClick={() => jumpTo(category.id)}
                      aria-current={active === category.id ? 'true' : undefined}
                      className="no-tap-flash shrink-0 px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        borderRadius: '999px',
                        backgroundColor:
                          active === category.id ? 'var(--r-primary)' : 'rgb(var(--r-text-rgb) / 0.06)',
                        color: active === category.id ? 'var(--r-primary-fg)' : 'rgb(var(--r-text-rgb) / 0.7)',
                      }}
                    >
                      {category.icon && <span className="me-1" aria-hidden>{category.icon}</span>}
                      {category.name}
                    </button>
                  ))}
                </div>
                <IconAction
                  label="بحث"
                  onClick={() => { setSearchOpen(true); window.setTimeout(() => searchRef.current?.focus(), 80); }}
                >
                  <Search className="size-4.5" aria-hidden />
                </IconAction>
              </div>
            )}

            <div className="scroll-x mt-2 flex gap-1.5">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  aria-pressed={filter === item.id}
                  className="no-tap-flash shrink-0 border px-2.5 py-1 text-[0.6875rem] font-medium transition-colors"
                  style={{
                    borderRadius: '999px',
                    borderColor: filter === item.id ? 'var(--r-primary)' : 'rgb(var(--r-text-rgb) / 0.14)',
                    color: filter === item.id ? 'var(--r-primary)' : 'rgb(var(--r-text-rgb) / 0.55)',
                    backgroundColor: filter === item.id ? 'rgb(var(--r-primary-rgb) / 0.1)' : 'transparent',
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-3xl px-4 pb-12">
          {searching && (
            <p className="nums py-3 text-xs" style={{ color: 'rgb(var(--r-text-rgb) / 0.55)' }} aria-live="polite">
              {resultCount} نتيجة
            </p>
          )}

          {visible.length === 0 ? (
            <div className="py-20 text-center">
              <span
                className="mx-auto grid size-14 place-items-center rounded-2xl"
                style={{ backgroundColor: 'rgb(var(--r-text-rgb) / 0.05)', color: 'rgb(var(--r-text-rgb) / 0.35)' }}
              >
                <SearchX className="size-7" aria-hidden />
              </span>
              <p className="mt-4 text-base font-bold">
                {categories.length === 0 ? 'المنيو قيد الإعداد' : 'لا توجد نتائج'}
              </p>
              <p className="mt-1.5 text-sm" style={{ color: 'rgb(var(--r-text-rgb) / 0.55)' }}>
                {categories.length === 0
                  ? 'يعمل المطعم على إضافة أصنافه. عد لاحقاً.'
                  : 'جرّب كلمة أخرى أو أزل التصفية.'}
              </p>
              {categories.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setFilter('all'); setSearchOpen(false); }}
                  className="mt-5 px-4 py-2 text-sm font-medium"
                  style={{
                    borderRadius: 'calc(var(--r-radius) * 0.7)',
                    backgroundColor: 'rgb(var(--r-primary-rgb) / 0.12)',
                    color: 'var(--r-primary)',
                  }}
                >
                  إعادة التعيين
                </button>
              )}
            </div>
          ) : (
            visible.map((category) => (
              <section key={category.id} id={`cat-${category.id}`} className="scroll-mt-36 pt-7">
                <h2 className="flex items-center gap-2 text-lg font-extrabold">
                  {category.icon && <span aria-hidden>{category.icon}</span>}
                  {category.name}
                </h2>
                {category.description && (
                  <p className="mt-0.5 text-xs" style={{ color: 'rgb(var(--r-text-rgb) / 0.55)' }}>
                    {category.description}
                  </p>
                )}

                <ul className="mt-3 grid gap-2.5 md:grid-cols-2">
                  {category.products.map((product, index) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      currency={restaurant.currency}
                      showPrices={restaurant.show_prices}
                      index={index}
                      onOpen={setSelected}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </main>

      <footer
        className="border-t px-4 pt-8"
        style={{
          borderColor: 'rgb(var(--r-text-rgb) / 0.08)',
          paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))',
        }}
      >
        <div className="mx-auto max-w-3xl">
          {hours.length > 0 && (
            <section>
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <Clock className="size-4" style={{ color: 'var(--r-primary)' }} aria-hidden />
                أوقات العمل
              </h2>
              <dl className="mt-3 space-y-1.5">
                {groupByWeekday(hours).map(({ weekday, slots }) => (
                  <div key={weekday} className="flex items-baseline justify-between gap-4 text-xs">
                    <dt style={{ color: 'rgb(var(--r-text-rgb) / 0.6)' }}>{WEEKDAYS[weekday]}</dt>
                    <dd className="ltr-nums" style={{ color: 'var(--r-text)' }}>
                      {slots.length === 0
                        ? 'مغلق'
                        : slots.map((slot) => `${slot.opens_at} – ${slot.closes_at}`).join('  ·  ')}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {restaurant.address && (
            <p className="mt-6 flex items-start gap-2 text-sm" style={{ color: 'rgb(var(--r-text-rgb) / 0.7)' }}>
              <MapPin className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--r-primary)' }} aria-hidden />
              {restaurant.address}
            </p>
          )}

          {restaurant.accept_complaints && (
            <button
              type="button"
              onClick={() => setComplaintOpen(true)}
              className="mt-7 flex w-full items-center justify-center gap-2 px-5 py-3.5 text-sm font-bold transition-transform active:scale-[0.985]"
              style={{
                borderRadius: 'calc(var(--r-radius) * 0.75)',
                backgroundColor: 'rgb(var(--r-primary-rgb) / 0.12)',
                color: 'var(--r-primary)',
              }}
            >
              <MessageSquareHeart className="size-4.5" aria-hidden />
              الشكاوى والاقتراحات
            </button>
          )}

          <p className="mt-8 text-center text-xs" style={{ color: 'rgb(var(--r-text-rgb) / 0.4)' }}>
            هذا المنيو من إنشاء{' '}
            {/* الحشوة السالبة تبقي السطر متماسكاً بصرياً وتمنح الرابط
                مساحة لمس مقبولة على الهاتف */}
            <Link
              href="/"
              className="-m-2 inline-block p-2 font-medium underline-offset-2 hover:underline"
            >
              {platformName}
            </Link>
          </p>
        </div>
      </footer>

      <ProductSheet
        product={selected}
        currency={restaurant.currency}
        showPrices={restaurant.show_prices}
        onClose={() => setSelected(null)}
      />

      <ComplaintDialog
        open={complaintOpen}
        onClose={() => setComplaintOpen(false)}
        restaurantId={restaurant.id}
        restaurantName={restaurant.name}
      />

      {hoursOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="أوقات العمل"
          onClick={() => setHoursOpen(false)}
        >
          <div className="absolute inset-0 bg-black/55" />
          <div
            className="relative w-full max-w-sm p-5"
            style={{ backgroundColor: 'var(--r-card)', borderRadius: 'var(--r-radius)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">أوقات العمل</h2>
                <p className="mt-0.5 text-xs" style={{ color: 'rgb(var(--r-text-rgb) / 0.6)' }}>
                  {openState.isOpen ? `مفتوح الآن · ${openState.label}` : openState.label || 'مغلق'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHoursOpen(false)}
                aria-label="إغلاق"
                className="-m-1 rounded-lg p-1.5"
                style={{ color: 'rgb(var(--r-text-rgb) / 0.55)' }}
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <dl className="mt-4 space-y-2">
              {groupByWeekday(hours).map(({ weekday, slots }) => (
                <div key={weekday} className="flex items-baseline justify-between gap-4 text-sm">
                  <dt style={{ color: 'rgb(var(--r-text-rgb) / 0.62)' }}>{WEEKDAYS[weekday]}</dt>
                  <dd className="ltr-nums">
                    {slots.length === 0
                      ? 'مغلق'
                      : slots.map((slot) => `${slot.opens_at} – ${slot.closes_at}`).join('  ·  ')}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}

function IconAction({
  label, onClick, children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn('grid size-9 shrink-0 place-items-center rounded-full transition-colors')}
      style={{ backgroundColor: 'rgb(var(--r-text-rgb) / 0.06)', color: 'rgb(var(--r-text-rgb) / 0.7)' }}
    >
      {children}
    </button>
  );
}
