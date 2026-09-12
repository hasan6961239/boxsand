'use strict';
/** يولّد صور التسويق (منشورات فيسبوك وواتساب) من قوالب HTML */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'sales-kit', 'social');
const FONTS_FILE = path.join(ROOT, 'assets', 'fonts.css');
if (!fs.existsSync(FONTS_FILE)) {
  console.error('الخطوط غير موجودة. شغّل أولاً:  node scripts/fetch-fonts.js');
  process.exit(1);
}
const FONTS = fs.readFileSync(FONTS_FILE, 'utf8');

const BASE = `
${FONTS}
*{box-sizing:border-box;margin:0;padding:0}
body{direction:rtl;font-family:'IBM Plex Sans Arabic',sans-serif;background:#FBFAF6;color:#0C2B27}
.card{width:1080px;display:flex;flex-direction:column;overflow:hidden;position:relative}
.sq{height:1080px}
.tall{height:1350px}
.pad{padding:74px 70px}
.d{font-family:'Readex Pro',sans-serif;font-weight:700}
.num{font-variant-numeric:tabular-nums}
.eyebrow{font-size:26px;font-weight:600;letter-spacing:.10em;color:#6E817C}
.brand{
  margin-top:auto;background:#08453A;color:#EAF3F0;padding:30px 70px;
  display:flex;align-items:center;gap:20px;font-size:29px
}
.brand .mk{width:60px;height:60px;border-radius:17px;background:#0E6E5C;display:grid;place-items:center;
  font-family:'Readex Pro',sans-serif;font-weight:700;font-size:30px;color:#fff}
.brand b{font-family:'Readex Pro',sans-serif;font-weight:600}
.brand .u{margin-right:auto;font-size:25px;opacity:.75}
.tick{color:#0E6E5C;font-weight:700}
`;

const PAGES = [
  {
    name: 'fb-01-الرقم',
    cls: 'sq',
    html: `
<div class="pad" style="flex:1;display:flex;flex-direction:column;justify-content:center">
  <div class="eyebrow">أول شاشة تفتحها في صيدليتك</div>
  <div class="d num" style="font-size:168px;line-height:1.05;color:#0E6E5C;margin-top:20px;white-space:nowrap">8,107<span style="font-size:66px;margin-right:14px">د.ل</span></div>
  <div class="d" style="font-size:46px;font-weight:600;line-height:1.35;margin-top:16px;max-width:900px">
    قيمة أدوية تنتهي صلاحيتها خلال 90 يوم
  </div>
  <div style="margin-top:30px;background:#FBF0DF;border-right:9px solid #A85F10;padding:26px 30px;border-radius:14px;max-width:900px">
    <div style="font-size:34px;color:#A85F10;font-weight:600;line-height:1.5">
      المنظومة لقتها قبل ما تتحوّل إلى خسارة
    </div>
  </div>
  <div style="display:flex;gap:40px;margin-top:44px;font-size:30px;font-weight:600">
    <span><span class="tick">✓</span> صلاحية كل دفعة</span>
    <span><span class="tick">✓</span> بدون إنترنت</span>
    <span><span class="tick">✓</span> عربية بالكامل</span>
  </div>
</div>`
  },
  {
    name: 'fb-02-التسريبات',
    cls: 'sq',
    html: `
<div class="pad" style="flex:1;display:flex;flex-direction:column">
  <div class="eyebrow">لكل صاحب صيدلية</div>
  <div class="d" style="font-size:60px;line-height:1.22;margin-top:16px">
    4 أماكن تتسرّب منها<br>أرباح صيدليتك
  </div>
  <div style="display:flex;flex-direction:column;gap:16px;margin-top:34px">
    ${[
      ['#A3281E', 'دواء ينتهي في آخر الرف', 'ما تكتشفه إلا لما زبون يطلبه — وفات وقت إرجاعه'],
      ['#A85F10', 'صنف يمشي عندك يخلص', 'الزبون يروح للصيدلية المجاورة وما يرجعش'],
      ['#A85F10', 'ديون في دفتر ما حد يقراه', 'الزبون يقول سددت وأنت مش متأكد'],
      ['#D9A441', 'بضاعة راكدة من سنة', 'فلوسك واقفة فيها بدل ما تشتري شيء يمشي']
    ].map(([c, t, s]) => `
    <div style="display:flex;gap:24px;align-items:stretch;background:#fff;border:1px solid #DFD7C4;border-radius:15px;overflow:hidden">
      <div style="width:9px;background:${c};flex:0 0 9px"></div>
      <div style="padding:18px 4px 18px 24px">
        <div class="d" style="font-size:33px;font-weight:600">${t}</div>
        <div style="font-size:25px;color:#3A544F;margin-top:4px">${s}</div>
      </div>
    </div>`).join('')}
  </div>
</div>`
  },
  {
    name: 'wa-03-العرض',
    cls: 'tall',
    html: `
<div class="pad" style="flex:1;display:flex;flex-direction:column;justify-content:center">
  <div class="eyebrow">تعمل بدون إنترنت</div>
  <div class="d" style="font-size:80px;line-height:1.22;margin-top:22px">
    كل علبة عندك<br>برقم دفعتها<br>وتاريخ انتهائها
  </div>
  <div style="font-size:34px;color:#3A544F;line-height:1.7;margin-top:30px;max-width:870px">
    تشتغل على جهاز صيدليتك بدون إنترنت. تنبهك قبل الانتهاء بوقت
    يكفي تبيع فيه البضاعة بدل ما ترميها.
  </div>
  <div style="display:flex;flex-direction:column;gap:17px;margin-top:46px;font-size:33px;font-weight:600">
    <span><span class="tick">✓</span> بيع بالباركود وطباعة فاتورة</span>
    <span><span class="tick">✓</span> تنبيه الصلاحية والنواقص</span>
    <span><span class="tick">✓</span> ديون الزبائن وحساب الموردين</span>
    <span><span class="tick">✓</span> تقارير أرباح وبضاعة راكدة</span>
  </div>
  <div style="margin-top:52px;background:#08453A;color:#EAF3F0;border-radius:18px;padding:36px 40px">
    <div class="d" style="font-size:41px;font-weight:600">دفعة واحدة — بدون اشتراك شهري</div>
    <div style="font-size:30px;opacity:.85;margin-top:9px">التركيب والتدريب داخل السعر · ما تدفعش قبل ما تشوفها شغالة</div>
  </div>
</div>`
  }
];

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await (await browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 })).newPage();

  for (const p of PAGES) {
    const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>${BASE}</style></head>
      <body><div class="card ${p.cls}" id="card">${p.html}
        <div class="brand"><div class="mk">ص</div><b>صيدليتي</b>
          <span class="u">منظومة إدارة الصيدليات</span></div>
      </div></body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(220);
    const fit = await page.evaluate(() => {
      const c = document.getElementById('card');
      return { need: c.scrollHeight, have: c.clientHeight };
    });
    if (fit.need > fit.have + 1) {
      throw new Error(`المحتوى يتجاوز البطاقة في «${p.name}»: يحتاج ${fit.need}px والمتاح ${fit.have}px`);
    }
    const file = path.join(OUT, p.name + '.png');
    await page.locator('#card').screenshot({ path: file });
    console.log('  ✓', p.name + '.png', '—', (fs.statSync(file).size / 1024).toFixed(0), 'KB');
  }
  await browser.close();
  console.log('\n  الصور في: sales-kit/social/\n');
})().catch((e) => { console.error('فشل:', e.message); process.exit(1); });
