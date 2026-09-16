import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * عنوان الزائر من رؤوس الوكيل.
 *
 * على Netlify يصل الطلب عبر وسيط، فـ request.ip غير موجود. نأخذ أول عنوان في
 * x-forwarded-for لأنه الأقرب إلى العميل.
 */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-nf-client-connection-ip') ?? request.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * بصمة زائر يومية غير قابلة للعكس.
 *
 * تدخل فيها: العنوان + متصفحه + ملح سري + تاريخ اليوم. تغيّر التاريخ يبطل
 * البصمة كل منتصف ليل، فلا يمكن تتبّع زائر عبر الأيام حتى من داخل قاعدة
 * البيانات. ولا نضع كوكيز إطلاقاً.
 */
export function visitorHash(request: NextRequest, scope: string): string {
  const salt = process.env.ANALYTICS_SALT ?? 'sufra-dev-salt';
  const day = new Date().toISOString().slice(0, 10);
  const agent = request.headers.get('user-agent') ?? '';
  return createHash('sha256')
    .update(`${salt}|${day}|${scope}|${clientIp(request)}|${agent}`)
    .digest('hex')
    .slice(0, 32);
}

/** مفتاح تحديد المعدل — مجزّأ أيضاً، فلا يُخزَّن أي عنوان. */
export function rateLimitKey(request: NextRequest, purpose: string): string {
  const salt = process.env.ANALYTICS_SALT ?? 'sufra-dev-salt';
  return createHash('sha256')
    .update(`${salt}|rl|${purpose}|${clientIp(request)}`)
    .digest('hex')
    .slice(0, 40);
}
