using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Threading;

namespace Qirtasiya.Data
{
    public sealed class SearchOptions
    {
        /* كم نتيجة: 8 في البيع. 0 = كل المطابق مرتّباً (الجداول، تُقسَّم صفحات بعده) */
        public int Limit;
        /* book أو stat، أو null للكل */
        public string Kind;
        /* الملاحظات أيضاً (قرار 0009: خارج الفهرس، أبطأ، عند الطلب فقط) */
        public bool Notes;
        /* بحث أحدث على نفس القناة يلغي هذا (كل حرف جديد يلغي ما قبله) */
        public string Channel;
        /* شرط إضافي على الصنف i من items، بعلامات ? وقيمها (صفحة الأصناف) */
        public string Filter;
        public object[] FilterArgs;
    }

    public sealed class SearchResult
    {
        /* الأصناف مرتّبة: المطابق أولاً (Exact نتيجة)، ثم القريب */
        public readonly List<long> Ids = new List<long>();
        public readonly List<int> Scores = new List<int>();
        public int Exact;
        /* موضع أول نتيجة قريبة («هل تقصد؟»)، أو -1. نفس fz.first في 3.2 */
        public int NearFrom = -1;
        /* كم نتيجة اسمها هو البحث نفسه (Enter في البيع يضيفها) */
        public int Names;
        public bool Cancelled;
        public string Query = "";
        public long Ms;
    }

    /* ============================================================
       البحث بالاسم: الفهرس والاستعلام (المرحلة 3، قرار 0009)
       ------------------------------------------------------------
       الفهرس (search_*) نصوص موحَّدة بـ Search.Norm، يكتبها المحرك في
       نفس معاملة إضافة الصنف أو تعديله أو حذفه، فلا يتأخر عنه أبداً.
       يُبنى كاملاً عند الفتح إن تغيّر Search.Version، ويُصلَح ما نقص منه.

       الاستعلام على اتصال قراءة منفصل (WAL: لا ينتظر البيع ولا يؤخّره):
       1. المطابق: المرشحون من فهرس trigram (كل جزء من 3 أحرف في كلمات
          البحث)، ودرجة كل مرشح بنفس درجات 3.2 تُحسب داخل SQLite، فلا
          يخرج منها إلا المطلوب مرتّباً.
       2. القريب (حين لا يكفي المطابق): كل كلمة بحث تُقارن بقاموس الكلمات
          (مسافة التحرير)، والمرشحون من فهرس الكلمات بالكلمات القريبة،
          ودرجتهم بـ MatchNear كما في 3.2.
       بحث جديد على نفس القناة يوقف القديم فوراً (sqlite3_interrupt).
       ============================================================ */
    public sealed partial class ShopDb
    {
        /* ---------- الفهرس ---------- */

        const string SearchSrc = "SELECT id, kind, title, code, barcode, author, brand, publisher, cat, cat_full, loc_note, note FROM items";

        bool searchOn;          // القاعدة فيها الفهرس (الترقية 3)
        bool searchTouched;     // الأمر الجاري غيّر الفهرس
        bool searchRebuilt;     // الأمر الجاري بنى الفهرس كله
        long searchGen;         // يزيد بعد كل أمر غيّر الفهرس: عدد الأصناف يُعاد

        static bool HasSearch(Sqlite c)
        {
            return c.Long("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'search_items'", 0) > 0;
        }

        /* نصوص الفهرس لصنف واحد */
        sealed class IndexText
        {
            public string Name, Other, Words, Note;
            public int NameWords;
            /* كلمات فهرس القريب: ما قد يقرب من كلمة بحث (بلا أرقام الباركود والرموز) */
            public string Terms;
        }

        /* من صف بأعمدة SearchSrc */
        static IndexText MakeText(object[] r)
        {
            IndexText x = new IndexText();
            x.Name = Search.Norm((string)r[2]);
            string[] f = { (string)r[3], (string)r[4], (string)r[5], (string)r[6], (string)r[7], (string)r[8], (string)r[9], (string)r[10] };
            x.Other = Search.Others(f);
            x.Note = Search.Norm((string)r[11]);
            /* كلمات القريب كما في 3.2 (الطيّ على التوحيد الأساسي)، ومعها ما أضافه التوحيد
               الكامل: «الطبعة الخامسة» فيها «خامسه» (لغلط مثل «الخارسة») و«5» معاً */
            List<string> w = new List<string>();
            NearWords((string)r[2], w);
            x.NameWords = w.Count;
            foreach (string t in f) NearWords(t, w);
            x.Words = string.Join(" ", w.ToArray());
            List<string> terms = new List<string>();
            foreach (string t in w) if (Search.NearTerm(t) && !terms.Contains(t)) terms.Add(t);
            x.Terms = string.Join(" ", terms.ToArray());
            return x;
        }

