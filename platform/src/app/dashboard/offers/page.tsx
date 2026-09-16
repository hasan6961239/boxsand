import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentRestaurant } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { OffersClient } from './offers-client';
import type { Offer } from '@/types/database';

export const metadata: Metadata = { title: 'العروض' };

export default async function OffersPage() {
  const restaurant = await getCurrentRestaurant();
  if (!restaurant) redirect('/dashboard/setup');

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('offers')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .order('position')
    .returns<Offer[]>();

  return <OffersClient restaurantId={restaurant.id} offers={data ?? []} />;
}
