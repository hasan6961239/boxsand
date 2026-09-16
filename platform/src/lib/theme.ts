import type { RestaurantTheme, ThemePreset } from '@/types/database';

export type ThemeValues = Omit<RestaurantTheme, 'restaurant_id' | 'updated_at'>;

/**
 * الثيمات الجاهزة.
 *
 * كل ثيم مضبوط يدوياً لا مولَّد آلياً: التباين بين النص والخلفية مفحوص، ولون
 * البطاقة مختلف عن الخلفية بما يكفي لتُرى حوافها بلا حدود صارخة.
 */
export const THEME_PRESETS: Record<ThemePreset, { label: string; description: string; values: ThemeValues }> = {
  elegant: {
    label: 'أنيق',
    description: 'أخضر عميق وذهبي هادئ على خلفية كريمية.',
    values: {
      preset: 'elegant',
      primary_color: '#1F6F5C', secondary_color: '#C89A4A',
      background_color: '#FBF9F6', text_color: '#1A1713', card_color: '#FFFFFF',
      font_family: 'tajawal', border_radius: 20, button_style: 'solid', default_dark: false,
    },
  },
  modern: {
    label: 'عصري',
    description: 'أزرق نقي وحواف واسعة ومساحات بيضاء.',
    values: {
      preset: 'modern',
      primary_color: '#2563A8', secondary_color: '#5EAAD8',
      background_color: '#F7F9FC', text_color: '#15202B', card_color: '#FFFFFF',
      font_family: 'tajawal', border_radius: 24, button_style: 'solid', default_dark: false,
    },
  },
  luxury: {
    label: 'فاخر',
    description: 'أسود دافئ وذهبي — مناسب للمطاعم الراقية.',
    values: {
      preset: 'luxury',
      primary_color: '#C6A052', secondary_color: '#8A6E33',
      background_color: '#14120F', text_color: '#F4EFE6', card_color: '#1E1B16',
      font_family: 'tajawal', border_radius: 10, button_style: 'outline', default_dark: true,
    },
  },
  minimal: {
    label: 'بسيط',
    description: 'أبيض ورمادي وحواف حادة — المحتوى هو البطل.',
    values: {
      preset: 'minimal',
      primary_color: '#2E2E2E', secondary_color: '#7A7A7A',
      background_color: '#FFFFFF', text_color: '#141414', card_color: '#FAFAFA',
      font_family: 'tajawal', border_radius: 6, button_style: 'outline', default_dark: false,
    },
  },
  dark: {
    label: 'ليلي',
    description: 'داكن مريح للعين مع لمسة خضراء.',
    values: {
      preset: 'dark',
      primary_color: '#3F9C84', secondary_color: '#D9B071',
      background_color: '#121412', text_color: '#EFF2EE', card_color: '#1B1F1C',
      font_family: 'tajawal', border_radius: 18, button_style: 'solid', default_dark: true,
    },
  },
  classic: {
    label: 'كلاسيكي',
    description: 'أحمر مطاعم تقليدي على خلفية دافئة.',
    values: {
      preset: 'classic',
      primary_color: '#A3302B', secondary_color: '#D89A3C',
      background_color: '#FAF5EC', text_color: '#20160F', card_color: '#FFFDF8',
      font_family: 'tajawal', border_radius: 14, button_style: 'solid', default_dark: false,
    },
  },
};

export const DEFAULT_THEME: ThemeValues = THEME_PRESETS.elegant.values;

/** يحوّل «#RRGGBB» إلى «r g b» لاستعمالها داخل rgb(... / alpha). */
function toRgbChannels(hex: string): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) || 0;
  const g = parseInt(value.slice(2, 4), 16) || 0;
  const b = parseInt(value.slice(4, 6), 16) || 0;
  return `${r} ${g} ${b}`;
}

/** سطوع نسبي تقريبي — يقرّر لون النص فوق لون الهوية. */
export function isLight(hex: string): boolean {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) || 0;
  const g = parseInt(value.slice(2, 4), 16) || 0;
  const b = parseInt(value.slice(4, 6), 16) || 0;
  return (r * 299 + g * 587 + b * 114) / 1000 > 165;
}

/**
 * متغيّرات CSS لصفحة منيو مطعم بعينه.
 *
 * تُحقن على عنصر الغلاف لا على :root، فلا تتسرّب ألوان المطعم إلى بقية
 * المنصة، ويظل بالإمكان عرض معاينة مباشرة داخل لوحة التحكم.
 */
export function themeToCssVars(theme: ThemeValues): Record<string, string> {
  const onPrimary = isLight(theme.primary_color) ? '#151210' : '#FFFFFF';

  return {
    '--r-primary': theme.primary_color,
    '--r-primary-rgb': toRgbChannels(theme.primary_color),
    '--r-primary-fg': onPrimary,
    '--r-secondary': theme.secondary_color,
    '--r-secondary-rgb': toRgbChannels(theme.secondary_color),
    '--r-bg': theme.background_color,
    '--r-text': theme.text_color,
    '--r-text-rgb': toRgbChannels(theme.text_color),
    '--r-card': theme.card_color,
    '--r-radius': `${theme.border_radius}px`,
  };
}

export function mergeTheme(theme: Partial<ThemeValues> | null | undefined): ThemeValues {
  return { ...DEFAULT_THEME, ...(theme ?? {}) };
}
