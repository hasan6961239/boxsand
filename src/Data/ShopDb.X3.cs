using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Threading;

namespace Qirtasiya.Data
{
    /* تغيير واحد في بيانات 3.x: سجل (Key = معرّفه) أو قسم كامل (Key = "") */
    public sealed class X3Op
    {
        public string Coll = "", Key = "";
        public bool HasBase, HasNow;
        public object Base, Now;
        /* السجل الجديد: جيرانه في ترتيب الواجهة، ليأخذ مكانه نفسه */
        public string Prev, Next;
        /* إرجاع: معرّف الفاتورة الأصلية (رقمها قد يتغيّر عند جهاز المحل) */
        public string RefId = "";
        /* ترتيب جديد لسجلات القسم كله (نادر: الواجهة رتّبت الموجود) */
        public List<string> Order;
    }

    /* ============================================================
       واجهة 3.x نفسها فوق الأساس الجديد (قرار 0025)
       ------------------------------------------------------------
       - ملف 3.x (store.json) يُحفظ هنا سجلاً سجلاً كما هو، في x3_docs:
         كل مصفوفة سجلات بمعرّفات (الكتب، الفواتير، الزبائن...) سجل لكل
         عنصر، وكل ما سواها (meta، counters، مصفوفة بلا معرّفات) قسم واحد.
         التصدير يعيد الملف نفسه حرفياً: نفس النص لكل سجل، بنفس الترتيب.
       - كل حفظ من الواجهة فرقٌ عن آخر ما رأته (base): ما غيّرته هي وحدها
         يُطبَّق، وما تغيّر هنا من غيرها (جهاز ثانٍ) يبقى.
       - الكميات والديون وما شابهها تُطبَّق فرقاً لا رقماً: بيعة من اللابتوب
         وبيعة في المحل للكتاب نفسه تنقصان النسختين معاً.
       - x3_docs جدول مسجَّل: يصل الجهاز الثاني كأي جدول (قرار 0023).
       ============================================================ */
    public sealed partial class ShopDb
    {
        /* يزيد مع كل تغيير في بيانات 3.x: الواجهة تعرف أن عليها إعادة التحميل */
        long x3Gen;
        public long X3Gen { get { return Interlocked.Read(ref x3Gen); } }

        /* يُستدعى بعد كل تغيير محفوظ (البرنامج يكتب store.json منه) */
        public Action X3Changed;

        void X3Touched()
        {
            Interlocked.Increment(ref x3Gen);
            Action a = X3Changed;
            if (a != null) { try { a(); } catch (Exception) { } }
        }

        /* هل تعمل هذه القاعدة بواجهة 3.x؟ */
        public bool X3Mode
        {
            get { lock (gate) return db.Text("SELECT value FROM settings WHERE key = 'ui'") == "\"3x\""; }
        }

        /* ---------- القراءة ---------- */

        /* الملف كله كما كتبته الواجهة آخر مرة (وما طبّقه جهاز المحل بعدها) */
        public string X3Export()
        {
            lock (gate) return X3ExportCore(db);
        }

        static string X3ExportCore(Sqlite c)
        {
            Dictionary<string, string> single = new Dictionary<string, string>(StringComparer.Ordinal);
            Dictionary<string, List<string>> recs = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            List<string> seen = new List<string>();
            string keysJson = null;
            foreach (object[] r in c.Rows("SELECT coll, key, body FROM x3_docs ORDER BY coll, ord, id"))
            {
                string coll = (string)r[0], key = (string)r[1], body = (string)r[2];
                if (coll == "$keys") { keysJson = body; continue; }
                if (key.Length == 0) single[coll] = body;
                else
                {
                    List<string> l;
                    if (!recs.TryGetValue(coll, out l)) recs[coll] = l = new List<string>();
                    l.Add(body);
                }
                if (!seen.Contains(coll)) seen.Add(coll);
            }
            if (keysJson == null && seen.Count == 0) return "null";
            List<string> order = new List<string>();
            if (keysJson != null)
                foreach (object k in (Json.Parse(keysJson) as List<object>) ?? new List<object>()) order.Add(Convert.ToString(k, CultureInfo.InvariantCulture));
            foreach (string k in seen) if (!order.Contains(k)) order.Add(k);

            StringBuilder sb = new StringBuilder(1 << 16);
            sb.Append('{');
            bool first = true;
            foreach (string k in order)
            {
                string one;
                List<string> many;
                bool hasOne = single.TryGetValue(k, out one), hasMany = recs.TryGetValue(k, out many);
                if (!hasOne && !hasMany) continue;
                if (!first) sb.Append(',');
                first = false;
                Json.Quote(sb, k);
                sb.Append(':');
                if (hasMany)
                {
                    sb.Append('[');
                    for (int i = 0; i < many.Count; i++) { if (i > 0) sb.Append(','); sb.Append(many[i]); }
                    sb.Append(']');
                }
                else sb.Append(one);
            }
            sb.Append('}');
            return sb.ToString();
        }

        /* ---------- الفرق ---------- */

        /* مصفوفة سجلات: غير فارغة، وكل عنصر كائن بمعرّف نصي أو رقمي لا يتكرر */
        static bool X3IsRecords(object v)
        {
            List<object> l = v as List<object>;
            if (l == null || l.Count == 0) return false;
            HashSet<string> ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (object o in l)
            {
                Dictionary<string, object> d = o as Dictionary<string, object>;
                if (d == null) return false;
                string id = X3Id(d);
                if (id == null || !ids.Add(id)) return false;
            }
            return true;
        }

