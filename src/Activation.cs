using System;
using System.Globalization;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;

namespace Qirtasiya
{
    /* ============================================================
       رموز التفعيل (قرار 0028)
       ------------------------------------------------------------
       مولّد الرموز على تلفون صاحب المنظومة يحمل المفتاح الخاص وحده
       (ECDSA P-256)، والبرنامج يحمل المفتاح العام: يتحقق من الرمز ولا
       يستطيع توليده، فلا يصنع أحدٌ رمزاً من نسخة البرنامج نفسها.

       الرمز 70 بايتاً تُكتب بـ 112 حرفاً من حروف رقم الجهاز نفسها:
         [0]      الإصدار (1)
         [1..3]   نهاية المدة: ساعات منذ 2020-01-01 بتوقيت غرينتش (0 = مدى الحياة)
         [4..67]  التوقيع r||s على "QIRTASIYA-ACT-1|<الجهاز 12 حرفاً>|<النهاية>"
         [68..69] CRC16 لما قبله: غلط النسخ يُعرف وحده فلا يُقال «ليس لهذا الجهاز»

       هذا الملف حساب فقط: لا ملفات ولا سجل ويندوز. التخزين والقفل في Program.cs.
       بقيود C# 5 كبقية البرنامج (مترجم ويندوز المدمج).
       ============================================================ */
    static class Activation
    {
        public const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        public const int CodeBytes = 70;
        public const int CodeChars = 112;
        const string Domain = "QIRTASIYA-ACT-1|";

        static readonly DateTime Epoch = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        public static long HoursOf(DateTime utc)
        {
            return (long)Math.Floor((utc.ToUniversalTime() - Epoch).TotalHours);
        }

        public static DateTime TimeOfHours(long h) { return Epoch.AddHours(h); }

        /* ---------- النص ---------- */

        /* حروف الرمز وحدها: الشرطات والمسافات والأسطر وعلامات الاتجاه التي يضيفها
           الواتساب تسقط، والحروف الصغيرة تكبر */
        public static string Clean(string s)
        {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder(s.Length);
            foreach (char ch in s.ToUpperInvariant())
                if (Alphabet.IndexOf(ch) >= 0) sb.Append(ch);
            return sb.ToString();
        }

        public static string B32(byte[] b)
        {
            StringBuilder sb = new StringBuilder((b.Length * 8 + 4) / 5);
            int buf = 0, bits = 0;
            foreach (byte x in b)
            {
                buf = (buf << 8) | x; bits += 8;
                while (bits >= 5) { sb.Append(Alphabet[(buf >> (bits - 5)) & 31]); bits -= 5; }
                buf &= (1 << bits) - 1;
            }
            if (bits > 0) sb.Append(Alphabet[(buf << (5 - bits)) & 31]);
            return sb.ToString();
        }

        /* null إن كان النص ليس بالطول المطلوب بالضبط */
        public static byte[] UnB32(string s, int bytes)
        {
            if (s == null || s.Length != (bytes * 8 + 4) / 5) return null;
            byte[] o = new byte[bytes];
            int buf = 0, bits = 0, n = 0;
            foreach (char ch in s)
            {
                int v = Alphabet.IndexOf(ch);
                if (v < 0) return null;
                buf = (buf << 5) | v; bits += 5;
                if (bits >= 8)
                {
                    if (n < bytes) o[n++] = (byte)((buf >> (bits - 8)) & 255);
                    bits -= 8;
                }
                buf &= (1 << bits) - 1;
            }
            return n == bytes ? o : null;
        }

        /* CRC-16/CCITT-FALSE */
        public static int Crc16(byte[] b, int len)
        {
            int crc = 0xFFFF;
            for (int i = 0; i < len; i++)
            {
                crc ^= b[i] << 8;
                for (int k = 0; k < 8; k++) crc = (crc & 0x8000) != 0 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
            }
            return crc;
        }

        /* رقم الجهاز كما يُعرض: حرف النسخة (M مصراتة، T طرابلس) ثم البصمة */
        public static string DeviceNumber(string edition, string fp)
        {
            return (edition == "tripoli" ? "T-" : "M-") + fp;
        }

        /* ---------- الرمز ---------- */

        public sealed class Code
        {
            public long ExpiryH;      // 0 = مدى الحياة
            public byte[] Sig;        // 64 بايت
            public string Text;       // 112 حرفاً بلا شرطات — هكذا يُحفظ
        }

