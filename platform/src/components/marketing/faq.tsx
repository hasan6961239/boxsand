'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

const QUESTIONS = [
  {
    q: 'هل يحتاج الزبون إلى تحميل تطبيق؟',
    a: 'لا. يمسح الزبون رمز QR بكاميرا هاتفه فيفتح المنيو مباشرة في المتصفح. لا تطبيق، ولا تسجيل، ولا انتظار.',
  },
  {
    q: 'إذا غيّرت الأسعار، هل أطبع رمز QR من جديد؟',
    a: 'إطلاقاً. رمز QR يشير إلى رابط ثابت لا يتغير أبداً. أي تعديل تجريه على الأصناف أو الأسعار يظهر للزبون فوراً، والملصقات المطبوعة تبقى صالحة.',
  },
  {
    q: 'هل أحتاج خبرة تقنية لإدارة المنيو؟',
    a: 'لا. لوحة التحكم مصمَّمة لصاحب المطعم لا للمبرمج: تضغط «إضافة صنف»، تكتب الاسم والسعر، ترفع صورة، وتحفظ. وترتيب الأقسام بالسحب والإفلات.',
  },
  {
    q: 'ماذا لو نفد صنف اليوم؟',
    a: 'زر واحد يحوّله إلى «غير متوفر» فيظهر للزبون بشكل باهت أو يختفي حسب إعدادك، ثم تعيده متى شئت دون أن تفقد بياناته.',
  },
  {
    q: 'هل يستطيع مطعم آخر رؤية بياناتي؟',
    a: 'لا. العزل بين المطاعم مفروض داخل قاعدة البيانات نفسها لا في الواجهة فقط، وكل مطعم يرى بياناته وحدها.',
  },
  {
    q: 'هل يمكن أن يكون المنيو بألوان مطعمي؟',
    a: 'نعم. تختار ثيماً جاهزاً أو تضبط الألوان والخط وحجم الاستدارة بنفسك، فيشعر الزبون أنه في موقع مطعمك الخاص.',
  },
  {
    q: 'كيف أعرف رأي الزبائن؟',
    a: 'في نهاية المنيو زر «الشكاوى والاقتراحات». كل رسالة تصل إلى لوحتك برقم وتاريخ وحالة تتابعها حتى الإغلاق.',
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="mx-auto max-w-2xl divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {QUESTIONS.map((item, index) => {
        const expanded = open === index;
        return (
          <div key={item.q}>
            <h3>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : index)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-3 px-5 py-4 text-start transition-colors hover:bg-surface-2"
              >
                <span className="flex-1 text-sm font-semibold text-text">{item.q}</span>
                <ChevronDown
                  className={cn('size-4 shrink-0 text-subtle transition-transform duration-300', expanded && 'rotate-180')}
                  aria-hidden
                />
              </button>
            </h3>
            <div
              className="grid transition-[grid-template-rows] duration-300 ease-out"
              style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden">
                <p className="px-5 pb-4 text-sm leading-relaxed text-muted">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
