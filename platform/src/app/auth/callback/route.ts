import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * نقطة عودة روابط البريد (تفعيل الحساب، إعادة تعيين كلمة المرور).
 * تبدّل الرمز المؤقت بجلسة ثم تحوّل إلى الوجهة المطلوبة.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const rawNext = searchParams.get('next') ?? '/dashboard';

  // وجهة داخلية فقط — لا تحويل إلى نطاق خارجي
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('[سُفرة] تبديل رمز الجلسة:', error.message);
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