        static string X3Id(Dictionary<string, object> d)
        {
            object v;
            if (!d.TryGetValue("id", out v) || v == null) return null;
            if (v is string) return ((string)v).Length > 0 ? (string)v : null;
            if (v is long || v is double) return Json.Write(v);
            return null;
        }

        /* ما غيّرته الواجهة بين base (آخر ما رأته) وnow (ما ترسله الآن) */
        public static List<X3Op> X3Diff(string baseJson, string nowJson)
        {
            Dictionary<string, object> b = string.IsNullOrEmpty(baseJson) ? null : Json.Parse(baseJson) as Dictionary<string, object>;
            Dictionary<string, object> n = Json.Parse(nowJson) as Dictionary<string, object>;
            if (n == null) throw new ShopException("محتوى الحفظ ليس ملف بيانات 3.x.");
            return X3Diff(b ?? new Dictionary<string, object>(), n);
        }

        public static List<X3Op> X3Diff(Dictionary<string, object> b, Dictionary<string, object> n)
        {
            List<X3Op> ops = new List<X3Op>();
            List<object> bKeys = new List<object>(b.Keys), nKeys = new List<object>(n.Keys);
            if (!JsonEqual(bKeys, nKeys)) ops.Add(Single("$keys", b.Count > 0, bKeys, true, nKeys));

            foreach (KeyValuePair<string, object> kv in n)
            {
                object bv;
                bool had = b.TryGetValue(kv.Key, out bv);
                if (had && JsonEqual(bv, kv.Value)) continue;
                bool bRec = had && X3IsRecords(bv), nRec = X3IsRecords(kv.Value);
                if (!nRec)
                {
                    if (bRec) foreach (object o in (List<object>)bv) ops.Add(Rec(kv.Key, (Dictionary<string, object>)o, null));
                    ops.Add(Single(kv.Key, had && !bRec, bv, true, kv.Value));
                    continue;
                }
                if (had && !bRec) ops.Add(Single(kv.Key, true, bv, false, null));
                RecordsDiff(kv.Key, bRec ? (List<object>)bv : new List<object>(), (List<object>)kv.Value, ops);
            }
            foreach (KeyValuePair<string, object> kv in b)
            {
                if (n.ContainsKey(kv.Key)) continue;
                if (X3IsRecords(kv.Value)) foreach (object o in (List<object>)kv.Value) ops.Add(Rec(kv.Key, (Dictionary<string, object>)o, null));
                else ops.Add(Single(kv.Key, true, kv.Value, false, null));
            }
            return ops;
        }

        static X3Op Single(string coll, bool hasB, object bv, bool hasN, object nv)
        {
            X3Op o = new X3Op();
            o.Coll = coll; o.Key = "";
            o.HasBase = hasB; o.Base = hasB ? bv : null;
            o.HasNow = hasN; o.Now = hasN ? nv : null;
            return o;
        }

        static X3Op Rec(string coll, Dictionary<string, object> bv, Dictionary<string, object> nv)
        {
            X3Op o = new X3Op();
            o.Coll = coll;
            o.Key = X3Id(nv ?? bv);
            o.HasBase = bv != null; o.Base = bv;
            o.HasNow = nv != null; o.Now = nv;
            return o;
        }

        static void RecordsDiff(string coll, List<object> bl, List<object> nl, List<X3Op> ops)
        {
            Dictionary<string, Dictionary<string, object>> bm = new Dictionary<string, Dictionary<string, object>>(StringComparer.Ordinal);
            List<string> bOrder = new List<string>();
            foreach (object o in bl)
            {
                Dictionary<string, object> d = (Dictionary<string, object>)o;
                string id = X3Id(d);
                bm[id] = d; bOrder.Add(id);
            }
            List<string> nOrder = new List<string>();
            foreach (object o in nl) nOrder.Add(X3Id((Dictionary<string, object>)o));
            HashSet<string> nSet = new HashSet<string>(nOrder, StringComparer.Ordinal);

            for (int i = 0; i < nl.Count; i++)
            {
                Dictionary<string, object> d = (Dictionary<string, object>)nl[i];
                string id = nOrder[i];
                Dictionary<string, object> old;
                if (bm.TryGetValue(id, out old))
                {
                    if (!JsonEqual(old, d)) ops.Add(Rec(coll, old, d));
                    continue;
                }
                X3Op op = Rec(coll, null, d);
                op.Prev = i > 0 ? nOrder[i - 1] : null;
                op.Next = i + 1 < nOrder.Count ? nOrder[i + 1] : null;
                if (coll == "invoices") op.RefId = ReturnRefId(d, nl);
                ops.Add(op);
            }
            foreach (string id in bOrder) if (!nSet.Contains(id)) ops.Add(Rec(coll, bm[id], null));

            /* الموجود من قبل بترتيب آخر؟ */
            List<string> bCommon = bOrder.FindAll(delegate (string id) { return nSet.Contains(id); });
            List<string> nCommon = nOrder.FindAll(delegate (string id) { return bm.ContainsKey(id); });
            for (int i = 0; i < bCommon.Count; i++)
            {
                if (bCommon[i] == nCommon[i]) continue;
                X3Op o = new X3Op();
                o.Coll = coll; o.Key = ""; o.Order = nOrder;
                o.HasBase = true; o.HasNow = true;
                ops.Add(o);
                break;
            }
        }

