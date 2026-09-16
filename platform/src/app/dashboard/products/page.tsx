import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentRestaurant } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { getPlanLimits } from '@/lib/guard';
import { ProductsClient, type ProductRow } from './products-client';
import type { Category, OptionGroup, ProductOption, ProductVariant } from '@/types/database';

export const metadata: Metadata = { title: 'الأصناف' };

export default async function ProductsPage() {
  const restaurant = await getCurrentRestaurant();
  if (!restaurant) redirect('/dashboard/setup');

  const supabase = await createServerSupabase();
  const [{ data: categories }, { data: products }, { data: variants }, { data: groups }, { data: options }, limits] =
    await Promise.all([
      supabase.from('categories').select('*').eq('restaurant_id', restaurant.id)
        .order('position').order('created_at').returns<Category[]>(),
      supabase.from('products').select('*').eq('restaurant_id', restaurant.id)
        .order('position').order('created_at').returns<ProductRow[]>(),
      supabase.from('product_variants').select('*').eq('restaurant_id', restaurant.id)
        .order('position').returns<ProductVariant[]>(),
      supabase.from('option_groups').select('*').eq('restaurant_id', restaurant.id)
        .order('position').returns<OptionGroup[]>(),
      supabase.from('options').select('*').eq('restaurant_id', restaurant.id)
        .order('position').returns<ProductOption[]>(),
      getPlanLimits(restaurant.id),
    ]);

  return (
    <ProductsClient
      restaurantId={restaurant.id}
      currency={restaurant.currency}
      categories={categories ?? []}
      products={products ?? []}
      variants={variants ?? []}
      groups={groups ?? []}
      options={options ?? []}
      maxProducts={limits.maxProducts}
      planName={limits.planName}
    />
  );
}
