'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase/server';
import { UserFacingError, toUserMessage } from '@/lib/errors';
import type { ActionState } from '../dashboard/actions';

/** كل إجراء إداري يبدأ بإثبات الصلاحية، ثم ينفّذ، ثم يسجّل الأثر. */
async function asAdmin() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserFacingError('انتهت الجلسة. سجّل الدخول مرة أخرى.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_blocked')
    .eq('id', user.id)
    .maybeSingle<{ role: string; is_blocked: boolean }>();

  if (profile?.role !== 'super_admin' || profile.is_blocked) {
    throw new UserFacingError('هذه العملية تخصّ إدارة المنصة.');
  }
  return supabase;
}

async function run(work: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await work();
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    return { error: toUserMessage(error, 'لوحة الإدارة') };
  }
}

function refresh() {
  revalidatePath('/admin', 'layout');
}

export async function setRestaurantStatusAction(
  restaurantId: string,
  status: 'trial' | 'active' | 'suspended' | 'disabled',
  note?: string,
): Promise<ActionState> {
  return run(async () => {
    const supabase = await asAdmin();

    const { data: before } = await supabase
      .from('restaurants')
      .select('slug, status')
      .eq('id', restaurantId)
      .maybeSingle<{ slug: string; status: string }>();

    const { error } = await supabase
      .from('restaurants')
      .update({ status, status_note: note?.trim() || null })
      .eq('id', restaurantId);
    if (error) throw error;

    await supabase.rpc('log_audit', {
      p_action: 'restaurant.status',
      p_entity_type: 'restaurant',
      p_entity_id: restaurantId,
      p_restaurant_id: restaurantId,
      p_meta: { from: before?.status ?? null, to: status },
    });

    refresh();
    // المنيو العام يتغيّر ظهوره فوراً مع الحالة
    if (before?.slug) revalidatePath(`/menu/${before.slug}`);
    return { ok: true };
  });
}

export async function deleteRestaurantAction(restaurantId: string): Promise<ActionState> {
  return run(async () => {
    const supabase = await asAdmin();

    const { data: before } = await supabase
      .from('restaurants')
      .select('name, slug')
      .eq('id', restaurantId)
      .maybeSingle<{ name: string; slug: string }>();

    // السجل قبل الحذف: بعده لن يبقى ما نشير إليه
    await supabase.rpc('log_audit', {
      p_action: 'restaurant.delete',
      p_entity_type: 'restaurant',
      p_entity_id: restaurantId,
      p_restaurant_id: null,
      p_meta: { name: before?.name ?? null, slug: before?.slug ?? null },
    });

    const { error } = await supabase.from('restaurants').delete().eq('id', restaurantId);
    if (error) throw error;

    refresh();
    if (before?.slug) revalidatePath(`/menu/${before.slug}`);
    return { ok: true };
  });
}

export async function setUserBlockedAction(userId: string, blocked: boolean): Promise<ActionState> {
  return run(async () => {
    const supabase = await asAdmin();

    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id === userId) {
      throw new UserFacingError('لا يمكنك حظر حسابك أنت.');
    }

    const { error } = await supabase.from('profiles').update({ is_blocked: blocked }).eq('id', userId);
    if (error) throw error;

    await supabase.rpc('log_audit', {
      p_action: blocked ? 'user.block' : 'user.unblock',
      p_entity_type: 'user',
      p_entity_id: userId,
      p_restaurant_id: null,
      p_meta: {},
    });

    refresh();
    return { ok: true };
  });
}

export async function savePlanAction(
  planId: string,
  values: {
    name: string;
    description: string;
    price_monthly: number | null;
    max_categories: number | null;
    max_products: number | null;
    features: string[];
    is_public: boolean;
  },
): Promise<ActionState> {
  return run(async () => {
    const supabase = await asAdmin();

    if (values.name.trim().length < 2) {
      return { error: 'اسم الخطة قصير جداً.' };
    }

    const { error } = await supabase
      .from('plans')
      .update({
        name: values.name.trim(),
        description: values.description.trim() || null,
        price_monthly: values.price_monthly,
        max_categories: values.max_categories,
        max_products: values.max_products,
        features: values.features.filter((feature) => feature.trim()),
        is_public: values.is_public,
      })
      .eq('id', planId);
    if (error) throw error;

    await supabase.rpc('log_audit', {
      p_action: 'plan.update',
      p_entity_type: 'plan',
      p_entity_id: planId,
      p_restaurant_id: null,
      p_meta: {},
    });

    refresh();
    revalidatePath('/');
    return { ok: true };
  });
}

export async function savePlatformSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return run(async () => {
    const supabase = await asAdmin();

    const text = (key: string) => {
      const value = String(formData.get(key) ?? '').trim();
      return value === '' ? null : value;
    };

    const name = text('platform_name');
    if (!name || name.length < 2) return { fields: { platform_name: 'اسم المنصة قصير جداً' } };

    const { error } = await supabase
      .from('platform_settings')
      .update({
        platform_name: name,
        tagline: text('tagline') ?? '',
        primary_color: text('primary_color') ?? '#1F6F5C',
        contact_email: text('contact_email'),
        contact_phone: text('contact_phone'),
        whatsapp: text('whatsapp'),
        seo_title: text('seo_title'),
        seo_description: text('seo_description'),
        allow_signup: formData.get('allow_signup') === 'true',
      })
      .eq('id', true);
    if (error) throw error;

    await supabase.rpc('log_audit', {
      p_action: 'platform.settings',
      p_entity_type: 'platform',
      p_entity_id: null,
      p_restaurant_id: null,
      p_meta: {},
    });

    refresh();
    revalidatePath('/', 'layout');
    return { ok: true };
  });
}
