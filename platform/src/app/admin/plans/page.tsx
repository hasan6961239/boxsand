import type { Metadata } from 'next';
import { createServerSupabase } from '@/lib/supabase/server';
import { PlansClient } from './plans-client';
import type { Plan } from '@/types/database';

export const metadata: Metadata = { title: 'الخطط' };

export default async function AdminPlansPage() {
  const supabase = await createServerSupabase();

  const [{ data: plans }, { data: subscriptions }] = await Promise.all([
    supabase.from('plans').select('*').order('position').returns<Plan[]>(),
    supabase.from('subscriptions').select('plan_id')
      .in('status', ['trialing', 'active', 'past_due'])
      .returns<{ plan_id: string }[]>(),
  ]);

  const counts: Record<string, number> = {};
  for (const row of subscriptions ?? []) counts[row.plan_id] = (counts[row.plan_id] ?? 0) + 1;

  return <PlansClient plans={plans ?? []} counts={counts} />;
}
