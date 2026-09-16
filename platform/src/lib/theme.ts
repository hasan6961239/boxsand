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

/* ════════════════════════════════════════════════════════════════════════
   الوضع الليلي لصفحة المنيو

   الوضع الليلي هنا ليس عكساً لألوان المطعم. عكس الألوان يُنتج خلفيات صارخة
   ونصوصاً باهتة. بدلاً من ذلك: لوحة المطعم تمثّل أحد الوضعين (حسب سطوع
   خلفيته)، والوضع الآخر يُبنى على أسطح محايدة دافئة مع تعديل لون الهوية
   وحده ليحافظ على تباين كافٍ.
   ════════════════════════════════════════════════════════════════════════ */

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): Hsl {
  const value = hex.replace('#', '');
  const r = (parseInt(value.slice(0, 2), 16) || 0) / 255;
  const g = (parseInt(value.slice(2, 4), 16) || 0) / 255;
  const b = (parseInt(value.slice(4, 6), 16) || 0) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  return { h: (h * 60 + 360) % 360, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];

  const toHex = (channel: number) =>
    Math.round((channel + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** يرفع سطوع اللون ليقرأ بوضوح على خلفية داكنة، مع إبقاء الصبغة كما هي. */
function forDarkSurface(hex: string): string {
  const hsl = hexToHsl(hex);
  if (hsl.s < 0.05) return '#E6E1D9';           // رمادي: نعيده رمادياً فاتحاً
  return hslToHex({ h: hsl.h, s: Math.min(0.62, Math.max(hsl.s, 0.34)), l: Math.max(hsl.l, 0.6) });
}

/** يخفض سطوع اللون ليقرأ على خلفية فاتحة. */
function forLightSurface(hex: string): string {
  const hsl = hexToHsl(hex);
  if (hsl.s < 0.05) return '#2E2A25';
  return hslToHex({ h: hsl.h, s: Math.min(0.72, Math.max(hsl.s, 0.36)), l: Math.min(hsl.l, 0.38) });
}

const NEUTRAL_DARK = { bg: '#121110', card: '#1C1A17', text: '#F3EFE9' };
const NEUTRAL_LIGHT = { bg: '#FBF9F6', card: '#FFFFFF', text: '#1A1713' };

/** هل لوحة المطعم نفسها داكنة؟ */
export function themeIsDark(theme: ThemeValues): boolean {
  return !isLight(theme.background_color);
}

/**
 * متغيّرات CSS للمنيو في الوضع المطلوب.
 * إن وافق الوضعُ لوحةَ المطعم استُعملت كما هي؛ وإلا بُني نظيرها.
 */
export function buildThemeVars(theme: ThemeValues, dark: boolean): Record<string, string> {
  const baseIsDark = themeIsDark(theme);
  if (dark === baseIsDark) return themeToCssVars(theme);

  const surface = dark ? NEUTRAL_DARK : NEUTRAL_LIGHT;
  const adjust = dark ? forDarkSurface : forLightSurface;

  return themeToCssVars({
    ...theme,
    primary_color: adjust(theme.primary_color),
    secondary_color: adjust(theme.secondary_color),
    background_color: surface.bg,
    card_color: surface.card,
    text_color: surface.text,
  });
}
