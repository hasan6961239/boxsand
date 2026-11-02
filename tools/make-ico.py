#!/usr/bin/env python3
# ============================================================
#  make-ico.py — أيقونة البرنامج بالصيغة التي يقرؤها ويندوز كله
#  ------------------------------------------------------------
#  كانت app.ico وapp-tripoli.ico صور PNG مضغوطة في كل المقاسات (16 و32
#  أيضاً)، وwPlanes = 0. أجزاء من ويندوز (شريط المهام، الاختصارات، ذاكرة
#  الأيقونات) لا تقرأ الصغيرة منها، فيظهر مكان الشعار «صفحة بيضاء».
#  الصيغة المعتادة: المقاسات الصغيرة صور نقطية (BMP بقناة شفافية 32 بت
#  وقناع)، و256 وحده PNG، وwPlanes = 1.
#
#    python3 tools/make-ico.py app/app.ico            يعيد كتابتها في مكانها
#    python3 tools/make-ico.py مصدر.ico|.png هدف.ico
#
#  يحتاج Pillow. كل مقاس من صورته نفسها في المصدر إن وُجدت (رسمها المصمم
#  لذلك المقاس)، وإلا صُغّر من أقرب أكبر منه.
# ============================================================
import io
import struct
import sys

from PIL import Image, IcoImagePlugin

BMP_SIZES = [16, 20, 24, 32, 40, 48, 64, 128]
PNG_SIZE = 256


def sources(path):
    """كل صور المصدر بمقاساتها: {عرض: صورة RGBA}"""
    with open(path, 'rb') as f:
        head = f.read(4)
    if head == b'\x00\x00\x01\x00':
        with open(path, 'rb') as f:
            ico = IcoImagePlugin.IcoFile(f)
            return {w: ico.getimage((w, h)).convert('RGBA') for (w, h) in ico.sizes() if w == h}
    im = Image.open(path).convert('RGBA')
    return {im.width: im}


def at(src, size):
    if size in src:
        return src[size]
    bigger = sorted(s for s in src if s > size)
    base = src[bigger[0]] if bigger else src[max(src)]
    return base.resize((size, size), Image.LANCZOS)


def dib(im):
    """BITMAPINFOHEADER + الألوان BGRA من الأسفل للأعلى + قناع AND بت لكل نقطة"""
    w, h = im.size
    px = im.load()
    head = struct.pack('<IiiHHIIiiII', 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    color = bytearray()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            color += bytes((b, g, r, a))
    row = ((w + 31) // 32) * 4
    mask = bytearray()
    for y in range(h - 1, -1, -1):
        line = bytearray(row)
        for x in range(w):
            if px[x, y][3] == 0:
                line[x // 8] |= 0x80 >> (x % 8)
        mask += line
    return head + bytes(color) + bytes(mask)


def png(im):
    out = io.BytesIO()
    im.save(out, format='PNG', optimize=True)
    return out.getvalue()


def build(src):
    images = [(s, dib(at(src, s))) for s in BMP_SIZES] + [(PNG_SIZE, png(at(src, PNG_SIZE)))]
    out = bytearray(struct.pack('<HHH', 0, 1, len(images)))
    offset = 6 + 16 * len(images)
    for s, data in images:
        d = 0 if s >= 256 else s
        out += struct.pack('<BBBBHHII', d, d, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    for _, data in images:
        out += data
    return bytes(out)


def main():
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__ or 'make-ico.py مصدر [هدف]')
    src = sources(sys.argv[1])
    data = build(src)
    target = sys.argv[2] if len(sys.argv) == 3 else sys.argv[1]
    with open(target, 'wb') as f:
        f.write(data)
    print('%s: %d صورة، %d بايت' % (target, len(BMP_SIZES) + 1, len(data)))


if __name__ == '__main__':
    main()
