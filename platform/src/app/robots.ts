import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // لوحات التحكم والمسارات الداخلية لا مكان لها في نتائج البحث
      disallow: ['/dashboard', '/admin', '/api/', '/auth/', '/reset-password', '/verify'],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
