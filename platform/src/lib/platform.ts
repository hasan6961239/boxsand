import { createServerSupabase } from './supabase/server';
import { isSupabaseConfigured } from './supabase/env';
import { PLATFORM } from './config';
import type { Plan, PlatformSettings } from '@/types/database';

const FALLBACK: PlatformSettings = {
  id: true,
  platform_name: PLATFORM.name,
  tagline: PLATFORM.tagline,
  logo_url: null,
  primary_color: '#1F6F5C',
  contact_email: null,
  contact_phone: null,
  whatsapp: null,
  social: {},
  seo_title: null,
  seo_description: null,
  allow_signup: true,
  updated_at: new Date().toISOString(),
};

/**
 * إعدادات المنصة من قاعدة البيانات، مع قيم احتياطية.
 *
 * الصفحة الرئيسية يجب أن تُبنى حتى قبل ضبط Supabase (أول نشر على Netlify مثلاً)
 * فلا نُسقط البناء لأن قاعدة البيانات لم تُربط بعد.
 */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  if (!isSupabaseConfigured()) return FALLBACK;
  try {
    const supabase = await createServerSupabase();
    const { data } = await supabase.from('platform_settings').select('*').maybeSingle<PlatformSettings>();
    return data ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export async function getPublicPlans(): Promise<Plan[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createServerSupabase();
    const { data } = await supabase
      .from('plans')
      .select('*')
      .eq('is_public', true)
      .order('position')
      .returns<Plan[]>();
    return data ?? [];
  } catch {
    return [];
  }
}
