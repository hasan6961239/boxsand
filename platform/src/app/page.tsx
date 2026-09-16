import Link from 'next/link';
import {
  QrCode, Smartphone, Palette, BarChart3, MessageSquareHeart, Zap,
  ArrowLeft, Check, Store, ListPlus, Share2, Sparkles,
} from 'lucide-react';
import { SiteNav } from '@/components/marketing/site-nav';
import { SiteFooter } from '@/components/marketing/site-footer';
import { PhonePreview } from '@/components/marketing/phone-preview';
import { Faq } from '@/components/marketing/faq';
import { Reveal, Stagger, StaggerItem } from '@/components/reveal';
import { ButtonLink } from '@/components/ui/button';
import { getPlatformSettings, getPublicPlans } from '@/lib/platform';
import { formatPrice } from '@/lib/money';

/*
 * الصفحة الرئيسية ثابتة تُعاد كل خمس دقائق.
 *
 * لهذا لا تقرأ جلسة المستخدم: صفحة مخزَّنة لا تستطيع إظهار حالة دخول صحيحة
 * لكل زائر. وهذا لا يضرّ التجربة — الـ middleware يحوّل من سجّل دخوله من
 * /login إلى لوحته مباشرة.
 */
export const revalidate = 300;

const STEPS = [
  { icon: Store, title: 'أنشئ مطعمك', text: 'اسم المطعم، الشعار، صورة الغلاف، أرقام التواصل وأوقات العمل.' },
  { icon: ListPlus, title: 'أضف الأصناف', text: 'أقسام وأصناف بالصور والأسعار والوصف، وترتيب بالسحب والإفلات.' },
  { icon: QrCode, title: 'احصل على QR', text: 'رمز جاهز للطباعة بجودة عالية، برابط ثابت لا ينكسر أبداً.' },
  { icon: Share2, title: 'شارك مع زبائنك', text: 'ضعه على الطاولات أو الواجهة، ويفتح الزبون المنيو في ثانية.' },
];

const FEATURES = [
  { icon: Smartphone, title: 'مصمَّم للهاتف أولاً', text: 'أغلب زبائنك يفتحون المنيو من الهاتف، فبُني التصميم للهاتف أولاً ثم اتسع للشاشات الكبيرة.' },
  { icon: QrCode, title: 'رمز QR ثابت', text: 'غيّر أسعارك وأصنافك واسم مطعمك متى شئت — الملصقات المطبوعة تبقى صالحة.' },
  { icon: Palette, title: 'بهوية مطعمك', text: 'ستة ثيمات جاهزة وتحكّم كامل في الألوان والخط، فيبدو المنيو موقعاً خاصاً بك لا قالباً عاماً.' },
  { icon: Zap, title: 'سريع بحق', text: 'الصفحة تُبنى على الخادم والصور تُضغط تلقائياً، فيفتح المنيو حتى على شبكة ضعيفة.' },
  { icon: MessageSquareHeart, title: 'اسمع زبائنك', text: 'شكاوى واقتراحات وتقييمات تصل إلى لوحتك برقم وحالة تتابعها حتى الإغلاق.' },
  { icon: BarChart3, title: 'اعرف ما يحدث', text: 'عدد مشاهدات المنيو والأصناف الأكثر طلباً — بلا كوكيز تتبع ولا انتهاك خصوصية.' },
];

