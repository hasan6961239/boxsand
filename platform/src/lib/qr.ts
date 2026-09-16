import QRCode from 'qrcode';

export interface QrOptions {
  /** لون النقاط — الأسود أعلى تبايناً وأضمن للمسح */
  dark?: string;
  light?: string;
  margin?: number;
  width?: number;
}

/**
 * يولّد رمز QR كـ SVG.
 *
 * مستوى تصحيح الأخطاء H (أعلى مستوى) مقصود: يسمح بإخفاء شعار في المنتصف
 * وبمسح الرمز حتى لو اتّسخ أو تجعّد الملصق على الطاولة.
 */
export async function generateQrSvg(text: string, options: QrOptions = {}): Promise<string> {
  const { dark = '#101010', light = '#FFFFFF', margin = 2, width = 512 } = options;

  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin,
    width,
    color: { dark, light },
  });
}

/** رابط QR الثابت — لا يتغير أبداً حتى لو تغيّر اسم المطعم أو رابط منيوه. */
export function qrTarget(siteUrl: string, shortId: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/r/${shortId}`;
}
