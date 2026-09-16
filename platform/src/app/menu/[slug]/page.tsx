import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { createPublicClient } from '@/lib/supabase/public';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { siteUrl, PLATFORM } from '@/lib/config';
import { MenuView } from '@/components/menu/menu-view';
import { UnavailableNotice } from '@/components/menu/unavailable';
import type { PublicMenu, PublicMenuResult } from '@/types/database';

/*
 * المنيو محتوى عام يُقرأ كثيراً ويتغيّر قليلاً، فيُخزَّن مؤقتاً. وعند كل
 * تعديل من لوحة التحكم نُبطل التخزين لهذا المسار وحده، فيرى الزبون الجديد
 * فوراً دون أن ندفع كلفة تصيير عند كل زيارة.
 */
export const revalidate = 60;

async function loadMenu(slug: string): Promise<PublicMenuResult> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc('get_public_menu', { p_slug: slug });
    if (error) {
      console.error('[سُفرة] تحميل المنيو:', error.message);
      return null;
    }
    return data as PublicMenuResult;
  } catch (error) {
    console.error('[سُفرة] تحميل المنيو:', error);
    return null;
  }
}

function isMenu(result: PublicMenuResult): result is PublicMenu {
  return Boolean(result && typeof result === 'object' && 'restaurant' in result);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadMenu(decodeURIComponent(slug));
  if (!isMenu(result)) return { title: 'المنيو غير متاح', robots: { index: false } };

  const { restaurant } = result;
  const description =
    restaurant.description?.slice(0, 160) ||
    restaurant.tagline ||
    `تصفّح منيو ${restaurant.name} — الأصناف والأسعار محدّثة دائماً.`;
  const url = `${siteUrl()}/menu/${restaurant.slug}`;
  const image = restaurant.cover_url?.startsWith('http') ? restaurant.cover_url : undefined;

  return {
    title: `منيو ${restaurant.name}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      locale: 'ar_LY',
      title: `منيو ${restaurant.name}`,
      description,
      url,
      siteName: restaurant.name,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: `منيو ${restaurant.name}`,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function MenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug);
  const result = await loadMenu(decoded);

  if (result && typeof result === 'object' && 'redirect_to' in result) {
    redirect(`/menu/${encodeURIComponent(result.redirect_to)}`);
  }

  if (result && typeof result === 'object' && 'unavailable' in result) {
    return <UnavailableNotice name={result.name} />;
  }

  if (!isMenu(result)) notFound();

  const { restaurant, hours } = result;

  // بيانات منظَّمة لمحركات البحث: تُظهر المطعم كنشاط محلي بمنيو، لا كصفحة نص.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: restaurant.name,
    description: restaurant.description ?? restaurant.tagline ?? undefined,
    image: restaurant.cover_url?.startsWith('http') ? restaurant.cover_url : undefined,
    logo: restaurant.logo_url?.startsWith('http') ? restaurant.logo_url : undefined,
    telephone: restaurant.phone ?? undefined,
    address: restaurant.address ? { '@type': 'PostalAddress', streetAddress: restaurant.address } : undefined,
    url: `${siteUrl()}/menu/${restaurant.slug}`,
    hasMap: restaurant.maps_url ?? undefined,
    priceRange: '$$',
    servesCuisine: undefined,
    openingHoursSpecification: hours.map((hour) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][hour.weekday],
      opens: hour.opens_at,
      closes: hour.closes_at,
    })),
    hasMenu: {
      '@type': 'Menu',
      name: `منيو ${restaurant.name}`,
      hasMenuSection: result.categories.map((category) => ({
        '@type': 'MenuSection',
        name: category.name,
        hasMenuItem: category.products.map((product) => ({
          '@type': 'MenuItem',
          name: product.name,
          description: product.description ?? undefined,
          offers: {
            '@type': 'Offer',
            price: product.price,
            priceCurrency: restaurant.currency,
          },
        })),
      })),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        // بيانات مبنية على الخادم من سجلات قاعدة البيانات، لا من مدخلات الزائر
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MenuView menu={result} platformName={PLATFORM.name} />
    </>
  );
}
