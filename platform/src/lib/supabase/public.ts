import { createClient } from '@supabase/supabase-js';

/**
 * عميل عام بلا جلسة — لصفحة المنيو.
 *
 * تجنّب قراءة الكوكيز مقصود: أي استدعاء لـ cookies يجعل الصفحة ديناميكية
 * فتُصيَّر عند كل زيارة. المنيو محتوى عام يُقرأ آلاف المرات ولا يتغيّر إلا
 * حين يعدّله صاحب المطعم، فيُخزَّن مؤقتاً ويُجدَّد عند الحفظ.
 */
export function createPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
