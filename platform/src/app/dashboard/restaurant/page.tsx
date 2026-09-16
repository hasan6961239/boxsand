import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentRestaurant } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { RestaurantClient } from './restaurant-client';
import type { OpeningHour, RestaurantTheme } from '@/types/database';

export const metadata: Metadata = { title: 'معلومات المطعم' };

export default async function RestaurantPage() {
  const restaurant = await getCurrentRestaurant();
  if (!restaurant) redirect('/dashboard/setup');

  const supabase = await createServerSupabase();
  const [{ data: theme }, { data: hours }] = await Promise.all([
    supabase.from('restaurant_themes').select('*').eq('restaurant_id', restaurant.id).maybeSingle<RestaurantTheme>(),
    supabase.from('opening_hours').select('*').eq('restaurant_id', restaurant.id)
      .order('weekday').order('opens_at').returns<OpeningHour[]>(),
  ]);

  return <RestaurantClient restaurant={restaurant} theme={theme} hours={hours ?? []} />;
}
