import { Phone, MessageCircle, MapPin } from 'lucide-react';

/**
 * معاينة المنيو داخل إطار هاتف — تُبنى بـ CSS لا بصورة، فتبقى حادّة على كل
 * كثافة شاشة، وتستجيب للوضع الليلي، ولا تضيف أي كيلوبايت إلى التحميل.
 */
export function PhonePreview() {
  return (
    <div className="relative mx-auto w-[16.5rem] sm:w-[18rem]" aria-hidden>
      <div className="absolute -inset-8 -z-10 rounded-full bg-primary/15 blur-3xl" />

      <div className="rounded-[2.5rem] border-[10px] border-[#241f1b] bg-[#241f1b] shadow-xl">
        <div className="relative overflow-hidden rounded-[1.9rem] bg-surface">
          <div className="absolute inset-x-0 top-0 z-10 flex justify-center">
            <span className="mt-1.5 h-4 w-20 rounded-full bg-[#241f1b]" />
          </div>

          {/* الغلاف والشعار */}
          <div className="relative h-28 bg-gradient-to-br from-[#14503F] via-[#1F6F5C] to-[#C89A4A]">
            <div className="absolute -bottom-6 start-4 grid size-14 place-items-center rounded-2xl border-4 border-surface bg-[#14503F]">
              <span className="text-lg font-bold text-[#C89A4A]">ذ</span>
            </div>
          </div>

          <div className="px-4 pb-4 pt-8">
            <p className="text-[0.9rem] font-bold text-text">مطعم الذوق</p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-success" />
              <span className="text-[0.625rem] text-muted">مفتوح الآن · يغلق 01:00</span>
            </div>

            <div className="mt-3 flex gap-1.5">
              {[Phone, MessageCircle, MapPin].map((Icon, index) => (
                <span
                  key={index}
                  className="grid h-7 flex-1 place-items-center rounded-lg bg-surface-2 text-muted"
                >
                  <Icon className="size-3.5" />
                </span>
              ))}
            </div>

            <div className="scroll-x mt-3 flex gap-1.5">
              {['الكل', 'البرجر', 'البيتزا', 'المشاوي'].map((label, index) => (
                <span
                  key={label}
                  className={
                    'shrink-0 rounded-full px-2.5 py-1 text-[0.625rem] font-medium ' +
                    (index === 1 ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted')
                  }
                >
                  {label}
                </span>
              ))}
            </div>

            <div className="mt-3 space-y-2">
              {[
                { name: 'برجر الذوق الخاص', price: '28', old: '34', tag: 'الأكثر طلباً' },
                { name: 'برجر الدجاج المقرمش', price: '24', old: null, tag: 'جديد' },
                { name: 'برجر حار', price: '29', old: null, tag: null },
              ].map((product) => (
                <div
                  key={product.name}
                  className="flex items-center gap-2.5 rounded-xl border border-border bg-surface p-2"
                >
                  <div className="size-11 shrink-0 rounded-lg bg-gradient-to-br from-[#F6C177] to-[#E8873B]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.6875rem] font-semibold text-text">{product.name}</p>
                    {product.tag && (
                      <span className="mt-0.5 inline-block rounded-full bg-accent-soft px-1.5 py-px text-[0.5625rem] font-medium text-accent">
                        {product.tag}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 text-end">
                    {product.old && (
                      <p className="nums text-[0.5625rem] text-subtle line-through">{product.old}</p>
                    )}
                    <p className="nums text-[0.6875rem] font-bold text-primary">{product.price} د.ل</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
