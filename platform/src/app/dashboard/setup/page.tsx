import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireSession, getCurrentRestaurant } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { SetupWizard } from './wizard';

export const metadata: Metadata = { title: 'أنشئ مطعمك' };

export default async function SetupPage() {
  const session = await requireSession('/dashboard/setup');
  const restaurant = await getCurrentRestaurant();
  if (restaurant) redirect('/dashboard');

  // اسم المطعم كُتب عند التسجيل وحُفظ في بيانات المستخدم؛ نملأ الحقل به
  // فلا يكتبه صاحب المطعم مرتين.
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const suggested = String(user?.user_metadata?.restaurant_name ?? '').trim();

  return <SetupWizard defaultName={suggested} defaultPhone={session.profile.phone ?? ''} />;
}
