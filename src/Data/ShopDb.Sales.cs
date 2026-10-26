using System;
using System.Collections.Generic;

namespace Qirtasiya.Data
{
    public sealed class SaleLine
    {
        public long ItemId;
        public long Qty;
        public long Price;

        public SaleLine() { }
        public SaleLine(long itemId, long qty, long price) { ItemId = itemId; Qty = qty; Price = price; }
    }

    public sealed class SaleInput
    {
        public List<SaleLine> Lines = new List<SaleLine>();
        public long Discount;
        public string Method = "cash";      // cash | card | credit
        public string Mode = "retail";      // retail | wholesale
        public long CustomerId;             // للآجل
        public long Paid;                   // المدفوع الآن من الآجل
        public string Date = "";            // فارغ = اليوم. طلب التلفون يحمل تاريخه
        public string At = "";
        public string Source = "pos";
        public string Device = "";
        public string PhoneId = "";
        public string Note = "";
    }

    public sealed class InvoiceResult
    {
        public long Id, No, Total, Due, CashBack, DebtCut, Over;
        public bool Duplicate;              // طلب تلفون وصل من قبل: لم يُسجَّل مرة ثانية
        public List<string> FromRoom = new List<string>();
    }

    public sealed class ReturnLine
    {
        public long LineId;                 // سطر الفاتورة الأصلية
        public long Qty;

        public ReturnLine() { }
        public ReturnLine(long lineId, long qty) { LineId = lineId; Qty = qty; }
    }

    public sealed class InvoiceLineRow
    {
        public long Id, ItemId, Qty, Price, Cost, LineNo, SrcLineId;
        public string Kind, Name;
    }

    public sealed class InvoiceRow
    {
        public long Id, No, RefId, Subtotal, Discount, Total, Profit, CustomerId, Paid, Due, CashBack, DebtCut, UserId;
        public string Kind, Date, At, Method, Mode, Source, Device, PhoneId, Note, EditedAt, DeletedAt, DeleteReason;
        public List<InvoiceLineRow> Lines = new List<InvoiceLineRow>();
        public bool Deleted { get { return DeletedAt.Length > 0; } }
    }

    public sealed class CustomerRow
    {
        public long Id, Balance;
        public string Name, Phone, Note;
        public bool Wholesale, Active;
    }

    public sealed partial class ShopDb
    {
        /* ---------- القراءة ---------- */

        public InvoiceRow GetInvoice(long id) { lock (gate) return LoadInvoice(id); }

        public InvoiceRow GetInvoiceByNo(long no)
        {
            lock (gate)
            {
                long id = db.Long("SELECT id FROM invoices WHERE no = ?", 0, no);
                return id > 0 ? LoadInvoice(id) : null;
            }
        }

        InvoiceRow LoadInvoice(long id)
        {
            List<object[]> rs = db.Rows("SELECT id, no, kind, IFNULL(ref_id, 0), date, at, subtotal, discount, total, profit, method, mode, " +
                "IFNULL(customer_id, 0), paid, due, cash_back, debt_cut, source, device, phone_id, note, IFNULL(user_id, 0), edited_at, deleted_at, delete_reason " +
                "FROM invoices WHERE id = ?", id);
            if (rs.Count == 0) return null;
            object[] r = rs[0];
            InvoiceRow v = new InvoiceRow();
            v.Id = (long)r[0]; v.No = (long)r[1]; v.Kind = (string)r[2]; v.RefId = (long)r[3]; v.Date = (string)r[4]; v.At = (string)r[5];
            v.Subtotal = (long)r[6]; v.Discount = (long)r[7]; v.Total = (long)r[8]; v.Profit = (long)r[9]; v.Method = (string)r[10];
            v.Mode = (string)r[11]; v.CustomerId = (long)r[12]; v.Paid = (long)r[13]; v.Due = (long)r[14]; v.CashBack = (long)r[15];
            v.DebtCut = (long)r[16]; v.Source = (string)r[17]; v.Device = (string)r[18]; v.PhoneId = (string)r[19]; v.Note = (string)r[20];
            v.UserId = (long)r[21]; v.EditedAt = (string)r[22]; v.DeletedAt = (string)r[23]; v.DeleteReason = (string)r[24];
            foreach (object[] l in db.Rows("SELECT id, IFNULL(item_id, 0), kind, name, qty, price, cost, line_no, IFNULL(src_line_id, 0) " +
                "FROM invoice_lines WHERE invoice_id = ? ORDER BY line_no", id))
            {
                InvoiceLineRow x = new InvoiceLineRow();
                x.Id = (long)l[0]; x.ItemId = (long)l[1]; x.Kind = (string)l[2]; x.Name = (string)l[3]; x.Qty = (long)l[4];
                x.Price = (long)l[5]; x.Cost = (long)l[6]; x.LineNo = (long)l[7]; x.SrcLineId = (long)l[8];
                v.Lines.Add(x);
            }
            return v;
        }

