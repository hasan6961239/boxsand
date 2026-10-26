using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Qirtasiya.Data
{
    /* ============================================================
       JSON صغير بلا مكتبات: قراءة وكتابة
       ------------------------------------------------------------
       الكائن ← Dictionary<string, object>، المصفوفة ← List<object>،
       العدد الصحيح ← long، والكسري ← double. يكفي لملفات المولّد،
       ولنقل store.json من 3.x، ولأوامر المحرك.
       ============================================================ */
    public static class Json
    {
        public static object Parse(string s)
        {
            Reader r = new Reader(s);
            r.Ws();
            object v = r.Value();
            r.Ws();
            if (r.Pos < s.Length) throw r.Fail("نص زائد بعد القيمة");
            return v;
        }

        sealed class Reader
        {
            readonly string s;
            public int Pos;
            readonly StringBuilder sb = new StringBuilder();

            public Reader(string text) { s = text; }

            public FormatException Fail(string why)
            {
                return new FormatException("JSON غير صالح عند الحرف " + Pos + ": " + why);
            }

            public void Ws()
            {
                while (Pos < s.Length)
                {
                    char c = s[Pos];
                    if (c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '﻿') Pos++;
                    else break;
                }
            }

            public object Value()
            {
                if (Pos >= s.Length) throw Fail("انتهى النص");
                char c = s[Pos];
                if (c == '{') return Obj();
                if (c == '[') return Arr();
                if (c == '"') return Str();
                if (c == 't' && Lit("true")) return true;
                if (c == 'f' && Lit("false")) return false;
                if (c == 'n' && Lit("null")) return null;
                if (c == '-' || (c >= '0' && c <= '9')) return Num();
                throw Fail("حرف غير متوقع '" + c + "'");
            }

            bool Lit(string w)
            {
                if (string.CompareOrdinal(s, Pos, w, 0, w.Length) != 0) return false;
                Pos += w.Length;
                return true;
            }

            Dictionary<string, object> Obj()
            {
                Dictionary<string, object> o = new Dictionary<string, object>(StringComparer.Ordinal);
                Pos++;
                Ws();
                if (Pos < s.Length && s[Pos] == '}') { Pos++; return o; }
                while (true)
                {
                    Ws();
                    if (Pos >= s.Length || s[Pos] != '"') throw Fail("متوقع اسم حقل");
                    string k = Str();
                    Ws();
                    if (Pos >= s.Length || s[Pos] != ':') throw Fail("متوقع :");
                    Pos++;
                    Ws();
                    o[k] = Value();
                    Ws();
                    if (Pos >= s.Length) throw Fail("كائن غير مغلق");
                    if (s[Pos] == ',') { Pos++; continue; }
                    if (s[Pos] == '}') { Pos++; return o; }
                    throw Fail("متوقع , أو }");
                }
            }

            List<object> Arr()
            {
                List<object> a = new List<object>();
                Pos++;
                Ws();
                if (Pos < s.Length && s[Pos] == ']') { Pos++; return a; }
                while (true)
                {
                    Ws();
                    a.Add(Value());
                    Ws();
                    if (Pos >= s.Length) throw Fail("مصفوفة غير مغلقة");
                    if (s[Pos] == ',') { Pos++; continue; }
                    if (s[Pos] == ']') { Pos++; return a; }
                    throw Fail("متوقع , أو ]");
                }
            }

            string Str()
            {
                Pos++;
                int start = Pos;
                /* الحالة الشائعة: نص بلا هروب — يُقصّ مباشرة */
                while (Pos < s.Length)
                {
                    char c = s[Pos];
                    if (c == '"') { Pos++; return s.Substring(start, Pos - 1 - start); }
                    if (c == '\\') break;
                    Pos++;
                }
                sb.Length = 0;
                sb.Append(s, start, Pos - start);
                while (Pos < s.Length)
                {
                    char c = s[Pos++];
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    if (Pos >= s.Length) break;
                    char e = s[Pos++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (Pos + 4 > s.Length) throw Fail("\\u ناقص");
                            sb.Append((char)int.Parse(s.Substring(Pos, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                            Pos += 4;
                            break;
                        default: throw Fail("هروب غير معروف \\" + e);
                    }
                }
                throw Fail("نص غير مغلق");
            }

            object Num()
            {
                int start = Pos;
                bool frac = false;
                if (s[Pos] == '-') Pos++;
                while (Pos < s.Length)
                {
                    char c = s[Pos];
                    if (c >= '0' && c <= '9') { Pos++; continue; }
                    if (c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') { frac = true; Pos++; continue; }
                    break;
                }
                string t = s.Substring(start, Pos - start);
                long l;
                if (!frac && long.TryParse(t, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out l)) return l;
                double d;
                if (double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return d;
                throw Fail("عدد غير صالح " + t);
            }
        }

        public static string Write(object v)
        {
            StringBuilder sb = new StringBuilder();
            Write(sb, v);
            return sb.ToString();
        }

        public static void Write(StringBuilder sb, object v)
        {
            if (v == null) { sb.Append("null"); return; }
            string s = v as string;
            if (s != null) { Quote(sb, s); return; }
            if (v is bool) { sb.Append((bool)v ? "true" : "false"); return; }
            if (v is long || v is int || v is short || v is byte)
            {
                sb.Append(Convert.ToInt64(v, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture));
                return;
            }
            if (v is double || v is float || v is decimal)
            {
                double d = Convert.ToDouble(v, CultureInfo.InvariantCulture);
                if (double.IsNaN(d) || double.IsInfinity(d)) { sb.Append("null"); return; }
                sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
                return;
            }
            IDictionary<string, object> o = v as IDictionary<string, object>;
            if (o != null)
            {
                sb.Append('{');
                bool first = true;
                foreach (KeyValuePair<string, object> kv in o)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    Quote(sb, kv.Key);
                    sb.Append(':');
                    Write(sb, kv.Value);
                }
                sb.Append('}');
                return;
            }
            IEnumerable e = v as IEnumerable;
            if (e != null)
            {
                sb.Append('[');
                bool first = true;
                foreach (object x in e)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    Write(sb, x);
                }
                sb.Append(']');
                return;
            }
            throw new ArgumentException("نوع لا يُكتب JSON: " + v.GetType().Name);
        }

        public static void Quote(StringBuilder sb, string s)
        {
            sb.Append('"');
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        /* U+2028/2029 تكسر JavaScript القديم إن وُضع الناتج في سكربت */
                        if (c < 0x20 || c == (char)0x2028 || c == (char)0x2029) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        /* قراءة مريحة من كائن: الحقل الناقص يعطي القيمة الافتراضية */
        public static object Get(IDictionary<string, object> o, string k)
        {
            object v;
            return o != null && o.TryGetValue(k, out v) ? v : null;
        }

        public static string Str(IDictionary<string, object> o, string k)
        {
            object v;
            if (o == null || !o.TryGetValue(k, out v) || v == null) return "";
            string s = v as string;
            if (s != null) return s;
            if (v is double) return ((double)v).ToString("R", CultureInfo.InvariantCulture);
            if (v is bool) return (bool)v ? "true" : "false";
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        public static long Long(IDictionary<string, object> o, string k, long def)
        {
            object v;
            if (o == null || !o.TryGetValue(k, out v) || v == null) return def;
            if (v is long) return (long)v;
            if (v is double) return (long)Math.Round((double)v, MidpointRounding.AwayFromZero);
            if (v is bool) return (bool)v ? 1 : 0;
            long l;
            string s = v as string;
            if (s != null && long.TryParse(s.Trim(), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out l)) return l;
            return def;
        }

        public static double Num(IDictionary<string, object> o, string k, double def)
        {
            object v;
            if (o == null || !o.TryGetValue(k, out v) || v == null) return def;
            if (v is long) return (long)v;
            if (v is double) return (double)v;
            double d;
            string s = v as string;
            if (s != null && double.TryParse(s.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return d;
            return def;
        }

        public static bool Bool(IDictionary<string, object> o, string k)
        {
            object v;
            if (o == null || !o.TryGetValue(k, out v) || v == null) return false;
            if (v is bool) return (bool)v;
            if (v is long) return (long)v != 0;
            return false;
        }

        public static Dictionary<string, object> Obj(IDictionary<string, object> o, string k)
        {
            object v;
            if (o == null || !o.TryGetValue(k, out v)) return null;
            return v as Dictionary<string, object>;
        }

        public static List<object> Arr(IDictionary<string, object> o, string k)
        {
            object v;
            if (o == null || !o.TryGetValue(k, out v)) return new List<object>();
            List<object> a = v as List<object>;
            return a ?? new List<object>();
        }
    }
}
