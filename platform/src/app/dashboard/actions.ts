'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { assertCanManage, assertWithinLimit } from '@/lib/guard';
import { UserFacingError, toUserMessage } from '@/lib/errors';
import {
  restaurantProfileSchema, themeSchema, categorySchema, productSchema,
  variantSchema, optionGroupSchema, optionSchema, offerSchema,
  openingHourSchema, complaintStatusSchema, slugify, fieldErrors,
  type FieldErrors,
} from '@/lib/validation';

export interface ActionState {
  ok?: boolean;
  error?: string;
  fields?: FieldErrors;
  /** معرّف السجل بعد الحفظ — يحتاجه النموذج ليحفظ الأحجام والإضافات التابعة. */
  id?: string;
}

const OK: ActionState = { ok: true };

/** يلفّ أي عملية: يترجم الأخطاء، ويُبقي redirect يمرّ كما هو. */
async function run(work: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await work();
  } catch (error) {
    // next/navigation يستخدم الاستثناءات للتحويل — لا نبتلعها
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    return { error: toUserMessage(error, 'لوحة التحكم') };
  }
}

function refresh(paths: string[] = []) {
  revalidatePath('/dashboard', 'layout');
  for (const path of paths) revalidatePath(path);
}

/** يحدّث صفحة المنيو العامة فور تعديل محتواها. */
function refreshMenu(slug: string) {
  revalidatePath(`/menu/${slug}`);
}

const text = (value: FormDataEntryValue | null) => {
  const result = typeof value === 'string' ? value.trim() : '';
  return result === '' ? null : result;
};
const bool = (value: FormDataEntryValue | null) => value === 'true' || value === 'on';

/* ══════════════════════════════════════════════════════════════════════════
   إنشاء المطعم (معالج الإعداد)
   ══════════════════════════════════════════════════════════════════════════ */

export async function createRestaurantAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserFacingError('انتهت الجلسة. سجّل الدخول مرة أخرى.');

    const name = String(formData.get('name') ?? '').trim();
    if (name.length < 2) return { fields: { name: 'اسم المطعم قصير جداً' } };

    // مطعم واحد لكل مالك في الوقت الحالي؛ البنية تدعم أكثر لاحقاً.
    const { data: existing } = await supabase.from('restaurants').select('id').limit(1);
    if (existing && existing.length > 0) redirect('/dashboard');

    const slug = await uniqueSlug(slugify(name) || 'restaurant');
    const shortId = await uniqueShortId();

    const { error } = await supabase.from('restaurants').insert({
      owner_id: user.id,
      name,
      slug,
      short_id: shortId,
      phone: text(formData.get('phone')),
      currency: String(formData.get('currency') ?? 'LYD'),
    });
    if (error) throw error;

    refresh();
    redirect('/dashboard');
  });
}

/** رابط فريد: يضيف رقماً متتابعاً عند التعارض بدل أن يفشل الإنشاء. */
async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const supabase = await createServerSupabase();
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    // نبحث في تاريخ الروابط أيضاً حتى لا نسرق رابطاً قديماً لمطعم آخر
    const { data } = await supabase.rpc('get_public_menu', { p_slug: candidate });
    const taken = data !== null && !(excludeId && typeof data === 'object' && 'restaurant' in data &&
      (data as { restaurant?: { id?: string } }).restaurant?.id === excludeId);
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function uniqueShortId(): Promise<string> {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  const supabase = await createServerSupabase();
  for (let attempt = 0; attempt < 20; attempt++) {
    let candidate = '';
    const bytes = new Uint8Array(7);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) candidate += alphabet[byte % alphabet.length];
    const { data } = await supabase.rpc('resolve_short_id', { p_short_id: candidate });
    if (!data) return candidate;
  }
  throw new UserFacingError('تعذّر توليد معرّف فريد. أعد المحاولة.');
}

