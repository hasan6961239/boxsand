import type { Metadata } from 'next';
import { createServerSupabase } from '@/lib/supabase/server';
import { AdminUsersClient, type AdminUserRow } from './users-client';
import type { Profile } from '@/types/database';

export const metadata: Metadata = { title: 'المستخدمون' };

export default async function AdminUsersPage() {
  const supabase = await createServerSupabase();

  const [{ data: profiles }, { data: memberships }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(1000).returns<Profile[]>(),
    supabase.from('restaurant_members').select('user_id, restaurant_id, restaurants(name)')
      .returns<{ user_id: string; restaurant_id: string; restaurants: { name: string } | null }[]>(),
  ]);

  const byUser = new Map<string, string[]>();
  for (const row of memberships ?? []) {
    const list = byUser.get(row.user_id) ?? [];
    if (row.restaurants?.name) list.push(row.restaurants.name);
    byUser.set(row.user_id, list);
  }

  const rows: AdminUserRow[] = (profiles ?? []).map((profile) => ({
    ...profile,
    restaurants: byUser.get(profile.id) ?? [],
  }));

  return <AdminUsersClient rows={rows} />;
}