        static void NearWords(string raw, List<string> into)
        {
            string[] a = Search.Words(Search.Basic(raw));
            into.AddRange(a);
            foreach (string t in Search.Words(Search.Norm(raw))) if (Array.IndexOf(a, t) < 0) into.Add(t);
        }

        /* صف الفهرس لصنف (أعمدة SearchSrc). trigram من الجدول نفسه، أو يُبنى بعد الكل */
        static IndexText SearchInsert(Sqlite c, object[] r, bool tri)
        {
            long id = (long)r[0];
            IndexText x = MakeText(r);
            c.Run("INSERT INTO search_items(item_id, kind, name, other, words, nwords, note) VALUES(?, ?, ?, ?, ?, ?, ?)",
                id, r[1], x.Name, x.Other, x.Words, x.NameWords, x.Note);
            if (tri) c.Run("INSERT INTO search_tri(rowid, name, other) VALUES(?, ?, ?)", id, x.Name, x.Other);
            c.Run("INSERT INTO search_words(rowid, words) VALUES(?, ?)", id, x.Terms);
            return x;
        }

        /* صنف واحد من جديد: يُحذف من الفهرس بقيمه القديمة، ويُكتب إن كان موجوداً.
           يعيد كلماته الجديدة للقاموس، أو null */
        static IndexText SearchIndex(Sqlite c, long id)
        {
            List<object[]> old = c.Rows("SELECT name, other FROM search_items WHERE item_id = ?", id);
            if (old.Count > 0)
            {
                c.Run("INSERT INTO search_tri(search_tri, rowid, name, other) VALUES('delete', ?, ?, ?)", id, old[0][0], old[0][1]);
                c.Run("INSERT INTO search_words(search_words, rowid, words) VALUES('delete', ?, ?)", id, OldTerms(c, id));
                c.Run("DELETE FROM search_items WHERE item_id = ?", id);
            }
            List<object[]> r = c.Rows(SearchSrc + " WHERE id = ? AND active = 1", id);
            return r.Count > 0 ? SearchInsert(c, r[0], true) : null;
        }

        /* كلمات القريب المكتوبة لصنف في الفهرس (فهرس الكلمات بلا محتوى: يُحذف منه بنفس كلماته) */
        static string OldTerms(Sqlite c, long id)
        {
            string words = c.Text("SELECT words FROM search_items WHERE item_id = ?", id) ?? "";
            List<string> terms = new List<string>();
            foreach (string t in words.Split(' ')) if (t.Length > 0 && Search.NearTerm(t) && !terms.Contains(t)) terms.Add(t);
            return string.Join(" ", terms.ToArray());
        }

