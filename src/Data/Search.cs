using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Qirtasiya.Data
{
    /* ============================================================
       البحث بالاسم: توحيد الكتابة والدرجات (المرحلة 3، قرار 0009)
       ------------------------------------------------------------
       منطق 3.2 نفسه (app/js/core.js: norm، fold، fzDist، matchNear،
       exactScore) منقولاً للمحرك، مع توحيد أوسع للكتابة:
       - Norm: التشكيل والتطويل، الهمزات، التاء المربوطة، الألف المقصورة،
         الأرقام العربية، والعلامات مسافات. ثم:
           • الترتيبي رقم: الثاني/التاني/الثانية ← 2 (حتى العاشر).
           • «الجزء/ج/ط/الطبعة» تُحذف إن تبعها رقم: «الجزء التاني» = «ج2» = «2».
           • الألقاب تُحذف إن تبعها اسم: «د. أشرف» = «دكتور أشرف» = «أشرف».
       - Fold: الحروف المتشابهة نطقاً حرف واحد (ظ=ض، ذ=ز=د، ث=ت، ص=س،
         ط=ت) و«ال» لا تُحسب، للبحث «القريب».
       - ExactScore: المطابق حرفياً، الاسم أولاً (1000 … 300).
       - MatchNear: القريب (1..90) بمسافة التحرير: حرف غلط في الكلمة،
         وحرفان في الكلمة الطويلة من 7 أحرف.
       الأرقام والأكواد لا تُقرَّب أبداً: باركود بخانة غلط صنفٌ آخر.
       ============================================================ */
    public static class Search
    {
        /* يتغيّر مع أي تغيير في التوحيد أو الفهرس: يُعاد بناء الفهرس عند الفتح */
        public const int Version = 1;

        /* فاصل الخانات الأخرى (الرمز، الباركود، المؤلف...) في الفهرس. Norm لا يُخرجه أبداً،
           فلا تطابق كلمةٌ نصفَ خانة ونصف التي بعدها. */
        public const char Sep = '\u001f';

        /* ---------- التوحيد ---------- */

        /* توحيد 3.x (norm + digits) وتصير العلامات مسافات */
        public static string Basic(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            if (NeedsKC(s)) s = s.Normalize(NormalizationForm.FormKC);
            StringBuilder b = new StringBuilder(s.Length);
            bool space = true;
            for (int i = 0; i < s.Length; i++)
            {
                char m = Map(s[i]);
                if (m == '\0') continue;
                if (m == ' ')
                {
                    if (!space) { b.Append(' '); space = true; }
                    continue;
                }
                b.Append(m);
                space = false;
            }
            if (b.Length > 0 && b[b.Length - 1] == ' ') b.Length--;
            return b.ToString();
        }

        /* أشكال العرض (ﻻ، ﷲ) والحروف العريضة: تُفكّ لحروفها العادية */
        static bool NeedsKC(string s)
        {
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if ((c >= '\uFB50' && c <= '\uFDFF') || (c >= '\uFE70' && c <= '\uFEFE') || (c >= '\uFF00' && c <= '\uFFEF')) return true;
            }
            return false;
        }

        /* حرف ← حرفه الموحَّد، أو ' ' فاصل، أو '\0' يُحذف */
        static char Map(char c)
        {
            if (c < 0x80)
            {
                if (c >= 'A' && c <= 'Z') return (char)(c + 32);
                if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) return c;
                return ' ';
            }
            if (c >= '\u0660' && c <= '\u0669') return (char)('0' + (c - '\u0660'));   // ٠١٢٣٤٥٦٧٨٩
            if (c >= '\u06F0' && c <= '\u06F9') return (char)('0' + (c - '\u06F0'));   // ۰۱۲۳۴۵۶۷۸۹
            if ((c >= '\u064B' && c <= '\u065F') || c == '\u0670' || c == '\u0640') return '\0';   // التشكيل والتطويل
            switch (c)
            {
                case '\u0623': case '\u0625': case '\u0622': case '\u0671': return '\u0627';   // أ إ آ ٱ ← ا
                case '\u0649': return '\u064A';   // ى ← ي
                case '\u0629': return '\u0647';   // ة ← ه
                case '\u0624': return '\u0648';   // ؤ ← و
                case '\u0626': return '\u064A';   // ئ ← ي
                case '\u06CC': return '\u064A';   // ی الفارسية ← ي
                case '\u06A9': return '\u0643';   // ک ← ك
            }
            if (c >= '\u00C0' && c <= '\u024F') return Latin[c - 0xC0];   // é ← e
            if (char.IsLetterOrDigit(c)) return char.ToLowerInvariant(c);
            switch (char.GetUnicodeCategory(c))
            {
                case UnicodeCategory.NonSpacingMark:
                case UnicodeCategory.SpacingCombiningMark:
                case UnicodeCategory.EnclosingMark:
                case UnicodeCategory.Format:   // علامات الاتجاه وZWNJ داخل الكلمة
                    return '\0';
            }
            return ' ';
        }

        /* الحروف اللاتينية بعلامات (é، ç، ö): الحرف نفسه بلا علامة */
        static readonly char[] Latin = MakeLatin();

        static char[] MakeLatin()
        {
            char[] t = new char[0x250 - 0xC0];
            for (int i = 0; i < t.Length; i++)
            {
                char c = (char)(0xC0 + i);
                string d = c.ToString().Normalize(NormalizationForm.FormD).ToLowerInvariant();
                if (d.Length > 0 && d[0] >= 'a' && d[0] <= 'z') t[i] = d[0];
                else if (char.IsLetter(c)) t[i] = char.ToLowerInvariant(c);
                else t[i] = ' ';   // × ÷
            }
            return t;
        }

        static readonly Dictionary<string, string> Ordinals = MakeOrdinals();

        static Dictionary<string, string> MakeOrdinals()
        {
            string[,] o = {
                { "اول", "1" }, { "اولي", "1" },
                { "ثاني", "2" }, { "تاني", "2" }, { "ثانيه", "2" }, { "تانيه", "2" },
                { "ثالث", "3" }, { "تالت", "3" }, { "ثالثه", "3" }, { "تالته", "3" },
                { "رابع", "4" }, { "رابعه", "4" }, { "خامس", "5" }, { "خامسه", "5" },
                { "سادس", "6" }, { "سادسه", "6" }, { "سابع", "7" }, { "سابعه", "7" },
                { "ثامن", "8" }, { "تامن", "8" }, { "ثامنه", "8" }, { "تامنه", "8" },
                { "تاسع", "9" }, { "تاسعه", "9" }, { "عاشر", "10" }, { "عاشره", "10" }
            };
            Dictionary<string, string> d = new Dictionary<string, string>(StringComparer.Ordinal);
            for (int i = 0; i < o.GetLength(0); i++) d[o[i, 0]] = o[i, 1];
            return d;
        }

        static readonly string[] Parts = { "الجزء", "جزء", "ج", "ط", "الطبعه", "طبعه" };
        static readonly string[] Titles = { "د", "دكتور", "الدكتور", "دكتوره", "الدكتوره", "ا", "استاذ", "الاستاذ", "استاذه", "الاستاذه" };

        /* «الثاني» ← 2 دائماً؛ «ثاني» بلا «ال» فقط بعد «الجزء/ج/ط» */
        static string Ordinal(string w, bool afterPart)
        {
            string n;
            if (w.Length > 3 && w[0] == '\u0627' && w[1] == '\u0644' && Ordinals.TryGetValue(w.Substring(2), out n)) return n;
            if (afterPart && Ordinals.TryGetValue(w, out n)) return n;
            return null;
        }

        static bool AllDigits(string w)
        {
            if (w.Length == 0) return false;
            for (int i = 0; i < w.Length; i++) if (w[i] < '0' || w[i] > '9') return false;
            return true;
        }

        /* «ج2»، «ط3»، «الجزء2» ← الرقم */
        static string GluedPart(string w)
        {
            foreach (string p in Parts)
            {
                if (w.Length > p.Length && w.StartsWith(p, StringComparison.Ordinal) && AllDigits(w.Substring(p.Length)))
                    return w.Substring(p.Length);
            }
            return null;
        }

        /* التوحيد الكامل: ما يُفهرس وما يُبحث به */
        public static string Norm(string s)
        {
            string basic = Basic(s);
            if (basic.Length == 0) return basic;
            string[] w = basic.Split(' ');
            /* الكلمة بعد التوحيد: رقم إن كانت ترتيبية أو «ج2» */
            string[] n = new string[w.Length];
            bool afterPart = false;
            for (int i = 0; i < w.Length; i++)
            {
                n[i] = Ordinal(w[i], afterPart) ?? GluedPart(w[i]) ?? w[i];
                afterPart = Array.IndexOf(Parts, w[i]) >= 0;
            }
            StringBuilder b = new StringBuilder(basic.Length);
            for (int i = 0; i < w.Length; i++)
            {
                bool hasNext = i + 1 < w.Length;
                if (hasNext && Array.IndexOf(Parts, w[i]) >= 0 && AllDigits(n[i + 1])) continue;
                if (hasNext && Array.IndexOf(Titles, w[i]) >= 0) continue;
                if (b.Length > 0) b.Append(' ');
                b.Append(n[i]);
            }
            return b.Length > 0 ? b.ToString() : basic;
        }

        /* ---------- القريب ---------- */

        /* الطيّ على نص موحَّد بـ Norm: الحروف المتشابهة نطقاً حرف واحد */
        public static string Fold(string normalized)
        {
            StringBuilder b = new StringBuilder(normalized.Length);
            bool space = true;
            for (int i = 0; i < normalized.Length; i++)
            {
                char c = normalized[i];
                switch (c)
                {
                    case '\u0621': continue;                   // ء
                    case '\u0638': c = '\u0636'; break;        // ظ ← ض
                    case '\u0630': case '\u0632': c = '\u062F'; break;   // ذ ز ← د
                    case '\u062B': c = '\u062A'; break;        // ث ← ت
                    case '\u0635': c = '\u0633'; break;        // ص ← س
                    case '\u0637': c = '\u062A'; break;        // ط ← ت
                }
                bool letter = (c >= '\u0621' && c <= '\u064A') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
                if (!letter)
                {
                    if (!space) { b.Append(' '); space = true; }
                    continue;
                }
                b.Append(c);
                space = false;
            }
            if (b.Length > 0 && b[b.Length - 1] == ' ') b.Length--;
            return b.ToString();
        }

        /* «ال» و«وال» لا تُحسب في القريب */
        public static string Stem(string w)
        {
            if (w.Length > 5 && w.StartsWith("وال", StringComparison.Ordinal)) return w.Substring(3);
            if (w.Length > 4 && w.StartsWith("ال", StringComparison.Ordinal)) return w.Substring(2);
            return w;
        }

        static readonly string[] NoWords = new string[0];

        /* كلمات نص موحَّد بعد الطيّ وحذف «ال» */
        public static string[] Words(string normalized)
        {
            string f = Fold(normalized);
            if (f.Length == 0) return NoWords;
            string[] w = f.Split(' ');
            for (int i = 0; i < w.Length; i++) w[i] = Stem(w[i]);
            return w;
        }

        public static bool HasDigit(string s)
        {
            for (int i = 0; i < s.Length; i++) if (s[i] >= '0' && s[i] <= '9') return true;
            return false;
        }

        /* كلمة قد تقرب من كلمة بحث: بلا أرقام، أو فيها 3 أحرف متتالية. كلمة البحث
           التي فيها رقم لا تُقرَّب، والتي بلا رقم لا تقرب من رقم ولا من رمز مثل k0012 */
        public static bool NearTerm(string w)
        {
            int run = 0;
            bool digit = false;
            for (int i = 0; i < w.Length; i++)
            {
                if (w[i] >= '0' && w[i] <= '9') { digit = true; run = 0; }
                else if (++run >= 3) return true;
            }
            return !digit && w.Length > 0;
        }

        [ThreadStatic] static int[] rowA, rowB, rowC;

        /* مسافة التحرير (مع تبديل حرفين متجاورين)، تتوقف حين تتجاوز الحدّ.
           b حتى الطول bn فقط (لمقارنة بداية الكلمة بلا نسخها). */
        public static int Dist(string a, string b, int max) { return Dist(a, b, b.Length, max); }

        static int Dist(string a, string b, int bn, int max)
        {
            if (Math.Abs(a.Length - bn) > max) return max + 1;
            if (rowA == null || rowA.Length < bn + 1)
            {
                int n = Math.Max(bn + 1, 32);
                rowA = new int[n]; rowB = new int[n]; rowC = new int[n];
            }
            int[] pp = rowA, p = rowB, c = rowC;
            for (int j = 0; j <= bn; j++) p[j] = j;
            for (int i = 1; i <= a.Length; i++)
            {
                c[0] = i;
                int low = i;
                char ai = a[i - 1];
                for (int j = 1; j <= bn; j++)
                {
                    int v = Math.Min(Math.Min(p[j] + 1, c[j - 1] + 1), p[j - 1] + (ai == b[j - 1] ? 0 : 1));
                    if (i > 1 && j > 1 && ai == b[j - 2] && a[i - 2] == b[j - 1]) v = Math.Min(v, pp[j - 2] + 1);
                    c[j] = v;
                    if (v < low) low = v;
                }
                if (low > max) return max + 1;
                int[] t = pp; pp = p; p = c; c = t;
            }
            return p[bn];
        }

        /* أقرب كلمة في الصنف لكلمة البحث: المسافة d وموضعها at، أو false */
        public static bool NearWord(string q, string[] words, out double d, out int at)
        {
            d = 0; at = -1;
            bool exactOnly = q.Length < 3 || HasDigit(q);
            int max = q.Length >= 7 ? 2 : 1;
            for (int i = 0; i < words.Length; i++)
            {
                double x = WordDist(q, words[i], exactOnly, max);
                if (x < 0) continue;
                if (at < 0 || x < d) { d = x; at = i; }
                if (d == 0) break;
            }
            return at >= 0;
        }

        /* مسافة كلمة البحث عن كلمة واحدة، أو -1 إن لم تقرب */
        public static double WordDist(string q, string w, bool exactOnly, int max)
        {
            if (w.IndexOf(q, StringComparison.Ordinal) >= 0) return 0;
            if (exactOnly || HasDigit(w)) return -1;
            double d;
            if (q.Length == 3)
            {
                /* الكلمة القصيرة تشبه كل شيء: نقارنها بكلمات بطولها فقط */
                if (w.Length > 4) return -1;
                d = Dist(q, w, w.Length, 1);
            }
            else
            {
                d = Dist(q, w, w.Length, max);
                /* ما زلت تكتب: «شرلو» تبدأ بها «شيرلوك». +0.25 يرتّبها بعد الكاملة */
                for (int L = q.Length - 1; L <= q.Length + 1 && d > 0; L++)
                {
                    if (L < 3 || L >= w.Length) continue;
                    d = Math.Min(d, Dist(q, w, L, max) + 0.25);
                }
            }
            return Math.Floor(d) <= max ? d : -1;
        }

        public static bool WordNear(string q, string w)
        {
            return WordDist(q, w, q.Length < 3 || HasDigit(q), q.Length >= 7 ? 2 : 1) >= 0;
        }

        /* درجة القرب 1..90، أو 0: كل كلمة بحث تقرب من كلمة في الصنف */
        public static int MatchNear(string[] qw, string[] hw)
        {
            if (qw.Length == 0 || hw.Length == 0) return 0;
            double sum = 0, pos = 0;
            for (int k = 0; k < qw.Length; k++)
            {
                double d; int at;
                if (!NearWord(qw[k], hw, out d, out at)) return 0;
                sum += d; pos += Math.Min(at, 12);
            }
            return Math.Max(1, JsRound(90 - sum * 15 - pos / qw.Length));
        }

        /* Math.round في JavaScript: النصف للأعلى */
        public static int JsRound(double x) { return (int)Math.Floor(x + 0.5); }

        /* ---------- المطابق ---------- */

        /* بداية كلمة في نص موحَّد (الكلمات بينها مسافة واحدة): «فيزياء» في
           «الفيزياء»، «حضارة» في «والحضارة». نفس الشرط في SQL (ShopDb.Search.cs). */
        public static bool IsWordStart(string s, int p)
        {
            if (p == 0 || s[p - 1] == ' ') return true;
            if (p >= 2 && s[p - 2] == '\u0627' && s[p - 1] == '\u0644' && (p == 2 || s[p - 3] == ' ')) return true;
            return p >= 3 && s[p - 3] == '\u0648' && s[p - 2] == '\u0627' && s[p - 1] == '\u0644' && (p == 3 || s[p - 4] == ' ');
        }

        /* درجة المطابق حرفياً، الاسم أهمّ من باقي الخانات:
             1000 الاسم هو نفس البحث       900 الاسم يبدأ به
              850 في بداية كلمة من الاسم    800 داخل الاسم
              750 خانة أخرى هي نفس البحث (رمز، باركود، مؤلف)
              700 كل الكلمات في الاسم بأي ترتيب
              500 كل الكلمات موجودة وبعضها في الاسم
              400 النص كما كُتب في خانة أخرى
              300 الكلمات متفرّقة في الخانات الأخرى فقط
                0 لا يطابق
           nq وqs والاسم موحَّدة بـ Norm، وother خانات موحَّدة بين فواصل Sep. */
        public static int ExactScore(string nq, string[] qs, string name, string other)
        {
            if (name == nq) return 1000;
            int at = name.IndexOf(nq, StringComparison.Ordinal);
            if (at == 0) return 900;
            if (at > 0)
            {
                for (int k = at; k >= 0; k = name.IndexOf(nq, k + 1, StringComparison.Ordinal))
                    if (IsWordStart(name, k)) return 850;
                return 800;
            }
            if (other.Length > 0 && other.IndexOf(Sep + nq + Sep, StringComparison.Ordinal) >= 0) return 750;
            int inName = 0;
            for (int i = 0; i < qs.Length; i++)
            {
                if (name.IndexOf(qs[i], StringComparison.Ordinal) >= 0) inName++;
                else if (other.IndexOf(qs[i], StringComparison.Ordinal) < 0) return 0;
            }
            if (inName == qs.Length) return 700;
            if (inName > 0) return 500;
            return other.IndexOf(nq, StringComparison.Ordinal) >= 0 ? 400 : 300;
        }

        /* الخانات الأخرى بين فواصل: Sep خانة Sep خانة Sep (الفارغة لا تُكتب) */
        public static string Others(params string[] fields)
        {
            StringBuilder b = new StringBuilder();
            foreach (string f in fields)
            {
                string n = Norm(f);
                if (n.Length == 0) continue;
                if (b.Length == 0) b.Append(Sep);
                b.Append(n).Append(Sep);
            }
            return b.ToString();
        }

        /* أجزاء trigram لكلمة (3 أحرف متتالية): الفهرس يجد بها أي جزء من الكلمة */
        public static void Trigrams(string w, List<string> into)
        {
            for (int i = 0; i + 3 <= w.Length; i++)
            {
                string t = w.Substring(i, 3);
                if (!into.Contains(t)) into.Add(t);
            }
        }

        /* نص آمن داخل علامتي تنصيص في استعلام FTS5 */
        public static string Quote(string s) { return "\"" + s.Replace("\"", "\"\"") + "\""; }
    }
}
