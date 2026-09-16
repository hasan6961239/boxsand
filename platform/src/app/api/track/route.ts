import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { visitorHash, rateLimitKey } from '@/lib/request';

/**
 * تسجيل مشاهدة منيو أو صنف.
 *
 * يعمل بمفتاح الخدمة لأن الزائر لا يملك — عن قصد — صلاحية الكتابة في جداول
 * الإحصائيات: لو ملكها لأمكن لأي شخص تضخيم أرقام أي مطعم من المتصفح مباشرة.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { restaurantId?: string; productId?: string };
    const restaurantId = body.restaurantId;

    if (!restaurantId || !/^[0-9a-f-]{36}$/i.test(restaurantId)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const supabase = createAdminClient();

    // سقف سخيّ: يمنع حلقة تُطلق آلاف الطلبات، ولا يزعج زائراً يتصفّح بنشاط
    const { data: allowed } = await supabase.rpc('hit_rate_limit', {
      p_key: rateLimitKey(request, 'track'),
      p_max: 240,
      p_window_seconds: 3600,
    });
    if (allowed === false) return NextResponse.json({ ok: true });

    if (body.productId && /^[0-9a-f-]{36}$/i.test(body.productId)) {
      await supabase.rpc('record_product_view', {
        p_restaurant_id: restaurantId,
        p_product_id: body.productId,
      });
    } else {
      await supabase.rpc('record_menu_view', {
        p_restaurant_id: restaurantId,
        p_visitor_hash: visitorHash(request, restaurantId),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    // فشل التتبّع لا يجوز أن يظهر للزبون ولا أن يكسر الصفحة
    console.error('[سُفرة] تتبّع المشاهدات:', error);
    return NextResponse.json({ ok: true });
  }
}