        public CustomerRow GetCustomer(long id) { lock (gate) return LoadCustomer(id); }

        CustomerRow LoadCustomer(long id)
        {
            List<object[]> rs = db.Rows("SELECT id, name, phone, note, wholesale, balance, active FROM customers WHERE id = ?", id);
            if (rs.Count == 0) return null;
            object[] r = rs[0];
            CustomerRow c = new CustomerRow();
            c.Id = (long)r[0]; c.Name = (string)r[1]; c.Phone = (string)r[2]; c.Note = (string)r[3];
            c.Wholesale = (long)r[4] != 0; c.Balance = (long)r[5]; c.Active = (long)r[6] != 0;
            return c;
        }

        CustomerRow ActiveCustomer(long id)
        {
            CustomerRow c = LoadCustomer(id);
            if (c == null || !c.Active) throw Err("الزبون غير موجود.");
            return c;
        }

        /* كل تغيّر في الدين: رصيد + حركة بسببه */
        void AddDebt(Cmd c, long customerId, long delta, string reason, string refType, long refId)
        {
            if (delta == 0) return;
            db.Run("UPDATE customers SET balance = balance + ?, updated_at = ? WHERE id = ?", delta, c.At, customerId);
            db.Run("INSERT INTO customer_moves(op_id, at, customer_id, delta, reason, ref_type, ref_id) VALUES(?, ?, ?, ?, ?, ?, ?)",
                c.OpId, c.At, customerId, delta, reason, refType ?? "", refId);
        }

        /* ---------- الزبائن ---------- */

        public long AddCustomer(string name, string phone, string note, bool wholesale, long opening, long userId)
        {
            return Run<long>("customer-add", userId, delegate (Cmd c)
            {
                name = (name ?? "").Trim();
                if (name.Length == 0) throw Err("اكتب اسم الزبون.");
                if (opening < 0) throw Err("الدين السابق لا يكون سالباً.");
                long id = db.Insert("INSERT INTO customers(name, phone, note, wholesale, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)",
                    name, (phone ?? "").Trim(), note ?? "", wholesale, c.At, c.At);
                AddDebt(c, id, opening, "opening", "customer", id);
                c.Detail = "إضافة زبون: " + name + (opening > 0 ? " (دين سابق " + Money(opening) + ")" : "");
                c.RefType = "customer"; c.RefId = id;
                return id;
            });
        }

        public void UpdateCustomer(long id, string name, string phone, string note, bool wholesale, long userId)
        {
            Run("customer-edit", userId, delegate (Cmd c)
            {
                ActiveCustomer(id);
                name = (name ?? "").Trim();
                if (name.Length == 0) throw Err("اكتب اسم الزبون.");
                db.Run("UPDATE customers SET name = ?, phone = ?, note = ?, wholesale = ?, updated_at = ? WHERE id = ?",
                    name, (phone ?? "").Trim(), note ?? "", wholesale, c.At, id);
                c.Detail = "تعديل زبون: " + name;
                c.RefType = "customer"; c.RefId = id;
            });
        }

