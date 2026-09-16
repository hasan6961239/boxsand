import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimitKey } from '@/lib/request';
import { complaintSchema } from '@/lib/validation';
import { GENERIC_ERROR } from '@/lib/errors';

/**
 * استقبال شكوى أو اقتراح من زائر غير مسجَّل.
 *
 * لماذا مسار خادمي بدل إدراج مباشر بصلاحية anon؟ لأن سياسات RLS لا تستطيع
 * تنفيذ تحديد معدل: لو فُتح الإدراج للزائر لأمكن إغراق أي مطعم بآلاف الرسائل
 * عبر REST API مباشرة، متجاوزاً أي حماية في الواجهة.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = complaintSchema.safeParse(body);

    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { ok: false, error: first?.message ?? 'تحقّق من البيانات المدخلة.' },
        { status: 400 },
      );
    }

    // حقل الشرك: لا يراه الإنسان، وتملؤه الروبوتات. نردّ بنجاح ظاهري
    // حتى لا يتعلّم المُرسِل الآلي أن محاولته اكتُشفت.
    if (parsed.data.website) {
      return NextResponse.json({ ok: true, ref: 0 });
    }

    const supabase = createAdminClient();

    const { data: allowed } = await supabase.rpc('hit_rate_limit', {
      p_key: rateLimitKey(request, 'complaint'),
      p_max: 3,
      p_window_seconds: 3600,
    });
    if (allowed === false) {
      return NextResponse.json(
        { ok: false, error: 'أرسلت رسائل كثيرة خلال وقت قصير. حاول بعد قليل.' },
        { status: 429 },
      );
    }

    const { data: ref, error } = await supabase.rpc('submit_complaint', {
      p_restaurant_id: parsed.data.restaurantId,
      p_name: parsed.data.name ?? null,
      p_phone: parsed.data.phone ?? null,
      p_type: parsed.data.type,
      p_rating: parsed.data.rating ?? null,
      p_message: parsed.data.message,
    });

    if (error) {
      if (error.message.includes('لا يستقبل')) {
        return NextResponse.json({ ok: false, error: 'هذا المطعم لا يستقبل الرسائل حالياً.' }, { status: 403 });
      }
      throw error;
    }

    return NextResponse.json({ ok: true, ref });
  } catch (error) {
    console.error('[سُفرة] إرسال شكوى:', error);
    return NextResponse.json({ ok: false, error: GENERIC_ERROR }, { status: 500 });
  }
}
