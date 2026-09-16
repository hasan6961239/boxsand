import { UPLOAD } from './config';
import { UserFacingError } from './errors';

export interface CompressOptions {
  maxDimension?: number;
  /** جودة WebP بين 0 و 1 */
  quality?: number;
}

/**
 * يضغط الصورة داخل متصفح صاحب المطعم قبل الرفع.
 *
 * هذا أهم قرار في أداء صفحة المنيو: صورة الهاتف الأصلية تتجاوز ٤ ميجابايت
 * أحياناً، وعشرون صنفاً بها تجعل المنيو غير قابل للفتح على شبكة ضعيفة.
 * الضغط هنا يوفّر عرض النطاق مرتين — عند الرفع وعند كل مشاهدة.
 */
export async function compressImage(file: File, options: CompressOptions = {}): Promise<File> {
  const { maxDimension = UPLOAD.maxDimension, quality = 0.82 } = options;

  if (!UPLOAD.accept.includes(file.type as (typeof UPLOAD.accept)[number])) {
    throw new UserFacingError('صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WebP.');
  }
  if (file.size > UPLOAD.maxBytes) {
    throw new UserFacingError('حجم الصورة يتجاوز ٥ ميجابايت. اختر صورة أصغر.');
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new UserFacingError('تعذّر قراءة هذه الصورة. جرّب صورة أخرى.');
  });

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new UserFacingError('متصفحك لا يدعم معالجة الصور.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', quality),
  );
  if (!blob) throw new UserFacingError('تعذّر ضغط الصورة. جرّب صورة أخرى.');

  if (blob.size > UPLOAD.maxStoredBytes) {
    throw new UserFacingError('الصورة كبيرة جداً حتى بعد الضغط. اختر صورة أبسط أو أصغر.');
  }

  return new File([blob], `${crypto.randomUUID()}.webp`, { type: 'image/webp' });
}

/** مسار التخزين — يبدأ بمعرّف المطعم لأن سياسة الأمان تقرأ هذا الجزء. */
export function storagePath(restaurantId: string, kind: 'logo' | 'cover' | 'product' | 'offer', fileName: string) {
  return `${restaurantId}/${kind}/${fileName}`;
}
