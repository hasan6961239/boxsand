import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentRestaurant } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { ComplaintsClient } from './complaints-client';
import type { Complaint } from '@/types/database';

export const metadata: Metadata = { title: 'الشكاوى والاقتراحات' };

export default async function ComplaintsPage() {
  const restaurant = await getCurrentRestaurant();
  if (!restaurant) redirect('/dashboard/setup');

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('complaints')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .order('created_at', { ascending: false })
    .limit(500)
    .returns<Complaint[]>();

  return <ComplaintsClient restaurantId={restaurant.id} complaints={data ?? []} />;
}