/* ══════════════════════════════════════════════════════════════════════════
   معلومات المطعم
   ══════════════════════════════════════════════════════════════════════════ */

export async function updateRestaurantAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const id = String(formData.get('id') ?? '');
    const current = await assertCanManage(id);

    const parsed = restaurantProfileSchema.safeParse({
      name: formData.get('name'),
      slug: formData.get('slug'),
      tagline: formData.get('tagline') ?? '',
      description: formData.get('description') ?? '',
      phone: formData.get('phone') ?? '',
      whatsapp: formData.get('whatsapp') ?? '',
      instagram: formData.get('instagram') ?? '',
      facebook: formData.get('facebook') ?? '',
      tiktok: formData.get('tiktok') ?? '',
      maps_url: formData.get('maps_url') ?? '',
      address: formData.get('address') ?? '',
      currency: formData.get('currency'),
      timezone: formData.get('timezone'),
      show_unavailable: bool(formData.get('show_unavailable')),
      show_prices: bool(formData.get('show_prices')),
      accept_complaints: bool(formData.get('accept_complaints')),
    });
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const supabase = await createServerSupabase();
    const slug = parsed.data.slug === current.slug ? current.slug : await uniqueSlug(parsed.data.slug, id);

    const { error } = await supabase
      .from('restaurants')
      .update({
        ...parsed.data,
        slug,
        tagline: parsed.data.tagline || null,
        description: parsed.data.description || null,
        phone: parsed.data.phone || null,
        whatsapp: parsed.data.whatsapp || null,
        instagram: parsed.data.instagram || null,
        facebook: parsed.data.facebook || null,
        tiktok: parsed.data.tiktok || null,
        maps_url: parsed.data.maps_url || null,
        address: parsed.data.address || null,
      })
      .eq('id', id);
    if (error) throw error;

    refresh();
    refreshMenu(current.slug);
    if (slug !== current.slug) refreshMenu(slug);
    return slug === parsed.data.slug ? OK : { ok: true, error: `الرابط محجوز، استُخدم «${slug}» بدلاً منه.` };
  });
}

export async function updateMediaAction(
  restaurantId: string,
  field: 'logo_url' | 'cover_url',
  url: string | null,
): Promise<ActionState> {
  return run(async () => {
    const current = await assertCanManage(restaurantId);
    const supabase = await createServerSupabase();
    const { error } = await supabase.from('restaurants').update({ [field]: url }).eq('id', restaurantId);
    if (error) throw error;
    refresh();
    refreshMenu(current.slug);
    return OK;
  });
}

export async function updateThemeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const restaurantId = String(formData.get('restaurant_id') ?? '');
    const current = await assertCanManage(restaurantId);

    const parsed = themeSchema.safeParse({
      preset: formData.get('preset'),
      primary_color: formData.get('primary_color'),
      secondary_color: formData.get('secondary_color'),
      background_color: formData.get('background_color'),
      text_color: formData.get('text_color'),
      card_color: formData.get('card_color'),
      font_family: formData.get('font_family'),
      border_radius: formData.get('border_radius'),
      button_style: formData.get('button_style'),
      default_dark: bool(formData.get('default_dark')),
    });
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const supabase = await createServerSupabase();
    const { error } = await supabase
      .from('restaurant_themes')
      .upsert({ restaurant_id: restaurantId, ...parsed.data });
    if (error) throw error;

    refresh();
    refreshMenu(current.slug);
    return OK;
  });
}

