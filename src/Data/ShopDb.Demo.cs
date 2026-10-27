using System;
using System.Collections.Generic;

namespace Qirtasiya.Data
{
    /* ============================================================
       بيانات التجربة (قرار 0021)
       ------------------------------------------------------------
       مكتبة صغيرة واقعية لتجربة 4.0 على جهاز قبل العمل الحقيقي:
       أماكن ومخزن، كتب جامعية ومدرسية وروايات وقرطاسية، زبائن،
       بضاعة واردة، وبيعات اليوم. بأوامر المحرك نفسها، فكل شيء فيها
       كما يكون في المحل (الكميات من حركاتها، السجل، الفهرس).
       القاعدة تحمل الإعداد demo = true: الواجهة تعرض «نسخة تجربة».
       ============================================================ */
    public sealed partial class ShopDb
    {
        static readonly string[] DemoSubjects = {
            "الفيزياء", "الكيمياء", "الرياضيات", "الأحياء", "التشريح", "علم النفس", "المحاسبة", "الاقتصاد",
            "القانون المدني", "القانون التجاري", "الهندسة الكهربائية", "الهندسة المدنية", "البرمجة", "قواعد البيانات",
            "اللغة العربية", "اللغة الإنجليزية", "التاريخ الإسلامي", "الجغرافيا", "الإحصاء", "التسويق"
        };
        static readonly string[] DemoForms = { "أساسيات", "مدخل إلى", "مبادئ", "المرجع في", "شرح", "مسائل محلولة في", "الوجيز في" };
        static readonly string[] DemoParts = { "", "", "الجزء الأول", "الجزء الثاني", "الجزء الثالث" };
        static readonly string[] DemoAuthors = {
            "د. أشرف محمود", "د. سالم الزاوي", "أ. فاطمة الورفلي", "د. علي بن عمران", "د. خالد التاجوري",
            "أ. مريم الشريف", "د. محمد المصراتي", "د. هدى الفيتوري", "أ. عبد الله السويحلي", "د. نوري الغرياني"
        };
        static readonly string[] DemoPublishers = { "دار المعرفة", "منشورات الجامعة", "دار الكتاب الجديد", "دار الفكر", "منشورات الوحدة" };
        static readonly string[] DemoSchool = { "الرياضيات", "العلوم", "اللغة العربية", "اللغة الإنجليزية", "التربية الإسلامية", "التاريخ" };
        static readonly string[] DemoGrades = { "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس" };
        static readonly string[] DemoNovels = {
            "سلسلة شيرلوك هومز", "رجال في الشمس", "موسم الهجرة إلى الشمال", "الخبز الحافي", "ثلاثية غرناطة",
            "حكايات قبل النوم", "قصص الأنبياء للأطفال", "كليلة ودمنة", "مغامرات توم سوير", "البؤساء",
            "حضارة الإسلام في الأندلس", "عالم صوفي", "الأمير الصغير", "مئة عام من العزلة"
        };
        static readonly string[,] DemoStationery = {
            { "قلم جاف أزرق", "أقلام", "Bic", "قطعة", "500" }, { "قلم جاف أحمر", "أقلام", "Bic", "قطعة", "500" },
            { "قلم رصاص HB", "أقلام", "Faber-Castell", "قطعة", "750" }, { "قلم تحديد فسفوري", "أقلام", "Stabilo", "قطعة", "2000" },
            { "دفتر 60 ورقة مسطر", "دفاتر", "الأمل", "قطعة", "1500" }, { "دفتر 100 ورقة مربعات", "دفاتر", "الأمل", "قطعة", "2500" },
            { "كراسة رسم A4", "دفاتر", "Canson", "قطعة", "3500" }, { "مسطرة 30 سم", "أدوات هندسية", "Maped", "قطعة", "1000" },
            { "علبة هندسة كاملة", "أدوات هندسية", "Maped", "علبة", "8500" }, { "آلة حاسبة علمية", "أدوات هندسية", "Casio", "قطعة", "45000" },
            { "ممحاة بيضاء", "أقلام", "Pelikan", "قطعة", "500" }, { "مبراة معدنية", "أقلام", "Maped", "قطعة", "750" },
            { "حقيبة مدرسية", "حقائب", "Delsey", "قطعة", "65000" }, { "ورق طباعة A4 (رزمة)", "ورق وطباعة", "Double A", "رزمة", "28000" },
            { "ملف بلاستيك شفاف", "ورق وطباعة", "Deli", "قطعة", "1000" }, { "ألوان خشبية 12 لون", "أقلام", "Faber-Castell", "علبة", "6500" },
            { "ألوان مائية", "أقلام", "Giotto", "علبة", "9000" }, { "دباسة صغيرة", "ورق وطباعة", "Deli", "قطعة", "7500" }
        };
        static readonly string[] DemoCustomers = {
            "مكتبة الأمل (جملة)", "مدرسة النجاح", "سالم عبد الله", "فاطمة علي", "محمد الطاهر", "عائشة المبروك",
            "خالد سعيد", "مريم أحمد", "علي حسن", "نوري مفتاح", "هدى الصادق", "عمر الهادي"
        };

