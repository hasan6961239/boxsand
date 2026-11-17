using System;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Qirtasiya
{
    /* ============================================================
       رمز التفعيل الثابت (قرار 0030، يعدّل 0028)
       ------------------------------------------------------------
       رمز واحد يعرفه صاحب المنظومة، يُكتب على الجهاز نفسه (بلا واتساب ولا
       رقم جهاز):
         الرمز وحده            مدى الحياة
         الرمز وبعده رقم       عدد الأيام من لحظة إدخاله (1 يوم، 7 أسبوع، 365 سنة)
       الحروف الكبيرة والصغيرة سواء، والمسافات والشرطات تسقط، والأرقام العربية
       (١٢٣) تُقرأ. حروف عربية (لغة الكيبورد) تُعرف وتُقال للمستخدم.

       في البرنامج (والمستودع العام) بصمة الرمز فقط: PBKDF2 بملح وعدد دورات
       كبير، «P1:<الدورات>:<الملح>:<البصمة>» (base64)، فلا يُقرأ الرمز من الكود
       ولا من ملف البرنامج.

       هذا الملف حساب فقط: لا ملفات ولا سجل ويندوز. ما يُحفظ على الجهاز (سجل
       بنهاية المدة مختوم ببصمة الجهاز، لا الرمز نفسه) والقفل في Program.cs.
       بقيود C# 5 كبقية البرنامج (مترجم ويندوز المدمج).
       ============================================================ */
    static class Activation
    {
        public const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        /* أطول رقم أيام بعد الرمز: 5 أرقام */
        public const int MaxDayDigits = 5;

        static readonly DateTime Epoch = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        public static long HoursOf(DateTime utc)
        {
            return (long)Math.Floor((utc.ToUniversalTime() - Epoch).TotalHours);
        }

        public static DateTime TimeOfHours(long h) { return Epoch.AddHours(h); }

        /* ---------- بصمة الجهاز والسجلات ---------- */

        /* حروف البصمة وحدها (A-Z و2-9)، للسجلات المختومة ببصمة الجهاز */
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

        /* رقم الجهاز (للسجل والتشخيص): حرف النسخة (M مصراتة، T طرابلس) ثم البصمة */
        public static string DeviceNumber(string edition, string fp)
        {
            return (edition == "tripoli" ? "T-" : "M-") + fp;
        }

        /* ---------- بصمة الرمز ---------- */

        public sealed class Secret
        {
            public int Iter;
            public byte[] Salt;
            public byte[] Hash;
        }

        /* null = فارغ أو غير صالح (التفعيل معطّل) */
        public static Secret ParseSecret(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            string[] p = s.Trim().Split(':');
            if (p.Length != 4 || p[0] != "P1") return null;
            try
            {
                Secret r = new Secret();
                r.Iter = int.Parse(p[1], NumberStyles.None, CultureInfo.InvariantCulture);
                r.Salt = Convert.FromBase64String(p[2]);
                r.Hash = Convert.FromBase64String(p[3]);
                if (r.Iter < 1000 || r.Salt.Length < 8 || r.Hash.Length < 16) return null;
                return r;
            }
            catch (FormatException) { return null; }
            catch (OverflowException) { return null; }
        }

        /* نص المستخدم → حروف إنجليزية صغيرة وأرقام فقط */
        public static string Normalize(string s)
        {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder(s.Length);
            foreach (char c0 in s)
            {
                char c = c0;
                if (c >= '٠' && c <= '٩') c = (char)('0' + (c - '٠'));
                else if (c >= '۰' && c <= '۹') c = (char)('0' + (c - '۰'));
                else if (c >= 'A' && c <= 'Z') c = (char)(c + 32);
                if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) sb.Append(c);
            }
            return sb.ToString();
        }

        /* حروف عربية: الكيبورد على العربي وقت الكتابة */
        public static bool HasArabicLetters(string s)
        {
            if (s == null) return false;
            foreach (char c in s)
                if ((c >= 'ء' && c <= 'ي') || (c >= 'ٱ' && c <= 'ۓ')) return true;
            return false;
        }

        public static bool Matches(Secret sec, string code)
        {
            byte[] h;
            using (Rfc2898DeriveBytes k = new Rfc2898DeriveBytes(Encoding.UTF8.GetBytes(code), sec.Salt, sec.Iter))
                h = k.GetBytes(sec.Hash.Length);
            int d = 0;
            for (int i = 0; i < h.Length; i++) d |= h[i] ^ sec.Hash[i];
            return d == 0;
        }

        /* عدد الأيام: 0 = مدى الحياة، -1 = مرفوض. err: empty | arabic | zero | wrong
           الأرقام في آخر النص قد تكون الأيام أو جزءاً من الرمز نفسه: نجرّب الأطول أولاً */
        public static int Check(Secret sec, string text, out string err)
        {
            err = "";
            string s = Normalize(text);
            if (s.Length == 0) { err = HasArabicLetters(text) ? "arabic" : "empty"; return -1; }
            int t = 0;
            while (t < s.Length && t < MaxDayDigits && s[s.Length - 1 - t] >= '0' && s[s.Length - 1 - t] <= '9') t++;
            for (int k = t; k >= 0; k--)
            {
                if (s.Length - k <= 0 || !Matches(sec, s.Substring(0, s.Length - k))) continue;
                if (k == 0) return 0;
                int days = int.Parse(s.Substring(s.Length - k), CultureInfo.InvariantCulture);
                if (days == 0) { err = "zero"; return -1; }
                return days;
            }
            err = HasArabicLetters(text) ? "arabic" : "wrong";
            return -1;
        }
    }
}
