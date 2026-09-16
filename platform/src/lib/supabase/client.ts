'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * عميل المتصفح — يستخدم مفتاح anon العام. كل ما يصل إليه محكوم بسياسات RLS،
 * فتسريبه لا يفتح بيانات أحد.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
