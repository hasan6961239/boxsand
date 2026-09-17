'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { siteUrl } from '@/lib/config';
import { translateAuthError, GENERIC_ERROR } from '@/lib/errors';
import {
  loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema,
  fieldErrors, type FieldErrors,
} from '@/lib/validation';

export interface FormState {
  error?: string;
  fields?: FieldErrors;
  success?: string;
}

/**
 * رسالة واضحة حين تكون المنصة منشورة بلا قاعدة بيانات.
 *
 * بدونها يصطدم النموذج بخطأ من مكتبة Supabase فيرى المستخدم «حدث خطأ غير
 * متوقع» — وهي رسالة لا تدلّ صاحب المنصة على أن المتغيّرات ناقصة.
 */
const NOT_CONFIGURED =
  'المنصة غير مربوطة بقاعدة البيانات بعد. إن كنت مالك المنصة: أضف متغيّرات Supabase في إعدادات النشر ثم أعد النشر.';

function configurationError(): FormState | null {
  return isSupabaseConfigured() ? null : { error: NOT_CONFIGURED };
}

/** يمنع فتح تحويل إلى موقع خارجي عبر ?next= — ثغرة تصيّد كلاسيكية. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const unconfigured = configurationError();
  if (unconfigured) return unconfigured;

  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { fields: fieldErrors(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: translateAuthError(error.message) };

  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('role, is_blocked').eq('id', user.id).maybeSingle();
    if (profile?.is_blocked) {
      await supabase.auth.signOut();
      return { error: 'هذا الحساب موقوف. تواصل مع إدارة المنصة.' };
    }
    if (profile?.role === 'super_admin') redirect('/admin');
  }

  revalidatePath('/', 'layout');
  redirect(safeNext(formData.get('next')));
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const unconfigured = configurationError();
  if (unconfigured) return unconfigured;

  const parsed = registerSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    password: formData.get('password'),
    restaurantName: formData.get('restaurantName'),
  });
  if (!parsed.success) return { fields: fieldErrors(parsed.error) };

  const supabase = await createServerSupabase();

  // التسجيل قد يكون مغلقاً من لوحة الأدمن حين يُباع النظام يدوياً.
  const { data: settings } = await supabase.from('platform_settings').select('allow_signup').maybeSingle();
  if (settings && settings.allow_signup === false) {
    return { error: 'التسجيل الذاتي مغلق حالياً. تواصل معنا لفتح حساب لمطعمك.' };
  }

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback?next=/dashboard`,
      data: {
        full_name: parsed.data.fullName,
        phone: parsed.data.phone,
        // يُقرأ في معالج الإعداد لإنشاء المطعم بعد تفعيل البريد
        restaurant_name: parsed.data.restaurantName,
      },
    },
  });
  if (error) return { error: translateAuthError(error.message) };

  // جلسة فورية تعني أن تأكيد البريد معطّل في إعدادات Supabase
  if (data.session) {
    revalidatePath('/', 'layout');
    redirect('/dashboard');
  }

  redirect(`/verify?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function forgotPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const unconfigured = configurationError();
  if (unconfigured) return unconfigured;

  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) return { fields: fieldErrors(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
  });

  // لا نكشف إن كان البريد مسجّلاً أم لا — وإلا صار النموذج أداة لجرد الحسابات.
  if (error) console.error('[سُفرة] استعادة كلمة المرور:', error.message);
  return { success: 'إن كان هذا البريد مسجّلاً لدينا، فقد أُرسل إليه رابط إعادة التعيين.' };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const unconfigured = configurationError();
  if (unconfigured) return unconfigured;

  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) return { fields: fieldErrors(parsed.error) };

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'انتهت صلاحية رابط إعادة التعيين. اطلب رابطاً جديداً.' };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: translateAuthError(error.message) };

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function logoutAction() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/');
}

export async function resendVerificationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const unconfigured = configurationError();
  if (unconfigured) return unconfigured;

  const email = String(formData.get('email') ?? '');
  if (!email) return { error: GENERIC_ERROR };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${siteUrl()}/auth/callback?next=/dashboard` },
  });
  if (error) return { error: translateAuthError(error.message) };
  return { success: 'أُرسلت رسالة تفعيل جديدة.' };
}
