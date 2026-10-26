using System;
using System.Collections.Generic;
using Qirtasiya.Data;

/* عمل محل عشوائي بكل أنواع الأوامر: لاختبار سجل التغييرات، واختبار القتل */
static class Work
{
    public static List<long> Items = new List<long>();
    public static List<long> Customers = new List<long>();
    public static List<long> Places = new List<long>();
    public static long Store, Consignor;

    public static void Setup(ShopDb d, Random r, int items, int customers)
    {
        Items.Clear(); Customers.Clear(); Places.Clear();
        long cab = d.AddPlace(0, "cabinet", "خزانة A", "A", 1);
        for (int s = 1; s <= 3; s++) Places.Add(d.AddPlace(cab, "shelf", "رف " + s, s.ToString(), 1));
        Places.Add(d.AddPlace(0, "room", "غرفة الخزين", "خزين", 1));
        Store = d.AddPlace(0, "store", "المخزن الأول", "م1", 1);
        for (int i = 0; i < items; i++)
        {
            ItemInput it = new ItemInput();
            it.Kind = i % 5 == 4 ? "stat" : "book";
            it.Title = (it.Kind == "book" ? "كتاب تجربة " : "قلم تجربة ") + i;
            it.Price = 1000 * r.Next(5, 80);
            it.PriceW = it.Price * 9 / 10;
            it.Cost = it.Price * 6 / 10;
            it.Min = r.Next(0, 3);
            it.HomePlaceId = Places[r.Next(0, 3)];
            if (r.Next(3) == 0) it.Barcode = "978" + (1000000000L + i).ToString();
            Items.Add(d.AddItem(it, r.Next(0, 30), 0, 1));
            if (r.Next(3) == 0) d.AdjustStock(Items[Items.Count - 1], Store, r.Next(5, 40), "", 1);
        }
        for (int i = 0; i < customers; i++)
            Customers.Add(d.AddCustomer("زبون " + i, "090" + (1000000 + i), "", i % 4 == 0, r.Next(3) == 0 ? 1000 * r.Next(1, 50) : 0, 1));
        ConsignLine l = new ConsignLine();
        l.Title = "على المباع تجربة"; l.Qty = 20; l.Price = 15000; l.OwnerPrice = 10000;
        Consignor = d.ConsignReceive(0, "صاحب بضاعة", "", "", "", new ConsignLine[] { l }, 1);
        Items.Add(d.Read<long>(delegate (Sqlite c) { return c.Long("SELECT item_id FROM consignments WHERE consignor_id = ?", 0, Consignor); }));
    }

    static long Pick(Random r, List<long> l) { return l[r.Next(l.Count)]; }