export async function saveHoursAction(
  restaurantId: string,
  slots: { weekday: number; opens_at: string; closes_at: string }[],
): Promise<ActionState> {
  return run(async () => {
    const current = await assertCanManage(restaurantId);

    for (const slot of slots) {
      const parsed = openingHourSchema.safeParse(slot);
      if (!parsed.success) return { error: 'تحقّق من صيغة الأوقات المدخلة.' };
      if (parsed.data.opens_at === parsed.data.closes_at) {
        return { error: 'وقت الفتح والإغلاق متطابقان في إحدى الفترات.' };
      }
    }

    const supabase = await createServerSupabase();
    // استبدال كامل: أبسط وأدقّ من محاولة مطابقة الفترات المعدَّلة واحدة واحدة
    const { error: deleteError } = await supabase.from('opening_hours').delete().eq('restaurant_id', restaurantId);
    if (deleteError) throw deleteError;

    if (slots.length > 0) {
      const { error } = await supabase
        .from('opening_hours')
        .insert(slots.map((slot) => ({ ...slot, restaurant_id: restaurantId })));
      if (error) throw error;
    }

    refresh();
    refreshMenu(current.slug);
    return OK;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   الأقسام
   ══════════════════════════════════════════════════════════════════════════ */

export async function saveCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const restaurantId = String(formData.get('restaurant_id') ?? '');
    const id = text(formData.get('id'));
    const current = await assertCanManage(restaurantId);

    const parsed = categorySchema.safeParse({
      name: formData.get('name'),
      description: formData.get('description') ?? '',
      icon: formData.get('icon') ?? '',
      is_visible: bool(formData.get('is_visible')),
    });
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const supabase = await createServerSupabase();
    const payload = {
      name: parsed.data.name,
      description: parsed.data.description || null,
      icon: parsed.data.icon || null,
      is_visible: parsed.data.is_visible,
    };

    if (id) {
      const { error } = await supabase.from('categories').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      await assertWithinLimit(restaurantId, 'categories');
      const { count } = await supabase
        .from('categories')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId);
      const { error } = await supabase
        .from('categories')
        .insert({ ...payload, restaurant_id: restaurantId, position: count ?? 0 });
      if (error) throw error;
    }

    refresh(['/dashboard/categories', '/dashboard/products']);
    refreshMenu(current.slug);
    return OK;
  });
}

export async function deleteCategoryAction(restaurantId: string, id: string): Promise<ActionState> {
  return run(async () => {
    const current = await assertCanManage(restaurantId);
    const supabase = await createServerSupabase();
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) throw error;
    refresh(['/dashboard/categories', '/dashboard/products']);
    refreshMenu(current.slug);
    return OK;
  });
}