        /* يملأ قاعدة فارغة ببيانات التجربة. يعيد عدد الأصناف */
        public int SeedDemo(long userId)
        {
            if (Read<long>(delegate (Sqlite c) { return c.Long("SELECT COUNT(*) FROM items", 0); }) > 0)
                throw Err("القاعدة فيها أصناف: بيانات التجربة لقاعدة فارغة فقط.");
            Random r = new Random(2026);

            /* الأماكن: طابق ← أقسام ← خزائن ← رفوف، وغرفة خزين ومخزن */
            long floor = AddPlace(1, "floor", "الطابق الأرضي", "ط1", userId);
            string[] sections = { "الجامعي", "المدرسي", "الأطفال والروايات", "القرطاسية" };
            List<long>[] shelves = new List<long>[sections.Length];
            for (int s = 0; s < sections.Length; s++)
            {
                shelves[s] = new List<long>();
                long sec = AddPlace(floor, "section", "قسم " + sections[s], "", userId);
                for (int k = 0; k < 2; k++)
                {
                    string letter = ((char)('A' + s * 2 + k)).ToString();
                    long cab = AddPlace(sec, "cabinet", "خزانة " + letter, letter, userId);
                    for (int sh = 1; sh <= 4; sh++) shelves[s].Add(AddPlace(cab, "shelf", "رف " + sh, sh.ToString(), userId));
                }
            }
            AddPlace(1, "room", "غرفة الخزين", "", userId);
            long store = AddPlace(0, "store", "المخزن الأول", "", userId);

            SetCategories("book", new string[] { "جامعي", "مدرسي", "روايات", "أطفال", "مراجع", "لغات" }, userId);
            SetCategories("stat", new string[] { "أقلام", "دفاتر", "أدوات هندسية", "حقائب", "ورق وطباعة" }, userId);
            long sup1 = AddSupplier("دار المعرفة للتوزيع", "0912345678", "طرابلس", "", userId);
            long sup2 = AddSupplier("شركة الأفق للقرطاسية", "0923456789", "طرابلس", "", userId);

            List<long> items = new List<long>();
            Run("demo", userId, delegate (Cmd c)
            {
                HashSet<string> seen = new HashSet<string>();
                /* كتب جامعية: «أساسيات الفيزياء الجزء الثاني» */
                for (int i = 0; i < 150; i++)
                {
                    string subject = DemoSubjects[r.Next(DemoSubjects.Length)];
                    string title = (DemoForms[r.Next(DemoForms.Length)] + " " + subject + " " + DemoParts[r.Next(DemoParts.Length)]).Trim();
                    if (!seen.Add(title)) continue;
                    items.Add(DemoBook(c, r, title, "جامعي", "جامعي / " + subject, shelves[0], sup1, 15, 85));
                }
                /* الكتاب المثال في الخطة: الاسم نفسه وأجزاؤه */
                items.Add(DemoBook(c, r, "الفيزياء الأساسية", "جامعي", "جامعي / الفيزياء", shelves[0], sup1, 30, 30));
                items.Add(DemoBook(c, r, "الفيزياء الأساسية الجزء الثاني", "جامعي", "جامعي / الفيزياء", shelves[0], sup1, 32, 32));
                /* كتب المدارس: «الرياضيات للصف الثالث» */
                foreach (string subj in DemoSchool)
                    foreach (string g in DemoGrades)
                        items.Add(DemoBook(c, r, subj + " للصف " + g, "مدرسي", "مدرسي / " + subj, shelves[1], sup1, 5, 15));
                foreach (string n in DemoNovels)
                    items.Add(DemoBook(c, r, n, n.Contains("للأطفال") || n.Contains("قبل النوم") ? "أطفال" : "روايات", "", shelves[2], sup1, 10, 45));
                for (int i = 0; i < DemoStationery.GetLength(0); i++)
                {
                    ItemInput d = new ItemInput();
                    d.Kind = "stat";
                    d.Title = DemoStationery[i, 0]; d.Cat = DemoStationery[i, 1]; d.Brand = DemoStationery[i, 2]; d.Unit = DemoStationery[i, 3];
                    d.Price = long.Parse(DemoStationery[i, 4]);
                    d.PriceW = d.Price * 9 / 10;
                    d.Cost = d.Price * 6 / 10;
                    d.Min = 10;
                    d.Barcode = "62" + (1000000000L + i * 7919).ToString();
                    d.SupplierId = sup2;
                    d.HomePlaceId = shelves[3][r.Next(shelves[3].Count)];
                    items.Add(AddItem0(c, d, r.Next(0, 4) == 0 ? r.Next(0, 5) : r.Next(20, 120), d.HomePlaceId, "open"));
                }
                c.Detail = "بيانات التجربة: " + items.Count + " صنف";
            });

            List<long> customers = new List<long>();
            for (int i = 0; i < DemoCustomers.Length; i++)
                customers.Add(AddCustomer(DemoCustomers[i], "09" + (10000000 + r.Next(90000000)), "", i < 2, i % 4 == 2 ? 1000 * r.Next(20, 150) : 0, userId));

            /* بضاعة واردة للمخزن، وبيعات اليوم (نقداً وآجلاً) */
            List<ReceiveLine> rl = new List<ReceiveLine>();
            for (int i = 0; i < 6; i++) rl.Add(new ReceiveLine(items[r.Next(items.Count)], r.Next(10, 40), 0, store));
            Receive(sup1, "", "شحنة تجربة للمخزن", rl, userId);
            for (int i = 0; i < 9; i++)
            {
                SaleInput s = new SaleInput();
                HashSet<long> used = new HashSet<long>();
                for (int k = r.Next(1, 4); k > 0; k--)
                {
                    long it = items[r.Next(items.Count)];
                    if (!used.Add(it)) continue;
                    s.Lines.Add(new SaleLine(it, r.Next(1, 3), GetItem(it).Price));
                }
                if (i % 4 == 3) { s.Method = "credit"; s.CustomerId = customers[r.Next(customers.Count)]; }
                Sell(s, userId);
            }
            SetSetting("demo", "true", userId);
            return items.Count;
        }

