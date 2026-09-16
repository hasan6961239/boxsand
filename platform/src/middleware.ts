import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * يجدّد جلسة Supabase عند كل طلب، ويمنع الوصول إلى الصفحات المحمية.
 *
 * هذه طبقة راحة لا طبقة أمان: الأمان الحقيقي في سياسات RLS داخل قاعدة
 * البيانات. لو عُطّل هذا الملف تماماً لظهرت الصفحات فارغة، ولم تتسرّب بيانات.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(list) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser لا getSession: الأول يتحقق من التوقيع لدى الخادم، والثاني يثق
  // بالكوكي كما هو.
  const { data: { user } } = await supabase.auth.getUser();
  const { pathname, search } = request.nextUrl;

  const isProtected = pathname.startsWith('/dashboard') || pathname.startsWith('/admin');
  const isAuthPage = ['/login', '/register', '/forgot-password'].includes(pathname);

  if (isProtected && !user) {
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(login);
  }

  if (isAuthPage && user) {
    const dashboard = request.nextUrl.clone();
    dashboard.pathname = '/dashboard';
    dashboard.search = '';
    return NextResponse.redirect(dashboard);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * كل المسارات عدا الأصول الثابتة والصور — لا داعي لاستدعاء Supabase
     * من أجل ملف خط أو أيقونة.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|fonts/|demo/|.*\\.(?:svg|png|jpg|jpeg|webp|avif|woff2)$).*)',
  ],
};