export async function reorderAction(
  restaurantId: string,
  table: 'categories' | 'products',
  orderedIds: string[],
): Promise<ActionState> {
  return run(async () => {
    const current = await assertCanManage(restaurantId);
    const supabase = await createServerSupabase();

    // تحديث متوازٍ: القائمة قصيرة عملياً (عشرات لا آلاف)
    const results = await Promise.all(
      orderedIds.map((id, position) =>
        supabase.from(table).update({ position }).eq('id', id).eq('restaurant_id', restaurantId),
      ),
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;

    refresh([`/dashboard/${table}`]);
    refreshMenu(current.slug);
    return OK;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   الأصناف
   ══════════════════════════════════════════════════════════════════════════ */

export async function saveProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const restaurantId = String(formData.get('restaurant_id') ?? '');
    const id = text(formData.get('id'));
    const current = await assertCanManage(restaurantId);

    const badges = formData.getAll('badges').map(String).filter(Boolean);
    const parsed = productSchema.safeParse({
      name: formData.get('name'),
      description: formData.get('description') ?? '',
      category_id: formData.get('category_id'),
      base_price: formData.get('base_price'),
      compare_at_price: formData.get('compare_at_price') ?? '',
      image_url: formData.get('image_url') ?? '',
      badges,
      is_available: bool(formData.get('is_available')),
      is_visible: bool(formData.get('is_visible')),
    });
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const supabase = await createServerSupabase();
    const payload = {
      name: parsed.data.name,
      description: parsed.data.description || null,
      category_id: parsed.data.category_id,
      base_price: parsed.data.base_price,
      compare_at_price:
        parsed.data.compare_at_price === '' || parsed.data.compare_at_price === undefined
          ? null
          : Number(parsed.data.compare_at_price),
      image_url: parsed.data.image_url || null,
      badges: parsed.data.badges,
      is_available: parsed.data.is_available,
      is_visible: parsed.data.is_visible,
    };

    let savedId = id;
    if (id) {
      const { error } = await supabase.from('products').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      await assertWithinLimit(restaurantId, 'products');
      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', parsed.data.category_id);
      const { data: created, error } = await supabase
        .from('products')
        .insert({ ...payload, restaurant_id: restaurantId, position: count ?? 0 })
        .select('id')
        .single();
      if (error) throw error;
      savedId = created.id;
    }

    refresh(['/dashboard/products']);
    refreshMenu(current.slug);
    return { ok: true, id: savedId ?? undefined };
  });
}

export async function deleteProductAction(restaurantId: string, id: string): Promise<ActionState> {
  return run(async () => {
    const current = await assertCanManage(restaurantId);
    const supabase = await createServerSupabase();
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
    refresh(['/dashboard/products']);
    refreshMenu(current.slug);
    return OK;
  });
}

/** تبديل التوفر بنقرة — أكثر عملية يستخدمها صاحب المطعم يومياً. */
export async function toggleProductAction(
  restaurantId: string,
  id: string,
  field: 'is_available' | 'is_visible',
  value: boolean,
): Promise<ActionState> {
  return run(async () => {
    const current = await assertCanManage(restaurantId);
    const supabase = await createServerSupabase();
    const { error } = await supabase.from('products').update({ [field]: value }).eq('id', id);
    if (error) throw error;
    refresh(['/dashboard/products']);
    refreshMenu(current.slug);
    return OK;
  });
}

export async function toggleCategoryAction(
  restaurantId: string,
  id: string,
  value: boolean,
): Promise<ActionState> {
  return run(async () => {
    const current = await assertCanManage(restaurantId);
    const supabase = await createServerSupabase();
    const { error } = await supabase.from('categories').update({ is_visible: value }).eq('id', id);
    if (error) throw error;
    refresh(['/dashboard/categories']);
    refreshMenu(current.slug);
    return OK;
  });
}

/* ── الأحجام والإضافات ──────────────────────────────────────────────────── */

export async function saveVariantsAction(
  restaurantId: string,
  productId: string,
  variants: { id?: string; name: string; price: number; is_available: boolean }[],
): Promise<ActionState> {
  return run(async () => {
    const current = await assertCanManage(restaurantId);
    for (const variant of variants) {
      const parsed = variantSchema.safeParse(variant);
      if (!parsed.success) return { error: 'تحقّق من أسماء الأحجام وأسعارها.' };
    }

    const supabase = await createServerSupabase();
    const { error: deleteError } = await supabase.from('product_variants').delete().eq('product_id', productId);
    if (deleteError) throw deleteError;

    if (variants.length > 0) {
      const { error } = await supabase.from('product_variants').insert(
        variants.map((variant, position) => ({
          product_id: productId,
          restaurant_id: restaurantId,
          name: variant.name.trim(),
          price: variant.price,
          is_available: variant.is_available,
          position,
        })),
      );
      if (error) throw error;
    }

    refresh(['/dashboard/products']);
    refreshMenu(current.slug);
    return OK;
  });
}

export async function saveOptionGroupsAction(
  restaurantId: string,
  productId: string,
  groups: {
    name: string;
    min_select: number;
    max_select: number;
    options: { name: string; price_delta: number; is_available: boolean }[];
  }[],
): Promise<ActionState> {
  return run(async () => {
    const current = await assertCanManage(restaurantId);

    for (const group of groups) {
      const parsedGroup = optionGroupSchema.safeParse(group);
      if (!parsedGroup.success) return { error: 'تحقّق من بيانات مجموعات الإضافات.' };
      for (const option of group.options) {
        const parsedOption = optionSchema.safeParse(option);
        if (!parsedOption.success) return { error: 'تحقّق من أسماء الإضافات وأسعارها.' };
      }
    }

    const supabase = await createServerSupabase();
    const { error: deleteError } = await supabase.from('option_groups').delete().eq('product_id', productId);
    if (deleteError) throw deleteError;

    for (const [position, group] of groups.entries()) {
      const { data: created, error } = await supabase
        .from('option_groups')
        .insert({
          product_id: productId,
          restaurant_id: restaurantId,
          name: group.name.trim(),
          min_select: group.min_select,
          max_select: group.max_select,
          position,
        })
        .select('id')
        .single();
      if (error) throw error;

      if (group.options.length > 0) {
        const { error: optionsError } = await supabase.from('options').insert(
          group.options.map((option, index) => ({
            group_id: created.id,
            restaurant_id: restaurantId,
            name: option.name.trim(),
            price_delta: option.price_delta,
            is_available: option.is_available,
            position: index,
          })),
        );
        if (optionsError) throw optionsError;
      }
    }

    refresh(['/dashboard/products']);
    refreshMenu(current.slug);
    return OK;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   العروض
   ══════════════════════════════════════════════════════════════════════════ */

export async function saveOfferAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const restaurantId = String(formData.get('restaurant_id') ?? '');
    const id = text(formData.get('id'));
    const current = await assertCanManage(restaurantId);

    const parsed = offerSchema.safeParse({
      title: formData.get('title'),
      description: formData.get('description') ?? '',
      badge_text: formData.get('badge_text') ?? '',
      image_url: formData.get('image_url') ?? '',
      is_active: bool(formData.get('is_active')),
    });
    if (!parsed.success) return { fields: fieldErrors(parsed.error) };

    const supabase = await createServerSupabase();
    const payload = {
      title: parsed.data.title,
      description: parsed.data.description || null,
      badge_text: parsed.data.badge_text || null,
      image_url: parsed.data.image_url || null,
      is_active: parsed.data.is_active,
    };

    if (id) {
      const { error } = await supabase.from('offers').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { count } = await supabase
        .from('offers')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId);
      const { error } = await supabase
        .from('offers')
        .insert({ ...payload, restaurant_id: restaurantId, position: count ?? 0 });
      if (error) throw error;
    }

    refresh(['/dashboard/offers']);
    refreshMenu(current.slug);
    return OK;
  });
}

