import { expect, test } from '@playwright/test';

const hasDatabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

test.describe('الصفحة الرئيسية', () => {
  test('تفتح باللغة العربية واتجاه RTL', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('لا يوجد تمرير أفقي', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('تصل إلى التسجيل وتسجيل الدخول', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'أنشئ حسابك' })).toBeVisible();

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  });

  test('رابط تخطّي المحتوى يظهر عند التنقل بلوحة المفاتيح', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'تخطَّ إلى المحتوى' })).toBeFocused();
  });
});

test.describe('الصفحات الفنية', () => {
  test('robots.txt يمنع فهرسة لوحات التحكم', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.ok()).toBeTruthy();
    const body = await response.text();
    expect(body).toContain('/dashboard');
    expect(body).toContain('/admin');
    expect(body).toContain('Sitemap:');
  });

  test('خريطة الموقع صالحة', async ({ request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.ok()).toBeTruthy();
    expect(await response.text()).toContain('<urlset');
  });

  test('ملف التطبيق يصف المنصة بالعربية', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest.lang).toBe('ar');
    expect(manifest.dir).toBe('rtl');
  });

  test('رابط غير موجود يعرض صفحة عربية لا خطأ تقني', async ({ page }) => {
    const response = await page.goto('/la-yujad-abadan');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'الصفحة غير موجودة' })).toBeVisible();
  });
});

test.describe('حراسة الصفحات المحمية', () => {
  test('لوحة التحكم تحوّل الزائر إلى تسجيل الدخول', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('لوحة الإدارة تحوّل الزائر إلى تسجيل الدخول', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });

  test('لا يقبل ?next= تحويلاً إلى موقع خارجي', async ({ page }) => {
    await page.goto('/dashboard');
    // التحويل قد يكتمل في المتصفح بعد أول استجابة، فننتظره بدل قراءة
    // الرابط فوراً
    await expect(page).toHaveURL(/\/login\?next=/);
    const url = new URL(page.url());
    const next = url.searchParams.get('next') ?? '';
    expect(next.startsWith('/')).toBeTruthy();
    expect(next.startsWith('//')).toBeFalsy();
  });
});

test.describe('واجهة الشكاوى', () => {
  test('ترفض الطلب الناقص برسالة عربية لا بخطأ خادم', async ({ request }) => {
    const response = await request.post('/api/complaints', { data: { message: 'مرحبا' } });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe('string');
  });
});

test.describe('المنيو التجريبي', () => {
  test.skip(!hasDatabase, 'يحتاج مشروع Supabase مضبوطاً وبيانات البذور — شغّل npm run db:seed');

  test('يفتح ويعرض الأصناف', async ({ page }) => {
    await page.goto('/menu/demo');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('مطعم الذوق');
    await expect(page.getByRole('heading', { name: 'البرجر' })).toBeVisible();
  });

  test('البحث يُرشّح الأصناف', async ({ page }) => {
    await page.goto('/menu/demo');
    await page.getByRole('button', { name: 'بحث' }).first().click();
    await page.getByRole('searchbox', { name: 'ابحث في المنيو' }).fill('برجر');
    await expect(page.getByText(/نتيجة/)).toBeVisible();
  });

  test('الضغط على صنف يفتح تفاصيله', async ({ page }) => {
    await page.goto('/menu/demo');
    await page.getByRole('button', { name: /برجر الذوق الخاص/ }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('الحجم')).toBeVisible();
  });

  test('رابط QR الثابت يحوّل إلى المنيو', async ({ page }) => {
    await page.goto('/r/thawq7');
    await expect(page).toHaveURL(/\/menu\/demo/);
  });

  test('لا يوجد تمرير أفقي في المنيو', async ({ page }) => {
    await page.goto('/menu/demo');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('صفحة المنيو لا تسرّب أي معرّف مستخدم في مصدرها', async ({ page }) => {
    const response = await page.goto('/menu/demo');
    const html = (await response?.text()) ?? '';
    expect(html).not.toContain('owner_id');
    expect(html).not.toContain('service_role');
  });
});