        /* تعديل الدين يدوياً (رصيد افتتاحي خاطئ مثلاً): يُسجَّل الفرق وسببه */
        public void SetBalance(long id, long balance, string why, long userId)
        {
            Run("customer-balance", userId, delegate (Cmd c)
            {
                CustomerRow cu = ActiveCustomer(id);
                if (balance < 0) throw Err("الدين لا يكون سالباً.");
                AddDebt(c, id, balance - cu.Balance, "adjust", "customer", id);
                c.Detail = "تعديل دين " + cu.Name + ": " + Money(cu.Balance) + " ← " + Money(balance) + (string.IsNullOrEmpty(why) ? "" : " — " + why);
                c.Before = Money(cu.Balance); c.After = Money(balance);
                c.RefType = "customer"; c.RefId = id;
            });
        }

        public void DeleteCustomer(long id, long userId)
        {
            Run("customer-delete", userId, delegate (Cmd c)
            {
                CustomerRow cu = ActiveCustomer(id);
                if (cu.Balance > 0) throw Err("لا يمكن حذف زبون عليه دين (" + Money(cu.Balance) + "). سدّد الدين أولاً.");
                db.Run("UPDATE customers SET active = 0, updated_at = ? WHERE id = ?", c.At, id);
                c.Detail = "حذف زبون: " + cu.Name;
                c.RefType = "customer"; c.RefId = id;
            });
        }

        /* تسديد دين: لا يُسدَّد أكثر من الدين. يعيد المبلغ المسدَّد فعلاً */
        public long Pay(long customerId, long amount, string date, string note, long userId)
        {
            return Run<long>("payment", userId, delegate (Cmd c)
            {
                CustomerRow cu = ActiveCustomer(customerId);
                long a = Math.Min(amount, cu.Balance);
                if (a <= 0) throw Err(cu.Balance <= 0 ? "لا دين على " + cu.Name + "." : "أدخل مبلغاً صحيحاً.");
                long id = db.Insert("INSERT INTO payments(customer_id, amount, date, at, note, user_id) VALUES(?, ?, ?, ?, ?, ?)",
                    customerId, a, string.IsNullOrEmpty(date) ? c.Date : date, c.At, note ?? "", UserRef(userId));
                AddDebt(c, customerId, -a, "payment", "payment", id);
                c.Detail = "تسديد دين: " + cu.Name + " " + Money(a);
                c.RefType = "payment"; c.RefId = id;
                return a;
            });
        }

        static object UserRef(long userId) { return userId > 0 ? (object)userId : null; }

        /* ---------- البيع ---------- */

        public InvoiceResult Sell(SaleInput s, long userId)
        {
            return Run<InvoiceResult>("sale", userId, delegate (Cmd c) { return Sell0(c, s, userId); });
        }