        /* إرجاع جديد: معرّف الفاتورة التي رقمها refNo في ما ترسله الواجهة */
        static string ReturnRefId(Dictionary<string, object> v, List<object> all)
        {
            if (Json.Str(v, "kind") != "return") return "";
            object rn;
            if (!v.TryGetValue("refNo", out rn) || rn == null) return "";
            foreach (object o in all)
            {
                Dictionary<string, object> x = (Dictionary<string, object>)o;
                if (Json.Str(x, "kind") == "return") continue;
                object no;
                if (x.TryGetValue("no", out no) && JsonEqual(no, rn)) return X3Id(x) ?? "";
            }
            return "";
        }

        /* ---------- المساواة والدمج ---------- */

        public static bool JsonEqual(object a, object b)
        {
            if (a == null || b == null) return a == null && b == null;
            if (IsNum(a) && IsNum(b)) return Num(a) == Num(b);
            string sa = a as string;
            if (sa != null) return b is string && string.Equals(sa, (string)b, StringComparison.Ordinal);
            if (a is bool) return b is bool && (bool)a == (bool)b;
            List<object> la = a as List<object>;
            if (la != null)
            {
                List<object> lb = b as List<object>;
                if (lb == null || la.Count != lb.Count) return false;
                for (int i = 0; i < la.Count; i++) if (!JsonEqual(la[i], lb[i])) return false;
                return true;
            }
            Dictionary<string, object> da = a as Dictionary<string, object>;
            if (da != null)
            {
                Dictionary<string, object> db2 = b as Dictionary<string, object>;
                if (db2 == null || da.Count != db2.Count) return false;
                foreach (KeyValuePair<string, object> kv in da)
                {
                    object v;
                    if (!db2.TryGetValue(kv.Key, out v) || !JsonEqual(kv.Value, v)) return false;
                }
                return true;
            }
            return false;
        }

        static bool IsNum(object v) { return v is long || v is double; }
        static double Num(object v) { return v is long ? (long)v : (double)v; }

        /* cur + (now - base)، عدداً صحيحاً إن كانت كلها صحيحة */
        static object AddDelta(object cur, object bv, object nv)
        {
            if (cur is long && bv is long && nv is long) return (long)cur + ((long)nv - (long)bv);
            double r = Math.Round(Num(cur) + (Num(nv) - Num(bv)), 6, MidpointRounding.AwayFromZero);
            if (r == Math.Floor(r) && Math.Abs(r) < 1e15) return (long)r;
            return r;
        }

        /* حقول تُطبَّق فرقاً: ما بِيع هنا وما بِيع هناك يُحسبان معاً */
        static readonly Dictionary<string, string[]> X3Additive = new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            { "books", new string[] { "qty", "store", "soldTotal" } },
            { "stationery", new string[] { "qty", "store", "soldTotal" } },
            { "customers", new string[] { "balance" } },
            { "consignments", new string[] { "sold", "returned" } }
        };

        static bool Additive(string coll, string field)
        {
            string[] f;
            return X3Additive.TryGetValue(coll, out f) && Array.IndexOf(f, field) >= 0;
        }

        /* دمج ثلاثي على مستوى الحقل: ما غيّرته الواجهة (base ← now) فوق الحالي cur */
        static object Merge3(string coll, object bv, object nv, object cur)
        {
            if (JsonEqual(cur, bv)) return nv;
            Dictionary<string, object> b = bv as Dictionary<string, object>, n = nv as Dictionary<string, object>, c = cur as Dictionary<string, object>;
            if (b == null || n == null || c == null) return nv;
            Dictionary<string, object> r = new Dictionary<string, object>(c, StringComparer.Ordinal);
            List<string> fields = new List<string>(n.Keys);
            foreach (string k in b.Keys) if (!n.ContainsKey(k)) fields.Add(k);
            foreach (string k in fields)
            {
                object x, y, z;
                bool hb = b.TryGetValue(k, out x), hn = n.TryGetValue(k, out y);
                if (hb == hn && JsonEqual(x, y)) continue;
                if (!hn) { r.Remove(k); continue; }
                bool hc = c.TryGetValue(k, out z);
                if (coll == "counters" && hc && IsNum(y) && IsNum(z)) { r[k] = Num(y) >= Num(z) ? y : z; continue; }
                if (hb && hc && Additive(coll, k) && IsNum(x) && IsNum(y) && IsNum(z)) { r[k] = AddDelta(z, x, y); continue; }
                r[k] = y;
            }
            return r;
        }

        /* ---------- المخزن: القاعدة أو الذاكرة (لما ينتظر جهاز المحل على الجهاز الثاني) ---------- */

        sealed class X3Row
        {
            public long Id;
            public double Ord;
            public string Body;
        }

        interface IX3Store
        {
            X3Row Get(string coll, string key);
            void Put(string coll, string key, double ord, string body);
            void Del(string coll, string key);
            double? OrdAfter(string coll, double ord);
            double? OrdBefore(string coll, double ord);
            double? MaxOrd(string coll);
            void Renumber(string coll);
            bool CodeUsed(string coll, string code, string exceptKey);
            void SetOrd(string coll, string key, double ord);
        }

