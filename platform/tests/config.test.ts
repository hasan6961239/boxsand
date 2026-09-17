import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { siteUrl, isSiteUrlConfigured, CURRENCIES, BADGE_LABELS, WEEKDAYS } from '@/lib/config';

describe('siteUrl', () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.URL;
  });
  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
  });

  it('يفضّل المتغيّر المعلن ويحذف الشرطة الأخيرة', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://sufra.ly/';
    expect(siteUrl()).toBe('https://sufra.ly');
  });

  it('يستعمل عنوان Netlify على الخادم حين يغيب المتغيّر', () => {
    process.env.URL = 'https://sufra.netlify.app';
    expect(siteUrl()).toBe('https://sufra.netlify.app');
  });

  it('يستعمل عنوان الصفحة في المتصفح — فلا تنكسر روابط اللوحة لو نُسي المتغيّر', () => {
    vi.stubGlobal('window', { location: { origin: 'https://sufra.ly' } });
    expect(siteUrl()).toBe('https://sufra.ly');
  });

  it('المتغيّر المعلن يسبق عنوان المتصفح', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://sufra.ly';
    vi.stubGlobal('window', { location: { origin: 'https://preview.netlify.app' } });
    expect(siteUrl()).toBe('https://sufra.ly');
  });

  it('يسقط إلى localhost في التطوير وحده', () => {
    expect(siteUrl()).toBe('http://localhost:3000');
  });
});

describe('isSiteUrlConfigured — حارس طباعة رموز QR', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('يرفض localhost', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    expect(isSiteUrlConfigured()).toBe(false);
  });

  it('يرفض 127.0.0.1', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://127.0.0.1:3000';
    expect(isSiteUrlConfigured()).toBe(false);
  });

  it('يقبل الدومين الحقيقي', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://sufra.ly';
    expect(isSiteUrlConfigured()).toBe(true);
  });
});

describe('ثوابت الواجهة', () => {
  it('العملة الافتراضية هي الدينار الليبي', () => {
    expect(CURRENCIES.LYD?.symbol).toBe('د.ل');
  });

  it('لكل شارة تسمية عربية', () => {
    for (const badge of ['new', 'popular', 'offer', 'spicy', 'vegetarian']) {
      expect(BADGE_LABELS[badge]?.label, badge).toBeTruthy();
    }
  });

  it('أيام الأسبوع سبعة تبدأ بالأحد', () => {
    expect(WEEKDAYS).toHaveLength(7);
    expect(WEEKDAYS[0]).toBe('الأحد');
  });
});

describe('isSupabaseConfigured', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('تعتبر المنصة غير مربوطة حين يغيب أي مفتاح', async () => {
    const { isSupabaseConfigured } = await import('@/lib/supabase/env');
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(isSupabaseConfigured()).toBe(false);

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('تعتبرها مربوطة حين يوجد المفتاحان', async () => {
    const { isSupabaseConfigured } = await import('@/lib/supabase/env');
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    expect(isSupabaseConfigured()).toBe(true);
  });
});