        InvoiceResult Sell0(Cmd c, SaleInput s, long userId)
        {
            InvoiceResult res = new InvoiceResult();
            string phoneId = (s.PhoneId ?? "").Trim();
            if (phoneId.Length > 0)
            {
                long dup = db.Long("SELECT id FROM invoices WHERE phone_id = ?", 0, phoneId);
                if (dup > 0)
                {
                    InvoiceRow v0 = LoadInvoice(dup);
                    res.Id = v0.Id; res.No = v0.No; res.Total = v0.Total; res.Due = v0.Due; res.Duplicate = true;
                    c.Detail = "طلب تلفون مكرر " + phoneId + " — مسجّل في الفاتورة " + v0.No;
                    return res;
                }
            }
            if (s.Lines == null || s.Lines.Count == 0) throw Err("الفاتورة فارغة.");
            if (s.Method != "cash" && s.Method != "card" && s.Method != "credit") throw Err("طريقة دفع غير معروفة: " + s.Method);
            if (s.Mode != "retail" && s.Mode != "wholesale") throw Err("نوع بيع غير معروف: " + s.Mode);

            List<ItemRow> items = new List<ItemRow>();
            long sub = 0, gross = 0;
            foreach (SaleLine l in s.Lines)
            {
                if (l.Qty <= 0) throw Err("الكمية لا تكون صفراً أو سالبة.");
                if (l.Price < 0) throw Err("السعر لا يكون سالباً.");
                ItemRow it = ActiveItem(l.ItemId);
                items.Add(it);
                sub += l.Qty * l.Price;
                gross += l.Qty * (l.Price - it.Cost);
            }
            long disc = Math.Min(Math.Max(s.Discount, 0), sub);
            long total = sub - disc;
            long customerId = 0;
            long paid = total;
            if (s.Method == "credit")
            {
                if (s.CustomerId <= 0) throw Err("اختر الزبون للبيع الآجل.");
                ActiveCustomer(s.CustomerId);
                customerId = s.CustomerId;
                paid = Math.Min(Math.Max(s.Paid, 0), total);
            }
            long due = total - paid;
            string date = string.IsNullOrEmpty(s.Date) ? c.Date : s.Date;
            string at = string.IsNullOrEmpty(s.At) ? c.At : s.At;

            long no = Counter("invoice");
            long id = db.Insert("INSERT INTO invoices(no, kind, date, at, subtotal, discount, total, profit, method, mode, customer_id, " +
                "paid, due, source, device, phone_id, note, user_id) VALUES(?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                no, date, at, sub, disc, total, gross - disc, s.Method, s.Mode, customerId > 0 ? (object)customerId : null,
                paid, due, s.Source ?? "pos", s.Device ?? "", phoneId, s.Note ?? "", UserRef(userId));

            for (int i = 0; i < s.Lines.Count; i++)
            {
                SaleLine l = s.Lines[i];
                ItemRow it = items[i];
                db.Run("INSERT INTO invoice_lines(invoice_id, line_no, item_id, kind, name, qty, price, cost) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                    id, i + 1, it.Id, it.Kind, it.Title, l.Qty, l.Price, it.Cost);
                long taken;
                long room = TakeStock(c, it, l.Qty, true, "sale", "invoice", id, out taken);
                if (room > 0) res.FromRoom.Add(it.Title + " × " + room);
                /* آخر بيع على الصنف نفسه: الفواتير تُؤرشف، وتقرير الراكد يحتاجه بعدها */
                db.Run("UPDATE items SET last_sold = MAX(last_sold, ?), sold_total = sold_total + ?, updated_at = ? WHERE id = ?",
                    date, l.Qty, c.At, it.Id);
                db.Run("UPDATE consignments SET sold = sold + ? WHERE item_id = ?", l.Qty, it.Id);
            }
            if (due > 0) AddDebt(c, customerId, due, "sale", "invoice", id);

            res.Id = id; res.No = no; res.Total = total; res.Due = due;
            c.Detail = (s.Source == "phone" ? "بيع من التلفون: " : "بيع: ") + "فاتورة " + no + " بقيمة " + Money(total) +
                (due > 0 ? " (آجل " + Money(due) + ")" : "");
            c.RefType = "invoice"; c.RefId = id;
            c.Device = s.Device ?? "";
            return res;
        }

        /* ---------- الإرجاع ----------
           كما صُحّح في 3.x: يُردّ ما دفعه الزبون فعلاً بعد الخصم، ولا يُرجَع
           أكثر مما بِيع ناقصاً ما أُرجع قبل، وفي الآجل يُنقص الدين أولاً وما
           زاد يُردّ نقداً. */
        public InvoiceResult Return(long invoiceId, IList<ReturnLine> lines, string note, long userId)
        {
            return Run<InvoiceResult>("return", userId, delegate (Cmd c)
            {
                InvoiceRow v = LoadInvoice(invoiceId);
                if (v == null || v.Deleted) throw Err("الفاتورة غير موجودة.");
                if (v.Kind != "sale") throw Err("لا يُرجَع من عملية إرجاع.");
                List<InvoiceLineRow> src = new List<InvoiceLineRow>();
                List<long> qty = new List<long>();
                long gross = 0, cost = 0;
                foreach (ReturnLine r in lines)
                {
                    if (r.Qty <= 0) continue;
                    InvoiceLineRow l = null;
                    foreach (InvoiceLineRow x in v.Lines) if (x.Id == r.LineId) l = x;
                    if (l == null) throw Err("السطر ليس من هذه الفاتورة.");
                    long can = Math.Max(l.Qty - ReturnedQty(v, l) - Pending(src, qty, l), 0);
                    long q = Math.Min(r.Qty, can);
                    if (q <= 0) continue;
                    src.Add(l); qty.Add(q);
                    gross += q * l.Price;
                    cost += q * l.Cost;
                }
                if (src.Count == 0) throw Err("لم تحدد كمية للإرجاع، أو أُرجع كل ما في الفاتورة سابقاً.");

                long tot = v.Subtotal > 0 ? MulDiv(gross, v.Total, v.Subtotal) : gross;
                long prof = tot - cost;
                long debtCut = 0;
                if (v.CustomerId > 0)
                {
                    CustomerRow cu = LoadCustomer(v.CustomerId);
                    if (cu != null) debtCut = Math.Min(tot, Math.Max(cu.Balance, 0));
                }
                long cashBack = tot - debtCut;
                long no = Counter("invoice");
                long id = db.Insert("INSERT INTO invoices(no, kind, ref_id, date, at, subtotal, discount, total, profit, method, mode, customer_id, " +
                    "paid, due, cash_back, debt_cut, note, user_id) VALUES(?, 'return', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    no, v.Id, c.Date, c.At, -gross, -(gross - tot), -tot, -prof, v.Method, v.Mode,
                    v.CustomerId > 0 ? (object)v.CustomerId : null, -cashBack, -debtCut, cashBack, debtCut, note ?? "", UserRef(userId));
                for (int i = 0; i < src.Count; i++)
                {
                    InvoiceLineRow l = src[i];
                    db.Run("INSERT INTO invoice_lines(invoice_id, line_no, item_id, kind, name, qty, price, cost, src_line_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        id, i + 1, l.ItemId > 0 ? (object)l.ItemId : null, l.Kind, l.Name, qty[i], l.Price, l.Cost, l.Id);
                    if (l.ItemId > 0)
                    {
                        ItemRow it = LoadItem(l.ItemId);
                        if (it != null)
                        {
                            AddStock(c, it.Id, it.HomePlaceId, qty[i], "return", "invoice", id);
                            db.Run("UPDATE items SET sold_total = MAX(sold_total - ?, 0), updated_at = ? WHERE id = ?", qty[i], c.At, it.Id);
                            db.Run("UPDATE consignments SET sold = MAX(sold - ?, 0) WHERE item_id = ?", qty[i], it.Id);
                        }
                    }
                }
                if (debtCut > 0) AddDebt(c, v.CustomerId, -debtCut, "return", "invoice", id);

                InvoiceResult res = new InvoiceResult();
                res.Id = id; res.No = no; res.Total = -tot; res.CashBack = cashBack; res.DebtCut = debtCut;
                c.Detail = "إرجاع: من فاتورة " + v.No + " بقيمة " + Money(tot) +
                    (debtCut > 0 ? " — أُنقص من الدين " + Money(debtCut) : "");
                c.RefType = "invoice"; c.RefId = id;
                return res;
            });
        }

        /* ما أُرجع من سطر: إرجاعات الأسطر بأرقامها، والإرجاع المنقول من 3.x
           (بلا رقم سطر) يُعرف بالصنف والاسم، كما كانت 3.x تحسبه. */
        long ReturnedQty(InvoiceRow v, InvoiceLineRow l)
        {
            return db.Long("SELECT IFNULL(SUM(r.qty), 0) FROM invoice_lines r JOIN invoices x ON x.id = r.invoice_id " +
                "WHERE x.kind = 'return' AND x.ref_id = ? AND x.deleted_at = '' AND " +
                "(r.src_line_id = ? OR (r.src_line_id IS NULL AND r.item_id IS ? AND r.name = ?))", 0, v.Id, l.Id,
                l.ItemId > 0 ? (object)l.ItemId : null, l.Name);
        }

        static long Pending(List<InvoiceLineRow> src, List<long> qty, InvoiceLineRow l)
        {
            long n = 0;
            for (int i = 0; i < src.Count; i++) if (src[i].Id == l.Id) n += qty[i];
            return n;
        }

        bool HasReturns(long invoiceId)
        {
            return db.Long("SELECT COUNT(*) FROM invoices WHERE kind = 'return' AND ref_id = ? AND deleted_at = ''", 0, invoiceId) > 0;
        }

        /* ---------- تعديل الفاتورة ----------
           كما في 3.x: البيع وحده يُعدَّل، وما عليه إرجاع لا يُعدَّل. فرق
           الكميات يعود للمخزون (أو يُخصم) إن اختير ذلك، وأثر الدين فرق واحد
           (الجديد − القديم). Over = ما دفعه الزبون زيادة على الفاتورة بعد
           التعديل، ليُردّ له. */
        public InvoiceResult EditInvoice(long id, IList<SaleLine> lines, long discount, string method, long customerId,
            long paidNow, bool restock, long userId)
        {
            return Run<InvoiceResult>("invoice-edit", userId, delegate (Cmd c)
            {
                InvoiceRow v = LoadInvoice(id);
                if (v == null || v.Deleted) throw Err("الفاتورة غير موجودة.");
                if (v.Kind == "return") throw Err("عملية الإرجاع لا تُعدَّل — احذفها وسجّل الإرجاع من جديد.");
                if (HasReturns(v.Id)) throw Err("على هذه الفاتورة إرجاع مسجّل — احذف الإرجاع أولاً ثم عدّلها.");
                if (method != "cash" && method != "card" && method != "credit") throw Err("طريقة دفع غير معروفة: " + method);
                if (method == "credit")
                {
                    if (customerId <= 0) throw Err("اختر الزبون للبيع الآجل.");
                    ActiveCustomer(customerId);
                }
                else customerId = 0;

                /* الأسطر الجديدة: الصنف الموجود في الفاتورة يبقى بسعر شرائه واسمه فيها */
                List<InvoiceLineRow> keep = new List<InvoiceLineRow>();
                foreach (SaleLine l in lines)
                {
                    if (l.Qty < 0 || l.Price < 0) throw Err("لا كميات ولا أسعار سالبة.");
                    if (l.Qty == 0) continue;
                    InvoiceLineRow o = null;
                    foreach (InvoiceLineRow x in v.Lines) if (x.ItemId == l.ItemId && x.ItemId > 0) o = x;
                    InvoiceLineRow n = new InvoiceLineRow();
                    n.ItemId = l.ItemId; n.Qty = l.Qty; n.Price = l.Price;
                    if (o != null) { n.Kind = o.Kind; n.Name = o.Name; n.Cost = o.Cost; }
                    else
                    {
                        ItemRow it = ActiveItem(l.ItemId);
                        n.Kind = it.Kind; n.Name = it.Title; n.Cost = it.Cost;
                    }
                    keep.Add(n);
                }
                if (keep.Count == 0) throw Err("لا يمكن ترك الفاتورة فارغة — احذفها بدل ذلك.");

                if (restock)
                {
                    Dictionary<long, long> delta = new Dictionary<long, long>();   // موجب = يعود للمخزون
                    foreach (InvoiceLineRow o in v.Lines) if (o.ItemId > 0) delta[o.ItemId] = (delta.ContainsKey(o.ItemId) ? delta[o.ItemId] : 0) + o.Qty;
                    foreach (InvoiceLineRow n in keep) delta[n.ItemId] = (delta.ContainsKey(n.ItemId) ? delta[n.ItemId] : 0) - n.Qty;
                    foreach (KeyValuePair<long, long> kv in delta)
                    {
                        if (kv.Value == 0) continue;
                        ItemRow it = LoadItem(kv.Key);
                        if (it == null) continue;
                        if (kv.Value > 0)
                        {
                            AddStock(c, it.Id, it.HomePlaceId, kv.Value, "invoice-edit", "invoice", v.Id);
                            db.Run("UPDATE consignments SET sold = MAX(sold - ?, 0) WHERE item_id = ?", kv.Value, it.Id);
                        }
                        else
                        {
                            long taken;
                            TakeStock(c, it, -kv.Value, true, "invoice-edit", "invoice", v.Id, out taken);
                            db.Run("UPDATE consignments SET sold = sold + ? WHERE item_id = ?", -kv.Value, it.Id);
                        }
                        db.Run("UPDATE items SET sold_total = MAX(sold_total - ?, 0), updated_at = ? WHERE id = ?", kv.Value, c.At, it.Id);
                    }
                }

                long sub = 0, gross = 0;
                foreach (InvoiceLineRow n in keep) { sub += n.Qty * n.Price; gross += n.Qty * (n.Price - n.Cost); }
                long disc = Math.Min(Math.Max(discount, 0), sub);
                long total = sub - disc;
                long paid = method == "credit" ? Math.Min(Math.Max(paidNow, 0), total) : total;
                long due = total - paid;

                db.Run("DELETE FROM invoice_lines WHERE invoice_id = ?", v.Id);
                for (int i = 0; i < keep.Count; i++)
                {
                    InvoiceLineRow n = keep[i];
                    db.Run("INSERT INTO invoice_lines(invoice_id, line_no, item_id, kind, name, qty, price, cost) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                        v.Id, i + 1, n.ItemId, n.Kind, n.Name, n.Qty, n.Price, n.Cost);
                }
                db.Run("UPDATE invoices SET subtotal = ?, discount = ?, total = ?, profit = ?, method = ?, customer_id = ?, paid = ?, due = ?, " +
                    "edited_at = ? WHERE id = ?", sub, disc, total, gross - disc, method, customerId > 0 ? (object)customerId : null,
                    paid, due, c.At, v.Id);

                long over = 0;
                if (v.CustomerId > 0 && v.CustomerId == customerId)
                {
                    CustomerRow cu = LoadCustomer(customerId);
                    long nb = cu.Balance + due - v.Due;
                    if (nb < 0) { over = -nb; nb = 0; }
                    AddDebt(c, customerId, nb - cu.Balance, "invoice-edit", "invoice", v.Id);
                }
                else
                {
                    if (v.CustomerId > 0 && v.Due > 0)
                    {
                        CustomerRow oc = LoadCustomer(v.CustomerId);
                        if (oc != null)
                        {
                            long ob = oc.Balance - v.Due;
                            if (ob < 0) { over = -ob; ob = 0; }
                            AddDebt(c, oc.Id, ob - oc.Balance, "invoice-edit", "invoice", v.Id);
                        }
                    }
                    if (due > 0 && customerId > 0) AddDebt(c, customerId, due, "invoice-edit", "invoice", v.Id);
                }

                InvoiceResult res = new InvoiceResult();
                res.Id = v.Id; res.No = v.No; res.Total = total; res.Due = due; res.Over = over;
                c.Detail = "تعديل فاتورة: رقم " + v.No + " صارت " + Money(total);
                c.Before = Money(v.Total); c.After = Money(total);
                c.RefType = "invoice"; c.RefId = v.Id;
                return res;
            });
        }

        /* ---------- حذف الفاتورة ----------
           البيع الذي عليه إرجاع لا يُحذف قبل إرجاعه (وإلا عادت نسخ وهمية).
           الصف يبقى بعلامة الحذف وسببه، ورقمه محجوز. */
        public void DeleteInvoice(long id, bool restock, string reason, long userId)
        {
            Run("invoice-delete", userId, delegate (Cmd c)
            {
                InvoiceRow v = LoadInvoice(id);
                if (v == null || v.Deleted) throw Err("الفاتورة غير موجودة.");
                if (v.Kind == "sale" && HasReturns(v.Id))
                    throw Err("على هذه الفاتورة إرجاع مسجّل — احذفه أولاً ثم احذف الفاتورة.");
                if (restock)
                {
                    foreach (InvoiceLineRow l in v.Lines)
                    {
                        if (l.ItemId <= 0) continue;
                        ItemRow it = LoadItem(l.ItemId);
                        if (it == null) continue;
                        if (v.Kind == "sale")
                        {
                            AddStock(c, it.Id, it.HomePlaceId, l.Qty, "invoice-delete", "invoice", v.Id);
                            db.Run("UPDATE consignments SET sold = MAX(sold - ?, 0) WHERE item_id = ?", l.Qty, it.Id);
                            db.Run("UPDATE items SET sold_total = MAX(sold_total - ?, 0), updated_at = ? WHERE id = ?", l.Qty, c.At, it.Id);
                        }
                        else
                        {
                            long taken;
                            TakeStock(c, it, l.Qty, true, "invoice-delete", "invoice", v.Id, out taken);
                            db.Run("UPDATE consignments SET sold = sold + ? WHERE item_id = ?", l.Qty, it.Id);
                            db.Run("UPDATE items SET sold_total = sold_total + ?, updated_at = ? WHERE id = ?", l.Qty, c.At, it.Id);
                        }
                    }
                }
                if (v.CustomerId > 0)
                {
                    CustomerRow cu = LoadCustomer(v.CustomerId);
                    if (cu != null)
                    {
                        if (v.Kind == "return") AddDebt(c, cu.Id, v.DebtCut, "invoice-delete", "invoice", v.Id);
                        else if (v.Due > 0) AddDebt(c, cu.Id, Math.Max(cu.Balance - v.Due, 0) - cu.Balance, "invoice-delete", "invoice", v.Id);
                    }
                }
                db.Run("UPDATE invoices SET deleted_at = ?, delete_reason = ?, deleted_restock = ? WHERE id = ?", c.At, reason ?? "", restock, v.Id);
                c.Detail = "حذف فاتورة: رقم " + v.No + " بقيمة " + Money(v.Total) +
                    (restock ? " — أُعيدت الأصناف" : " — بلا إرجاع للمخزون") + (string.IsNullOrEmpty(reason) ? "" : " — " + reason);
                c.RefType = "invoice"; c.RefId = v.Id;
            });
        }

        /* ---------- إقفال اليوم ---------- */

        public void CloseDay(string date, long expected, long counted, string note, long userId)
        {
            Run("day-close", userId, delegate (Cmd c)
            {
                if (string.IsNullOrEmpty(date)) date = c.Date;
                long diff = counted - expected;
                db.Run("INSERT INTO day_closings(date, kind, expected, counted, diff, at, note, user_id) VALUES(?, 'day', ?, ?, ?, ?, ?, ?) " +
                    "ON CONFLICT(date) DO UPDATE SET expected = excluded.expected, counted = excluded.counted, diff = excluded.diff, " +
                    "at = excluded.at, note = excluded.note, user_id = excluded.user_id",
                    date, expected, counted, diff, c.At, note ?? "", UserRef(userId));
                c.Detail = "إقفال يوم: " + date + " فرق " + Money(diff);
            });
        }
    }
}
