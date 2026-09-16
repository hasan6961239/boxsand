/**
 * لا يرى المستخدم رسالة تقنية أبداً. كل خطأ غير متوقع يُسجَّل في سجلّات الخادم
 * ويُعرض للمستخدم نص عربي واضح.
 */
export const GENERIC_ERROR = 'حدث خطأ غير متوقع، يرجى المحاولة مرة أخرى.';

/** خطأ مقصود نعرض رسالته للمستخدم كما هي (تحقق من المدخلات، صلاحيات…). */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export function toUserMessage(error: unknown, context?: string): string {
  if (error instanceof UserFacingError) return error.message;
  console.error(`[سُفرة]${context ? ` ${context}` : ''}`, error);
  return GENERIC_ERROR;
}

/** رسائل Supabase الشائعة بالعربية — الباقي يُخفى خلف الرسالة العامة. */
export function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  if (m.includes('email not confirmed')) return 'لم يتم تفعيل البريد الإلكتروني بعد. راجع صندوق الوارد.';
  if (m.includes('user already registered') || m.includes('already been registered'))
    return 'هذا البريد الإلكتروني مسجّل مسبقاً. جرّب تسجيل الدخول.';
  if (m.includes('password should be')) return 'كلمة المرور قصيرة جداً — استخدم ٨ محارف على الأقل.';
  if (m.includes('rate limit') || m.includes('too many'))
    return 'محاولات كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة.';
  if (m.includes('email address') && m.includes('invalid')) return 'صيغة البريد الإلكتروني غير صحيحة.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled'))
    return 'التسجيل مغلق حالياً. تواصل معنا لفتح حساب.';
  console.error('[سُفرة] مصادقة:', message);
  return GENERIC_ERROR;
}
