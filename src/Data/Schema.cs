using System;
using System.Collections.Generic;
using System.Text;

namespace Qirtasiya.Data
{
    /* ترقية واحدة: رقم، واسم يُكتب في السجل، وأوامرها */
    public sealed class Migration
    {
        public readonly int Version;
        public readonly string Name;
        public readonly string Sql;
        /* يُنفَّذ بعد SQL وبناء المُطلِقات: البذور وتحويل البيانات. at = وقت الترقية */
        public readonly Action<Sqlite, string> Code;

        public Migration(int version, string name, string sql, Action<Sqlite, string> code)
        {
            Version = version; Name = name; Sql = sql; Code = code;
        }
    }

    /* ============================================================
       مخطط القاعدة وترقياته (المرحلة 1)
       ------------------------------------------------------------
       - كل مبلغ عدد صحيح بالدرهم، وكل كمية عدد صحيح (قرار 0006).
       - الجداول STRICT: لا يدخل نص في خانة مبلغ، ولا كسر في كمية.
       - الترقيات مرقّمة، وPRAGMA user_version يحفظ آخر ترقية طُبّقت.
         ترقية مطبَّقة لا تُعدَّل أبداً: أي تغيير ترقية جديدة بعدها.
       - كل جدول (إلا سجل التغييرات نفسه وحالة الجهاز) له مُطلِقات تكتب
         صورة الصف بعد كل إضافة وتعديل وحذف في change_log (قرار 0007).
         تُولَّد من أعمدة الجدول بعد كل ترقية، فلا ينسى أحد عموداً.
       الشرح بالعربي: docs/plan/schema.md
       ============================================================ */
    public static class Schema
    {
        /* "QRTS": يميّز ملف قاعدتنا عن أي ملف SQLite آخر */
        public const int AppId = 0x51525453;

        /* جداول لا تُسجَّل تغييراتها */
        public static readonly string[] Unlogged = { "change_log", "cur_op", "local_state" };

        /* فهرس البحث (search_*) يُبنى من الأصناف على كل جهاز: لا يُسجَّل ولا يُربط */
        public const string SearchPrefix = "search_";

        public static bool IsLogged(string table)
        {
            return Array.IndexOf(Unlogged, table) < 0 && !table.StartsWith(SearchPrefix, StringComparison.Ordinal);
        }

        public static List<Migration> All()
        {
            List<Migration> m = new List<Migration>();
            m.Add(new Migration(1, "الجداول الأولى", V1, SeedV1));
            m.Add(new Migration(2, "تاريخ طباعة اللاصقة (من 3.x)",
                "ALTER TABLE items ADD COLUMN label_printed TEXT NOT NULL DEFAULT '';", null));
            m.Add(new Migration(3, "فهرس البحث (FTS5 trigram)", V3Search, null));
            return m;
        }

