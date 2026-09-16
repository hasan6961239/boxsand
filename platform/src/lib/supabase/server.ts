import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * عميل الخادم بهوية المستخدم الحالي. يعمل تحت سياسات RLS تماماً كعميل
 * المتصفح — فالخادم هنا ليس امتيازاً، بل مجرد مكان تنفيذ.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(list) {
          try {
            for (const { name, value, options } of list) cookieStore.set(name, value, options);
          } catch {
            // الاستدعاء من Server Component لا يسمح بكتابة الكوكيز؛
            // الـ middleware هو من يجدّد الجلسة، فالتجاهل هنا مقصود.
          }
        },
      },
    },
  );
}