        long DemoBook(Cmd c, Random r, string title, string cat, string catFull, List<long> shelves, long supplier, int minDinar, int maxDinar)
        {
            ItemInput d = new ItemInput();
            d.Kind = "book";
            d.Title = title;
            d.Author = DemoAuthors[r.Next(DemoAuthors.Length)];
            d.Publisher = DemoPublishers[r.Next(DemoPublishers.Length)];
            d.Cat = cat; d.CatFull = catFull;
            d.Price = 250 * (r.Next(minDinar * 4, maxDinar * 4 + 1));
            d.PriceW = d.Price * 9 / 10 / 250 * 250;
            d.Cost = d.Price * 7 / 10 / 250 * 250;
            d.Min = r.Next(0, 3);
            if (r.Next(5) < 3) d.Barcode = "978" + (9953000000L + r.Next(1000000)).ToString();
            d.SupplierId = supplier;
            d.HomePlaceId = shelves[r.Next(shelves.Count)];
            /* بعضها نفد وبعضها قليل: التنبيهات فيها شيء */
            long qty = r.Next(10) == 0 ? 0 : r.Next(1, 15);
            try { return AddItem0(c, d, qty, d.HomePlaceId, "open"); }
            catch (ShopException)
            {
                /* باركود تكرر صدفة: بلا باركود */
                d.Barcode = "";
                return AddItem0(c, d, qty, d.HomePlaceId, "open");
            }
        }
    }
}
