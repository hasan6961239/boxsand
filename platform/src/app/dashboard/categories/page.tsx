import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentRestaurant } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { getPlanLimits } from '@/lib/guard';
import { CategoriesClient } from './categories-client';
import type { Category } from '@/types/database';

export const metadata: Metadata = { title: 'الأقسام' };

export default async function CategoriesPage() {
  const restaurant = await getCurrentRestaurant();
  if (!restaurant) redirect('/dashboard/setup');

  const supabase = await createServerSupabase();
  const [{ data: categories }, { data: counts }, limits] = await Promise.all([
    supabase
      .from('categories')
      .select('*')
      .eq('restaurant_id', restaurant.id)
      .order('position')
      .order('created_at')
      .returns<Category[]>(),
    supabase
      .from('products')
      .select('category_id')
      .eq('restaurant_id', restaurant.id)
      .returns<{ category_id: string }[]>(),
    getPlanLimits(restaurant.id),
  ]);

  const productCounts: Record<string, number> = {};
  for (const row of counts ?? []) {
    productCounts[row.category_id] = (productCounts[row.category_id] ?? 0) + 1;
  }

  return (
    <CategoriesClient
      restaurantId={restaurant.id}
      categories={categories ?? []}
      productCounts={productCounts}
      maxCategories={limits.maxCategories}
      planName={limits.planName}
    />
  );
}
