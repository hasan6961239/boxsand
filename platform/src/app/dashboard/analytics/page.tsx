import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentRestaurant } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { AnalyticsClient } from './analytics-client';

export const metadata: Metadata = { title: 'الإحصائيات' };

function dayKey(daysAgo: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

export default async function AnalyticsPage() {
  const restaurant = await getCurrentRestaurant();
  if (!restaurant) redirect('/dashboard/setup');

  const supabase = await createServerSupabase();
  const since = dayKey(29);

  const [{ data: daily }, { data: productViews }, { data: products }] = await Promise.all([
    supabase
      .from('analytics_daily')
      .select('day, views, visitors')
      .eq('restaurant_id', restaurant.id)
      .gte('day', since)
      .order('day')
      .returns<{ day: string; views: number; visitors: number }[]>(),
    supabase
      .from('product_views_daily')
      .select('product_id, views')
      .eq('restaurant_id', restaurant.id)
      .gte('day', since)
      .returns<{ product_id: string; views: number }[]>(),
    supabase
      .from('products')
      .select('id, name')
      .eq('restaurant_id', restaurant.id)
      .returns<{ id: string; name: string }[]>(),
  ]);

  // سلسلة متصلة لكل الثلاثين يوماً: الأيام بلا زيارات لا تُخزَّن، وبدون ملئها
  // يقفز المخطط فوق الفجوات فيبدو النشاط أعلى مما هو.
  const map = new Map((daily ?? []).map((row) => [row.day, row]));
  const series = Array.from({ length: 30 }, (_, index) => {
    const day = dayKey(29 - index);
    const row = map.get(day);
    return { day, views: row?.views ?? 0, visitors: row?.visitors ?? 0 };
  });

  const names = new Map((products ?? []).map((product) => [product.id, product.name]));
  const totals = new Map<string, number>();
  for (const row of productViews ?? []) {
    totals.set(row.product_id, (totals.get(row.product_id) ?? 0) + row.views);
  }

  const top = [...totals.entries()]
    .map(([id, views]) => ({ id, name: names.get(id) ?? 'صنف محذوف', views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 8);

  return <AnalyticsClient series={series} topProducts={top} />;
}