    /* عملية واحدة. يعيد وصفها، أو null إن رفضتها القاعدة لسبب مشروع
       (لا دين ليُسدَّد، أُرجع كل شيء...) — وهذا جزء من الاختبار أيضاً. */
    public static string Step(ShopDb d, Random r, Func<long> lastSale)
    {
        int k = r.Next(100);
        try
        {
            if (k < 50) return SellOne(d, r);
            if (k < 60)
            {
                long id = RandomSale(d, r);
                if (id == 0) return null;
                InvoiceRow v = d.GetInvoice(id);
                List<ReturnLine> ls = new List<ReturnLine>();
                foreach (InvoiceLineRow l in v.Lines) if (r.Next(2) == 0) ls.Add(new ReturnLine(l.Id, r.Next(1, (int)l.Qty + 1)));
                if (ls.Count == 0) ls.Add(new ReturnLine(v.Lines[0].Id, 1));
                d.Return(id, ls, "", 1);
                return "return";
            }
            if (k < 66)
            {
                long id = RandomSale(d, r);
                if (id == 0) return null;
                List<SaleLine> ls = new List<SaleLine>();
                foreach (InvoiceLineRow l in d.GetInvoice(id).Lines) if (l.ItemId > 0) ls.Add(new SaleLine(l.ItemId, r.Next(1, 4), l.Price));
                if (r.Next(2) == 0) ls.Add(new SaleLine(Pick(r, Items), 1, 5000));
                bool credit = r.Next(3) == 0;
                d.EditInvoice(id, ls, r.Next(3) == 0 ? 1000 : 0, credit ? "credit" : "cash", credit ? Pick(r, Customers) : 0, r.Next(2) * 2000, r.Next(4) > 0, 1);
                return "edit";
            }
            if (k < 70)
            {
                long id = PickId(d, r, "SELECT id FROM invoices WHERE deleted_at = '' ORDER BY id");
                if (id == 0) return null;
                d.DeleteInvoice(id, r.Next(4) > 0, "تجربة", 1);
                return "delete";
            }
            if (k < 78) { d.Pay(Pick(r, Customers), 1000 * r.Next(1, 30), "", "", 1); return "pay"; }
            if (k < 84)
            {
                long it = Pick(r, Items);
                long from = r.Next(2) == 0 ? Store : Pick(r, Places);
                long to = r.Next(2) == 0 ? Store : Pick(r, Places);
                if (from == to) return null;
                d.MoveStock(it, from, to, r.Next(1, 10), 1);
                return "move";
            }
            if (k < 89)
            {
                List<ReceiveLine> ls = new List<ReceiveLine>();
                int n = r.Next(1, 4);
                for (int i = 0; i < n; i++) ls.Add(new ReceiveLine(Pick(r, Items), r.Next(1, 20), 1000 * r.Next(0, 30), r.Next(3) == 0 ? Store : 0));
                d.Receive(0, "", "", ls, 1);
                return "receive";
            }
            if (k < 92) { d.AdjustStock(Pick(r, Items), Pick(r, Places), r.Next(1, 5), "", 1); return "adjust"; }
            if (k < 95)
            {
                long s = d.Read<long>(delegate (Sqlite c) { return c.Long("SELECT id FROM count_sessions WHERE status = 'open'", 0); });
                if (s == 0) { d.CountStart("all", "", 1); return "count-start"; }
                if (r.Next(4) == 0) { d.CountApply(s, 1); return "count-apply"; }
                d.CountSet(s, Pick(r, Items), r.Next(0, 30), 1);
                return "count-set";
            }
            if (k < 97)
            {
                long due = d.ConsignDue(Consignor);
                if (due <= 0) return null;
                d.ConsignPay(Consignor, Math.Min(due, 5000), "", "", r.Next(2) == 0, 1);
                return "consign-pay";
            }
            if (k < 98)
            {
                /* صنف جديد: فهرس البحث في نفس معاملته */
                ItemInput n = new ItemInput();
                n.Kind = "book"; n.Title = "كتاب جديد " + r.Next(100000) + " الجزء الثاني"; n.Price = 1000 * r.Next(5, 80);
                n.Barcode = "";
                Items.Add(d.AddItem(n, r.Next(0, 5), 0, 1));
                return "item-add";
            }
            ItemRow item = d.GetItem(Pick(r, Items));
            ItemInput u = new ItemInput();
            /* الاسم يتغيّر أحياناً (فهرس البحث يتبعه)، والسعر دائماً */
            string title = item.Title;
            int cut = title.IndexOf(" — ", StringComparison.Ordinal);
            if (cut >= 0) title = title.Substring(0, cut);
            if (r.Next(2) == 0) title += " — ط" + r.Next(1, 9);
            u.Title = title; u.Author = item.Author; u.Barcode = item.Barcode; u.HomePlaceId = item.HomePlaceId;
            u.Price = item.Price + 500; u.PriceW = item.PriceW; u.Cost = item.Cost; u.Min = item.Min; u.Cat = item.Cat;
            d.UpdateItem(item.Id, u, 1);
            return "item-edit";
        }
        catch (ShopException) { return null; }
    }

    public static string SellOne(ShopDb d, Random r)
    {
        SaleInput s = new SaleInput();
        int n = r.Next(1, 4);
        List<long> used = new List<long>();
        for (int i = 0; i < n; i++)
        {
            long it = Pick(r, Items);
            if (used.Contains(it)) continue;
            used.Add(it);
            ItemRow row = d.GetItem(it);
            s.Lines.Add(new SaleLine(it, r.Next(1, 4), row.Price));
        }
        if (r.Next(8) == 0) s.Discount = 1000 * r.Next(1, 5);
        int m = r.Next(10);
        if (m < 2) { s.Method = "credit"; s.CustomerId = Pick(r, Customers); s.Paid = r.Next(2) == 0 ? 0 : 3000; }
        else if (m == 2) s.Method = "card";
        d.Sell(s, 1);
        return "sale";
    }

    static long RandomSale(ShopDb d, Random r)
    {
        return PickId(d, r, "SELECT id FROM invoices WHERE kind = 'sale' AND deleted_at = '' ORDER BY id");
    }

    /* الاختيار بـ Random لا بـ random() في SQL: نفس البذرة = نفس العمليات */
    static long PickId(ShopDb d, Random r, string sql)
    {
        List<object[]> ids = d.Read<List<object[]>>(delegate (Sqlite c) { return c.Rows(sql); });
        return ids.Count == 0 ? 0 : (long)ids[r.Next(ids.Count)][0];
    }
}
