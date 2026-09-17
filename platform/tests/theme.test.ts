import { describe, expect, it } from 'vitest';
import {
  THEME_PRESETS, DEFAULT_THEME, mergeTheme, themeToCssVars,
  buildThemeVars, themeIsDark, isLight,
} from '@/lib/theme';

/** نسبة التباين حسب WCAG بين لونين ست عشريين. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const channels = [0, 2, 4].map((offset) => {
      const value = parseInt(hex.replace('#', '').slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('isLight', () => {
  it('يميّز الفاتح من الداكن', () => {
    expect(isLight('#FFFFFF')).toBe(true);
    expect(isLight('#FBF9F6')).toBe(true);
    expect(isLight('#131110')).toBe(false);
    expect(isLight('#1F6F5C')).toBe(false);
  });
});

describe('الثيمات الجاهزة', () => {
  it('نص كل ثيم يقرأ على خلفيته بتباين ٧:١ على الأقل', () => {
    for (const [key, preset] of Object.entries(THEME_PRESETS)) {
      const ratio = contrast(preset.values.text_color, preset.values.background_color);
      expect(ratio, `الثيم ${key}`).toBeGreaterThanOrEqual(7);
    }
  });

  it('نص كل ثيم يقرأ على لون بطاقته أيضاً', () => {
    for (const [key, preset] of Object.entries(THEME_PRESETS)) {
      const ratio = contrast(preset.values.text_color, preset.values.card_color);
      expect(ratio, `الثيم ${key}`).toBeGreaterThanOrEqual(7);
    }
  });

  it('لون الهوية يصلح للنص الثانوي على خلفية الثيم (٣:١ على الأقل)', () => {
    for (const [key, preset] of Object.entries(THEME_PRESETS)) {
      const ratio = contrast(preset.values.primary_color, preset.values.card_color);
      expect(ratio, `الثيم ${key}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('الثيم المعلَن داكناً خلفيته داكنة فعلاً', () => {
    for (const [key, preset] of Object.entries(THEME_PRESETS)) {
      expect(themeIsDark(preset.values), `الثيم ${key}`).toBe(preset.values.default_dark);
    }
  });
});

describe('mergeTheme', () => {
  it('يكمل الناقص من الثيم الافتراضي', () => {
    expect(mergeTheme(null)).toEqual(DEFAULT_THEME);
    expect(mergeTheme({ primary_color: '#FF0000' }).primary_color).toBe('#FF0000');
    expect(mergeTheme({ primary_color: '#FF0000' }).card_color).toBe(DEFAULT_THEME.card_color);
  });
});

describe('themeToCssVars', () => {
  it('يُخرج قنوات RGB لاستعمالها مع الشفافية', () => {
    const vars = themeToCssVars({ ...DEFAULT_THEME, primary_color: '#1F6F5C' });
    expect(vars['--r-primary-rgb']).toBe('31 111 92');
  });

  it('يختار لون النص فوق الهوية حسب سطوعها', () => {
    expect(themeToCssVars({ ...DEFAULT_THEME, primary_color: '#111111' })['--r-primary-fg']).toBe('#FFFFFF');
    expect(themeToCssVars({ ...DEFAULT_THEME, primary_color: '#F5E9C8' })['--r-primary-fg']).toBe('#151210');
  });
});

describe('buildThemeVars — الوضع الليلي مُصمَّم لا معكوس', () => {
  it('يترك لوحة المطعم كما هي حين يوافق الوضعُ سطوعَها', () => {
    const light = THEME_PRESETS.elegant.values;
    expect(buildThemeVars(light, false)['--r-bg']).toBe(light.background_color);

    const dark = THEME_PRESETS.luxury.values;
    expect(buildThemeVars(dark, true)['--r-bg']).toBe(dark.background_color);
  });

  it('يبني نظيراً داكناً على أسطح محايدة لا بعكس الألوان', () => {
    const vars = buildThemeVars(THEME_PRESETS.elegant.values, true);
    expect(isLight(vars['--r-bg']!)).toBe(false);
    // ليس عكساً: خلفية العكس ستكون #04060 9 تقريباً لا رمادياً دافئاً
    expect(vars['--r-bg']).not.toBe('#040609');
    expect(isLight(vars['--r-text']!)).toBe(true);
  });

  it('لون الهوية يبقى مقروءاً على السطح المُولَّد في الوضعين', () => {
    for (const [key, preset] of Object.entries(THEME_PRESETS)) {
      for (const dark of [true, false]) {
        const vars = buildThemeVars(preset.values, dark);
        const ratio = contrast(vars['--r-primary']!, vars['--r-card']!);
        expect(ratio, `${key} / ${dark ? 'ليلي' : 'فاتح'}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('النص يبقى مقروءاً على السطح المُولَّد في الوضعين', () => {
    for (const [key, preset] of Object.entries(THEME_PRESETS)) {
      for (const dark of [true, false]) {
        const vars = buildThemeVars(preset.values, dark);
        const ratio = contrast(vars['--r-text']!, vars['--r-bg']!);
        expect(ratio, `${key} / ${dark ? 'ليلي' : 'فاتح'}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('يحافظ على الصبغة عند التبديل — أخضر يبقى أخضر', () => {
    const vars = buildThemeVars(THEME_PRESETS.elegant.values, true);
    const hex = vars['--r-primary']!.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    expect(g!).toBeGreaterThan(r!);
    expect(g!).toBeGreaterThan(b!);
  });
});
