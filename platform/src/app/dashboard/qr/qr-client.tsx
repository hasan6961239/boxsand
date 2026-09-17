'use client';

import { useRef, useState } from 'react';
import { Download, Printer, Info, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, CardDescription, PageHeader } from '@/components/ui/primitives';
import { CopyLink } from '@/components/dashboard/copy-link';
import { useToast } from '@/components/ui/toast';

interface Props {
  svg: string;
  target: string;
  menuUrl: string;
  restaurantName: string;
  logoUrl: string | null;
  /** هل عنوان الموقع مضبوط؟ إن لم يكن، الرمز يشير إلى localhost. */
  urlConfigured: boolean;
}

export function QrClient({ svg, target, menuUrl, restaurantName, logoUrl, urlConfigured }: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function downloadSvg() {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    triggerDownload(URL.createObjectURL(blob), `qr-${slugFile(restaurantName)}.svg`);
  }

  /**
   * PNG بدقة ٢٠٤٨ بكسل: كافية لطباعة ملصق A4 بوضوح تام، ولا تنتج ملفاً ثقيلاً.
   * نرسم الـ SVG على canvas بدل استدعاء مكتبة ثانية.
   */
  async function downloadPng() {
    setBusy(true);
    try {
      const size = 2048;
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const image = new window.Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('svg load failed'));
        image.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas unavailable');

      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, size, size);
      context.drawImage(image, 0, 0, size, size);
      URL.revokeObjectURL(url);

      const pngUrl = await new Promise<string>((resolve, reject) =>
        canvas.toBlob((result) => {
          if (result) resolve(URL.createObjectURL(result));
          else reject(new Error('toBlob failed'));
        }, 'image/png'),
      );
      triggerDownload(pngUrl, `qr-${slugFile(restaurantName)}.png`);
    } catch {
      toast.error('تعذّر إنشاء صورة PNG. جرّب تنزيل صيغة SVG.');
    } finally {
      setBusy(false);
    }
  }

  function print() {
    window.print();
  }

  return (
    <>
      <PageHeader
        title="رمز QR"
        description="اطبعه وضعه على الطاولات أو عند المدخل."
      />

      {!urlConfigured && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-3 rounded-xl border border-danger/35 bg-danger-soft px-4 py-3.5 print:hidden"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
          <div className="text-sm">
            <p className="font-bold text-danger">لا تطبع هذا الرمز بعد</p>
            <p className="mt-1 leading-relaxed text-danger/90">
              عنوان الموقع غير مضبوط، فالرمز الحالي يشير إلى عنوان محلي لن يعمل على أي هاتف.
              اضبط <code className="ltr-nums rounded bg-danger/10 px-1">NEXT_PUBLIC_SITE_URL</code> ثم
              أعد نشر الموقع، وحدّث هذه الصفحة قبل الطباعة.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <Card className="flex flex-col items-center print:border-0 print:shadow-none">
          <div
            ref={printRef}
            className="qr-print w-56 rounded-2xl border border-border bg-white p-4"
            // الرمز مولَّد على الخادم بمكتبة QR موثوقة، لا من مدخلات مستخدم
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <p className="mt-3 text-center text-sm font-bold text-text print:text-black">{restaurantName}</p>
          <p className="mt-0.5 text-center text-xs text-muted print:text-black">امسح لعرض المنيو</p>

          <div className="mt-4 flex flex-wrap justify-center gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={downloadSvg} disabled={!urlConfigured}>
              <Download className="size-4" aria-hidden />
              SVG
            </Button>
            <Button variant="outline" size="sm" onClick={downloadPng} loading={busy} loadingText="…" disabled={!urlConfigured}>
              <Download className="size-4" aria-hidden />
              PNG
            </Button>
            <Button variant="outline" size="sm" onClick={print} disabled={!urlConfigured}>
              <Printer className="size-4" aria-hidden />
              طباعة
            </Button>
          </div>
        </Card>

        <div className="space-y-4 print:hidden">
          <Card>
            <CardTitle>رابط المنيو</CardTitle>
            <CardDescription>شاركه في وصف حساباتك أو عبر واتساب.</CardDescription>
            <CopyLink url={menuUrl} className="mt-4" />
          </Card>

          <Card>
            <CardTitle>الرابط الثابت داخل الرمز</CardTitle>
            <CardDescription>
              هذا ما يفتحه الرمز فعلياً، ثم يحوّل إلى منيوك الحالي.
            </CardDescription>
            <CopyLink url={target} className="mt-4" />

            <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-info-soft px-4 py-3">
              <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
              <p className="text-xs leading-relaxed text-info">
                اطبع الرمز مرة واحدة فقط. تستطيع تغيير اسم مطعمك ورابط منيوك وأسعارك
                وأصنافك متى شئت — الرمز المطبوع يبقى صالحاً إلى الأبد.
              </p>
            </div>
          </Card>

          <Card>
            <CardTitle>نصائح الطباعة</CardTitle>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              <li className="flex gap-2"><span className="text-primary" aria-hidden>•</span>لا تطبع الرمز بعرض أقل من ٣ سم، وإلا تعذّر مسحه من مسافة الطاولة.</li>
              <li className="flex gap-2"><span className="text-primary" aria-hidden>•</span>اطبعه أسود على أبيض؛ الألوان الفاتحة تُضعف التباين.</li>
              <li className="flex gap-2"><span className="text-primary" aria-hidden>•</span>اترك حافة بيضاء حوله ولا تضعه على صورة أو نقش.</li>
              <li className="flex gap-2"><span className="text-primary" aria-hidden>•</span>استخدم صيغة SVG عند الطباعة الاحترافية — لا تفقد حدّتها مهما كُبّرت.</li>
              <li className="flex gap-2"><span className="text-primary" aria-hidden>•</span>جرّب مسحه بهاتفك قبل طباعة نسخ كثيرة.</li>
            </ul>
          </Card>

          {logoUrl && (
            <Card>
              <CardTitle>لماذا لا يوجد شعارك داخل الرمز؟</CardTitle>
              <CardDescription>
                إضافة شعار في وسط الرمز تبدو جميلة لكنها تُضعف نسبة القراءة على الهواتف
                القديمة والإضاءة المنخفضة. فضّلنا رمزاً يُمسح من أول مرة دائماً، ووضعنا
                اسم مطعمك تحته بدلاً من ذلك.
              </CardDescription>
            </Card>
          )}
        </div>
      </div>

      {/* الطباعة تُخرج الرمز وحده في منتصف الصفحة */}
      <style>{`
        @media print {
          body { background: #fff !important; }
          aside, header, nav, .print\\:hidden { display: none !important; }
          main { padding: 0 !important; }
          .qr-print { width: 60mm !important; border: none !important; }
        }
      `}</style>
    </>
  );
}

function triggerDownload(url: string, fileName: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** اسم ملف آمن من اسم المطعم العربي. */
function slugFile(name: string): string {
  return name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'menu';
}
