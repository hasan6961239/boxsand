'use client';

import Image from 'next/image';
import { Phone, MessageCircle, MapPin, Instagram, Facebook, Music2, Clock } from 'lucide-react';
import { getOpenState } from '@/lib/hours';
import { cn } from '@/lib/cn';
import type { PublicHour, PublicRestaurant } from '@/types/database';

interface Props {
  restaurant: PublicRestaurant;
  hours: PublicHour[];
  onShowHours: () => void;
}

export function MenuHero({ restaurant, hours, onShowHours }: Props) {
  const open = getOpenState(hours, restaurant.timezone);

  return (
    <header className="relative">
      {/* الغلاف: نسبة أقصر على الهاتف حتى لا يدفع المنيو خارج الشاشة الأولى */}
      <div className="relative h-44 w-full overflow-hidden sm:h-60 lg:h-72">
        {restaurant.cover_url ? (
          <Image
            src={restaurant.cover_url}
            alt=""
            fill
            sizes="100vw"
            priority
            className="object-cover"
            unoptimized={restaurant.cover_url.startsWith('/')}
          />
        ) : (
          <div
            className="h-full w-full"
            style={{ background: 'linear-gradient(135deg, var(--r-primary), var(--r-secondary))' }}
          />
        )}
        {/* تدرّج يضمن قراءة النص فوق أي صورة مهما كانت فاتحة */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, rgb(var(--r-text-rgb) / 0.55), transparent 62%)' }}
        />
      </div>

      <div className="relative mx-auto -mt-10 max-w-3xl px-4 sm:-mt-12">
        <div className="flex items-end gap-3">
          <div
            className="relative size-20 shrink-0 overflow-hidden border-4 sm:size-24"
            style={{
              borderRadius: 'calc(var(--r-radius) * 1.1)',
              borderColor: 'var(--r-bg)',
              backgroundColor: 'var(--r-card)',
            }}
          >
            {restaurant.logo_url ? (
              <Image
                src={restaurant.logo_url}
                alt={`شعار ${restaurant.name}`}
                fill
                sizes="96px"
                priority
                className="object-contain p-1.5"
                unoptimized={restaurant.logo_url.startsWith('/')}
              />
            ) : (
              <span
                className="grid h-full place-items-center text-2xl font-bold"
                style={{ color: 'var(--r-primary)' }}
                aria-hidden
              >
                {restaurant.name.charAt(0)}
              </span>
            )}
          </div>

          {open.label && (
            <button
              type="button"
              onClick={onShowHours}
              className="mb-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80"
              style={{
                backgroundColor: 'var(--r-card)',
                color: 'rgb(var(--r-text-rgb) / 0.75)',
              }}
            >
              <span
                className={cn('size-1.5 rounded-full', open.isOpen ? 'bg-[#2F9E5E]' : 'bg-[#C4544A]')}
                aria-hidden
              />
              {open.isOpen ? 'مفتوح الآن' : 'مغلق'}
              <span style={{ color: 'rgb(var(--r-text-rgb) / 0.5)' }}>· {open.label}</span>
              <Clock className="size-3" aria-hidden />
            </button>
          )}
        </div>

        <h1 className="mt-3 text-2xl font-extrabold sm:text-3xl" style={{ color: 'var(--r-text)' }}>
          {restaurant.name}
        </h1>
        {restaurant.tagline && (
          <p className="mt-1 text-sm" style={{ color: 'rgb(var(--r-text-rgb) / 0.62)' }}>
            {restaurant.tagline}
          </p>
        )}
        {restaurant.description && (
          <p className="mt-2.5 text-sm leading-relaxed" style={{ color: 'rgb(var(--r-text-rgb) / 0.72)' }}>
            {restaurant.description}
          </p>
        )}

        <ContactRow restaurant={restaurant} />
      </div>
    </header>
  );
}

function ContactRow({ restaurant }: { restaurant: PublicRestaurant }) {
  const links = [
    restaurant.phone && { href: `tel:${restaurant.phone}`, label: 'اتصال', icon: Phone },
    restaurant.whatsapp && {
      href: `https://wa.me/${restaurant.whatsapp.replace(/[^0-9]/g, '')}`,
      label: 'واتساب',
      icon: MessageCircle,
      external: true,
    },
    restaurant.maps_url && { href: restaurant.maps_url, label: 'الموقع', icon: MapPin, external: true },
    restaurant.instagram && {
      href: restaurant.instagram.startsWith('http')
        ? restaurant.instagram
        : `https://instagram.com/${restaurant.instagram.replace(/^@/, '')}`,
      label: 'إنستغرام',
      icon: Instagram,
      external: true,
    },
    restaurant.facebook && {
      href: restaurant.facebook.startsWith('http')
        ? restaurant.facebook
        : `https://facebook.com/${restaurant.facebook}`,
      label: 'فيسبوك',
      icon: Facebook,
      external: true,
    },
    restaurant.tiktok && {
      href: restaurant.tiktok.startsWith('http')
        ? restaurant.tiktok
        : `https://tiktok.com/@${restaurant.tiktok.replace(/^@/, '')}`,
      label: 'تيك توك',
      icon: Music2,
      external: true,
    },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Phone; external?: boolean }[];

  if (links.length === 0) return null;

  return (
    <nav aria-label="تواصل مع المطعم" className="scroll-x mt-4 flex gap-2 pb-1">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="no-tap-flash flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-xs font-medium transition-transform active:scale-95"
          style={{
            borderRadius: 'calc(var(--r-radius) * 0.7)',
            backgroundColor: 'rgb(var(--r-primary-rgb) / 0.1)',
            color: 'var(--r-primary)',
          }}
        >
          <link.icon className="size-4" aria-hidden />
          {link.label}
        </a>
      ))}
    </nav>
  );
}
