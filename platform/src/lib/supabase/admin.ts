import { createClient } from '@supabase/supabase-js';

/**
 * عميل بمفتاح الخدمة — يتجاوز كل سياسات RLS.
 *
 * لا يُستعمل إلا حيث يستحيل غيره: إدراج شكوى من زائر غير مسجَّل، وتسجيل
 * الإحصائيات. كل ما عداه يمرّ بهوية المستخدم لتبقى قاعدة البيانات هي الحَكَم.
 */
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('عميل مفتاح الخدمة لا يُستدعى من المتصفح إطلاقاً.');
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY غير مضبوط.');

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