        sealed class X3DbStore : IX3Store
        {
            readonly Sqlite c;
            public int Changes;
            public X3DbStore(Sqlite s) { c = s; }

            public X3Row Get(string coll, string key)
            {
                List<object[]> r = c.Rows("SELECT id, ord, body FROM x3_docs WHERE coll = ? AND key = ?", coll, key);
                if (r.Count == 0) return null;
                X3Row x = new X3Row();
                x.Id = (long)r[0][0]; x.Ord = Convert.ToDouble(r[0][1], CultureInfo.InvariantCulture); x.Body = (string)r[0][2];
                return x;
            }
            public void Put(string coll, string key, double ord, string body)
            {
                X3Row x = Get(coll, key);
                if (x == null) c.Run("INSERT INTO x3_docs(coll, key, ord, body) VALUES(?, ?, ?, ?)", coll, key, ord, body);
                else if (x.Body != body || x.Ord != ord) c.Run("UPDATE x3_docs SET ord = ?, body = ? WHERE id = ?", ord, body, x.Id);
                else return;
                Changes++;
            }
            public void Del(string coll, string key) { Changes += c.Run("DELETE FROM x3_docs WHERE coll = ? AND key = ?", coll, key); }
            double? D(string sql, params object[] args)
            {
                List<object[]> r = c.Rows(sql, args);
                object v = r.Count == 0 ? null : r[0][0];
                return v == null ? (double?)null : Convert.ToDouble(v, CultureInfo.InvariantCulture);
            }
            public double? OrdAfter(string coll, double ord) { return D("SELECT MIN(ord) FROM x3_docs WHERE coll = ? AND key <> '' AND ord > ?", coll, ord); }
            public double? OrdBefore(string coll, double ord) { return D("SELECT MAX(ord) FROM x3_docs WHERE coll = ? AND key <> '' AND ord < ?", coll, ord); }
            public double? MaxOrd(string coll) { return D("SELECT MAX(ord) FROM x3_docs WHERE coll = ? AND key <> ''", coll); }
            public void Renumber(string coll)
            {
                long i = 0;
                foreach (object[] r in c.Rows("SELECT id FROM x3_docs WHERE coll = ? AND key <> '' ORDER BY ord, id", coll))
                    c.Run("UPDATE x3_docs SET ord = ? WHERE id = ?", (double)(++i * 1024), r[0]);
                Changes++;
            }
            public bool CodeUsed(string coll, string code, string exceptKey)
            {
                return c.Long("SELECT COUNT(*) FROM x3_docs WHERE coll = ? AND key <> ? AND key <> '' AND json_extract(body, '$.code') = ?", 0, coll, exceptKey, code) > 0;
            }
            public void SetOrd(string coll, string key, double ord)
            {
                Changes += c.Run("UPDATE x3_docs SET ord = ? WHERE coll = ? AND key = ? AND ord <> ?", ord, coll, key, ord);
            }
        }

        /* الملف في الذاكرة: لعرض ما أُرسل لجهاز المحل ولم يرجع بعد */
        sealed class X3MemStore : IX3Store
        {
            public readonly Dictionary<string, Dictionary<string, X3Row>> Colls = new Dictionary<string, Dictionary<string, X3Row>>(StringComparer.Ordinal);
            public readonly List<string> Keys = new List<string>();

            Dictionary<string, X3Row> C(string coll)
            {
                Dictionary<string, X3Row> m;
                if (!Colls.TryGetValue(coll, out m)) Colls[coll] = m = new Dictionary<string, X3Row>(StringComparer.Ordinal);
                return m;
            }
            public X3Row Get(string coll, string key) { X3Row r; return C(coll).TryGetValue(key, out r) ? r : null; }
            public void Put(string coll, string key, double ord, string body)
            {
                X3Row r = Get(coll, key);
                if (r == null) { r = new X3Row(); C(coll)[key] = r; }
                r.Ord = ord; r.Body = body;
            }
            public void Del(string coll, string key) { C(coll).Remove(key); }
            IEnumerable<double> Ords(string coll)
            {
                foreach (KeyValuePair<string, X3Row> kv in C(coll)) if (kv.Key.Length > 0) yield return kv.Value.Ord;
            }
            public double? OrdAfter(string coll, double ord) { double? m = null; foreach (double o in Ords(coll)) if (o > ord && (m == null || o < m)) m = o; return m; }
            public double? OrdBefore(string coll, double ord) { double? m = null; foreach (double o in Ords(coll)) if (o < ord && (m == null || o > m)) m = o; return m; }
            public double? MaxOrd(string coll) { double? m = null; foreach (double o in Ords(coll)) if (m == null || o > m) m = o; return m; }
            public void Renumber(string coll)
            {
                List<X3Row> l = new List<X3Row>();
                foreach (KeyValuePair<string, X3Row> kv in C(coll)) if (kv.Key.Length > 0) l.Add(kv.Value);
                l.Sort(delegate (X3Row a, X3Row b) { return a.Ord.CompareTo(b.Ord); });
                for (int i = 0; i < l.Count; i++) l[i].Ord = (i + 1) * 1024;
            }
            public bool CodeUsed(string coll, string code, string exceptKey)
            {
                foreach (KeyValuePair<string, X3Row> kv in C(coll))
                {
                    if (kv.Key.Length == 0 || kv.Key == exceptKey) continue;
                    Dictionary<string, object> d = Json.Parse(kv.Value.Body) as Dictionary<string, object>;
                    if (d != null && Json.Str(d, "code") == code) return true;
                }
                return false;
            }
            public void SetOrd(string coll, string key, double ord) { X3Row r = Get(coll, key); if (r != null) r.Ord = ord; }

