using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Qirtasiya.Data
{
    /* بيانات صنف كما يكتبها البائع أو الاستيراد. المبالغ بالدرهم */
    public sealed class ItemInput
    {
        public string Kind = "book";
        public string Code = "";          // فارغ = رمز تلقائي K0001 / Q0001
        public string Title = "";
        public string Author = "";
        public string Brand = "";
        public string Publisher = "";
        public string Barcode = "";
        public string Cat = "";
        public string CatFull = "";
        public string Unit = "";
        public string LocNote = "";
        public string Note = "";
        public long Price, PriceW, Cost, Min;
        public long HomePlaceId = 1;
        public long SupplierId;           // 0 = بلا مورّد
        public string OldId = "";
    }

    public sealed class ItemRow
    {
        public long Id, HomePlaceId, SupplierId, Price, PriceW, Cost, Min, SoldTotal;
        public string Kind, Code, Title, Author, Brand, Publisher, Barcode, Cat, CatFull, Unit, LocNote, Note,
            LastSold, CreatedAt, UpdatedAt, OldId;
        public bool Active;

        public string KindName { get { return Kind == "book" ? "كتاب" : "صنف"; } }
    }

    public sealed partial class ShopDb
    {
        const string ItemCols = "id, kind, code, title, author, brand, publisher, barcode, cat, cat_full, unit, loc_note, " +
            "home_place_id, IFNULL(supplier_id, 0), price, price_w, cost, min_qty, note, last_sold, sold_total, active, created_at, updated_at, old_id";

        static ItemRow ReadItem(object[] r)
        {
            ItemRow it = new ItemRow();
            it.Id = (long)r[0]; it.Kind = (string)r[1]; it.Code = (string)r[2]; it.Title = (string)r[3];
            it.Author = (string)r[4]; it.Brand = (string)r[5]; it.Publisher = (string)r[6]; it.Barcode = (string)r[7];
            it.Cat = (string)r[8]; it.CatFull = (string)r[9]; it.Unit = (string)r[10]; it.LocNote = (string)r[11];
            it.HomePlaceId = (long)r[12]; it.SupplierId = (long)r[13]; it.Price = (long)r[14]; it.PriceW = (long)r[15];
            it.Cost = (long)r[16]; it.Min = (long)r[17]; it.Note = (string)r[18]; it.LastSold = (string)r[19];
            it.SoldTotal = (long)r[20]; it.Active = (long)r[21] != 0; it.CreatedAt = (string)r[22];
            it.UpdatedAt = (string)r[23]; it.OldId = (string)r[24];
            return it;
        }

        ItemRow LoadItem(long id)
        {
            List<object[]> rows = db.Rows("SELECT " + ItemCols + " FROM items WHERE id = ?", id);
            return rows.Count == 0 ? null : ReadItem(rows[0]);
        }

        ItemRow ActiveItem(long id)
        {
            ItemRow it = LoadItem(id);
            if (it == null || !it.Active) throw Err("الصنف غير موجود (ربما حُذف).");
            return it;
        }

        public ItemRow GetItem(long id) { lock (gate) return LoadItem(id); }

        public ItemRow FindByBarcode(string barcode)
        {
            lock (gate)
            {
                /* «barcode <> ''» حرفياً في الاستعلام: بدونه لا يستعمل SQLite الفهرس الجزئي */
                List<object[]> rows = db.Rows("SELECT " + ItemCols + " FROM items WHERE barcode = ? AND barcode <> '' AND active = 1", (barcode ?? "").Trim());
                return rows.Count == 0 ? null : ReadItem(rows[0]);
            }
        }

        public ItemRow FindByCode(string code)
        {
            lock (gate)
            {
                List<object[]> rows = db.Rows("SELECT " + ItemCols + " FROM items WHERE code = ? COLLATE NOCASE", (code ?? "").Trim());
                return rows.Count == 0 ? null : ReadItem(rows[0]);
            }
        }

        /* الكمية في كل مكان: رقم المكان ← الكمية */
        public Dictionary<long, long> StockOf(long itemId)
        {
            lock (gate)
            {
                Dictionary<long, long> m = new Dictionary<long, long>();
                foreach (object[] r in db.Rows("SELECT place_id, qty FROM item_stock WHERE item_id = ?", itemId))
                    m[(long)r[0]] = (long)r[1];
                return m;
            }
        }

        /* ما في المحل (أرض البيع وغرفة الخزين)، بلا المخازن — مثل qty في 3.x */
        public long ShopQty(long itemId) { lock (gate) return ShopQty0(itemId); }

        long ShopQty0(long itemId)
        {
            return db.Long("SELECT IFNULL(SUM(s.qty), 0) FROM item_stock s JOIN places p ON p.id = s.place_id " +
                "WHERE s.item_id = ? AND p.kind <> 'store'", 0, itemId);
        }

        long QtyAt(long itemId, long placeId)
        {
            return db.Long("SELECT qty FROM item_stock WHERE item_id = ? AND place_id = ?", 0, itemId, placeId);
        }

        /* ---------- الكميات: كل تغيير صف رصيد + صف حركة ---------- */

        void AddStock(Cmd c, long itemId, long placeId, long delta, string reason, string refType, long refId)
        {
            if (delta == 0) return;
            db.Run("INSERT INTO item_stock(item_id, place_id, qty) VALUES(?, ?, ?) " +
                "ON CONFLICT(item_id, place_id) DO UPDATE SET qty = qty + excluded.qty", itemId, placeId, delta);
            db.Run("INSERT INTO stock_moves(op_id, at, item_id, place_id, delta, reason, ref_type, ref_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                c.OpId, c.At, itemId, placeId, delta, reason, refType ?? "", refId);
        }

        /* يُنقص الكمية للبيع كما في 3.x: من مكان الصنف أولاً، ثم بقية رفوف
           المحل، ثم غرفة الخزين — ولا يُمسّ المخزن. ما لم يُغطَّ يُسجَّل سالباً
           على مكان الصنف إن سُمح (المحل يبيع وإن كان الرقم المسجَّل ناقصاً).
           يعيد ما أُخذ من غرفة الخزين، ليُنبَّه البائع ليعيد ملء الرف. */
        long TakeStock(Cmd c, ItemRow it, long qty, bool allowNegative, string reason, string refType, long refId, out long taken)
        {
            long left = qty, fromRoom = 0;
            List<object[]> rows = db.Rows(
                "SELECT s.place_id, s.qty, p.kind FROM item_stock s JOIN places p ON p.id = s.place_id " +
                "WHERE s.item_id = ? AND p.kind <> 'store' AND s.qty > 0 " +
                "ORDER BY CASE WHEN s.place_id = ? THEN 0 WHEN p.kind = 'room' THEN 2 ELSE 1 END, s.qty DESC, s.place_id",
                it.Id, it.HomePlaceId);
            foreach (object[] r in rows)
            {
                if (left <= 0) break;
                long n = Math.Min(left, (long)r[1]);
                AddStock(c, it.Id, (long)r[0], -n, reason, refType, refId);
                if ((string)r[2] == "room") fromRoom += n;
                left -= n;
            }
            if (left > 0 && allowNegative)
            {
                AddStock(c, it.Id, it.HomePlaceId, -left, reason, refType, refId);
                left = 0;
            }
            taken = qty - left;
            return fromRoom;
        }

        /* ---------- الأماكن ---------- */

        static readonly string[] PlaceKinds = { "floor", "section", "cabinet", "shelf", "room", "store" };

        public long AddPlace(long parentId, string kind, string name, string code, long userId)
        {
            return Run<long>("place-add", userId, delegate (Cmd c)
            {
                if (Array.IndexOf(PlaceKinds, kind) < 0) throw Err("نوع مكان غير معروف: " + kind);
                name = (name ?? "").Trim();
                if (name.Length == 0) throw Err("اكتب اسم المكان.");
                if (parentId > 0 && db.Long("SELECT COUNT(*) FROM places WHERE id = ? AND active = 1", 0, parentId) == 0)
                    throw Err("المكان الأب غير موجود.");
                long sort = db.Long("SELECT IFNULL(MAX(sort), 0) + 1 FROM places WHERE parent_id IS ?", 1, parentId > 0 ? (object)parentId : null);
                long id = db.Insert("INSERT INTO places(parent_id, kind, name, code, sort, created_at) VALUES(?, ?, ?, ?, ?, ?)",
                    parentId > 0 ? (object)parentId : null, kind, name, (code ?? "").Trim(), sort, c.At);
                c.Detail = "إضافة مكان: " + name;
                c.RefType = "place"; c.RefId = id;
                return id;
            });
        }

        public void UpdatePlace(long id, string name, string code, string phone, string address, string note, long userId)
        {
            Run("place-edit", userId, delegate (Cmd c)
            {
                name = (name ?? "").Trim();
                if (name.Length == 0) throw Err("اكتب اسم المكان.");
                if (db.Run("UPDATE places SET name = ?, code = ?, phone = ?, address = ?, note = ? WHERE id = ? AND active = 1",
                    name, (code ?? "").Trim(), phone ?? "", address ?? "", note ?? "", id) == 0) throw Err("المكان غير موجود.");
                c.Detail = "تعديل مكان: " + name;
                c.RefType = "place"; c.RefId = id;
            });
        }

        /* الحذف يُخفي المكان ويُبقي تاريخ حركاته. لا يُحذف مكان فيه بضاعة
           قبل نقلها، ولا مكان تحته أماكن أو أصناف مكانها فيه. */
        public void DeletePlace(long id, long userId)
        {
            Run("place-delete", userId, delegate (Cmd c)
            {
                if (id == 1) throw Err("المحل نفسه لا يُحذف.");
                string name = db.Text("SELECT name FROM places WHERE id = ? AND active = 1", id);
                if (name == null) throw Err("المكان غير موجود.");
                long qty = db.Long("SELECT COUNT(*) FROM item_stock s JOIN items i ON i.id = s.item_id WHERE s.place_id = ? AND s.qty <> 0 AND i.active = 1", 0, id);
                if (qty > 0) throw Err("في «" + name + "» بضاعة (" + qty + " صنف). انقلها أولاً ثم احذفه.");
                if (db.Long("SELECT COUNT(*) FROM places WHERE parent_id = ? AND active = 1", 0, id) > 0)
                    throw Err("تحت «" + name + "» أماكن أخرى. احذفها أو انقلها أولاً.");
                if (db.Long("SELECT COUNT(*) FROM items WHERE home_place_id = ? AND active = 1", 0, id) > 0)
                    throw Err("أصناف مسجّل مكانها في «" + name + "». غيّر مكانها أولاً.");
                db.Run("UPDATE places SET active = 0 WHERE id = ?", id);
                c.Detail = "حذف مكان: " + name;
                c.RefType = "place"; c.RefId = id;
            });
        }

        /* ---------- الأصناف ---------- */

        void CheckItem(ItemInput d, long selfId)
        {
            if (d.Kind != "book" && d.Kind != "stat") throw Err("نوع صنف غير معروف: " + d.Kind);
            d.Title = (d.Title ?? "").Trim();
            if (d.Title.Length == 0) throw Err(d.Kind == "book" ? "اكتب اسم الكتاب." : "اكتب اسم الصنف.");
            if (d.Price < 0 || d.PriceW < 0 || d.Cost < 0 || d.Min < 0) throw Err("لا أسعار ولا حدود سالبة.");
            d.Barcode = (d.Barcode ?? "").Trim();
            if (d.Barcode.Length > 0)
            {
                string other = db.Text("SELECT title FROM items WHERE barcode = ? AND barcode <> '' AND active = 1 AND id <> ?", d.Barcode, selfId);
                if (other != null) throw Err("هذا الباركود مستعمل في: " + other);
            }
            if (db.Long("SELECT COUNT(*) FROM places WHERE id = ? AND active = 1", 0, d.HomePlaceId) == 0)
                throw Err("مكان الصنف غير موجود.");
            if (d.SupplierId > 0 && db.Long("SELECT COUNT(*) FROM suppliers WHERE id = ?", 0, d.SupplierId) == 0)
                throw Err("المورّد غير موجود.");
        }

        string NextItemCode(string kind)
        {
            /* رمز لم يُستعمل: قد يكون رمزٌ يدوي أخذ الرقم التالي من قبل */
            while (true)
            {
                long n = Counter(kind);
                string code = (kind == "book" ? "K" : "Q") + n.ToString("0000", CultureInfo.InvariantCulture);
                if (db.Long("SELECT COUNT(*) FROM items WHERE code = ? COLLATE NOCASE", 0, code) == 0) return code;
            }
        }

        public long AddItem(ItemInput d, long qty, long placeId, long userId)
        {
            return Run<long>("item-add", userId, delegate (Cmd c) { return AddItem0(c, d, qty, placeId, "open"); });
        }

        long AddItem0(Cmd c, ItemInput d, long qty, long placeId, string reason)
        {
            CheckItem(d, 0);
            if (qty < 0) throw Err("الكمية لا تكون سالبة.");
            string code = (d.Code ?? "").Trim();
            if (code.Length == 0) code = NextItemCode(d.Kind);
            else if (db.Long("SELECT COUNT(*) FROM items WHERE code = ? COLLATE NOCASE", 0, code) > 0)
                throw Err("الرمز " + code + " مستعمل لصنف آخر.");
            long id = db.Insert("INSERT INTO items(kind, code, title, author, brand, publisher, barcode, cat, cat_full, unit, loc_note, " +
                "home_place_id, supplier_id, price, price_w, cost, min_qty, note, created_at, updated_at, old_id) " +
                "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                d.Kind, code, d.Title, d.Author ?? "", d.Brand ?? "", d.Publisher ?? "", d.Barcode, d.Cat ?? "", d.CatFull ?? "",
                d.Unit ?? "", d.LocNote ?? "", d.HomePlaceId, d.SupplierId > 0 ? (object)d.SupplierId : null,
                d.Price, d.PriceW, d.Cost, d.Min, d.Note ?? "", c.At, c.At, d.OldId ?? "");
            if (qty > 0)
            {
                long place = placeId > 0 ? placeId : d.HomePlaceId;
                if (db.Long("SELECT COUNT(*) FROM places WHERE id = ? AND active = 1", 0, place) == 0) throw Err("المكان غير موجود.");
                AddStock(c, id, place, qty, reason, "item", id);
            }
            c.Detail = "إضافة " + (d.Kind == "book" ? "كتاب" : "صنف") + ": " + d.Title;
            c.RefType = "item"; c.RefId = id;
            return id;
        }

        public void UpdateItem(long id, ItemInput d, long userId)
        {
            Run("item-edit", userId, delegate (Cmd c)
            {
                ItemRow old = ActiveItem(id);
                d.Kind = old.Kind;
                CheckItem(d, id);
                string code = (d.Code ?? "").Trim();
                if (code.Length == 0) code = old.Code;
                if (!string.Equals(code, old.Code, StringComparison.OrdinalIgnoreCase) &&
                    db.Long("SELECT COUNT(*) FROM items WHERE code = ? COLLATE NOCASE AND id <> ?", 0, code, id) > 0)
                    throw Err("الرمز " + code + " مستعمل لصنف آخر.");
                db.Run("UPDATE items SET code = ?, title = ?, author = ?, brand = ?, publisher = ?, barcode = ?, cat = ?, cat_full = ?, " +
                    "unit = ?, loc_note = ?, home_place_id = ?, supplier_id = ?, price = ?, price_w = ?, cost = ?, min_qty = ?, note = ?, " +
                    "updated_at = ? WHERE id = ?",
                    code, d.Title, d.Author ?? "", d.Brand ?? "", d.Publisher ?? "", d.Barcode, d.Cat ?? "", d.CatFull ?? "",
                    d.Unit ?? "", d.LocNote ?? "", d.HomePlaceId, d.SupplierId > 0 ? (object)d.SupplierId : null,
                    d.Price, d.PriceW, d.Cost, d.Min, d.Note ?? "", c.At, id);
                /* قبل وبعد لما يهمّ المدير: الاسم والأسعار */
                Dictionary<string, object> b = new Dictionary<string, object>(), a = new Dictionary<string, object>();
                Diff(b, a, "title", old.Title, d.Title);
                Diff(b, a, "price", old.Price, d.Price);
                Diff(b, a, "price_w", old.PriceW, d.PriceW);
                Diff(b, a, "cost", old.Cost, d.Cost);
                Diff(b, a, "barcode", old.Barcode, d.Barcode);
                if (b.Count > 0) { c.Before = Json.Write(b); c.After = Json.Write(a); }
                c.Detail = "تعديل " + old.KindName + ": " + d.Title;
                c.RefType = "item"; c.RefId = id;
            });
        }

        static void Diff(Dictionary<string, object> b, Dictionary<string, object> a, string k, object x, object y)
        {
            if (object.Equals(x, y)) return;
            b[k] = x; a[k] = y;
        }

        /* الحذف يُخفي الصنف: فواتيره القديمة تبقى تشير إليه، وتاريخ كمياته يبقى */
        public void DeleteItem(long id, long userId)
        {
            Run("item-delete", userId, delegate (Cmd c)
            {
                ItemRow it = ActiveItem(id);
                db.Run("UPDATE items SET active = 0, updated_at = ? WHERE id = ?", c.At, id);
                c.Detail = "حذف " + it.KindName + ": " + it.Title;
                c.RefType = "item"; c.RefId = id;
            });
        }

        /* «+ كمية» أو تصحيح يدوي في مكان واحد */
        public long AdjustStock(long itemId, long placeId, long delta, string note, long userId)
        {
            return Run<long>("stock-adjust", userId, delegate (Cmd c)
            {
                ItemRow it = ActiveItem(itemId);
                if (placeId <= 0) placeId = it.HomePlaceId;
                if (db.Long("SELECT COUNT(*) FROM places WHERE id = ? AND active = 1", 0, placeId) == 0) throw Err("المكان غير موجود.");
                if (delta == 0) throw Err("اكتب الكمية.");
                long now = QtyAt(itemId, placeId) + delta;
                if (delta < 0 && now < 0) throw Err("الكمية في هذا المكان لا تكفي.");
                AddStock(c, itemId, placeId, delta, "adjust", "item", itemId);
                db.Run("UPDATE items SET updated_at = ? WHERE id = ?", c.At, itemId);
                c.Detail = (delta > 0 ? "إضافة كمية: " : "إنقاص كمية: ") + it.Title + " × " + Math.Abs(delta) +
                    (string.IsNullOrEmpty(note) ? "" : " — " + note);
                c.RefType = "item"; c.RefId = itemId;
                return now;
            });
        }

        /* نقل بين مكانين (الرف والغرفة والمخزن). المجموع لا يتغيّر، ولا يُنقل
           أكثر مما في المكان. يعيد ما نُقل فعلاً. */
        public long MoveStock(long itemId, long fromPlace, long toPlace, long qty, long userId)
        {
            return Run<long>("stock-move", userId, delegate (Cmd c)
            {
                ItemRow it = ActiveItem(itemId);
                if (fromPlace == toPlace) throw Err("اختر مكانين مختلفين.");
                string from = db.Text("SELECT name FROM places WHERE id = ? AND active = 1", fromPlace);
                string to = db.Text("SELECT name FROM places WHERE id = ? AND active = 1", toPlace);
                if (from == null || to == null) throw Err("المكان غير موجود.");
                long n = Math.Min(qty, Math.Max(QtyAt(itemId, fromPlace), 0));
                if (n <= 0) throw Err("لا توجد كمية من «" + it.Title + "» في " + from + ".");
                AddStock(c, itemId, fromPlace, -n, "move", "item", itemId);
                AddStock(c, itemId, toPlace, n, "move", "item", itemId);
                db.Run("UPDATE items SET updated_at = ? WHERE id = ?", c.At, itemId);
                c.Detail = "نقل: " + it.Title + " × " + n + " من " + from + " إلى " + to;
                c.RefType = "item"; c.RefId = itemId;
                return n;
            });
        }

        /* ---------- الموردون ودور النشر والتصنيفات والإعدادات ---------- */

        public long AddSupplier(string name, string phone, string city, string note, long userId)
        {
            return Run<long>("supplier-add", userId, delegate (Cmd c)
            {
                name = (name ?? "").Trim();
                if (name.Length == 0) throw Err("اكتب اسم المورّد.");
                long id = db.Insert("INSERT INTO suppliers(name, phone, city, note, created_at) VALUES(?, ?, ?, ?, ?)",
                    name, phone ?? "", city ?? "", note ?? "", c.At);
                c.Detail = "مورّد: " + name;
                c.RefType = "supplier"; c.RefId = id;
                return id;
            });
        }

        public void UpdateSupplier(long id, string name, string phone, string city, string note, long userId)
        {
            Run("supplier-edit", userId, delegate (Cmd c)
            {
                name = (name ?? "").Trim();
                if (name.Length == 0) throw Err("اكتب اسم المورّد.");
                if (db.Run("UPDATE suppliers SET name = ?, phone = ?, city = ?, note = ? WHERE id = ?", name, phone ?? "", city ?? "", note ?? "", id) == 0)
                    throw Err("المورّد غير موجود.");
                c.Detail = "تعديل مورّد: " + name;
                c.RefType = "supplier"; c.RefId = id;
            });
        }

        public void DeleteSupplier(long id, long userId)
        {
            Run("supplier-delete", userId, delegate (Cmd c)
            {
                string name = db.Text("SELECT name FROM suppliers WHERE id = ? AND active = 1", id);
                if (name == null) throw Err("المورّد غير موجود.");
                db.Run("UPDATE suppliers SET active = 0 WHERE id = ?", id);
                c.Detail = "حذف مورّد: " + name;
                c.RefType = "supplier"; c.RefId = id;
            });
        }

        public long SavePublisher(long id, string name, long rateBp, string phone, string note, long userId)
        {
            return Run<long>(id > 0 ? "publisher-edit" : "publisher-add", userId, delegate (Cmd c)
            {
                name = (name ?? "").Trim();
                if (name.Length == 0) throw Err("اكتب اسم دار النشر.");
                if (rateBp < 0 || rateBp > 10000) throw Err("نسبة الخصم بين 0 و100%.");
                if (db.Long("SELECT COUNT(*) FROM publishers WHERE name = ? AND id <> ?", 0, name, id) > 0)
                    throw Err("دار النشر «" + name + "» موجودة.");
                if (id > 0)
                {
                    if (db.Run("UPDATE publishers SET name = ?, rate_bp = ?, phone = ?, note = ? WHERE id = ?", name, rateBp, phone ?? "", note ?? "", id) == 0)
                        throw Err("دار النشر غير موجودة.");
                }
                else id = db.Insert("INSERT INTO publishers(name, rate_bp, phone, note, created_at) VALUES(?, ?, ?, ?, ?)", name, rateBp, phone ?? "", note ?? "", c.At);
                c.Detail = "دار نشر: " + name;
                c.RefType = "publisher"; c.RefId = id;
                return id;
            });
        }

        public void DeletePublisher(long id, long userId)
        {
            Run("publisher-delete", userId, delegate (Cmd c)
            {
                string name = db.Text("SELECT name FROM publishers WHERE id = ?", id);
                if (name == null) throw Err("دار النشر غير موجودة.");
                db.Run("DELETE FROM publishers WHERE id = ?", id);
                c.Detail = "حذف دار نشر: " + name;
            });
        }

        public void SetCategories(string kind, IList<string> names, long userId)
        {
            Run("categories", userId, delegate (Cmd c)
            {
                if (kind != "book" && kind != "stat") throw Err("نوع تصنيف غير معروف.");
                List<string> clean = new List<string>();
                foreach (string n in names)
                {
                    string t = (n ?? "").Trim();
                    if (t.Length > 0 && !clean.Contains(t)) clean.Add(t);
                }
                List<object[]> old = db.Rows("SELECT id, name FROM categories WHERE kind = ?", kind);
                foreach (object[] r in old)
                    if (!clean.Contains((string)r[1])) db.Run("DELETE FROM categories WHERE id = ?", r[0]);
                for (int i = 0; i < clean.Count; i++)
                    db.Run("INSERT INTO categories(kind, name, sort) VALUES(?, ?, ?) ON CONFLICT(kind, name) DO UPDATE SET sort = excluded.sort",
                        kind, clean[i], i + 1);
                c.Detail = "قائمة التصنيفات (" + (kind == "book" ? "كتب" : "قرطاسية") + "): " + clean.Count;
            });
        }

        public List<string> Categories(string kind)
        {
            lock (gate)
            {
                List<string> l = new List<string>();
                foreach (object[] r in db.Rows("SELECT name FROM categories WHERE kind = ? ORDER BY sort, name", kind)) l.Add((string)r[0]);
                return l;
            }
        }

        public void SetSetting(string key, string value, long userId)
        {
            Run("setting", userId, delegate (Cmd c)
            {
                db.Run("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value ?? "");
                c.Detail = "إعداد: " + key;
            });
        }

        public string GetSetting(string key)
        {
            lock (gate) return db.Text("SELECT value FROM settings WHERE key = ?", key);
        }
    }
}
