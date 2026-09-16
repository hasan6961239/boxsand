import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * الرابط الثابت الذي يشير إليه رمز QR المطبوع.
 *
 * يحوّل المعرّف القصير إلى رابط المنيو الحالي. وجود هذه الطبقة هو ما يجعل
 * الملصقات المطبوعة تعمل إلى الأبد: يستطيع صاحب المطعم تغيير اسمه ورابطه
 * ساعة يشاء دون أن يُعيد طباعة شيء.
 *
 * التحويل مؤقت (307) لا دائم: التحويل الدائم يُخزَّن في المتصفح، فلو غيّر
 * المطعم رابطه لاحقاً لظلّ هاتف الزبون يفتح الرابط القديم.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shortId: string }> },
) {
  const { shortId } = await params;
  const origin = request.nextUrl.origin;

  if (!/^[a-z0-9]{4,12}$/i.test(shortId)) {
    return NextResponse.redirect(`${origin}/`, 307);
  }

  try {
    const supabase = await createServerSupabase();
    const { data: slug } = await supabase.rpc('resolve_short_id', { p_short_id: shortId.toLowerCase() });

    if (typeof slug === 'string' && slug) {
      return NextResponse.redirect(`${origin}/menu/${encodeURIComponent(slug)}`, 307);
    }
  } catch (error) {
    console.error('[سُفرة] تحويل رمز QR:', error);
  }

  return NextResponse.redirect(`${origin}/menu/${encodeURIComponent(shortId)}`, 307);
}