        /* الفهرس كله من الأصناف (داخل معاملة من يناديه) */
        static int SearchRebuild(Sqlite c)
        {
            c.Exec("DELETE FROM search_items; INSERT INTO search_words(search_words) VALUES('delete-all');");
            int n = 0;
            using (Stmt s = c.Prepare(SearchSrc + " WHERE active = 1 ORDER BY id"))
            {
                object[] r = new object[12];
                while (s.Step())
                {
                    for (int i = 0; i < r.Length; i++) r[i] = s.Value(i);
                    SearchInsert(c, r, false);
                    n++;
                }
            }
            c.Exec("INSERT INTO search_tri(search_tri) VALUES('rebuild')");
            c.Run("INSERT INTO local_state(key, value) VALUES('search_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                Search.Version.ToString(CultureInfo.InvariantCulture));
            return n;
        }

        /* أصناف موجودة ليست في الفهرس، وصفوف فهرس لأصناف محذوفة */
        static List<long> SearchMissing(Sqlite c)
        {
            List<long> ids = new List<long>();
            foreach (object[] r in c.Rows(
                "SELECT i.id FROM items i WHERE i.active = 1 AND NOT EXISTS (SELECT 1 FROM search_items s WHERE s.item_id = i.id) " +
                "UNION ALL SELECT s.item_id FROM search_items s LEFT JOIN items i ON i.id = s.item_id WHERE i.id IS NULL OR i.active = 0"))
                ids.Add((long)r[0]);
            return ids;
        }

        static bool SearchCount(Sqlite c)
        {
            return c.Long("SELECT (SELECT COUNT(*) FROM items WHERE active = 1) = (SELECT COUNT(*) FROM search_items)", 0) == 1;
        }

        /* عند الفتح: بناء كامل إن تغيّر التوحيد، وإلا إصلاح ما نقص */
        void EnsureSearch()
        {
            searchOn = HasSearch(db);
            if (!searchOn || Report.ReadOnly) return;
            Stopwatch sw = Stopwatch.StartNew();
            lock (gate)
            {
                db.Exec("BEGIN IMMEDIATE");
                bool ok = false;
                try
                {
                    string v = db.Text("SELECT value FROM local_state WHERE key = 'search_version'");
                    /* العدّ يكفي هنا (كل أوامر الأصناف تكتب الفهرس)، والمقارنة الكاملة في CheckSearchIndex */
                    List<long> ids = v != Search.Version.ToString(CultureInfo.InvariantCulture) ? null
                        : SearchCount(db) ? new List<long>() : SearchMissing(db);
                    /* الكثير الناقص (أصناف أُدخلت من خارج المحرك) يُبنى كله أسرع من صنف صنف */
                    if (ids == null || ids.Count > 500) Report.SearchBuilt = SearchRebuild(db);
                    else
                    {
                        foreach (long id in ids) SearchIndex(db, id);
                        Report.SearchFixed = ids.Count;
                    }
                    db.Exec("COMMIT");
                    ok = true;
                }
                finally
                {
                    if (!ok) Rollback(db);
                }
            }
            Report.SearchMs = sw.ElapsedMilliseconds;
        }

        /* من أوامر الأصناف، داخل معاملتها */
        void IndexItem(long id)
        {
            if (!searchOn) return;
            IndexText x = SearchIndex(db, id);
            searchTouched = true;
            /* كلمات الصنف الجديدة تدخل القاموس بلا إعادة تحميله (الزائد من أمر
               لم يكتمل لا يضر: لا يطابق شيئاً في الفهرس) */
            if (x != null && x.Terms.Length > 0) lock (vocabGate) vocabNew.AddRange(x.Terms.Split(' '));
        }

        void RebuildSearch()
        {
            if (!searchOn) return;
            SearchRebuild(db);
            searchTouched = true;
            searchRebuilt = true;
        }

        /* من الفحص الكامل: كل صنف موجود في الفهرس مرة، ولا شيء غيره */
        void CheckSearch(List<string> bad)
        {
            if (!searchOn) return;
            int missing = SearchMissing(db).Count;
            if (missing > 0) bad.Add("فهرس البحث: " + missing + " صنف ناقص أو زائد");
        }

        /* فحص الفهرس حرفاً بحرف: نصوصه = توحيد الأصناف الآن، وفهرسا FTS5 يطابقانها.
           أبطأ من الفحص الكامل نفسه على 100 ألف صنف، والفهرس يُعاد بناؤه من الأصناف
           في أي وقت، فيُشغَّل في الاختبارات وعند الشك فقط. */
        public List<string> CheckSearchIndex()
        {
            List<string> bad = new List<string>();
            lock (gate)
            {
                if (!searchOn) { bad.Add("لا فهرس بحث في هذه القاعدة"); return bad; }
                CheckSearch(bad);
                /* rank = 1: trigram يطابق search_items نصاً بنص. فهرس الكلمات بلا محتوى: بنيته فقط،
                   وكلماته تُعدّ تحت */
                foreach (string q in new string[] { "INSERT INTO search_tri(search_tri, rank) VALUES('integrity-check', 1)",
                    "INSERT INTO search_words(search_words) VALUES('integrity-check')" })
                {
                    try { db.Exec(q); }
                    catch (SqliteException e) { bad.Add("فهرس البحث: " + e.Message + " — " + q); }
                }
                Dictionary<long, object[]> idx = new Dictionary<long, object[]>();
                foreach (object[] r in db.Rows("SELECT item_id, kind, name, other, words, nwords, note FROM search_items")) idx[(long)r[0]] = r;
                int stale = 0;
                Dictionary<string, long> terms = new Dictionary<string, long>(StringComparer.Ordinal);
                foreach (object[] r in db.Rows(SearchSrc + " WHERE active = 1"))
                {
                    object[] s;
                    if (!idx.TryGetValue((long)r[0], out s)) continue;
                    IndexText x = MakeText(r);
                    if ((string)s[1] != (string)r[1] || (string)s[2] != x.Name || (string)s[3] != x.Other || (string)s[4] != x.Words ||
                        (long)s[5] != x.NameWords || (string)s[6] != x.Note) stale++;
                    if (x.Terms.Length == 0) continue;
                    foreach (string t in x.Terms.Split(' ')) { long n; terms.TryGetValue(t, out n); terms[t] = n + 1; }
                }
                if (stale > 0) bad.Add("فهرس البحث: " + stale + " صنف تغيّر ولم يُحدَّث");
                /* فهرس الكلمات: كل كلمة في عدد أصنافها بالضبط */
                int wrong = 0;
                foreach (object[] r in db.Rows("SELECT term, doc FROM search_vocab"))
                {
                    long n;
                    if (!terms.TryGetValue((string)r[0], out n) || n != (long)r[1]) wrong++;
                    terms.Remove((string)r[0]);
                }
                wrong += terms.Count;
                if (wrong > 0) bad.Add("فهرس البحث: " + wrong + " كلمة في فهرس القريب لا تطابق الأصناف");
            }
            return bad;
        }

        /* ---------- الاستعلام ---------- */

        sealed class Ticket { public volatile bool Cancelled; }
        sealed class Cancel : Exception { }

        readonly object searchGate = new object();   // اتصال القراءة: بحث واحد في كل لحظة
        readonly object ticketGate = new object();
        readonly Dictionary<string, Ticket> tickets = new Dictionary<string, Ticket>();
        Sqlite reader;
        Ticket readerOwner;
        long countGen = -1, itemCount;
        /* قاموس القريب: يُحمَّل مرة، وتُضاف إليه كلمات الأصناف الجديدة، ويُعاد بعد بناء كامل */
        readonly object vocabGate = new object();
        readonly List<string> vocabNew = new List<string>();
        long vocabEpoch, vocabLoaded = -1;
        List<string> vocab;
        HashSet<string> vocabSet;

        /* نتيجة البحث بالترتيب. لا ترمي عند الإلغاء: Cancelled = true */
        public SearchResult SearchItems(string q, SearchOptions o)
        {
            if (o == null) o = new SearchOptions();
            if (!searchOn) throw Err("فهرس البحث غير موجود في هذه القاعدة.");
            Stopwatch sw = Stopwatch.StartNew();
            Ticket t = new Ticket();
            lock (ticketGate)
            {
                Ticket old;
                if (o.Channel != null && tickets.TryGetValue(o.Channel, out old))
                {
                    old.Cancelled = true;
                    if (readerOwner == old && reader != null) reader.Interrupt();
                }
                if (o.Channel != null) tickets[o.Channel] = t;
            }
            try
            {
                SearchResult r = null;
                lock (searchGate)
                {
                    if (disposed) throw Err("القاعدة مغلقة.");
                    if (!t.Cancelled)
                    {
                        if (reader == null) reader = OpenReader();
                        lock (ticketGate) readerOwner = t;
                        try { r = SearchCore(reader, q, o, t); }
                        catch (Cancel) { }
                        catch (SqliteException e) { if (e.Primary != 9) throw; }   // 9 = SQLITE_INTERRUPT
                        finally { lock (ticketGate) readerOwner = null; }
                    }
                }
                if (r == null) { r = new SearchResult(); r.Cancelled = true; }
                r.Ms = sw.ElapsedMilliseconds;
                return r;
            }
            finally
            {
                lock (ticketGate)
                {
                    Ticket cur;
                    if (o.Channel != null && tickets.TryGetValue(o.Channel, out cur) && cur == t) tickets.Remove(o.Channel);
                }
            }
        }

        /* للجداول (صفحة الأصناف): المطلوب حتى need نتيجة، والعدد.
           ثلاثة أحرف فأكثر: كل المطابق مرتّباً (من فهرس trigram، أجزاء من الألف).
           حرف أو حرفان يطابقان أغلب المكتبة: الصفحات المطلوبة فقط، والعدد حتى 1000
           (more = أكثر من ذلك)، بدل ترتيب 100 ألف صنف مع كل حرف. */
        public SearchResult SearchWindow(string q, SearchOptions o, int need, out long total, out bool more)
        {
            more = false;
            bool shortQ = true;
            foreach (string w in Search.Norm(q).Split(' ')) if (w.Length >= 3) shortQ = false;
            o.Limit = shortQ ? Math.Max(Math.Min(need, 2000), 1) : 0;
            SearchResult r = SearchItems(q, o);
            total = r.Ids.Count;
            if (r.Cancelled || !shortQ || r.Ids.Count < o.Limit) return r;
            long n;
            lock (searchGate)
            {
                if (disposed) throw Err("القاعدة مغلقة.");
                if (reader == null) reader = OpenReader();
                n = CountExact(reader, Search.Norm(q), o, 1000);
            }
            more = n > 1000;
            total = Math.Max(Math.Min(n, 1000), r.Ids.Count);
            return r;
        }

        /* كم صنفاً يطابق حرفياً، حتى cap + 1: كل كلمة في الاسم أو خانة أخرى (أي درجة فوق صفر) */
        static long CountExact(Sqlite c, string nq, SearchOptions o, long cap)
        {
            string O = o.Notes ? "(s.other || char(31) || s.note)" : "s.other";
            List<object> args = new List<object>();
            StringBuilder sql = new StringBuilder("SELECT COUNT(*) FROM (SELECT 1 FROM search_items s WHERE 1");
            foreach (string w in nq.Split(' '))
            {
                args.Add(w);
                sql.Append(" AND (instr(s.name, ?").Append(args.Count).Append(") > 0 OR instr(").Append(O).Append(", ?").Append(args.Count).Append(") > 0)");
            }
            Filters(sql, args, o);
            sql.Append(" LIMIT ").Append((cap + 1).ToString(CultureInfo.InvariantCulture)).Append(")");
            return c.Long(sql.ToString(), 0, args.ToArray());
        }

        Sqlite OpenReader()
        {
            Sqlite r = Sqlite.Open(FilePath, true, false);
            r.Exec("PRAGMA trusted_schema = OFF");
            return r;
        }

        bool disposed;

        void CloseReader()
        {
            lock (searchGate)
                lock (ticketGate)
                {
                    disposed = true;
                    if (reader != null) reader.Dispose();
                    reader = null;
                }
        }

        static void Check(Ticket t) { if (t.Cancelled) throw new Cancel(); }

        sealed class Hit
        {
            public long Id, Key;
            public string Kind;
            public int Score;
        }

        SearchResult SearchCore(Sqlite c, string q, SearchOptions o, Ticket t)
        {
            SearchResult res = new SearchResult();
            string nq = Search.Norm(q);
            res.Query = nq;
            if (nq.Length == 0) return res;
            string[] qs = nq.Split(' ');

            List<Hit> exact = o.Limit > 0 ? TopHits(c, nq, qs, o, t) : null;
            if (exact == null) exact = ExactHits(c, nq, qs, o, t, null, false);
            int names = 0;
            foreach (Hit h in exact) if (h.Score == 1000) names++;
            if (o.Limit > 0 && exact.Count >= o.Limit)
            {
                Fill(res, exact, null, o.Limit);
                res.Names = names;
                return res;
            }
            /* القريب حين لا يكفي المطابق. في الجداول الكبيرة (فوق 4000 صنف) فقط
               حين لا مطابق أصلاً، كما في 3.2: حتى لا تثقل الكتابة */
            List<Hit> near = null;
            if (o.Limit > 0 || exact.Count == 0 || ItemCount(c) <= 4000) near = NearHits(c, nq, exact, o, t);
            Fill(res, exact, near, o.Limit);
            res.Names = names;
            return res;
        }

        static void Fill(SearchResult res, List<Hit> exact, List<Hit> near, int limit)
        {
            foreach (Hit h in exact)
            {
                if (limit > 0 && res.Ids.Count >= limit) break;
                res.Ids.Add(h.Id); res.Scores.Add(h.Score);
            }
            res.Exact = res.Ids.Count;
            if (near == null) return;
            foreach (Hit h in near)
            {
                if (limit > 0 && res.Ids.Count >= limit) break;
                res.Ids.Add(h.Id); res.Scores.Add(h.Score);
            }
            if (res.Ids.Count > res.Exact) res.NearFrom = res.Exact;
        }

        long ItemCount(Sqlite c)
        {
            long g = Interlocked.Read(ref searchGen);
            if (countGen != g)
            {
                itemCount = c.Long("SELECT COUNT(*) FROM search_items", 0);
                countGen = g;
            }
            return itemCount;
        }

        /* شرط النوع والشرط الإضافي على المرشح s */
        static void Filters(StringBuilder sql, List<object> args, SearchOptions o)
        {
            if (!string.IsNullOrEmpty(o.Kind))
            {
                args.Add(o.Kind);
                sql.Append(" AND s.kind = ?").Append(args.Count);
            }
            if (!string.IsNullOrEmpty(o.Filter))
            {
                /* علامات ? في الشرط تأخذ الأرقام بعد آخر رقم قبلها: تُضاف قيمها آخراً */
                sql.Append(" AND EXISTS (SELECT 1 FROM items i WHERE i.id = s.item_id AND (").Append(o.Filter).Append("))");
                if (o.FilterArgs != null) args.AddRange(o.FilterArgs);
            }
        }

        /* في البيع (8 نتائج) تكفي غالباً الدرجات العليا، وتأتي من الفهارس بلا
           مرور على كل الأصناف (الحرف والحرفان لا trigram لهما). كل خطوة تكمل
           درجات معيّنة، فإن ملأ ما اكتمل الحدّ فهو الجواب:
           1. الاسم يبدأ بما كُتب، مرتّباً بالطول جاهزاً          ← 900 فأعلى
           2. ما كُتب كما هو بمسافاته (3 أحرف فأكثر)              ← 750 فأعلى
              أو حرفان: بداية كلمة « ري» أو «الري»                ← 850 فأعلى
           3. كلمات قصيرة فقط: الأسماء وحدها من فهرسها           ← 800 (700 لأكثر من كلمة)
           وإلا null: البحث الكامل. */
        static List<Hit> TopHits(Sqlite c, string nq, string[] qs, SearchOptions o, Ticket t)
        {
            List<Hit> hits = PrefixHits(c, nq, o);
            if (Enough(hits, o.Limit, 900)) return hits;
            if (o.Notes) return null;   // الملاحظات ليست في فهرس trigram
            List<string> g = new List<string>();
            if (nq.Length >= 3)
            {
                Search.Trigrams(nq, g);
                hits = Merge(hits, ExactHits(c, nq, qs, o, t, AndOf(g), false));
                if (Enough(hits, o.Limit, 750)) return hits;
            }
            else if (nq.Length == 2)
            {
                Search.Trigrams("ال" + nq, g);
                hits = Merge(hits, ExactHits(c, nq, qs, o, t, Search.Quote(" " + nq) + " OR (" + AndOf(g) + ")", false));
                if (Enough(hits, o.Limit, 850)) return hits;
            }
            foreach (string w in qs) if (w.Length >= 3) return null;   // الكامل بفهرس trigram سريع
            hits = Merge(hits, ExactHits(c, nq, qs, o, t, null, true));
            return Enough(hits, o.Limit, qs.Length == 1 ? 800 : 700) ? hits : null;
        }

        /* الحدّ امتلأ بنتائج درجتها مكتملة */
        static bool Enough(List<Hit> hits, int limit, int floor)
        {
            if (hits.Count < limit || hits[limit - 1].Score < floor) return false;
            hits.RemoveRange(limit, hits.Count - limit);
            return true;
        }

        static List<Hit> Merge(List<Hit> a, List<Hit> b)
        {
            HashSet<long> seen = new HashSet<long>();
            foreach (Hit h in a) seen.Add(h.Id);
            foreach (Hit h in b) if (seen.Add(h.Id)) a.Add(h);
            a.Sort(delegate (Hit x, Hit y)
            {
                if (x.Key != y.Key) return y.Key.CompareTo(x.Key);
                int k = string.CompareOrdinal(x.Kind, y.Kind);
                return k != 0 ? k : x.Id.CompareTo(y.Id);
            });
            return a;
        }

        static string AndOf(List<string> grams)
        {
            StringBuilder m = new StringBuilder();
            foreach (string g in grams) { if (m.Length > 0) m.Append(" AND "); m.Append(Search.Quote(g)); }
            return m.ToString();
        }

        /* الاسم يبدأ بالبحث (1000 إن كان هو نفسه، وإلا 900)، الأقصر أولاً */
        static List<Hit> PrefixHits(Sqlite c, string nq, SearchOptions o)
        {
            List<object> args = new List<object>();
            args.Add(nq);
            StringBuilder sql = new StringBuilder("SELECT s.item_id, s.kind, s.name = ?1, min(length(s.name), 4095) FROM search_items s WHERE ");
            if (nq.Length <= 2) sql.Append("substr(s.name, 1, ").Append(nq.Length).Append(") = ?1");
            else
            {
                /* كل اسم يبدأ بـ nq بين nq ونفسه بآخر حرف تالٍ (ترتيب UTF-8 = ترتيب الحروف) */
                args.Add(nq.Substring(0, nq.Length - 1) + (char)(nq[nq.Length - 1] + 1));
                sql.Append("s.name >= ?1 AND s.name < ?2");
            }
            Filters(sql, args, o);
            sql.Append(" ORDER BY length(s.name), s.kind, s.item_id LIMIT ").Append(o.Limit.ToString(CultureInfo.InvariantCulture));
            List<Hit> hits = new List<Hit>();
            foreach (object[] r in c.Rows(sql.ToString(), args.ToArray()))
            {
                Hit h = new Hit();
                h.Id = (long)r[0]; h.Kind = (string)r[1]; h.Score = (long)r[2] == 1 ? 1000 : 900;
                h.Key = h.Score * 4096L - (long)r[3];
                hits.Add(h);
            }
            return hits;
        }

        /* المطابق مرتّباً، ودرجته داخل SQLite.
           المفتاح = الدرجة × 4096، وفي الدرجات 700 فأعلى ناقص طول الاسم: الاسم
           الأقصر (الأقرب لما كُتب) أولاً، ثم الكتب قبل القرطاسية، ثم الأقدم. */
        static List<Hit> ExactHits(Sqlite c, string nq, string[] qs, SearchOptions o, Ticket t, string match, bool nameOnly)
        {
            const string N = "s.name";
            /* nameOnly: الأسماء وحدها، فيكفي فهرس الأسماء (أصغر بكثير من الجدول) */
            string O = nameOnly ? "''" : o.Notes
                ? "(CASE WHEN s.note = '' THEN s.other ELSE (CASE WHEN s.other = '' THEN char(31) ELSE s.other END) || s.note || char(31) END)"
                : "s.other";
            List<object> args = new List<object>();
            args.Add(nq);                 // ?1
            args.Add(nq.Length);          // ?2
            StringBuilder allName = new StringBuilder(), anyName = new StringBuilder(), allAny = new StringBuilder();
            for (int i = 0; i < qs.Length; i++)
            {
                args.Add(qs[i]);
                string p = "?" + args.Count;
                if (i > 0) { allName.Append(" AND "); anyName.Append(" OR "); allAny.Append(" AND "); }
                allName.Append("instr(").Append(N).Append(", ").Append(p).Append(") > 0");
                anyName.Append("instr(").Append(N).Append(", ").Append(p).Append(") > 0");
                allAny.Append("(instr(").Append(N).Append(", ").Append(p).Append(") > 0 OR instr(").Append(O).Append(", ").Append(p).Append(") > 0)");
            }
            string len = "min(length(" + N + "), 4095)";
            StringBuilder sql = new StringBuilder("SELECT s.item_id, s.kind, CASE");
            sql.Append(" WHEN ").Append(N).Append(" = ?1 THEN 1000 * 4096 - ").Append(len);
            sql.Append(" WHEN substr(").Append(N).Append(", 1, ?2) = ?1 THEN 900 * 4096 - ").Append(len);
            sql.Append(" WHEN instr(").Append(N).Append(", ?1) > 0 THEN (CASE WHEN instr(' ' || ").Append(N).Append(", ' ' || ?1) > 0")
                .Append(" OR instr(' ' || ").Append(N).Append(", ' ال' || ?1) > 0 OR instr(' ' || ").Append(N).Append(", ' وال' || ?1) > 0")
                .Append(" THEN 850 ELSE 800 END) * 4096 - ").Append(len);
            sql.Append(" WHEN instr(").Append(O).Append(", char(31) || ?1 || char(31)) > 0 THEN 750 * 4096 - ").Append(len);
            if (qs.Length == 1)
            {
                /* كلمة واحدة: 700 و500 تحتاجانها في الاسم (وقد فُحص)، فيبقى 400 */
                sql.Append(" WHEN instr(").Append(O).Append(", ?1) > 0 THEN 400 * 4096");
            }
            else
            {
                sql.Append(" WHEN ").Append(allName).Append(" THEN 700 * 4096 - ").Append(len);
                sql.Append(" WHEN ").Append(allAny).Append(" THEN (CASE WHEN ").Append(anyName).Append(" THEN 500 WHEN instr(")
                    .Append(O).Append(", ?1) > 0 THEN 400 ELSE 300 END) * 4096");
            }
            sql.Append(" ELSE 0 END AS k");

            /* المرشحون: من فهرس trigram إن كانت في البحث كلمة من 3 أحرف فأكثر،
               وإلا (حرف أو حرفان) كل الأصناف التي فيها أطول كلمة */
            List<string> tri = new List<string>();
            string longest = qs[0];
            foreach (string w in qs)
            {
                if (w.Length >= 3) Search.Trigrams(w, tri);
                if (w.Length > longest.Length) longest = w;
            }
            if (match != null || (tri.Count > 0 && !o.Notes))
            {
                args.Add(match ?? AndOf(tri));
                sql.Append(" FROM search_tri JOIN search_items s ON s.item_id = search_tri.rowid WHERE search_tri MATCH ?").Append(args.Count);
            }
            else
            {
                args.Add(longest);
                string p = "?" + args.Count;
                sql.Append(" FROM search_items s WHERE (instr(").Append(N).Append(", ").Append(p).Append(") > 0 OR instr(")
                    .Append(O).Append(", ").Append(p).Append(") > 0)");
            }
            Filters(sql, args, o);
            sql.Append(" ORDER BY k DESC, s.kind, s.item_id");
            if (o.Limit > 0) sql.Append(" LIMIT ").Append(o.Limit.ToString(CultureInfo.InvariantCulture));

            List<Hit> hits = new List<Hit>();
            Stmt st = c.Cached(sql.ToString());
            try
            {
                st.BindAll(args.ToArray());
                while (st.Step())
                {
                    long k = st.Long(2);
                    if (k <= 0) break;   // المرشحون غير المطابقين في آخر الترتيب
                    Hit h = new Hit();
                    h.Id = st.Long(0); h.Kind = st.Text(1); h.Key = k; h.Score = (int)((k + 4095) / 4096);
                    hits.Add(h);
                    if ((hits.Count & 1023) == 0) Check(t);
                }
            }
            finally { st.Reset(); }
            return hits;
        }

        /* كلمات القاموس: كل كلمة في فهرس القريب (Search.NearTerm) */
        List<string> Vocab(Sqlite c)
        {
            long epoch;
            lock (vocabGate) epoch = vocabEpoch;
            if (vocab == null || vocabLoaded != epoch)
            {
                lock (vocabGate) vocabNew.Clear();
                vocab = new List<string>();
                foreach (object[] r in c.Rows("SELECT term FROM search_vocab")) vocab.Add((string)r[0]);
                vocabSet = new HashSet<string>(vocab, StringComparer.Ordinal);
                vocabLoaded = epoch;
            }
            lock (vocabGate)
            {
                foreach (string w in vocabNew) if (vocabSet.Add(w)) vocab.Add(w);
                vocabNew.Clear();
            }
            return vocab;
        }

        /* يجهّز اتصال القراءة والقاموس، فلا ينتظرهما أول بحث (عند تشغيل البرنامج، في الخلفية) */
        public void WarmSearch()
        {
            if (!searchOn) return;
            lock (searchGate)
            {
                if (disposed) return;
                if (reader == null) reader = OpenReader();
                Vocab(reader);
                ItemCount(reader);
            }
        }

        List<Hit> NearHits(Sqlite c, string nq, List<Hit> exact, SearchOptions o, Ticket t)
        {
            List<Hit> near = new List<Hit>();
            string[] qw = Search.Words(nq);
            if (qw.Length == 0) return near;
            /* لكل كلمة بحث: الكلمات القريبة منها في القاموس ومسافتها. الكلمة القصيرة
               أو التي فيها رقم لا تُقرَّب (تُفحص بالاحتواء فقط) */
            Dictionary<string, double>[] maps = new Dictionary<string, double>[qw.Length];
            StringBuilder match = new StringBuilder();
            List<string> voc = null;
            for (int k = 0; k < qw.Length; k++)
            {
                string q = qw[k];
                if (q.Length < 3 || Search.HasDigit(q)) continue;
                if (voc == null) voc = Vocab(c);
                int max = q.Length >= 7 ? 2 : 1;
                Dictionary<string, double> m = new Dictionary<string, double>(StringComparer.Ordinal);
                foreach (string w in voc)
                {
                    double d = Search.WordDist(q, w, false, max);
                    if (d >= 0) m[w] = d;
                }
                Check(t);
                if (m.Count == 0) return near;
                maps[k] = m;
                if (match.Length > 0) match.Append(" AND ");
                match.Append('(');
                bool first = true;
                foreach (string w in m.Keys)
                {
                    if (!first) match.Append(" OR ");
                    match.Append(Search.Quote(w));
                    first = false;
                }
                match.Append(')');
            }
            if (match.Length == 0) return near;

            HashSet<long> skip = new HashSet<long>();
            foreach (Hit h in exact) skip.Add(h.Id);
            List<object> args = new List<object>();
            args.Add(match.ToString());
            StringBuilder sql = new StringBuilder("SELECT s.item_id, s.kind, s.words, s.nwords FROM search_words " +
                "JOIN search_items s ON s.item_id = search_words.rowid WHERE search_words MATCH ?1");
            Filters(sql, args, o);
            int n = 0;
            Stmt st = c.Cached(sql.ToString());
            try
            {
                st.BindAll(args.ToArray());
                while (st.Step())
                {
                    if ((++n & 255) == 0) Check(t);
                    long id = st.Long(0);
                    if (skip.Contains(id)) continue;
                    string[] hw = st.Text(2).Split(' ');
                    int nw = st.Int(3);
                    int sc = NearScore(qw, maps, hw, hw.Length);
                    if (sc == 0) continue;
                    /* الاسم القريب أهمّ من كلمة قريبة في المؤلف أو التصنيف، والاسم
                       القصير الذي تغطيه كلماتك أقرب من الطويل */
                    int sn = NearScore(qw, maps, hw, nw);
                    if (sn > 0) sc = sn + 100 + Search.JsRound(10.0 * qw.Length / Math.Max(Math.Max(nw, qw.Length), 1));
                    Hit h = new Hit();
                    h.Id = id; h.Kind = st.Text(1); h.Score = sc;
                    near.Add(h);
                }
            }
            finally { st.Reset(); }
            near.Sort(delegate (Hit a, Hit b)
            {
                if (a.Score != b.Score) return b.Score.CompareTo(a.Score);
                int k = string.CompareOrdinal(a.Kind, b.Kind);
                return k != 0 ? k : a.Id.CompareTo(b.Id);
            });
            /* البعيد جداً عن أقرب نتيجة ضجيج لا يفيد */
            if (near.Count > 0)
            {
                int best = near[0].Score;
                near.RemoveAll(delegate (Hit h) { return h.Score < best - 20; });
            }
            return near;
        }

        /* MatchNear من 3.2 على أول n كلمة من كلمات الصنف، والمسافات من القاموس */
        static int NearScore(string[] qw, Dictionary<string, double>[] maps, string[] hw, int n)
        {
            if (n == 0) return 0;
            double sum = 0, pos = 0;
            for (int k = 0; k < qw.Length; k++)
            {
                double best = -1;
                int at = -1;
                for (int i = 0; i < n; i++)
                {
                    double d;
                    if (maps[k] != null) { if (!maps[k].TryGetValue(hw[i], out d)) continue; }
                    else if (hw[i].IndexOf(qw[k], StringComparison.Ordinal) >= 0) d = 0;
                    else continue;
                    if (at < 0 || d < best) { best = d; at = i; }
                    if (best == 0) break;
                }
                if (at < 0) return 0;
                sum += best; pos += Math.Min(at, 12);
            }
            return Math.Max(1, Search.JsRound(90 - sum * 15 - pos / qw.Length));
        }
    }
}
