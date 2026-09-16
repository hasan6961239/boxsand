import type { Metadata } from 'next';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { ResendVerification } from './resend';

export const metadata: Metadata = { title: 'فعّل بريدك الإلكتروني' };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div className="text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
        <MailCheck className="size-7" aria-hidden />
      </div>

      <h1 className="mt-5 text-2xl font-bold text-text">فعّل بريدك الإلكتروني</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        أرسلنا رابط تفعيل إلى{' '}
        {email ? <span className="nums font-medium text-text">{email}</span> : 'بريدك الإلكتروني'}.
        افتح الرابط لتفعيل حسابك والدخول إلى لوحة التحكم.
      </p>
      <p className="mt-3 text-xs text-subtle">
        لم تصلك الرسالة؟ تحقق من مجلد البريد المزعج، أو أعد الإرسال.
      </p>

      {email && <ResendVerification email={email} />}

      <p className="mt-6 text-sm text-muted">
        <Link href="/login" className="font-medium text-primary hover:underline">
          العودة لتسجيل الدخول
        </Link>
      </p>
    </div>
  );
}
