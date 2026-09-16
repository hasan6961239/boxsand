import { redirect } from 'next/navigation';
import { createServerSupabase } from './supabase/server';
import { isSupabaseConfigured } from './supabase/env';
import type { Profile, Restaurant } from '@/types/database';

export interface Session {
  userId: string;
  email: string;
  profile: Profile;
}

/** الجلسة الحالية، أو null. لا يعيد التوجيه — للصفحات العامة. */
export async function getSession(): Promise<Session | null> {
  // الصفحات العامة تُبنى قبل ربط Supabase أحياناً؛ نعتبر ذلك «لا جلسة»
  // بدل إسقاط البناء برسالة غامضة.
  if (!isSupabaseConfigured()) return null;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle<Profile>();

  if (!profile || profile.is_blocked) return null;
  return { userId: user.id, email: user.email ?? '', profile };
}

/** يفرض تسجيل الدخول. */
export async function requireSession(returnTo?: string): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login');
  }
  return session;
}

/** يفرض صلاحية مدير المنصة. */
export async function requireAdmin(): Promise<Session> {
  const session = await requireSession('/admin');
  if (session.profile.role !== 'super_admin') redirect('/dashboard');
  return session;
}

/**
 * المطعم النشط لصاحب الحساب.
 *
 * الاستعلام محكوم بـ RLS، فلا يُرجع إلا مطاعم هذا المستخدم مهما كان المُعرَّف
 * المطلوب — التحقق مزدوج: هنا وفي قاعدة البيانات.
 */
export async function getCurrentRestaurant(restaurantId?: string): Promise<Restaurant | null> {
  const supabase = await createServerSupabase();
  let query = supabase.from('restaurants').select('*').order('created_at', { ascending: true }).limit(1);
  if (restaurantId) query = supabase.from('restaurants').select('*').eq('id', restaurantId).limit(1);

  const { data } = await query.returns<Restaurant[]>();
  return data?.[0] ?? null;
}

/** يفرض وجود مطعم — يوجّه إلى معالج الإعداد إن لم يكن. */
export async function requireRestaurant(): Promise<{ session: Session; restaurant: Restaurant }> {
  const session = await requireSession('/dashboard');
  const restaurant = await getCurrentRestaurant();
  if (!restaurant) redirect('/dashboard/setup');
  return { session, restaurant };
}
