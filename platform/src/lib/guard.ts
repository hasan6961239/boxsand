import { createServerSupabase } from './supabase/server';
import { UserFacingError } from './errors';
import type { Restaurant } from '@/types/database';

/**
 * يتحقق من أن المستخدم الحالي يدير هذا المطعم.
 *
 * قاعدة البيانات تمنع الكتابة على أي حال عبر RLS، لكن بلا هذا الفحص يعود
 * التحديث بصمت على «صفر صفوف» ويظن صاحب المطعم أن التعديل حُفظ. هنا نُرجع
 * رسالة صريحة بدل نجاح كاذب.
 */
export async function assertCanManage(restaurantId: string): Promise<Restaurant> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserFacingError('انتهت الجلسة. سجّل الدخول مرة أخرى.');

  const { data } = await supabase
    .from('restaurants')
    .select('*')
    .eq('id', restaurantId)
    .maybeSingle<Restaurant>();

  if (!data) throw new UserFacingError('لا تملك صلاحية على هذا المطعم.');
  return data;
}

/** حدود الخطة الحالية — null يعني بلا حد. */
export async function getPlanLimits(restaurantId: string): Promise<{
  maxCategories: number | null;
  maxProducts: number | null;
  planName: string;
}> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('subscriptions')
    .select('plans(name, max_categories, max_products)')
    .eq('restaurant_id', restaurantId)
    .in('status', ['trialing', 'active', 'past_due'])
    .maybeSingle<{ plans: { name: string; max_categories: number | null; max_products: number | null } | null }>();

  return {
    maxCategories: data?.plans?.max_categories ?? null,
    maxProducts: data?.plans?.max_products ?? null,
    planName: data?.plans?.name ?? 'مجاني',
  };
}

/** يرفض تجاوز حد الخطة برسالة تشرح السبب بدل خطأ قاعدة بيانات غامض. */
export async function assertWithinLimit(
  restaurantId: string,
  table: 'categories' | 'products',
): Promise<void> {
  const limits = await getPlanLimits(restaurantId);
  const max = table === 'categories' ? limits.maxCategories : limits.maxProducts;
  if (max === null) return;

  const supabase = await createServerSupabase();
  const { count } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId);

  if ((count ?? 0) >= max) {
    const what = table === 'categories' ? 'الأقسام' : 'الأصناف';
    throw new UserFacingError(
      `بلغت الحد الأقصى لعدد ${what} في خطة «${limits.planName}» (${max}). رقِّ خطتك للمتابعة.`,
    );
  }
}
