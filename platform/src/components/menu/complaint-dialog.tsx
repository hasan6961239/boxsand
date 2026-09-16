'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X, CheckCircle2, Star, Send } from 'lucide-react';
import { COMPLAINT_TYPES } from '@/lib/config';
import { cn } from '@/lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  restaurantId: string;
  restaurantName: string;
}

export function ComplaintDialog({ open, onClose, restaurantId, restaurantName }: Props) {
  const reduce = useReducedMotion();
  const [type, setType] = useState('complaint');
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');   // حقل شرك للروبوتات
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (message.trim().length < 3) {
      setError('اكتب رسالتك أولاً.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId,
          name: name.trim() || undefined,
          phone: phone.trim() || undefined,
          type,
          rating: rating || undefined,
          message: message.trim(),
          website,
        }),
      });

      const result = (await response.json()) as { ok: boolean; ref?: number; error?: string };
      if (!response.ok || !result.ok) {
        setError(result.error ?? 'تعذّر إرسال الرسالة، حاول مرة أخرى.');
        return;
      }
      setRef(result.ref ?? 0);
    } catch {
      setError('تعذّر الاتصال. تحقّق من الشبكة وحاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setRef(null);
    setMessage('');
    setName('');
    setPhone('');
    setRating(0);
    setType('complaint');
    setError(null);
    onClose();
  }

  const field =
    'w-full border p-3 text-sm outline-none transition-colors placeholder:opacity-50 focus:border-[var(--r-primary)]';
  const fieldStyle = {
    borderRadius: 'calc(var(--r-radius) * 0.65)',
    borderColor: 'rgb(var(--r-text-rgb) / 0.14)',
    backgroundColor: 'rgb(var(--r-text-rgb) / 0.03)',
    color: 'var(--r-text)',
  } as const;

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="الشكاوى والاقتراحات"
        >
          <motion.div
            className="absolute inset-0 bg-black/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={reset}
          />

          <motion.div
            className="relative flex max-h-[92vh] w-full flex-col overflow-hidden sm:max-h-[86vh] sm:max-w-md"
            style={{
              backgroundColor: 'var(--r-card)',
              borderTopLeftRadius: 'calc(var(--r-radius) * 1.4)',
              borderTopRightRadius: 'calc(var(--r-radius) * 1.4)',
            }}
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
          >
            <div
              className="flex shrink-0 items-start gap-3 border-b px-5 py-4"
              style={{ borderColor: 'rgb(var(--r-text-rgb) / 0.1)' }}
            >
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold" style={{ color: 'var(--r-text)' }}>
                  الشكاوى والاقتراحات
                </h2>
                <p className="mt-0.5 text-xs" style={{ color: 'rgb(var(--r-text-rgb) / 0.6)' }}>
                  رسالتك تصل مباشرة إلى إدارة {restaurantName}.
                </p>
              </div>
              <button
                type="button"
                onClick={reset}
                aria-label="إغلاق"
                className="-m-1 rounded-lg p-1.5 transition-opacity hover:opacity-70"
                style={{ color: 'rgb(var(--r-text-rgb) / 0.55)' }}
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            {ref !== null ? (
              <div
                className="px-8 pt-8 text-center"
                style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
              >
                <div
                  className="mx-auto grid size-14 place-items-center rounded-2xl"
                  style={{ backgroundColor: 'rgb(47 158 94 / 0.14)', color: '#2F9E5E' }}
                >
                  <CheckCircle2 className="size-7" aria-hidden />
                </div>
                <p className="mt-4 text-base font-bold" style={{ color: 'var(--r-text)' }}>
                  تم إرسال رسالتك بنجاح
                </p>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'rgb(var(--r-text-rgb) / 0.62)' }}>
                  شكراً لتواصلك معنا.
                  {ref > 0 && (
                    <>
                      {' '}رقم رسالتك <span className="nums font-bold">#{ref}</span>.
                    </>
                  )}
                </p>
                <button
                  type="button"
                  onClick={reset}
                  className="mt-6 w-full px-5 py-3 text-sm font-medium"
                  style={{
                    borderRadius: 'calc(var(--r-radius) * 0.7)',
                    backgroundColor: 'var(--r-primary)',
                    color: 'var(--r-primary-fg)',
                  }}
                >
                  إغلاق
                </button>
              </div>
            ) : (
              <form
                onSubmit={submit}
                className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pt-5"
                style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
              >
                {/* حقل الشرك: مخفي عن الإنسان وعن قارئ الشاشة، تملؤه الروبوتات */}
                <input
                  type="text"
                  name="website"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="absolute -left-[9999px] size-0 opacity-0"
                />

                <div>
                  <p className="mb-2 text-sm font-medium" style={{ color: 'var(--r-text)' }}>
                    نوع الرسالة
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(COMPLAINT_TYPES).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setType(key)}
                        aria-pressed={type === key}
                        className="border py-2.5 text-sm font-medium transition-colors"
                        style={{
                          borderRadius: 'calc(var(--r-radius) * 0.6)',
                          borderColor: type === key ? 'var(--r-primary)' : 'rgb(var(--r-text-rgb) / 0.14)',
                          backgroundColor: type === key ? 'rgb(var(--r-primary-rgb) / 0.1)' : 'transparent',
                          color: type === key ? 'var(--r-primary)' : 'rgb(var(--r-text-rgb) / 0.7)',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium" style={{ color: 'var(--r-text)' }}>
                    تقييمك <span className="text-xs font-normal opacity-60">(اختياري)</span>
                  </p>
                  <div className="flex gap-1" role="radiogroup" aria-label="التقييم من ١ إلى ٥">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={rating === value}
                        aria-label={`${value} من ٥`}
                        onClick={() => setRating(rating === value ? 0 : value)}
                        className="p-1 transition-transform active:scale-90"
                      >
                        <Star
                          className={cn('size-7', value <= rating ? 'fill-current' : '')}
                          style={{
                            color: value <= rating ? 'var(--r-secondary)' : 'rgb(var(--r-text-rgb) / 0.2)',
                          }}
                          aria-hidden
                        />
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="complaint-message" className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--r-text)' }}>
                    رسالتك
                  </label>
                  <textarea
                    id="complaint-message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={4}
                    maxLength={2000}
                    required
                    placeholder="اكتب ملاحظتك أو اقتراحك بالتفصيل…"
                    className={cn(field, 'resize-y')}
                    style={fieldStyle}
                  />
                  <p className="nums mt-1 text-end text-xs" style={{ color: 'rgb(var(--r-text-rgb) / 0.4)' }}>
                    {message.length} / 2000
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="complaint-name" className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--r-text)' }}>
                      اسمك <span className="text-xs font-normal opacity-60">(اختياري)</span>
                    </label>
                    <input
                      id="complaint-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={80}
                      className={field}
                      style={fieldStyle}
                    />
                  </div>
                  <div>
                    <label htmlFor="complaint-phone" className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--r-text)' }}>
                      رقم هاتفك <span className="text-xs font-normal opacity-60">(اختياري)</span>
                    </label>
                    <input
                      id="complaint-phone"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      type="tel"
                      inputMode="tel"
                      dir="ltr"
                      maxLength={20}
                      className={cn(field, 'text-start')}
                      style={fieldStyle}
                    />
                  </div>
                </div>

                {error && (
                  <p
                    role="alert"
                    className="px-3.5 py-2.5 text-sm"
                    style={{
                      borderRadius: 'calc(var(--r-radius) * 0.6)',
                      backgroundColor: 'rgb(196 84 74 / 0.12)',
                      color: '#C4544A',
                    }}
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 px-5 py-3.5 text-sm font-bold transition-opacity disabled:opacity-60"
                  style={{
                    borderRadius: 'calc(var(--r-radius) * 0.7)',
                    backgroundColor: 'var(--r-primary)',
                    color: 'var(--r-primary-fg)',
                  }}
                >
                  <Send className="size-4" aria-hidden />
                  {busy ? 'جارٍ الإرسال…' : 'إرسال'}
                </button>

                <p className="text-center text-xs leading-relaxed" style={{ color: 'rgb(var(--r-text-rgb) / 0.45)' }}>
                  لا نطلب أي بيانات إلزامية، ولا نشارك رسالتك مع أحد غير إدارة المطعم.
                </p>
              </form>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