export async function deleteOfferAction(restaurantId: string, id: string): Promise<ActionState> {
  return run(async () => {
    const current = await assertCanManage(restaurantId);
    const supabase = await createServerSupabase();
    const { error } = await supabase.from('offers').delete().eq('id', id);
    if (error) throw error;
    refresh(['/dashboard/offers']);
    refreshMenu(current.slug);
    return OK;
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   الشكاوى
   ══════════════════════════════════════════════════════════════════════════ */

export async function updateComplaintStatusAction(
  restaurantId: string,
  id: string,
  status: string,
): Promise<ActionState> {
  return run(async () => {
    await assertCanManage(restaurantId);
    const parsed = complaintStatusSchema.safeParse({ id, status });
    if (!parsed.success) return { error: 'حالة غير معروفة.' };

    const supabase = await createServerSupabase();
    const { error } = await supabase
      .from('complaints')
      .update({ status: parsed.data.status, is_read: true })
      .eq('id', id);
    if (error) throw error;

    refresh(['/dashboard/complaints']);
    return OK;
  });
}

export async function markComplaintsReadAction(restaurantId: string): Promise<ActionState> {
  return run(async () => {
    await assertCanManage(restaurantId);
    const supabase = await createServerSupabase();
    const { error } = await supabase
      .from('complaints')
      .update({ is_read: true })
      .eq('restaurant_id', restaurantId)
      .eq('is_read', false);
    if (error) throw error;
    refresh(['/dashboard/complaints']);
    return OK;
  });
}