        /* err: empty | length | typo | version */
        public static Code Parse(string text, out string err)
        {
            err = "";
            string c = Clean(text);
            if (c.Length == 0) { err = "empty"; return null; }
            if (c.Length != CodeChars) { err = "length"; return null; }
            byte[] b = UnB32(c, CodeBytes);
            if (b == null) { err = "length"; return null; }
            if (Crc16(b, 68) != ((b[68] << 8) | b[69])) { err = "typo"; return null; }
            if (b[0] != 1) { err = "version"; return null; }
            Code r = new Code();
            r.ExpiryH = ((long)b[1] << 16) | ((long)b[2] << 8) | b[3];
            r.Sig = new byte[64];
            Array.Copy(b, 4, r.Sig, 0, 64);
            r.Text = c;
            return r;
        }

        /* الرمز من نص ملصوق كما هو: رسالة واتساب كاملة فيها كلام وتاريخ، أو الرمز
           مكسوراً على أسطر. نأخذ كل مقطع من حروف الرمز تفصل بينها شرطات ومسافات
           فقط، وأول نافذة بطول الرمز يصحّ مجموعها (CRC) هي الرمز */
        public static Code Find(string text, out string err)
        {
            err = "";
            if (Clean(text).Length == 0) { err = "empty"; return null; }
            System.Collections.Generic.List<string> runs = new System.Collections.Generic.List<string>();
            StringBuilder cur = new StringBuilder();
            foreach (char ch in text.ToUpperInvariant())
            {
                if (Alphabet.IndexOf(ch) >= 0) { cur.Append(ch); continue; }
                UnicodeCategory cat = char.GetUnicodeCategory(ch);
                if (char.IsWhiteSpace(ch) || cat == UnicodeCategory.DashPunctuation || cat == UnicodeCategory.Format) continue;
                if (cur.Length > 0) runs.Add(cur.ToString());
                cur.Length = 0;
            }
            if (cur.Length > 0) runs.Add(cur.ToString());

            string why = "length";
            foreach (string r in runs)
            {
                for (int i = 0; i + CodeChars <= r.Length; i++)
                {
                    string e;
                    Code c = Parse(r.Substring(i, CodeChars), out e);
                    if (c != null) return c;
                    if (e == "version") why = "version";
                    else if (why != "version") why = "typo";
                }
            }
            string e2;
            Code whole = Parse(text, out e2);
            if (whole != null) return whole;
            err = why;
            return null;
        }

        public static byte[] Message(string fp12, long expiryH)
        {
            return Encoding.UTF8.GetBytes(Domain + fp12 + "|" + expiryH.ToString(CultureInfo.InvariantCulture));
        }

        /* fp: البصمة بشرطاتها أو بدونها (12 حرفاً) */
        public static bool Verify(byte[] pub, string fp, Code c)
        {
            if (c == null) return false;
            string fp12 = Clean(fp);
            if (fp12.Length != 12) return false;
            return EcdsaVerify(pub, Message(fp12, c.ExpiryH), c.Sig);
        }

        /* المفتاح العام كما يعطيه المولّد: base64 لـ 65 بايتاً (04||X||Y) */
        public static byte[] PublicKey(string b64)
        {
            if (string.IsNullOrEmpty(b64)) return null;
            try
            {
                byte[] k = Convert.FromBase64String(b64.Trim());
                if (k.Length != 65 || k[0] != 4) return null;
                BigInteger x = U(k, 1, 32), y = U(k, 33, 32);
                return OnCurve(x, y) ? k : null;
            }
            catch (FormatException) { return null; }
        }

        /* بصمة المفتاح العام (8 حروف): المولّد يعرضها والإعدادات تعرضها،
           فيُعرف بنظرة أن البرنامج مبني بمفتاح هذا التلفون */
        public static string KeyFp(byte[] pub)
        {
            if (pub == null) return "";
            byte[] h;
            using (SHA256 sha = SHA256.Create()) h = sha.ComputeHash(pub);
            string s = B32(h).Substring(0, 8);
            return s.Substring(0, 4) + "-" + s.Substring(4, 4);
        }

        /* ---------- ECDSA P-256 (التحقق فقط) ----------
           بلا مكتبات نظام: ECDsaCng غير موجود في mono، والاختبارات تبني البرنامج نفسه
           على لينكس. إحداثيات جاكوبي: مقلوب واحد في آخر كل ضرب. */

        static readonly BigInteger P = H("FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF");
        static readonly BigInteger N = H("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");
        static readonly BigInteger B = H("5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B");
        static readonly BigInteger Gx = H("6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296");
        static readonly BigInteger Gy = H("4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5");