            public string Export()
            {
                StringBuilder sb = new StringBuilder(1 << 16);
                sb.Append('{');
                bool first = true;
                List<string> order = new List<string>(Keys);
                foreach (string k in Colls.Keys) if (k != "$keys" && !order.Contains(k)) order.Add(k);
                foreach (string k in order)
                {
                    Dictionary<string, X3Row> m;
                    if (!Colls.TryGetValue(k, out m) || m.Count == 0) continue;
                    if (!first) sb.Append(',');
                    first = false;
                    Json.Quote(sb, k);
                    sb.Append(':');
                    X3Row one;
                    if (m.TryGetValue("", out one)) { sb.Append(one.Body); continue; }
                    List<X3Row> l = new List<X3Row>(m.Values);
                    l.Sort(delegate (X3Row a, X3Row b) { return a.Ord.CompareTo(b.Ord); });
                    sb.Append('[');
                    for (int i = 0; i < l.Count; i++) { if (i > 0) sb.Append(','); sb.Append(l[i].Body); }
                    sb.Append(']');
                }
                sb.Append('}');
                return sb.ToString();
            }
        }

        /* ---------- التطبيق ---------- */

        /* نتيجة حفظ: كم تغيّر، وهل تغيّر شيء غير ما أرسلته الواجهة (فتعيد التحميل) */
        public sealed class X3Result
        {
            public int Changes;
            public bool Merged;
            public Dictionary<string, long> Renumbered = new Dictionary<string, long>(StringComparer.Ordinal);
        }

        /* يطبّق التغييرات على st. remote: من جهاز ثانٍ (أرقام الفواتير والرموز تُعطى هنا) */
        static X3Result X3ApplyTo(IX3Store st, List<X3Op> ops, bool remote)
        {
            X3Result res = new X3Result();
            X3Row countersRow = st.Get("counters", "");
            Dictionary<string, object> counters = countersRow == null ? null : Json.Parse(countersRow.Body) as Dictionary<string, object>;
            long invBase = counters == null ? 0 : Json.Long(counters, "invoice", 0);
            long nextNo = invBase;
            bool countersBumped = false;

            /* الفواتير الجديدة: رقمها التالي هنا إن كان رقمها مأخوذاً (أو جاءت من جهاز ثانٍ) */
            List<X3Op> newInv = ops.FindAll(delegate (X3Op o) { return o.Coll == "invoices" && !o.HasBase && o.HasNow && o.Key.Length > 0; });
            newInv.Sort(delegate (X3Op a, X3Op b)
            {
                return Json.Long((Dictionary<string, object>)a.Now, "no", 0).CompareTo(Json.Long((Dictionary<string, object>)b.Now, "no", 0));
            });
            Dictionary<long, long> noMap = new Dictionary<long, long>();
            foreach (X3Op o in newInv)
            {
                Dictionary<string, object> v = (Dictionary<string, object>)o.Now;
                long no = Json.Long(v, "no", 0);
                if (!remote && (no > invBase || no <= 0)) { nextNo = Math.Max(nextNo, no); continue; }
                long fresh = ++nextNo;
                if (fresh != no)
                {
                    noMap[no] = fresh;
                    v["no"] = fresh;
                    res.Renumbered[o.Key] = fresh;
                }
                countersBumped = true;
            }
            /* الإرجاع: رقم الفاتورة الأصلية كما هو هنا */
            foreach (X3Op o in newInv)
            {
                Dictionary<string, object> v = (Dictionary<string, object>)o.Now;
                if (Json.Str(v, "kind") != "return") continue;
                X3Row orig = o.RefId.Length > 0 ? st.Get("invoices", o.RefId) : null;
                if (orig != null)
                {
                    Dictionary<string, object> ov = Json.Parse(orig.Body) as Dictionary<string, object>;
                    if (ov != null && ov.ContainsKey("no")) v["refNo"] = ov["no"];
                }
                else
                {
                    long rn = Json.Long(v, "refNo", 0), m;
                    if (noMap.TryGetValue(rn, out m)) v["refNo"] = m;
                }
            }

            foreach (X3Op o in ops)
            {
                if (o.Coll == "$keys")
                {
                    if (o.HasNow) st.Put("$keys", "", 0, Json.Write(o.Now)); else st.Del("$keys", "");
                    continue;
                }
                if (o.Order != null) { ApplyOrder(st, o.Coll, o.Order); continue; }
                X3Row cur = st.Get(o.Coll, o.Key);
                if (!o.HasNow)
                {
                    if (cur != null) st.Del(o.Coll, o.Key);
                    continue;
                }
                object curV = cur == null ? null : Json.Parse(cur.Body);
                object val;
                if (cur == null) val = o.Now;
                else if (!o.HasBase) { val = o.Now; res.Merged |= !JsonEqual(curV, o.Now); }
                else
                {
                    val = Merge3(o.Coll, o.Base, o.Now, curV);
                    res.Merged |= !JsonEqual(curV, o.Base);
                }
                if (o.Coll == "counters" && countersBumped)
                {
                    Dictionary<string, object> cv = val as Dictionary<string, object>;
                    if (cv != null && Json.Long(cv, "invoice", 0) < nextNo) { cv = new Dictionary<string, object>(cv); cv["invoice"] = nextNo; val = cv; }
                    countersBumped = false;
                }
                if ((o.Coll == "books" || o.Coll == "stationery") && !o.HasBase && cur == null) val = FreshCode(st, o.Coll, (Dictionary<string, object>)val, o.Key, ref counters, res);
                double ord = cur != null ? cur.Ord : o.Key.Length == 0 ? 0 : NewOrd(st, o.Coll, o.Prev, o.Next);
                st.Put(o.Coll, o.Key, ord, Json.Write(val));
            }
            /* أرقام جديدة بلا تغيير في counters من الواجهة نفسها */
            if (countersBumped && counters != null && Json.Long(counters, "invoice", 0) < nextNo)
            {
                X3Row cr = st.Get("counters", "");
                Dictionary<string, object> cv = cr == null ? null : Json.Parse(cr.Body) as Dictionary<string, object>;
                if (cv != null)
                {
                    cv["invoice"] = nextNo;
                    st.Put("counters", "", cr.Ord, Json.Write(cv));
                }
            }
            if (counters != null && counters.ContainsKey("$dirty"))
            {
                counters.Remove("$dirty");
                X3Row cr = st.Get("counters", "");
                Dictionary<string, object> cv = cr == null ? null : Json.Parse(cr.Body) as Dictionary<string, object>;
                if (cv != null)
                {
                    foreach (string k in new string[] { "book", "stat" })
                        if (Json.Long(counters, k, 0) > Json.Long(cv, k, 0)) cv[k] = counters[k];
                    st.Put("counters", "", cr.Ord, Json.Write(cv));
                }
            }
            if (res.Renumbered.Count > 0) res.Merged = true;
            return res;
        }