export default async function LandingPage() {
  const [settings, plans] = await Promise.all([getPlatformSettings(), getPublicPlans()]);

  return (
    <>
      <SiteNav platformName={settings.platform_name} signedIn={false} />

      <main id="main">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden pt-[calc(var(--header-h)+2.5rem)] pb-16 sm:pb-24">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_75%_0%,var(--primary-soft),transparent_70%)]"
          />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.05fr_0.95fr]">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-muted shadow-xs">
                <Sparkles className="size-3.5 text-accent" aria-hidden />
                منصة المنيو الرقمي للمطاعم
              </span>

              <h1 className="mt-5 text-[2rem] font-extrabold leading-[1.15] text-text sm:text-5xl">
                حوّل منيو مطعمك إلى
                <span className="text-gradient"> تجربة رقمية عصرية</span>
              </h1>

              <p className="mt-5 max-w-lg text-base leading-relaxed text-muted sm:text-lg">
                أنشئ منيو مطعمك الإلكتروني في دقائق، شاركه عبر رمز QR على الطاولات،
                وعدّل أصنافك وأسعارك بنفسك متى شئت — بلا مبرمج وبلا تطبيق يحمّله الزبون.
              </p>

              {/* على الهاتف يمتد الزران بعرض الشاشة: نصّاهما معاً أعرض بقليل من
                  ٣٩٠px فينكسر السطر بشكل غير مقصود ويبدوان مائلين. */}
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <ButtonLink href="/register" size="lg" className="w-full sm:w-auto">
                  ابدأ الآن مجاناً
                  <ArrowLeft className="size-4" aria-hidden />
                </ButtonLink>
                <ButtonLink href="/menu/demo" variant="outline" size="lg" className="w-full sm:w-auto">
                  شاهد منيو تجريبي
                </ButtonLink>
              </div>

              <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
                {['بلا بطاقة ائتمان', 'جاهز خلال دقائق', 'يعمل على كل الهواتف'].map((item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <Check className="size-4 text-success" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal delay={0.12} y={24}>
              <PhonePreview />
            </Reveal>
          </div>
        </section>

        {/* ── كيف يعمل ─────────────────────────────────────────────────── */}
        <section id="how" className="scroll-mt-20 border-y border-border bg-surface-2/40 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal className="text-center">
              <h2 className="text-2xl font-bold text-text sm:text-3xl">كيف يعمل؟</h2>
              <p className="mx-auto mt-3 max-w-lg text-muted">أربع خطوات بينك وبين منيو رقمي على طاولات مطعمك.</p>
            </Reveal>

            <Stagger className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <StaggerItem key={step.title}>
                  <div className="surface-card relative h-full p-6">
                    <span className="nums absolute end-5 top-5 text-3xl font-extrabold text-border-strong">
                      {index + 1}
                    </span>
                    <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
                      <step.icon className="size-5" aria-hidden />
                    </span>
                    <h3 className="mt-4 text-base font-bold text-text">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.text}</p>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {/* ── المزايا ──────────────────────────────────────────────────── */}
        <section id="features" className="scroll-mt-20 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal className="text-center">
              <h2 className="text-2xl font-bold text-text sm:text-3xl">كل ما يحتاجه مطعمك</h2>
              <p className="mx-auto mt-3 max-w-lg text-muted">
                لا مزايا للعرض فقط — كل ما في المنصة مبنيّ على ما يحتاجه صاحب مطعم فعلاً.
              </p>
            </Reveal>

            <Stagger className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <StaggerItem key={feature.title}>
                  <div className="surface-card h-full p-6 transition-shadow duration-300 hover:shadow-md">
                    <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent">
                      <feature.icon className="size-5" aria-hidden />
                    </span>
                    <h3 className="mt-4 text-base font-bold text-text">{feature.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">{feature.text}</p>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
        </section>

        {/* ── المعاينة ─────────────────────────────────────────────────── */}
        <section id="preview" className="scroll-mt-20 border-y border-border bg-surface-2/40 py-16 sm:py-24">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
            <Reveal>
              <h2 className="text-2xl font-bold text-text sm:text-3xl">شاهد ما سيراه زبونك</h2>
              <p className="mt-4 leading-relaxed text-muted">
                افتح المنيو التجريبي على هاتفك تماماً كما يفتحه زبونك بعد مسح رمز QR:
                أقسام تتنقل بينها بلمسة، بحث فوري، صور تُحمَّل عند الحاجة فقط، وتفاصيل كل صنف
                مع أحجامه وإضافاته.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  'يفتح مباشرة في المتصفح بلا تحميل تطبيق',
                  'بحث داخل المنيو وتصفية حسب العروض والأكثر طلباً',
                  'أزرار اتصال وواتساب وخرائط تعمل بلمسة واحدة',
                  'وضع ليلي مريح للعين في الإضاءة المنخفضة',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-text">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
              <ButtonLink href="/menu/demo" size="lg" className="mt-8">
                افتح المنيو التجريبي
                <ArrowLeft className="size-4" aria-hidden />
              </ButtonLink>
            </Reveal>

            <Reveal delay={0.1} y={24}>
              <PhonePreview />
            </Reveal>
          </div>
        </section>

        {/* ── الأسعار ──────────────────────────────────────────────────── */}
        {plans.length > 0 && (
          <section id="pricing" className="scroll-mt-20 py-16 sm:py-24">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <Reveal className="text-center">
                <h2 className="text-2xl font-bold text-text sm:text-3xl">خطط بسيطة وواضحة</h2>
                <p className="mx-auto mt-3 max-w-lg text-muted">ابدأ مجاناً، وارتقِ حين يكبر مطعمك.</p>
              </Reveal>

              <Stagger className="mt-12 grid gap-5 md:grid-cols-3">
                {plans.map((plan, index) => {
                  const featured = index === 1;
                  return (
                    <StaggerItem key={plan.id}>
                      <div
                        className={
                          'surface-card relative flex h-full flex-col p-6 ' +
                          (featured ? 'border-primary/40 shadow-lg ring-1 ring-primary/15' : '')
                        }
                      >
                        {featured && (
                          <span className="absolute -top-3 start-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-fg rtl:translate-x-1/2">
                            الأكثر ملاءمة
                          </span>
                        )}
                        <h3 className="text-lg font-bold text-text">{plan.name}</h3>
                        {plan.description && <p className="mt-1 text-sm text-muted">{plan.description}</p>}

                        <p className="mt-5">
                          {plan.price_monthly !== null ? (
                            <>
                              <span className="nums text-3xl font-extrabold text-text">
                                {formatPrice(plan.price_monthly, plan.currency)}
                              </span>
                              <span className="text-sm text-muted"> / شهرياً</span>
                            </>
                          ) : (
                            <span className="text-xl font-bold text-text">تواصل معنا</span>
                          )}
                        </p>

                        <ul className="mt-6 flex-1 space-y-2.5">
                          {(plan.features ?? []).map((feature) => (
                            <li key={feature} className="flex items-start gap-2.5 text-sm text-muted">
                              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                              {feature}
                            </li>
                          ))}
                        </ul>

                        <ButtonLink
                          href="/register"
                          variant={featured ? 'primary' : 'outline'}
                          className="mt-7 w-full"
                        >
                          {plan.price_monthly === 0 ? 'ابدأ مجاناً' : 'اختر هذه الخطة'}
                        </ButtonLink>
                      </div>
                    </StaggerItem>
                  );
                })}
              </Stagger>

              <p className="mt-6 text-center text-xs text-subtle">
                الأسعار قابلة للتعديل من لوحة إدارة المنصة. لا تُخصم أي مبالغ آلياً في الوقت الحالي.
              </p>
            </div>
          </section>
        )}

        {/* ── الأسئلة ──────────────────────────────────────────────────── */}
        <section id="faq" className="scroll-mt-20 border-t border-border bg-surface-2/40 py-16 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal className="text-center">
              <h2 className="text-2xl font-bold text-text sm:text-3xl">أسئلة شائعة</h2>
              <p className="mx-auto mt-3 max-w-lg text-muted">أكثر ما يسأل عنه أصحاب المطاعم قبل البدء.</p>
            </Reveal>
            <Reveal delay={0.08} className="mt-10">
              <Faq />
            </Reveal>
          </div>
        </section>

        {/* ── الدعوة الأخيرة ───────────────────────────────────────────── */}
        <section className="py-16 sm:py-24">
          <div className="mx-auto max-w-4xl px-4 sm:px-6">
            <Reveal>
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#14503F] via-[#1F6F5C] to-[#2A8C74] px-6 py-14 text-center shadow-xl sm:px-12">
                <div aria-hidden className="absolute -end-16 -top-16 size-56 rounded-full bg-white/10" />
                <div aria-hidden className="absolute -bottom-20 -start-10 size-64 rounded-full bg-black/10" />
                <h2 className="relative text-2xl font-bold text-white sm:text-3xl">
                  منيو مطعمك جاهز خلال دقائق
                </h2>
                <p className="relative mx-auto mt-3 max-w-lg text-white/85">
                  أنشئ حسابك، أضف أول قسم وأول صنف، وحمّل رمز QR — كل ذلك في جلسة واحدة.
                </p>
                <div className="relative mt-8 flex flex-wrap justify-center gap-3">
                  <ButtonLink href="/register" size="lg" className="bg-white text-[#14503F] hover:bg-white/90">
                    أنشئ حسابك الآن
                  </ButtonLink>
                  <Link
                    href="/menu/demo"
                    className="inline-flex h-[3.25rem] items-center rounded-xl border border-white/35 px-7 text-base font-medium text-white transition-colors hover:bg-white/10"
                  >
                    معاينة المنيو
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <SiteFooter settings={settings} />
    </>
  );
}