        const string V1 = @"
-- ---------- الإعدادات والعدّادات ----------
CREATE TABLE settings(
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL
) STRICT;

-- آخر رقم فاتورة وآخر رمز كتاب وقرطاسية: لا يُعاد استعمال رقم ولو حُذف صاحبه
CREATE TABLE counters(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  value INTEGER NOT NULL
) STRICT;

-- ---------- المستخدمون والصلاحيات (قرار 0011) ----------
CREATE TABLE users(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('admin','staff')),
  pass_hash TEXT NOT NULL DEFAULT '',
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE user_perms(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perm TEXT NOT NULL,
  UNIQUE(user_id, perm)
) STRICT;

-- ---------- الأماكن: شجرة مرنة ----------
-- shop: المحل كله (الجذر الافتراضي). floor/section/cabinet/shelf: أرض البيع.
-- room: غرفة خزين داخل المحل. store: مخزن (لا يُباع منه مباشرة).
CREATE TABLE places(
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES places(id),
  kind TEXT NOT NULL CHECK(kind IN ('shop','floor','section','cabinet','shelf','room','store')),
  name TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX places_parent ON places(parent_id);

-- ---------- الموردون ودور النشر والتصنيفات ----------
CREATE TABLE suppliers(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  old_id TEXT NOT NULL DEFAULT ''
) STRICT;

-- خصم الجملة بأجزاء العشرة آلاف: 2000 = 20%
CREATE TABLE publishers(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  rate_bp INTEGER NOT NULL DEFAULT 0 CHECK(rate_bp BETWEEN 0 AND 10000),
  mode TEXT NOT NULL DEFAULT 'margin',
  phone TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  old_id TEXT NOT NULL DEFAULT ''
) STRICT;

-- قائمة التصنيفات للاختيار. الصنف يحمل اسم تصنيفه نصاً كما هو، فلا
-- يتغيّر تصنيف أي كتاب بتغيير القائمة (تصنيفات مصراتة لا تُلمس).
CREATE TABLE categories(
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('book','stat')),
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(kind, name)
) STRICT;

-- ---------- الأصناف (كتب وقرطاسية) ----------
CREATE TABLE items(
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('book','stat')),
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL DEFAULT '',
  cat TEXT NOT NULL DEFAULT '',
  cat_full TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  loc_note TEXT NOT NULL DEFAULT '',
  home_place_id INTEGER NOT NULL DEFAULT 1 REFERENCES places(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  price INTEGER NOT NULL DEFAULT 0 CHECK(price >= 0),
  price_w INTEGER NOT NULL DEFAULT 0 CHECK(price_w >= 0),
  cost INTEGER NOT NULL DEFAULT 0 CHECK(cost >= 0),
  min_qty INTEGER NOT NULL DEFAULT 0 CHECK(min_qty >= 0),
  note TEXT NOT NULL DEFAULT '',
  last_sold TEXT NOT NULL DEFAULT '',
  sold_total INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  old_id TEXT NOT NULL DEFAULT ''
) STRICT;
-- الباركود فريد بين الأصناف الموجودة، والفارغ مسموح لأي عدد
CREATE UNIQUE INDEX items_barcode ON items(barcode) WHERE barcode <> '' AND active = 1;
CREATE INDEX items_home ON items(home_place_id);
CREATE INDEX items_old ON items(old_id) WHERE old_id <> '';

-- الكمية لكل صنف في كل مكان. نفس الكتاب في أكثر من مكان مدعوم من البداية.
CREATE TABLE item_stock(
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  place_id INTEGER NOT NULL REFERENCES places(id),
  qty INTEGER NOT NULL,
  UNIQUE(item_id, place_id)
) STRICT;
CREATE INDEX item_stock_place ON item_stock(place_id);

-- كل حركة كمية بسببها. مجموع الحركات لكل صنف ومكان = الكمية.
-- op_id بلا مفتاح خارجي: صف الأمر في ops يُكتب آخر المعاملة، والمفتاح المؤجَّل
-- كلّف 6 أجزاء من الألف لكل بيعة على 100 ألف كتاب. الفحص الكامل يتأكد منه.
CREATE TABLE stock_moves(
  id INTEGER PRIMARY KEY,
  op_id INTEGER NOT NULL,
  at TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  place_id INTEGER NOT NULL REFERENCES places(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX stock_moves_item ON stock_moves(item_id, place_id);

-- ---------- الزبائن والديون ----------
CREATE TABLE customers(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  wholesale INTEGER NOT NULL DEFAULT 0,
  balance INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  old_id TEXT NOT NULL DEFAULT ''
) STRICT;

-- كل تغيّر في دين الزبون بسببه. مجموعها = balance.
CREATE TABLE customer_moves(
  id INTEGER PRIMARY KEY,
  op_id INTEGER NOT NULL,
  at TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX customer_moves_customer ON customer_moves(customer_id);

CREATE TABLE payments(
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  amount INTEGER NOT NULL CHECK(amount > 0),
  date TEXT NOT NULL,
  at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  old_id TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX payments_customer ON payments(customer_id);
CREATE INDEX payments_date ON payments(date);

-- ---------- الفواتير والإرجاع ----------
-- الإرجاع فاتورة بإشارة سالبة تشير لأصلها (ref_id)، كما في 3.x.
-- الحذف لا يمسح الصف: deleted_at يملأ، ورقمه لا يُعاد استعماله.
CREATE TABLE invoices(
  id INTEGER PRIMARY KEY,
  no INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('sale','return')),
  ref_id INTEGER REFERENCES invoices(id),
  date TEXT NOT NULL,
  at TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL,
  total INTEGER NOT NULL,
  profit INTEGER NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('cash','card','credit')),
  mode TEXT NOT NULL DEFAULT 'retail' CHECK(mode IN ('retail','wholesale')),
  customer_id INTEGER REFERENCES customers(id),
  paid INTEGER NOT NULL,
  due INTEGER NOT NULL,
  cash_back INTEGER NOT NULL DEFAULT 0,
  debt_cut INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'pos',
  device TEXT NOT NULL DEFAULT '',
  phone_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  edited_at TEXT NOT NULL DEFAULT '',
  deleted_at TEXT NOT NULL DEFAULT '',
  delete_reason TEXT NOT NULL DEFAULT '',
  deleted_restock INTEGER NOT NULL DEFAULT 0,
  old_id TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX invoices_date ON invoices(date);
CREATE INDEX invoices_customer ON invoices(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX invoices_ref ON invoices(ref_id) WHERE ref_id IS NOT NULL;
-- طلب التلفون نفسه لا يُسجَّل فاتورتين ولو وصل مرتين
CREATE UNIQUE INDEX invoices_phone ON invoices(phone_id) WHERE phone_id <> '';

CREATE TABLE invoice_lines(
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  line_no INTEGER NOT NULL,
  item_id INTEGER REFERENCES items(id),
  kind TEXT NOT NULL CHECK(kind IN ('book','stat')),
  name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK(qty > 0),
  price INTEGER NOT NULL,
  cost INTEGER NOT NULL,
  -- سطر الفاتورة الأصلية في الإرجاع. إن أُعيد بناء أسطرها بالتعديل (والإرجاع
  -- محذوف، فالقائم يمنع التعديل) تنقطع الإشارة ولا يُرفض التعديل.
  src_line_id INTEGER REFERENCES invoice_lines(id) ON DELETE SET NULL,
  UNIQUE(invoice_id, line_no)
) STRICT;
CREATE INDEX invoice_lines_item ON invoice_lines(item_id);
CREATE INDEX invoice_lines_src ON invoice_lines(src_line_id) WHERE src_line_id IS NOT NULL;

-- ---------- إدخال البضاعة ----------
CREATE TABLE purchases(
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  at TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  note TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  old_id TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX purchases_date ON purchases(date);

CREATE TABLE purchase_lines(
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  line_no INTEGER NOT NULL,
  item_id INTEGER REFERENCES items(id),
  name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK(qty > 0),
  cost INTEGER NOT NULL CHECK(cost >= 0),
  place_id INTEGER REFERENCES places(id),
  UNIQUE(purchase_id, line_no)
) STRICT;

-- ---------- الكتب على المباع ----------
CREATE TABLE consignors(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  old_id TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE consignments(
  id INTEGER PRIMARY KEY,
  consignor_id INTEGER NOT NULL REFERENCES consignors(id),
  item_id INTEGER UNIQUE REFERENCES items(id),
  kind TEXT NOT NULL CHECK(kind IN ('book','stat')),
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL CHECK(qty >= 0),
  sold INTEGER NOT NULL DEFAULT 0 CHECK(sold >= 0),
  returned INTEGER NOT NULL DEFAULT 0 CHECK(returned >= 0),
  price INTEGER NOT NULL,
  owner_price INTEGER NOT NULL,
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  old_id TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX consignments_owner ON consignments(consignor_id);

CREATE TABLE consignment_payments(
  id INTEGER PRIMARY KEY,
  consignor_id INTEGER NOT NULL REFERENCES consignors(id),
  amount INTEGER NOT NULL CHECK(amount > 0),
  date TEXT NOT NULL,
  at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  from_drawer INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER REFERENCES users(id),
  old_id TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX consignment_payments_owner ON consignment_payments(consignor_id);

-- ---------- الجرد ----------
-- base: المسجَّل لحظة العدّ (لا لحظة التصحيح): الجرد يطول والمحل يبيع.
CREATE TABLE count_sessions(
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  done_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','applied','cancelled')),
  scope TEXT NOT NULL DEFAULT 'all',
  scope_value TEXT NOT NULL DEFAULT '',
  n_items INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  less INTEGER NOT NULL DEFAULT 0,
  more INTEGER NOT NULL DEFAULT 0,
  loss_qty INTEGER NOT NULL DEFAULT 0,
  loss_val INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id),
  old_id TEXT NOT NULL DEFAULT ''
) STRICT;
-- جرد مفتوح واحد في كل مرة
CREATE UNIQUE INDEX count_sessions_open ON count_sessions(status) WHERE status = 'open';

CREATE TABLE count_entries(
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES count_sessions(id),
  item_id INTEGER REFERENCES items(id),
  name TEXT NOT NULL DEFAULT '',
  base_qty INTEGER NOT NULL,
  counted_qty INTEGER NOT NULL CHECK(counted_qty >= 0),
  cost INTEGER NOT NULL DEFAULT 0,
  counted_at TEXT NOT NULL,
  UNIQUE(session_id, item_id)
) STRICT;

-- ---------- إقفال اليوم ----------
CREATE TABLE day_closings(
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'day',
  expected INTEGER NOT NULL,
  counted INTEGER NOT NULL,
  diff INTEGER NOT NULL,
  at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  old_id TEXT NOT NULL DEFAULT ''
) STRICT;

-- ---------- رسائل الفروع (طلبات التحويل وردودها) ----------
CREATE TABLE branch_messages(
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  from_branch TEXT NOT NULL DEFAULT '',
  to_branch TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  lines TEXT NOT NULL DEFAULT '[]',
  at TEXT NOT NULL
) STRICT;

-- ---------- سجل العمليات: من فعل ماذا ومتى ----------
-- صف لكل أمر غيّر شيئاً، في معاملته نفسها. لا يُعدَّل بعد كتابته.
CREATE TABLE ops(
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id INTEGER NOT NULL DEFAULT 0,
  before TEXT NOT NULL DEFAULT '',
  after TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  old_id TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX ops_at ON ops(at);

-- ---------- ما لا يُسجَّل ----------
-- سجل التغييرات: منه الربط والنسخ كل 10 دقائق والاسترجاع (قرار 0007).
-- AUTOINCREMENT: الرقم لا يعود للخلف ولو قُصّ السجل القديم.
CREATE TABLE change_log(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id INTEGER NOT NULL,
  tbl TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  op TEXT NOT NULL CHECK(op IN ('i','u','d')),
  data TEXT
) STRICT;

-- الأمر الجاري: المُطلِقات تأخذ رقمه من هنا
CREATE TABLE cur_op(
  id INTEGER PRIMARY KEY CHECK(id = 1),
  op INTEGER NOT NULL
) STRICT;
INSERT INTO cur_op(id, op) VALUES(1, 0);

-- حالة هذا الجهاز وحده (آخر ما رُفع للربط، آخر نسخة...)
CREATE TABLE local_state(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
";

        /* فهرس البحث (المرحلة 3، قرار 0009). نصوص موحَّدة بـ Search.Norm يكتبها
           المحرك مع كل إضافة وتعديل وحذف لصنف (ShopDb.Search.cs)، والأصناف
           المحذوفة ليست فيه. يُعاد بناؤه كاملاً إن تغيّر Search.Version. */
        const string V3Search = @"
-- صف لكل صنف موجود: الاسم، والخانات الأخرى بين فواصل، وكلمات القريب (أولها nwords كلمة
-- من الاسم)، والملاحظة
CREATE TABLE search_items(
  item_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  other TEXT NOT NULL,
  words TEXT NOT NULL,
  nwords INTEGER NOT NULL,
  note TEXT NOT NULL
) STRICT;
-- «الاسم يبدأ بما كُتب» مرتّباً بالطول جاهزاً: أول حرف وأول حرفين بلا فرز، وأطول بنطاق.
-- والأسماء وحدها (الحرف والحرفان في وسط كلمة) تُمسح من search_items_name لا من الجدول كله
CREATE INDEX search_items_name ON search_items(name, kind);
CREATE INDEX search_items_p1 ON search_items(substr(name, 1, 1), length(name), kind);
CREATE INDEX search_items_p2 ON search_items(substr(name, 1, 2), length(name), kind);
-- أي جزء من 3 أحرف في الاسم والخانات الأخرى: المرشحون للمطابق
CREATE VIRTUAL TABLE search_tri USING fts5(name, other, content='search_items', content_rowid='item_id',
  tokenize='trigram case_sensitive 1', detail='none');
-- الكلمات بعد الطيّ التي قد تقرب من كلمة بحث (بلا الباركود والرموز): المرشحون للقريب،
-- وقاموسها في search_vocab. بلا محتوى: يُحذف منه بنفس كلماته المحسوبة من search_items
CREATE VIRTUAL TABLE search_words USING fts5(words, content='', tokenize='unicode61 remove_diacritics 0', detail='none');
CREATE VIRTUAL TABLE search_vocab USING fts5vocab(search_words, row);
";

        /* البذور: ما يلزم أي محل من أول يوم، وتُسجَّل كأي تغيير */
        static void SeedV1(Sqlite db, string at)
        {
            db.Run("INSERT INTO places(id, parent_id, kind, name, code, created_at) VALUES(1, NULL, 'shop', 'المحل', '', ?)", at);
            db.Run("INSERT INTO users(id, name, login, role, created_at, updated_at) VALUES(1, 'المدير', 'admin', 'admin', ?, ?)", at, at);
            db.Run("INSERT INTO counters(name, value) VALUES('invoice', 0), ('book', 0), ('stat', 0)");
        }

        /* مُطلِقات سجل التغييرات لكل جدول مسجَّل، من أعمدته الحالية.
           تُحذف القديمة وتُبنى من جديد بعد كل ترقية في معاملتها نفسها. */
        public static void RebuildTriggers(Sqlite db)
        {
            List<string> old = new List<string>();
            foreach (object[] r in db.Rows("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'log\\_%' ESCAPE '\\'"))
                old.Add((string)r[0]);
            foreach (string t in old) db.Exec("DROP TRIGGER \"" + t + "\"");

            foreach (string table in LoggedTables(db))
            {
                /* JSON لا يحمل بيانات ثنائية: عمود BLOB في جدول مسجَّل يُرفض هنا،
                   في الترقية نفسها، لا عند أول بيعة بعدها */
                if (db.Long("SELECT COUNT(*) FROM pragma_table_info(?) WHERE upper(type) = 'BLOB'", 0, table) > 0)
                    throw new InvalidOperationException("جدول مسجَّل فيه عمود BLOB: " + table);
                List<string> cols = Columns(db, table);
                StringBuilder obj = new StringBuilder("json_object(");
                StringBuilder diff = new StringBuilder();
                for (int i = 0; i < cols.Count; i++)
                {
                    if (i > 0) { obj.Append(", "); diff.Append(" OR "); }
                    obj.Append("'").Append(cols[i]).Append("', NEW.\"").Append(cols[i]).Append("\"");
                    diff.Append("OLD.\"").Append(cols[i]).Append("\" IS NOT NEW.\"").Append(cols[i]).Append("\"");
                }
                obj.Append(")");
                string ins = "INSERT INTO change_log(op_id, tbl, row_id, op, data) VALUES((SELECT op FROM cur_op WHERE id = 1), '" + table + "', ";
                db.Exec("CREATE TRIGGER \"log_" + table + "_i\" AFTER INSERT ON \"" + table + "\" BEGIN " +
                    ins + "NEW.id, 'i', " + obj + "); END;");
                db.Exec("CREATE TRIGGER \"log_" + table + "_u\" AFTER UPDATE ON \"" + table + "\" WHEN " + diff + " BEGIN " +
                    ins + "NEW.id, 'u', " + obj + "); END;");
                db.Exec("CREATE TRIGGER \"log_" + table + "_d\" AFTER DELETE ON \"" + table + "\" BEGIN " +
                    ins + "OLD.id, 'd', NULL); END;");
            }
        }

        public static List<string> LoggedTables(Sqlite db)
        {
            List<string> t = new List<string>();
            foreach (object[] r in db.Rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY rowid"))
            {
                string n = (string)r[0];
                if (IsLogged(n)) t.Add(n);
            }
            return t;
        }

        public static List<string> Columns(Sqlite db, string table)
        {
            List<string> c = new List<string>();
            foreach (object[] r in db.Rows("SELECT name FROM pragma_table_info(?)", table)) c.Add((string)r[0]);
            return c;
        }
    }
}
