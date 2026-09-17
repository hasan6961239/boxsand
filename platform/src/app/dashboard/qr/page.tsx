import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentRestaurant } from '@/lib/auth';
import { generateQrSvg, qrTarget } from '@/lib/qr';
import { siteUrl, isSiteUrlConfigured } from '@/lib/config';
import { QrClient } from './qr-client';

export const metadata: Metadata = { title: 'رمز QR' };

export default async function QrPage() {
  const restaurant = await getCurrentRestaurant();
  if (!restaurant) redirect('/dashboard/setup');

  const target = qrTarget(siteUrl(), restaurant.short_id);
  const svg = await generateQrSvg(target);

  return (
    <QrClient
      svg={svg}
      target={target}
      urlConfigured={isSiteUrlConfigured()}
      menuUrl={`${siteUrl()}/menu/${restaurant.slug}`}
      restaurantName={restaurant.name}
      logoUrl={restaurant.logo_url}
    />
  );
}