        /* صنف جديد برمز مأخوذ هنا (جهازان أضافا معاً): الرمز التالي K0187 / Q0042 */
        static object FreshCode(IX3Store st, string coll, Dictionary<string, object> v, string key, ref Dictionary<string, object> counters, X3Result res)
        {
            string code = Json.Str(v, "code");
            if (code.Length == 0 || !st.CodeUsed(coll, code, key)) return v;
            string kind = coll == "books" ? "book" : "stat", prefix = coll == "books" ? "K" : "Q";
            if (counters == null) counters = new Dictionary<string, object>();
            long n = Json.Long(counters, kind, 0);
            string fresh;
            do { n++; fresh = prefix + n.ToString(CultureInfo.InvariantCulture).PadLeft(4, '0'); } while (st.CodeUsed(coll, fresh, key));
            counters[kind] = n;
            counters["$dirty"] = true;
            Dictionary<string, object> r = new Dictionary<string, object>(v);
            if (Json.Str(r, "barcode") == code) r["barcode"] = fresh;
            r["code"] = fresh;
            res.Merged = true;
            return r;
        }

        static double NewOrd(IX3Store st, string coll, string prev, string next)
        {
            for (int attempt = 0; attempt < 2; attempt++)
            {
                X3Row p = prev != null ? st.Get(coll, prev) : null, n = next != null ? st.Get(coll, next) : null;
                double? lo = null, hi = null;
                if (p != null) { lo = p.Ord; hi = st.OrdAfter(coll, p.Ord); }
                else if (n != null) { hi = n.Ord; lo = st.OrdBefore(coll, n.Ord); }
                else { double? m = st.MaxOrd(coll); return m == null ? 1024 : m.Value + 1024; }
                if (lo == null) return hi.Value - 1024;
                if (hi == null) return lo.Value + 1024;
                if (hi.Value - lo.Value > 1e-6) return (lo.Value + hi.Value) / 2;
                st.Renumber(coll);
            }
            double? mx = st.MaxOrd(coll);
            return mx == null ? 1024 : mx.Value + 1024;
        }

        static void ApplyOrder(IX3Store st, string coll, List<string> order)
        {
            for (int i = 0; i < order.Count; i++) st.SetOrd(coll, order[i], (i + 1) * 1024.0);
        }

        /* ---------- الحفظ ---------- */

        /* حفظ من واجهة 3.x على هذا الجهاز: ما تغيّر بين base وnow فوق الحالي */
        public X3Result X3Save(string baseJson, string nowJson, long userId)
        {
            List<X3Op> ops = X3Diff(baseJson, nowJson);
            return X3Apply(ops, false, userId, "");
        }

