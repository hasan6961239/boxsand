import type { MetadataRoute } from 'next';
import { createPublicClient } from '@/lib/supabase/public';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { siteUrl } from '@/lib/config';

/** خريطة الموقع: الصفحات الثابتة + منيو كل مطعم منشور. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const staticPages: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/register`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/login`, changeFrequency: 'monthly', priority: 0.3 },
  ];

  if (!isSupabaseConfigured()) return staticPages;

  try {
    const supabase = createPublicClient();
    const { data } = await supabase.rpc('get_public_restaurant_slugs');
    const menus = (data ?? []) as { slug: string; updated_at: string }[];

    return [
      ...staticPages,
      ...menus.map((menu) => ({
        url: `${base}/menu/${encodeURIComponent(menu.slug)}`,
        lastModified: new Date(menu.updated_at),
        changeFrequency: 'daily' as const,
        priority: 0.8,
      })),
    ];
  } catch (error) {
    console.error('[سُفرة] خريطة الموقع:', error);
    return staticPages;
  }
}
