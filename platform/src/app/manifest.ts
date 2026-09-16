import type { MetadataRoute } from 'next';
import { PLATFORM } from '@/lib/config';

/** يسمح بإضافة المنصة إلى الشاشة الرئيسية. بلا Service Worker حتى الآن. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${PLATFORM.name} — ${PLATFORM.tagline}`,
    short_name: PLATFORM.name,
    description: PLATFORM.description,
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FBF9F6',
    theme_color: '#1F6F5C',
    lang: 'ar',
    dir: 'rtl',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