        public X3Result X3Apply(List<X3Op> ops, bool remote, long userId, string device)
        {
            if (ops.Count == 0) return new X3Result();
            X3Result r = Run<X3Result>("x3-save", userId, delegate (Cmd c)
            {
                if (db.Text("SELECT value FROM settings WHERE key = 'ui'") != "\"3x\"")
                    db.Run("INSERT INTO settings(key, value) VALUES('ui', '\"3x\"') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
                X3DbStore st = new X3DbStore(db);
                X3Result res = X3ApplyTo(st, ops, remote);
                res.Changes = st.Changes;
                c.Detail = X3Summary(ops);
                if (!string.IsNullOrEmpty(device)) c.Device = device;
                return res;
            });
            if (r.Changes > 0) X3Touched();
            return r;
        }

        /* «3.x: كتب +1 ~2، فواتير +1» للسجل */
        static string X3Summary(List<X3Op> ops)
        {
            Dictionary<string, int[]> by = new Dictionary<string, int[]>(StringComparer.Ordinal);
            foreach (X3Op o in ops)
            {
                if (o.Coll == "$keys") continue;
                int[] n;
                if (!by.TryGetValue(o.Coll, out n)) by[o.Coll] = n = new int[3];
                if (!o.HasBase && o.HasNow) n[0]++; else if (o.HasBase && !o.HasNow) n[2]++; else n[1]++;
            }
            StringBuilder sb = new StringBuilder("حفظ 3.x:");
            foreach (KeyValuePair<string, int[]> kv in by)
            {
                sb.Append(' ').Append(kv.Key);
                if (kv.Value[0] > 0) sb.Append(" +").Append(kv.Value[0]);
                if (kv.Value[1] > 0) sb.Append(" ~").Append(kv.Value[1]);
                if (kv.Value[2] > 0) sb.Append(" -").Append(kv.Value[2]);
            }
            return sb.ToString();
        }

        /* أول مرة: ملف 3.x كله إلى القاعدة (أو ما اختلف عنها، إن كانت فيها نسخة) */
        public X3Result X3Adopt(string storeJson, long userId)
        {
            string cur;
            lock (gate) cur = db.Long("SELECT COUNT(*) FROM x3_docs", 0) > 0 ? X3ExportCore(db) : null;
            List<X3Op> ops = X3Diff(cur, storeJson);
            if (ops.Count == 0)
            {
                lock (gate)
                    if (db.Text("SELECT value FROM settings WHERE key = 'ui'") != "\"3x\"")
                        Run("x3-adopt", userId, delegate (Cmd c)
                        {
                            db.Run("INSERT INTO settings(key, value) VALUES('ui', '\"3x\"') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
                            c.Detail = "واجهة 3.x على الأساس الجديد";
                        });
                return new X3Result();
            }
            return X3Apply(ops, false, userId, "");
        }

        /* ---------- نقل التغييرات لجهاز المحل ---------- */

        public static string X3OpsJson(List<X3Op> ops)
        {
            List<object> l = new List<object>();
            foreach (X3Op o in ops)
            {
                Dictionary<string, object> d = new Dictionary<string, object>();
                d["c"] = o.Coll; d["k"] = o.Key;
                if (o.HasBase) d["b"] = o.Base;
                if (o.HasNow) d["n"] = o.Now;
                if (o.Prev != null) d["p"] = o.Prev;
                if (o.Next != null) d["x"] = o.Next;
                if (o.RefId.Length > 0) d["r"] = o.RefId;
                if (o.Order != null) d["o"] = new List<object>(o.Order.ToArray());
                l.Add(d);
            }
            return Json.Write(l);
        }

        public static List<X3Op> X3OpsFrom(object json)
        {
            List<X3Op> ops = new List<X3Op>();
            List<object> l = json as List<object>;
            if (l == null) throw new ShopException("تغييرات 3.x غير مفهومة.");
            foreach (object x in l)
            {
                Dictionary<string, object> d = x as Dictionary<string, object>;
                if (d == null) throw new ShopException("تغييرات 3.x غير مفهومة.");
                X3Op o = new X3Op();
                o.Coll = Json.Str(d, "c"); o.Key = Json.Str(d, "k");
                o.HasBase = d.ContainsKey("b"); o.Base = o.HasBase ? d["b"] : null;
                o.HasNow = d.ContainsKey("n"); o.Now = o.HasNow ? d["n"] : null;
                if (d.ContainsKey("p")) o.Prev = Json.Str(d, "p");
                if (d.ContainsKey("x")) o.Next = Json.Str(d, "x");
                o.RefId = Json.Str(d, "r");
                if (d.ContainsKey("o"))
                {
                    o.Order = new List<string>();
                    foreach (object k in Json.Arr(d, "o")) o.Order.Add(Convert.ToString(k, CultureInfo.InvariantCulture));
                }
                if (o.Coll.Length == 0) throw new ShopException("تغييرات 3.x بلا قسم.");
                ops.Add(o);
            }
            return ops;
        }

        /* قائمة كتب الفرع للفروع الأخرى (CatalogJson) من بيانات 3.x نفسها:
           qty ما في المحل (الرفوف وغرفة الخزين)، store ما في المخازن، والسعر بالدرهم */
        string X3CatalogJson(out int count)
        {
            Dictionary<string, object> s = Json.Parse(X3ExportCore(db)) as Dictionary<string, object> ?? new Dictionary<string, object>();
            Dictionary<string, object> branch = Json.Obj(s, "branch") ?? new Dictionary<string, object>();
            Dictionary<string, object> meta = Json.Obj(s, "meta") ?? new Dictionary<string, object>();
            Dictionary<string, double> wh = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (object w in Json.Arr(s, "warehouses"))
            {
                Dictionary<string, object> wd = w as Dictionary<string, object>;
                if (wd == null) continue;
                foreach (object o in Json.Arr(wd, "stock"))
                {
                    Dictionary<string, object> st = o as Dictionary<string, object>;
                    if (st == null) continue;
                    string k = Json.Str(st, "type") + ":" + X3Str(st, "itemId");
                    double q;
                    wh.TryGetValue(k, out q);
                    wh[k] = q + X3Num(st, "qty");
                }
            }
            StringBuilder sb = new StringBuilder();
            sb.Append("{\"v\":1,\"branch\":{\"id\":");
            Json.Quote(sb, Json.Str(branch, "id"));
            sb.Append(",\"name\":");
            Json.Quote(sb, Json.Str(branch, "name").Length > 0 ? Json.Str(branch, "name") : Json.Str(meta, "shopName"));
            sb.Append(",\"city\":");
            Json.Quote(sb, Json.Str(branch, "city"));
            sb.Append(",\"phone\":");
            Json.Quote(sb, Json.Str(branch, "phone"));
            sb.Append("},\"at\":");
            Json.Quote(sb, Stamp(clock()));
            sb.Append(",\"items\":[");
            count = 0;
            foreach (string coll in new string[] { "books", "stationery" })
            {
                string type = coll == "books" ? "book" : "stat";
                foreach (object o in Json.Arr(s, coll))
                {
                    Dictionary<string, object> it = o as Dictionary<string, object>;
                    if (it == null) continue;
                    double inWh;
                    wh.TryGetValue(type + ":" + X3Str(it, "id"), out inWh);
                    string lib = X3Str(it, "lib"), shelf = X3Str(it, "shelf"), loc = X3Str(it, "loc");
                    string place = loc.Length > 0 ? loc : lib.Length > 0 || shelf.Length > 0 ?
                        (lib.Length > 0 ? "خزانة " + lib : "") + (lib.Length > 0 && shelf.Length > 0 ? " · " : "") + (shelf.Length > 0 ? "رف " + shelf : "") : "";
                    if (count++ > 0) sb.Append(',');
                    sb.Append('[');
                    Json.Quote(sb, type); sb.Append(',');
                    Json.Quote(sb, X3Str(it, "code")); sb.Append(',');
                    Json.Quote(sb, X3Str(it, "title").Length > 0 ? X3Str(it, "title") : X3Str(it, "name")); sb.Append(',');
                    Json.Quote(sb, X3Str(it, "author")); sb.Append(',');
                    Json.Quote(sb, X3Str(it, "barcode")); sb.Append(',');
                    Json.Quote(sb, X3Str(it, "cat")); sb.Append(',');
                    sb.Append(((long)Math.Round(X3Num(it, "qty"))).ToString(CultureInfo.InvariantCulture)).Append(',');
                    sb.Append(((long)Math.Round(inWh)).ToString(CultureInfo.InvariantCulture)).Append(',');
                    sb.Append(((long)Math.Round(X3Num(it, "price") * 1000)).ToString(CultureInfo.InvariantCulture)).Append(',');
                    Json.Quote(sb, place);
                    sb.Append(']');
                }
            }
            sb.Append("]}");
            return sb.ToString();
        }

        /* حقول 3.x كما كتبتها الواجهة: النص قد يكون رقماً، والرقم قد يكون نصاً */
        static string X3Str(Dictionary<string, object> d, string k)
        {
            object v;
            if (!d.TryGetValue(k, out v) || v == null) return "";
            if (v is string) return (string)v;
            if (v is long || v is double) return Json.Write(v);
            return "";
        }

        static double X3Num(Dictionary<string, object> d, string k)
        {
            object v;
            if (!d.TryGetValue(k, out v) || v == null) return 0;
            if (v is long) return (long)v;
            if (v is double) return (double)v;
            double x;
            string t = v as string;
            return t != null && double.TryParse(t.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out x) ? x : 0;
        }

        /* الجهاز الثاني: الملف كما في نسخة جهاز المحل، وفوقه ما أُرسل ولم يرجع بعد */
        public string X3ExportWithPending()
        {
            lock (gate)
            {
                string device = db.Text("SELECT value FROM local_state WHERE key = 'sync.device'") ?? "";
                List<object[]> pend = db.Rows("SELECT o.body FROM sync_outbox o WHERE o.cmd = 'x3.apply' AND NOT EXISTS " +
                    "(SELECT 1 FROM remote_cmds r WHERE r.device = ? AND r.n = o.n) ORDER BY o.n", device);
                if (pend.Count == 0) return X3ExportCore(db);
                X3MemStore m = new X3MemStore();
                foreach (object[] r in db.Rows("SELECT coll, key, ord, body FROM x3_docs"))
                {
                    if ((string)r[0] == "$keys")
                    {
                        foreach (object k in (Json.Parse((string)r[3]) as List<object>) ?? new List<object>()) m.Keys.Add(Convert.ToString(k, CultureInfo.InvariantCulture));
                        continue;
                    }
                    m.Put((string)r[0], (string)r[1], Convert.ToDouble(r[2], CultureInfo.InvariantCulture), (string)r[3]);
                }
                foreach (object[] p in pend)
                {
                    Dictionary<string, object> body = Json.Parse((string)p[0]) as Dictionary<string, object>;
                    try
                    {
                        List<X3Op> ops = X3OpsFrom(Json.Get(body, "ops"));
                        X3ApplyTo(m, ops, false);
                        foreach (X3Op o in ops)
                            if (o.Coll == "$keys" && o.HasNow)
                            {
                                m.Keys.Clear();
                                foreach (object k in (List<object>)o.Now) m.Keys.Add(Convert.ToString(k, CultureInfo.InvariantCulture));
                            }
                    }
                    catch (Exception) { }
                }
                return m.Export();
            }
        }
    }
}
