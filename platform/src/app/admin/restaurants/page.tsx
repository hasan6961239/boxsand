import type { Metadata } from 'next';
import { createServerSupabase } from '@/lib/supabase/server';
import { AdminRestaurantsClient, type AdminRestaurantRow } from './restaurants-client';

export const metadata: Metadata = { title: 'المطاعم' };

export default async function AdminRestaurantsPage() {
  const supabase = await createServerSupabase();
  const { data } = await supabase.rpc('admin_restaurants');

  return <AdminRestaurantsClient rows={(data ?? []) as AdminRestaurantRow[]} />;
}