        static BigInteger H(string hex)
        {
            return BigInteger.Parse("0" + hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        }

        /* عدد موجب من بايتات بترتيب الشبكة (الأكبر أولاً) */
        static BigInteger U(byte[] b, int off, int len)
        {
            byte[] le = new byte[len + 1];
            for (int i = 0; i < len; i++) le[i] = b[off + len - 1 - i];
            return new BigInteger(le);
        }

        static BigInteger M(BigInteger x)
        {
            x = BigInteger.Remainder(x, P);
            return x.Sign < 0 ? x + P : x;
        }

        static bool OnCurve(BigInteger x, BigInteger y)
        {
            if (x.Sign < 0 || y.Sign < 0 || x >= P || y >= P) return false;
            return M(y * y) == M(x * x * x - 3 * x + B);
        }

        /* نقطة جاكوبي (X:Y:Z)، و Z = 0 هي اللانهاية */
        static void Dbl(ref BigInteger X, ref BigInteger Y, ref BigInteger Z)
        {
            if (Z.IsZero || Y.IsZero) { Z = BigInteger.Zero; return; }
            BigInteger delta = M(Z * Z), gamma = M(Y * Y), beta = M(X * gamma);
            BigInteger alpha = M(3 * M(X - delta) * M(X + delta));
            BigInteger x3 = M(alpha * alpha - 8 * beta);
            BigInteger z3 = M(M((Y + Z) * (Y + Z)) - gamma - delta);
            BigInteger y3 = M(alpha * M(4 * beta - x3) - 8 * M(gamma * gamma));
            X = x3; Y = y3; Z = z3;
        }

        static void Add(ref BigInteger X1, ref BigInteger Y1, ref BigInteger Z1, BigInteger X2, BigInteger Y2, BigInteger Z2)
        {
            if (Z2.IsZero) return;
            if (Z1.IsZero) { X1 = X2; Y1 = Y2; Z1 = Z2; return; }
            BigInteger z1z1 = M(Z1 * Z1), z2z2 = M(Z2 * Z2);
            BigInteger u1 = M(X1 * z2z2), u2 = M(X2 * z1z1);
            BigInteger s1 = M(M(Y1 * Z2) * z2z2), s2 = M(M(Y2 * Z1) * z1z1);
            BigInteger h = M(u2 - u1), r = M(2 * (s2 - s1));
            if (h.IsZero)
            {
                if (r.IsZero) { Dbl(ref X1, ref Y1, ref Z1); return; }
                Z1 = BigInteger.Zero;
                return;
            }
            BigInteger i = M(4 * h * h), j = M(h * i), v = M(u1 * i);
            BigInteger x3 = M(r * r - j - 2 * v);
            BigInteger y3 = M(r * M(v - x3) - 2 * M(s1 * j));
            BigInteger z3 = M(M(M((Z1 + Z2) * (Z1 + Z2)) - z1z1 - z2z2) * h);
            X1 = x3; Y1 = y3; Z1 = z3;
        }

        static void Mul(BigInteger k, BigInteger px, BigInteger py, out BigInteger X, out BigInteger Y, out BigInteger Z)
        {
            X = BigInteger.Zero; Y = BigInteger.One; Z = BigInteger.Zero;
            for (int i = 255; i >= 0; i--)
            {
                Dbl(ref X, ref Y, ref Z);
                if (!((k >> i) & BigInteger.One).IsZero) Add(ref X, ref Y, ref Z, px, py, BigInteger.One);
            }
        }

        public static bool EcdsaVerify(byte[] pub, byte[] msg, byte[] sig)
        {
            try
            {
                if (pub == null || pub.Length != 65 || pub[0] != 4 || sig == null || sig.Length != 64 || msg == null) return false;
                BigInteger qx = U(pub, 1, 32), qy = U(pub, 33, 32);
                if (!OnCurve(qx, qy)) return false;
                BigInteger r = U(sig, 0, 32), s = U(sig, 32, 32);
                if (r.Sign <= 0 || r >= N || s.Sign <= 0 || s >= N) return false;
                byte[] hash;
                using (SHA256 sha = SHA256.Create()) hash = sha.ComputeHash(msg);
                BigInteger e = U(hash, 0, 32);
                BigInteger w = BigInteger.ModPow(s, N - 2, N);
                BigInteger u1 = BigInteger.Remainder(e * w, N), u2 = BigInteger.Remainder(r * w, N);
                BigInteger x1, y1, z1, x2, y2, z2;
                Mul(u1, Gx, Gy, out x1, out y1, out z1);
                Mul(u2, qx, qy, out x2, out y2, out z2);
                Add(ref x1, ref y1, ref z1, x2, y2, z2);
                if (z1.IsZero) return false;
                BigInteger zi = BigInteger.ModPow(z1, P - 2, P);
                BigInteger x = M(x1 * M(zi * zi));
                return BigInteger.Remainder(x, N) == r;
            }
            catch (Exception) { return false; }
        }
    }
}
