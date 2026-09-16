/**
 * هل إعدادات Supabase موجودة؟
 *
 * البناء على Netlify يجري أحياناً قبل ضبط المتغيرات؛ نفحصها بدل أن ينهار
 * البناء برسالة غامضة، ونُظهر للمستخدم صفحة إعداد واضحة.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
