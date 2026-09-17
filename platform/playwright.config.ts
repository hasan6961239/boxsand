import { defineConfig, devices } from '@playwright/test';

/**
 * اختبارات المسارات الحرجة.
 *
 * تعمل على بناء إنتاجي حقيقي لا على خادم تطوير، لأن ما نريد اختباره هو ما
 * سيراه الزبون فعلاً. الاختبارات التي تحتاج قاعدة بيانات تتخطّى نفسها بوضوح
 * حين تكون متغيّرات Supabase غائبة، بدل أن تفشل فشلاً مضلّلاً.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3210',
    locale: 'ar-LY',
    timezoneId: 'Africa/Tripoli',
    trace: 'on-first-retry',
    // بيئات كثيرة (منها صور CI) تأتي بمتصفح مثبَّت مسبقاً بنسخة مختلفة عن
    // التي تتوقعها Playwright. هذا المنفذ يستخدمه بدل تنزيل نسخة ثانية.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },

  projects: [
    // Pixel 5 يعمل على Chromium: شاشة هاتف حقيقية بلمس، بلا اشتراط تثبيت
    // WebKit. لتغطية Safari فعلياً: npx playwright install webkit ثم أضف
    // مشروعاً بـ devices['iPhone 13'].
    { name: 'هاتف', use: { ...devices['Pixel 5'] } },
    { name: 'سطح مكتب', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npx next start -p 3210 -H 127.0.0.1',
        url: 'http://127.0.0.1:3210',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
