using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;
using System.Threading;
using System.Windows.Forms;

namespace Qirtasiya
{
    static class Program
    {
        const string AppTitle = "منظومة المكتبة والقرطاسية";
        const string AppVersion = "2.6";

        /* مجلد app المجاور للبرنامج كان يُقدَّم قبل الموارد المدمجة، والتثبيت
           في مجلد يكتب فيه المستخدم — فمن يضع app\index.html معدّلاً يتخطّى
           شاشة الترخيص كلها. صار لا يُقرأ إلا بوجود ملف dev-mode.txt. */
        static bool DevMode;

        /* ملكية النافذة: نافذة واحدة فقط تكتب. */
        static string OwnerToken = "";
        static DateTime OwnerSeen = DateTime.MinValue;
        static readonly TimeSpan OwnerTtl = TimeSpan.FromSeconds(12);
        static readonly object OwnerLock = new object();

        static string ExtraBackupDir = "";

        static string BaseDir;
        static string WebDir;
        static string DataDir;
        static string BackupDir;
        static string StoreFile;
        static string PrevFile;
        static string PortFile;

        static int Port;
        static TcpListener Listener;
        static Mutex Single;
        static NotifyIcon Tray;
        static readonly object IoLock = new object();
        static string LogFile;
        static string InstanceKey = "0";

        // ---------- الترخيص ----------
        // التطبيق يحمل المفاتيح العامة فقط: يتحقق من التوقيع ولا يستطيع توليده.
        //
        // PUB_N_NEW: مفتاحك الجديد. ولّده بـ tools/توليد-مفاتيح.html على جهازك
        //            (المفتاح الخاص لا يغادر متصفحك) والصق الناتج هنا.
        // PUB_N_OLD: المفتاح السابق — يبقى مقبولاً فترة انتقالية حتى لا تتوقف
        //            تراخيص الزبائن الحاليين. احذفه بعد إعادة إصدار تراخيصهم.
        //
        // اتركه فارغاً ("") لتعطيل أي من المفتاحين.
        const string PUB_N_NEW = "";
        const string PUB_N_OLD = "ul8ewQ1L8J7bmh0sNG5zGT/8PoKI5pnUmhNqEj1UZQiwaC9utxjGOkF8AjESJKwnVo9TqQpQaspkYcALYW8RKn9kt0bka9l3SVNL6AbIc0UNsfOV7LuQB6CnCyrCE33Bh0PNeOSR37HPtjCj+Cmde86iGylLgpU34nHkeW41RW4OJdtHuS6WOP7U9fGZ2/9KNXwYX0W0TWyPPtD7ckBczDXBoe0EQfq6hHeiCPxFkO3B8vazGrmzjy9UKMGA2sRXuN05AQUqwV5cDmTJK4LcYQzYm1bUoNdw9tp6rmIf6qukey7iIYMxR9XPKqgN5VXb7Q8AUAOm7Chph/J/aPS1tw==";
        const string PUB_E = "AQAB";

        static string[] PublicKeys()
        {
            List<string> keys = new List<string>();
            if (!string.IsNullOrEmpty(PUB_N_NEW)) keys.Add(PUB_N_NEW);
            if (!string.IsNullOrEmpty(PUB_N_OLD)) keys.Add(PUB_N_OLD);
            return keys.ToArray();
        }

        static bool SignatureValid(byte[] data, byte[] sig)
        {
            byte[] hash;
            using (SHA256 sha = SHA256.Create()) hash = sha.ComputeHash(data);
            string[] keys = PublicKeys();
            for (int i = 0; i < keys.Length; i++)
            {
                try
                {
                    using (RSACryptoServiceProvider rsa = new RSACryptoServiceProvider())
                    {
                        RSAParameters pr = new RSAParameters();
                        pr.Modulus = Convert.FromBase64String(keys[i]);
                        pr.Exponent = Convert.FromBase64String(PUB_E);
                        rsa.ImportParameters(pr);
                        if (rsa.VerifyHash(hash, CryptoConfig.MapNameToOID("SHA256"), sig)) return true;
                    }
                }
                catch { }
            }
            return false;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        static extern bool GetVolumeInformation(string rootPathName,
            System.Text.StringBuilder volumeNameBuffer, int volumeNameSize,
            out uint volumeSerialNumber, out uint maximumComponentLength,
            out uint fileSystemFlags, System.Text.StringBuilder fileSystemNameBuffer,
            int nFileSystemNameSize);

        static uint VolumeSerial()
        {
            uint serial = 0;
            try
            {
                uint a, b;
                System.Text.StringBuilder v = new System.Text.StringBuilder(261);
                System.Text.StringBuilder f = new System.Text.StringBuilder(261);
                string root = Path.GetPathRoot(Environment.SystemDirectory);
                GetVolumeInformation(root, v, v.Capacity, out serial, out a, out b, f, f.Capacity);
            }
            catch { }
            return serial;
        }

        /* معرّف التثبيت من سجل ويندوز — يبقى ثابتاً إن غيّر الزبون اسم جهازه */
        /* ختم البناء: ما كتبه السكربت في BuildInfo، وإن كان فارغاً
           (ترجمة يدوية) فتاريخ الملف التنفيذي نفسه. */
        static string BuildStamp()
        {
            if (!string.IsNullOrEmpty(BuildInfo.Stamp)) return BuildInfo.Stamp;
            try
            {
                string p = Assembly.GetExecutingAssembly().Location;
                if (p != null && p.Length > 0 && File.Exists(p))
                    return File.GetLastWriteTime(p).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            }
            catch { }
            return "";
        }

        static string MachineGuid()
        {
            string[] views = new string[] {
                "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography",
                "HKEY_LOCAL_MACHINE\\SOFTWARE\\Wow6432Node\\Microsoft\\Cryptography"
            };
            for (int i = 0; i < views.Length; i++)
            {
                try
                {
                    object v = Registry.GetValue(views[i], "MachineGuid", null);
                    if (v != null && v.ToString().Length > 0) return v.ToString();
                }
                catch { }
            }
            return "";
        }

        static string Fp12(string raw)
        {
            byte[] h;
            using (SHA256 sha = SHA256.Create()) h = sha.ComputeHash(Encoding.UTF8.GetBytes(raw));
            const string AB = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // بلا حروف تلتبس
            char[] outc = new char[12];
            for (int i = 0; i < 12; i++) outc[i] = AB[h[i] % AB.Length];
            return new string(outc, 0, 4) + "-" + new string(outc, 4, 4) + "-" + new string(outc, 8, 4);
        }

        /* البصمة الحالية: الرقم التسلسلي للقرص + معرّف ويندوز الثابت.
           اسم الجهاز خرج منها — تغييره كان يبطل ترخيصاً مدفوعاً. */
        static string MachineFingerprint()
        {
            string guid = MachineGuid();
            string raw = VolumeSerial().ToString("X8", CultureInfo.InvariantCulture) + "|" +
                (guid.Length > 0 ? guid : Environment.MachineName);
            return Fp12(raw);
        }

        /* البصمة القديمة (القرص + اسم الجهاز). تُقبل أيضاً حتى لا يتوقف
           ترخيص أُصدر بنسخة سابقة. */
        static string LegacyFingerprint()
        {
            return Fp12(VolumeSerial().ToString("X8", CultureInfo.InvariantCulture) + "|" + Environment.MachineName);
        }

        /* كل البصمات التي يُقبل ترخيص محرّر لأيٍّ منها */
        static string[] AcceptedFingerprints()
        {
            string now = MachineFingerprint();
            string old = LegacyFingerprint();
            if (old == now) return new string[] { now };
            return new string[] { now, old };
        }

        static bool VerifyLicense(string fp, string code, out string until)
        {
            until = "";
            try
            {
                if (string.IsNullOrEmpty(code)) return false;
                string clean = code.Replace("-", "").Replace(" ", "").Replace("\n", "").Replace("\r", "").Trim();
                int bar = clean.IndexOf('.');
                if (bar <= 0) return false;
                string exp = clean.Substring(0, bar);            // تاريخ الانتهاء أو 0
                string sigB64 = clean.Substring(bar + 1).Replace("_", "/").Replace(",", "+");
                byte[] sig = Convert.FromBase64String(sigB64);

                byte[] data = Encoding.UTF8.GetBytes(fp + "|" + exp);
                if (!SignatureValid(data, sig)) return false;

                if (exp != "0")
                {
                    DateTime d;
                    if (!DateTime.TryParseExact(exp, "yyyyMMdd", CultureInfo.InvariantCulture,
                        DateTimeStyles.None, out d)) return false;
                    /* ساعة الجهاز وحدها كانت تحكم: إرجاعها يمدّد ترخيصاً منتهياً.
                       نحفظ أحدث تاريخ رأيناه ونرفض أي قفزة إلى الوراء. */
                    DateTime now = DateTime.Now.Date;
                    DateTime seen = LastSeenDate();
                    if (seen > now) now = seen;
                    if (now > d.Date) { until = "expired"; return false; }
                    TouchLastSeen(now);
                    until = d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                }
                else until = "دائم";
                return true;
            }
            catch { return false; }
        }

        /* الترخيص وقفل الأرباح مربوطان بالجهاز لا بمجلد البيانات.
           كانا داخل DataDir، فتثبيتُ البرنامج — وهو يغيّر مجلد
           البيانات — كان يفقد الترخيص، فتُرفض كل كتابة بـ«unlicensed»
           ويبدو زر الاستعادة وكأنه لا يفعل شيئاً.
           صارا في مجلد المستخدم الثابت، ويُنقلان من المكان القديم
           تلقائياً إن وُجدا فيه. */
        static string UserRoot()
        {
            string r = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Qirtasiya");
            try { Directory.CreateDirectory(r); } catch { }
            return r;
        }

        /* يعيد المسار الثابت، وينقل إليه الملف القديم مرة واحدة */
        static string MachineFile(string name)
        {
            string stable = Path.Combine(UserRoot(), name);
            try
            {
                if (!File.Exists(stable))
                {
                    string old = Path.Combine(DataDir, name);
                    if (File.Exists(old))
                    {
                        File.Copy(old, stable);
                        Log("نُقل " + name + " إلى مجلد المستخدم الثابت");
                    }
                }
            }
            catch (Exception ex) { Log("تعذّر نقل " + name + ": " + ex.Message); }
            return stable;
        }

        static string LicPath() { return MachineFile("license.txt"); }

        static DateTime LastSeenDate()
        {
            try
            {
                string f = MachineFile("lastseen.txt");
                if (!File.Exists(f)) return DateTime.MinValue;
                DateTime d;
                if (DateTime.TryParseExact(File.ReadAllText(f).Trim(), "yyyy-MM-dd",
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out d)) return d.Date;
            }
            catch { }
            return DateTime.MinValue;
        }

        static void TouchLastSeen(DateTime d)
        {
            try
            {
                if (d <= LastSeenDate()) return;
                File.WriteAllText(MachineFile("lastseen.txt"),
                    d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), new UTF8Encoding(false));
            }
            catch { }
        }

        // ---------- رمز الأرباح ----------
        // كان بالنص الصريح داخل store.json ويُقدَّم على /api/load لأي متصفح.

        static string ProfitCodePath() { return MachineFile("profit.hash"); }

        static string HashCode(string code)
        {
            using (SHA256 sha = SHA256.Create())
                return Convert.ToBase64String(sha.ComputeHash(
                    Encoding.UTF8.GetBytes("qirtasiya-profit-v1|" + code)));
        }

        static bool ProfitCodeMatches(string code)
        {
            if (code == null) return false;
            string want;
            try
            {
                want = File.Exists(ProfitCodePath())
                    ? File.ReadAllText(ProfitCodePath()).Trim()
                    : HashCode("Rtv8ss3i");        // الرمز القديم حتى يغيّره صاحب المحل
            }
            catch { return false; }

            string got = HashCode(code.Trim());
            if (got.Length != want.Length) return false;
            int diff = 0;                          // مقارنة لا تتأثر بتوقيت التنفيذ
            for (int i = 0; i < got.Length; i++) diff |= got[i] ^ want[i];
            return diff == 0;
        }

        static bool LicenseOK(out string fp, out string until)
        {
            fp = MachineFingerprint();
            until = "";
            try
            {
                if (!File.Exists(LicPath())) return false;
                string code = File.ReadAllText(LicPath()).Trim();
                string[] fps = AcceptedFingerprints();
                for (int i = 0; i < fps.Length; i++)
                {
                    string u;
                    if (VerifyLicense(fps[i], code, out u)) { until = u; return true; }
                    if (u == "expired") until = "expired";
                }
                return false;
            }
            catch { return false; }
        }

        /* بصمة قصيرة من مسار التثبيت: تثبيتان مختلفان = قفل ونافذة مستقلان */
        static string MakeInstanceKey(string path)
        {
            string p = (path == null ? "" : path).ToLowerInvariant();
            long h = 5381;
            for (int i = 0; i < p.Length; i++) h = ((h << 5) + h + p[i]) & 0x7FFFFFFF;
            return h.ToString("x", CultureInfo.InvariantCulture);
        }
        static int ReqLogged = 0;
        static bool NoOpen;

        static void Log(string msg)
        {
            try
            {
                if (string.IsNullOrEmpty(LogFile)) return;
                FileInfo fi = new FileInfo(LogFile);
                if (fi.Exists && fi.Length > 200000) File.Delete(LogFile);
                File.AppendAllText(LogFile,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "  " + msg + "\r\n",
                    new UTF8Encoding(false));
            }
            catch { }
        }

        [STAThread]
        static void Main()
        {
            string[] argv = Environment.GetCommandLineArgs();
            for (int i = 1; i < argv.Length; i++)
            {
                string a = argv[i].TrimStart('-', '/').ToLowerInvariant();
                if (a == "noopen") NoOpen = true;
            }

            BaseDir = AppDomain.CurrentDomain.BaseDirectory;
            InstanceKey = MakeInstanceKey(BaseDir);

            bool isFirst;
            Single = new Mutex(true, "Local\\Qirtasiya_" + InstanceKey, out isFirst);

            WebDir = Path.Combine(BaseDir, "app");

            if (!isFirst)
            {
                // Already running: just re-open the window and exit.
                try
                {
                    string pf = Path.Combine(ResolveDataDir(), "port.txt");
                    if (File.Exists(pf))
                    {
                        int p;
                        if (int.TryParse(File.ReadAllText(pf).Trim(), out p) && !NoOpen)
                        {
                            OpenWindow("http://127.0.0.1:" + p.ToString(CultureInfo.InvariantCulture) + "/");
                        }
                    }
                }
                catch { }
                return;
            }

            try
            {
                DataDir = ResolveDataDir();
                BackupDir = Path.Combine(DataDir, "backups");
                Directory.CreateDirectory(DataDir);
                Directory.CreateDirectory(BackupDir);
                LogFile = Path.Combine(DataDir, "log.txt");
                Log("---- بدء التشغيل ----");
                Log("ويندوز: " + Environment.OSVersion.VersionString + " | 64bit: " + (IntPtr.Size == 8));
                Log("سطر الأوامر: " + Environment.CommandLine);
                Log("مجلد البرنامج: " + BaseDir);
                Log("مجلد البيانات: " + DataDir);
                StoreFile = Path.Combine(DataDir, "store.json");
                PrevFile = Path.Combine(DataDir, "store.previous.json");
                PortFile = Path.Combine(DataDir, "port.txt");

                Log("الإصدار " + AppVersion + " (بناء " + BuildStamp() + ") — الواجهة مدمجة داخل الملف التنفيذي");
                Log("مفتاح هذا التثبيت: " + InstanceKey);
                string _fp, _un;
                Log(LicenseOK(out _fp, out _un) ? ("الترخيص مفعّل حتى: " + _un) : ("غير مفعّل — بصمة الجهاز: " + _fp));

                DevMode = File.Exists(Path.Combine(BaseDir, "dev-mode.txt"));
                if (DevMode) Log("وضع التطوير مفعّل — يُقرأ مجلد app المجاور");
                try
                {
                    string bd = Path.Combine(DataDir, "backup-dir.txt");
                    if (File.Exists(bd)) ExtraBackupDir = File.ReadAllText(bd).Trim();
                    if (ExtraBackupDir.Length > 0) Log("مجلد نسخ إضافي: " + ExtraBackupDir);
                }
                catch { }

                EnableTls();
                MakeDailyBackup();
                PruneBackups(30);

                Port = StartServer();
                Log("النواة تعمل على المنفذ " + Port.ToString(CultureInfo.InvariantCulture));
                File.WriteAllText(PortFile, Port.ToString(CultureInfo.InvariantCulture), new UTF8Encoding(false));

                Application.EnableVisualStyles();
                SetupTray();
                Log("أيقونة شريط المهام جاهزة");
                if (NoOpen) Log("سيفتح ويندوز النافذة (وضع /noopen)");
                else OpenWindow(Url());
                Application.Run();
            }
            catch (Exception ex)
            {
                Log("خطأ قاتل: " + ex.ToString());
                MessageBox.Show("تعذر تشغيل البرنامج:\n\n" + ex.Message +
                    "\n\nالتفاصيل في الملف:\n" + (LogFile == null ? "(غير متاح)" : LogFile),
                    AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                try { if (Tray != null) { Tray.Visible = false; Tray.Dispose(); } }
                catch { }
            }
        }

        static string Url()
        {
            return "http://127.0.0.1:" + Port.ToString(CultureInfo.InvariantCulture) + "/";
        }

        // ---------- data location ----------

        static bool Writable(string dir)
        {
            try
            {
                Directory.CreateDirectory(dir);
                string probe = Path.Combine(dir, ".write-test");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return true;
            }
            catch { return false; }
        }

        /* النسخة المثبَّتة تضع هذا الملف بجانب البرنامج. وجوده يعني:
           لا تكتب البيانات هنا (Program Files للقراءة)، بل في مجلد
           المستخدم الثابت. */
        static bool Installed()
        {
            try { return File.Exists(Path.Combine(BaseDir, "installed.flag")); }
            catch { return false; }
        }

        /* المسار الثابت للنسخة المثبَّتة: لا يحمل بصمة المجلد، فلا
           يتغيّر مع إعادة التثبيت أو التحديث. قبله كان المسار الاحتياطي
           يحمل بصمة مجلد البرنامج (inst_<hash>)، فتثبيتٌ في مكان آخر
           كان يعني مجلد بيانات آخر — أي بيانات تبدو ضائعة. */
        static string StableDataDir()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Qirtasiya", "data");
        }

        /* إنقاذ بيانات من نسخة قديمة كانت تكتب في مسار ببصمة المجلد.
           يُنسخ أحدث ما وُجد، ولا يُحذف الأصل أبداً. */
        static void RescueOldData(string target)
        {
            try
            {
                if (File.Exists(Path.Combine(target, "store.json"))) return;
                string root = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Qirtasiya");
                if (!Directory.Exists(root)) return;

                string best = null;
                DateTime bestAt = DateTime.MinValue;
                foreach (string d in Directory.GetDirectories(root, "inst_*"))
                {
                    string f = Path.Combine(d, "store.json");
                    if (!File.Exists(f)) continue;
                    DateTime at = File.GetLastWriteTime(f);
                    if (at > bestAt) { bestAt = at; best = d; }
                }
                if (best == null) return;

                Directory.CreateDirectory(target);
                foreach (string f in Directory.GetFiles(best))
                {
                    string to = Path.Combine(target, Path.GetFileName(f));
                    if (!File.Exists(to)) File.Copy(f, to);
                }
                Log("نُقلت بيانات من نسخة سابقة: " + best);
            }
            catch (Exception ex) { Log("تعذّر نقل بيانات سابقة: " + ex.Message); }
        }

        static string ResolveDataDir()
        {
            string local = Path.Combine(BaseDir, "data");

            /* 1) وضع محمول: مجلد data موجود بجانب البرنامج ويقبل الكتابة.
                  يبقى كما هو لمن يشغّل البرنامج من مجلد التنزيلات. */
            if (!Installed() && Directory.Exists(local) && Writable(local)) return local;

            /* 2) وضع مثبَّت، أو مجلد البرنامج لا يقبل الكتابة */
            if (Installed() || !Writable(local))
            {
                string stable = StableDataDir();
                Directory.CreateDirectory(stable);
                RescueOldData(stable);
                return stable;
            }

            /* 3) محمول جديد: أنشئ المجلد بجانب البرنامج */
            return local;
        }

        // ---------- backups ----------

        static void MakeDailyBackup()
        {
            try
            {
                if (!File.Exists(StoreFile)) return;
                string name = "backup-" + DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + ".json";
                string target = Path.Combine(BackupDir, name);
                if (!File.Exists(target)) { File.Copy(StoreFile, target); CopyOutside(name); }
            }
            catch { }
        }

        static string MakeManualBackup()
        {
            lock (IoLock)
            {
                if (!File.Exists(StoreFile)) return "";
                string name = "backup-" + DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss", CultureInfo.InvariantCulture) + ".json";
                File.Copy(StoreFile, Path.Combine(BackupDir, name), true);
                CopyOutside(name);
                return name;
            }
        }

        /* ينسخ كل نسخة احتياطية إلى مجلد خارج الجهاز (فلاشة أو مجلد سحابي).
           كل النسخ كانت داخل مجلد البرنامج: عطل قرص واحد يأخذ البيانات
           و150 نسخة معها. */
        static void CopyOutside(string name)
        {
            if (string.IsNullOrEmpty(ExtraBackupDir)) return;
            try
            {
                Directory.CreateDirectory(ExtraBackupDir);
                File.Copy(Path.Combine(BackupDir, name), Path.Combine(ExtraBackupDir, name), true);
                Log("نُسخت النسخة إلى المجلد الإضافي: " + name);
            }
            catch (Exception ex) { Log("تعذّر النسخ إلى المجلد الإضافي: " + ex.Message); }
        }

        /* إبقاء 30 نسخة يومية + نسخة واحدة من كل شهر.
           150 نسخة يومية × 10 ميجابايت كانت تعني 1.5 جيجابايت بعد سنة. */
        static void PruneBackups(int keepDaily)
        {
            try
            {
                string[] files = Directory.GetFiles(BackupDir, "backup-*.json");
                if (files.Length <= keepDaily) return;
                Array.Sort(files, StringComparer.Ordinal);

                Dictionary<string, string> monthKeeper = new Dictionary<string, string>();
                for (int i = 0; i < files.Length; i++)
                {
                    string n = Path.GetFileName(files[i]);
                    if (n.Length < 14) continue;
                    string ym = n.Substring(7, 7);              // backup-YYYY-MM
                    if (!monthKeeper.ContainsKey(ym)) monthKeeper[ym] = files[i];
                }

                for (int i = 0; i < files.Length - keepDaily; i++)
                {
                    string n = Path.GetFileName(files[i]);
                    if (n.Length >= 14 && monthKeeper.ContainsKey(n.Substring(7, 7)) &&
                        monthKeeper[n.Substring(7, 7)] == files[i]) continue;   // أول نسخة في شهرها تبقى
                    try { File.Delete(files[i]); }
                    catch { }
                }
            }
            catch { }
        }

        // ---------- server ----------

        static int StartServer()
        {
            for (int p = 17845; p < 17945; p++)
            {
                try
                {
                    TcpListener l = new TcpListener(IPAddress.Loopback, p);
                    l.Start();
                    Listener = l;
                    Thread t = new Thread(AcceptLoop);
                    t.IsBackground = true;
                    t.Start();
                    return p;
                }
                catch (SocketException) { }
            }
            throw new Exception("لا يوجد منفذ محلي متاح.");
        }

        static void AcceptLoop()
        {
            while (true)
            {
                TcpClient client;
                try { client = Listener.AcceptTcpClient(); }
                catch { break; }
                ThreadPool.QueueUserWorkItem(HandleClient, client);
            }
        }

        static void HandleClient(object state)
        {
            TcpClient client = (TcpClient)state;
            string reqLine = "";
            try
            {
                client.NoDelay = true;
                client.ReceiveTimeout = 20000;
                client.SendTimeout = 30000;
                NetworkStream ns = client.GetStream();

                string head;
                byte[] extra;
                if (!ReadHeaderBlock(ns, out head, out extra))
                {
                    CloseGracefully(client);   // اتصال مُسبق بلا طلب — طبيعي من المتصفح
                    return;
                }

                string[] lines = head.Split(new string[] { "\r\n" }, StringSplitOptions.None);
                if (lines.Length == 0) { CloseGracefully(client); return; }

                reqLine = lines[0];
                string[] parts = reqLine.Split(new char[] { ' ' });
                if (parts.Length < 2) { CloseGracefully(client); return; }

                string method = parts[0];
                string rawPath = parts[1];

                int contentLength = 0;
                for (int i = 1; i < lines.Length; i++)
                {
                    int colon = lines[i].IndexOf(':');
                    if (colon <= 0) continue;
                    if (string.Equals(lines[i].Substring(0, colon).Trim(), "Content-Length",
                        StringComparison.OrdinalIgnoreCase))
                        int.TryParse(lines[i].Substring(colon + 1).Trim(), out contentLength);
                }

                byte[] body = new byte[0];
                if (contentLength > 0)
                {
                    body = new byte[contentLength];
                    int have = Math.Min(extra.Length, contentLength);
                    Array.Copy(extra, 0, body, 0, have);
                    while (have < contentLength)
                    {
                        int n = ns.Read(body, have, contentLength - have);
                        if (n <= 0) break;
                        have += n;
                    }
                }

                Route(ns, method, rawPath, body, lines);
                try { ns.Flush(); }
                catch { }
                CloseGracefully(client);
            }
            catch (Exception ex)
            {
                Log("فشل الطلب [" + reqLine + "] : " + ex.GetType().Name + " : " + ex.Message);
                try { CloseGracefully(client); }
                catch { }
            }
        }

        /* يقرأ ترويسة الطلب كاملة دفعة واحدة بدل بايت بايت */
        static bool ReadHeaderBlock(NetworkStream ns, out string head, out byte[] extra)
        {
            head = null;
            extra = new byte[0];
            MemoryStream ms = new MemoryStream();
            byte[] buf = new byte[4096];

            while (ms.Length < 131072)
            {
                int n;
                try { n = ns.Read(buf, 0, buf.Length); }
                catch { return false; }
                if (n <= 0) return false;
                ms.Write(buf, 0, n);

                byte[] arr = ms.ToArray();
                for (int i = 0; i + 3 < arr.Length; i++)
                {
                    if (arr[i] == 13 && arr[i + 1] == 10 && arr[i + 2] == 13 && arr[i + 3] == 10)
                    {
                        head = Encoding.UTF8.GetString(arr, 0, i);
                        int rest = arr.Length - (i + 4);
                        extra = new byte[rest];
                        if (rest > 0) Array.Copy(arr, i + 4, extra, 0, rest);
                        return true;
                    }
                }
            }
            return false;
        }

        /* إغلاق مهذّب: ويندوز يرسل RST إن أُغلق المقبس وفيه بيانات غير مقروءة،
           فيرى المتصفح ردّاً فارغاً. نُنهي الإرسال ثم نستهلك الباقي ثم نغلق. */
        static void CloseGracefully(TcpClient client)
        {
            try { client.Client.Shutdown(SocketShutdown.Send); }
            catch { }
            try
            {
                client.Client.ReceiveTimeout = 250;
                byte[] junk = new byte[2048];
                while (client.Client.Receive(junk) > 0) { }
            }
            catch { }
            try { client.Close(); }
            catch { }
        }

        static string GetHeader(string[] lines, string name)
        {
            for (int i = 1; i < lines.Length; i++)
            {
                int colon = lines[i].IndexOf(':');
                if (colon <= 0) continue;
                if (string.Equals(lines[i].Substring(0, colon).Trim(), name, StringComparison.OrdinalIgnoreCase))
                    return lines[i].Substring(colon + 1).Trim();
            }
            return null;
        }

        /* حارس نداءات الـAPI.
           بدونه كانت أي صفحة ويب يفتحها صاحب المحل تستطيع إرسال POST إلى
           127.0.0.1 وتمسح قاعدة البيانات أو تشغّل أداة إلغاء التثبيت.
           ثلاث طبقات:
             1) Host يجب أن يكون منفذنا على 127.0.0.1 — يغلق DNS rebinding.
             2) Origin إن وُجد يجب أن يكون أصلنا نحن.
             3) ترويسة X-Qirtasiya المخصّصة — تُجبر المتصفح على preflight،
                والنواة لا ترسل ترويسات CORS، فيفشل الطلب قبل أن يصل. */
        static bool ApiAllowed(string[] lines)
        {
            string want = "127.0.0.1:" + Port.ToString(CultureInfo.InvariantCulture);
            string host = GetHeader(lines, "Host");
            if (host == null || host != want) return false;

            string origin = GetHeader(lines, "Origin");
            if (!string.IsNullOrEmpty(origin) && origin != "http://" + want) return false;

            if (GetHeader(lines, "X-Qirtasiya") != "1") return false;
            return true;
        }

        static bool IsOwner(string[] lines)
        {
            lock (OwnerLock)
            {
                if (string.IsNullOrEmpty(OwnerToken)) return false;
                if (DateTime.UtcNow - OwnerSeen > OwnerTtl) return false;
                return GetHeader(lines, "X-Owner") == OwnerToken;
            }
        }

        static string NewToken()
        {
            byte[] b = new byte[16];
            using (RNGCryptoServiceProvider r = new RNGCryptoServiceProvider()) r.GetBytes(b);
            return BitConverter.ToString(b).Replace("-", "").ToLowerInvariant();
        }

        /* تحقق أن الجسم JSON صالح فعلاً قبل استبدال ملف البيانات.
           كان الفحص body[0]=='{' فقط، فجسم مبتور يستبدل ملفاً سليماً. */
        static bool LooksLikeJsonObject(byte[] body)
        {
            if (body == null || body.Length < 2) return false;
            int i = 0;
            while (i < body.Length && (body[i] == 32 || body[i] == 9 || body[i] == 10 || body[i] == 13)) i++;
            if (i >= body.Length || body[i] != (byte)'{') return false;

            string txt;
            try { txt = new UTF8Encoding(false, true).GetString(body); }
            catch { return false; }

            int depth = 0; bool inStr = false; bool esc = false; bool sawEnd = false;
            for (int k = 0; k < txt.Length; k++)
            {
                char c = txt[k];
                if (inStr)
                {
                    if (esc) { esc = false; continue; }
                    if (c == '\\') { esc = true; continue; }
                    if (c == '"') inStr = false;
                    continue;
                }
                if (c == '"') { inStr = true; continue; }
                if (c == '{' || c == '[') depth++;
                else if (c == '}' || c == ']')
                {
                    depth--;
                    if (depth < 0) return false;
                    if (depth == 0) sawEnd = true;
                }
                else if (sawEnd && c > ' ') return false;   // محتوى بعد نهاية الكائن
            }
            return depth == 0 && !inStr && sawEnd;
        }

        static void Route(Stream s, string method, string rawPath, byte[] body, string[] lines)
        {
            string path = rawPath;
            int q = path.IndexOf('?');
            if (q >= 0) path = path.Substring(0, q);
            path = Uri.UnescapeDataString(path);

            /* استثناء واحد من فحص الترويسة: تحرير الملكية عند إغلاق النافذة.
               sendBeacon لا يحمل ترويسات مخصّصة، لكنه الطريقة الوحيدة الموثوقة
               أثناء الإغلاق. الرمز نفسه (128 بت عشوائية) هو الإذن هنا —
               ولا يفعل هذا النداء شيئاً سوى تحرير القفل. */
            if (path == "/api/release" && method == "POST")
            {
                string tok = null;
                int qi = rawPath.IndexOf("?t=", StringComparison.Ordinal);
                if (qi >= 0) tok = Uri.UnescapeDataString(rawPath.Substring(qi + 3));
                if (string.IsNullOrEmpty(tok)) tok = GetHeader(lines, "X-Owner");
                lock (OwnerLock)
                {
                    if (!string.IsNullOrEmpty(OwnerToken) && tok == OwnerToken)
                    {
                        OwnerToken = ""; OwnerSeen = DateTime.MinValue;
                        Log("حُرّرت ملكية النافذة");
                    }
                }
                SendJson(s, "{\"ok\":true}");
                return;
            }

            if (path.StartsWith("/api/", StringComparison.Ordinal))
            {
                if (!ApiAllowed(lines))
                {
                    Log("رُفض نداء API من مصدر غير موثوق: " + path);
                    Send(s, 403, "Forbidden", "application/json; charset=utf-8",
                        Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":\"forbidden\"}"));
                    return;
                }

                // بلا ترخيص لا تُفتح بيانات ولا تُكتب — الفحص في الواجهة وحده كان يُتخطّى بملف واحد
                bool needLicense = path != "/api/license" && path != "/api/activate" &&
                                   path != "/api/info" && path != "/api/preset" && path != "/api/quit";
                if (needLicense)
                {
                    string lfp, lun;
                    if (!LicenseOK(out lfp, out lun))
                    {
                        Send(s, 403, "Forbidden", "application/json; charset=utf-8",
                            Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":\"unlicensed\"}"));
                        return;
                    }
                }

                // نداءات الكتابة تحتاج ملكية النافذة
                bool needOwner = path == "/api/save" || path == "/api/restore" ||
                                 path == "/api/backup" || path == "/api/backup-dir" ||
                                 path == "/api/uninstall" || path == "/api/profit-code" ||
                                 path == "/api/archive";
                if (needOwner && !IsOwner(lines))
                {
                    Send(s, 409, "Conflict", "application/json; charset=utf-8",
                        Encoding.UTF8.GetBytes("{\"ok\":false,\"notOwner\":true}"));
                    return;
                }
            }

            // ---------- ملكية النافذة ----------

            if (path == "/api/claim" && method == "POST")
            {
                string req = Encoding.UTF8.GetString(body);
                bool force = req.IndexOf("\"force\":true", StringComparison.Ordinal) >= 0;
                lock (OwnerLock)
                {
                    bool free = string.IsNullOrEmpty(OwnerToken) ||
                                DateTime.UtcNow - OwnerSeen > OwnerTtl;
                    if (free || force)
                    {
                        OwnerToken = NewToken();
                        OwnerSeen = DateTime.UtcNow;
                        Log(force && !free ? "أُخذت الملكية بالقوة من نافذة أخرى" : "مُنحت ملكية النافذة");
                        SendJson(s, "{\"ok\":true,\"token\":" + JsonStr(OwnerToken) + "}");
                        return;
                    }
                }
                SendJson(s, "{\"ok\":false,\"busy\":true}");
                return;
            }

            if (path == "/api/heartbeat" && method == "POST")
            {
                lock (OwnerLock)
                {
                    if (!string.IsNullOrEmpty(OwnerToken) && GetHeader(lines, "X-Owner") == OwnerToken)
                    {
                        OwnerSeen = DateTime.UtcNow;
                        SendJson(s, "{\"ok\":true}");
                        return;
                    }
                }
                SendJson(s, "{\"ok\":false,\"notOwner\":true}");
                return;
            }

            // ---------- رمز الأرباح ----------
            // يُخزَّن مجزّأً هنا، فلا يظهر في store.json ولا على /api/load

            if (path == "/api/profit-unlock" && method == "POST")
            {
                string code = ExtractJsonValue(Encoding.UTF8.GetString(body), "code");
                SendJson(s, ProfitCodeMatches(code) ? "{\"ok\":true}" : "{\"ok\":false}");
                return;
            }

            if (path == "/api/profit-code" && method == "POST")
            {
                try
                {
                    string code = ExtractJsonValue(Encoding.UTF8.GetString(body), "code");
                    if (string.IsNullOrEmpty(code) || code.Trim().Length < 4)
                        throw new Exception("الرمز قصير جداً");
                    File.WriteAllText(ProfitCodePath(), HashCode(code.Trim()), new UTF8Encoding(false));
                    Log("غُيّر رمز الأرباح");
                    SendJson(s, "{\"ok\":true}");
                }
                catch (Exception ex) { SendJson(s, "{\"ok\":false,\"error\":" + JsonStr(ex.Message) + "}"); }
                return;
            }

            /* ---------- أرشفة الفواتير ----------
               store.json يحمل كل فاتورة منذ أول يوم. بعد سنتين يصل 20-30
               ميجابايت: كل حفظ يعيد كتابته، وكل نسخة احتياطية تنسخه.
               الأرشفة تنقل فواتير سنة كاملة إلى ملف مستقل يُقرأ عند الطلب. */

            if (path == "/api/archive" && method == "POST")
            {
                try
                {
                    string req = Encoding.UTF8.GetString(body);
                    string year = ExtractJsonValue(req, "year");
                    string rows = ExtractJsonRaw(req, "invoices");
                    if (string.IsNullOrEmpty(year) || year.Length != 4)
                        throw new Exception("سنة غير صالحة");
                    for (int i = 0; i < year.Length; i++)
                        if (year[i] < '0' || year[i] > '9') throw new Exception("سنة غير صالحة");
                    if (string.IsNullOrEmpty(rows) || rows == "null")
                        throw new Exception("لا توجد فواتير للأرشفة");

                    string dir = Path.Combine(DataDir, "archive");
                    Directory.CreateDirectory(dir);
                    string target = Path.Combine(dir, "invoices-" + year + ".json");
                    lock (IoLock) File.WriteAllText(target, rows, new UTF8Encoding(false));
                    Log("أُرشفت فواتير سنة " + year);
                    SendJson(s, "{\"ok\":true,\"file\":" + JsonStr("archive/invoices-" + year + ".json") + "}");
                }
                catch (Exception ex) { SendJson(s, "{\"ok\":false,\"error\":" + JsonStr(ex.Message) + "}"); }
                return;
            }

            if (path == "/api/archives")
            {
                StringBuilder ab = new StringBuilder("[");
                try
                {
                    string dir = Path.Combine(DataDir, "archive");
                    if (Directory.Exists(dir))
                    {
                        string[] fs2 = Directory.GetFiles(dir, "invoices-*.json");
                        Array.Sort(fs2, StringComparer.Ordinal);
                        ReverseStrings(fs2);
                        for (int i = 0; i < fs2.Length; i++)
                        {
                            FileInfo fi = new FileInfo(fs2[i]);
                            string yr = Path.GetFileNameWithoutExtension(fi.Name).Replace("invoices-", "");
                            if (i > 0) ab.Append(",");
                            ab.Append("{\"year\":").Append(JsonStr(yr))
                              .Append(",\"size\":").Append(fi.Length.ToString(CultureInfo.InvariantCulture))
                              .Append("}");
                        }
                    }
                }
                catch { }
                ab.Append("]");
                SendJson(s, ab.ToString());
                return;
            }

            if (path == "/api/archive-read")
            {
                try
                {
                    string yr = "";
                    int qp = rawPath.IndexOf("?year=", StringComparison.Ordinal);
                    if (qp >= 0) yr = rawPath.Substring(qp + 6);
                    if (yr.Length != 4) throw new Exception("سنة غير صالحة");
                    for (int i = 0; i < yr.Length; i++)
                        if (yr[i] < '0' || yr[i] > '9') throw new Exception("سنة غير صالحة");
                    string f = Path.Combine(Path.Combine(DataDir, "archive"), "invoices-" + yr + ".json");
                    if (!File.Exists(f)) throw new Exception("لا يوجد أرشيف لهذه السنة");
                    Send(s, 200, "OK", "application/json; charset=utf-8", File.ReadAllBytes(f));
                }
                catch (Exception ex) { SendJson(s, "{\"ok\":false,\"error\":" + JsonStr(ex.Message) + "}"); }
                return;
            }

            if (path == "/api/backup-dir" && method == "POST")
            {
                try
                {
                    string dir = ExtractJsonValue(Encoding.UTF8.GetString(body), "dir");
                    ExtraBackupDir = (dir == null ? "" : dir.Trim());
                    File.WriteAllText(Path.Combine(DataDir, "backup-dir.txt"), ExtraBackupDir, new UTF8Encoding(false));
                    SendJson(s, "{\"ok\":true}");
                }
                catch (Exception ex) { SendJson(s, "{\"ok\":false,\"error\":" + JsonStr(ex.Message) + "}"); }
                return;
            }

            if (path == "/api/load")
            {
                byte[] data;
                lock (IoLock)
                {
                    data = File.Exists(StoreFile) ? File.ReadAllBytes(StoreFile) : new byte[0];
                    if (data.Length < 2 && File.Exists(PrevFile)) data = File.ReadAllBytes(PrevFile);
                }
                if (data.Length < 2) data = Encoding.UTF8.GetBytes("null");
                Send(s, 200, "OK", "application/json; charset=utf-8", data);
                return;
            }

            if (path == "/api/save" && method == "POST")
            {
                try
                {
                    if (!LooksLikeJsonObject(body))
                        throw new Exception("محتوى غير صالح — لم يُكتب شيء");
                    lock (IoLock)
                    {
                        // ثلاثة أجيال بدل واحد: جيل واحد لا يكفي إن تكرر حفظ فاسد
                        string prev2 = StoreFile + ".prev2";
                        try { if (File.Exists(PrevFile)) File.Copy(PrevFile, prev2, true); }
                        catch { }
                        string tmp = StoreFile + ".tmp";
                        File.WriteAllBytes(tmp, body);
                        if (File.Exists(StoreFile)) File.Replace(tmp, StoreFile, PrevFile, true);
                        else File.Move(tmp, StoreFile);
                    }
                    SendJson(s, "{\"ok\":true}");
                }
                catch (Exception ex)
                {
                    SendJson(s, "{\"ok\":false,\"error\":" + JsonStr(ex.Message) + "}");
                }
                return;
            }

            if (path == "/api/backup" && method == "POST")
            {
                try
                {
                    string name = MakeManualBackup();
                    PruneBackups(30);
                    SendJson(s, "{\"ok\":true,\"name\":" + JsonStr(name) + "}");
                }
                catch (Exception ex)
                {
                    SendJson(s, "{\"ok\":false,\"error\":" + JsonStr(ex.Message) + "}");
                }
                return;
            }

            if (path == "/api/backups")
            {
                StringBuilder sb = new StringBuilder("[");
                try
                {
                    string[] files = Directory.GetFiles(BackupDir, "backup-*.json");
                    Array.Sort(files, StringComparer.Ordinal);
                    ReverseStrings(files);   // Array.Reverse<T> غير موجود في .NET Framework
                    for (int i = 0; i < files.Length; i++)
                    {
                        FileInfo fi = new FileInfo(files[i]);
                        if (i > 0) sb.Append(",");
                        sb.Append("{\"name\":").Append(JsonStr(fi.Name));
                        sb.Append(",\"size\":").Append(fi.Length.ToString(CultureInfo.InvariantCulture));
                        sb.Append(",\"date\":").Append(JsonStr(fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)));
                        sb.Append("}");
                    }
                }
                catch { }
                sb.Append("]");
                SendJson(s, sb.ToString());
                return;
            }

            if (path == "/api/restore" && method == "POST")
            {
                try
                {
                    string name = ExtractJsonValue(Encoding.UTF8.GetString(body), "name");
                    if (string.IsNullOrEmpty(name) || name.Contains("..") || name.Contains("\\") || name.Contains("/"))
                        throw new Exception("اسم ملف غير صالح");
                    string src = Path.Combine(BackupDir, name);
                    if (!File.Exists(src)) throw new Exception("النسخة غير موجودة");
                    lock (IoLock)
                    {
                        MakeManualBackup();
                        File.Copy(src, StoreFile, true);
                    }
                    SendJson(s, "{\"ok\":true}");
                }
                catch (Exception ex)
                {
                    SendJson(s, "{\"ok\":false,\"error\":" + JsonStr(ex.Message) + "}");
                }
                return;
            }

            if (path == "/api/uninstall" && method == "POST")
            {
                try
                {
                    string un = Path.Combine(BaseDir, "Uninstall.exe");
                    if (!File.Exists(un)) throw new Exception("لم يُعثر على أداة إلغاء التثبيت");
                    Log("طلب المستخدم إلغاء التثبيت مع مسح البيانات");
                    Process.Start(un, "/purge");
                    SendJson(s, "{\"ok\":true}");
                    try { s.Flush(); }
                    catch { }
                    Thread.Sleep(1200);
                    ExitApp();
                }
                catch (Exception ex)
                {
                    SendJson(s, "{\"ok\":false,\"error\":" + JsonStr(ex.Message) + "}");
                }
                return;
            }

            if (path == "/api/open-folder" && method == "POST")
            {
                try { Process.Start("explorer.exe", "\"" + DataDir + "\""); }
                catch { }
                SendJson(s, "{\"ok\":true}");
                return;
            }

            if (path == "/api/info")
            {
                SendJson(s, "{\"ok\":true,\"version\":" + JsonStr(AppVersion) +
                    ",\"build\":" + JsonStr(BuildStamp()) +
                    ",\"dataDir\":" + JsonStr(DataDir) + ",\"port\":" + Port.ToString(CultureInfo.InvariantCulture) + "}");
                return;
            }

            if (path == "/api/quit" && method == "POST")
            {
                SendJson(s, "{\"ok\":true}");
                try { s.Flush(); }
                catch { }
                ExitApp();
                return;
            }

            // الإعداد المسبق الذي يكتبه المثبّت (رمز الفرع ومدينته)
            if (path == "/api/license")
            {
                string fp, until;
                bool ok = LicenseOK(out fp, out until);
                /* «لا يوجد ملف ترخيص» و«الترخيص غير صالح» مشكلتان
                   مختلفتان وحلّاهما مختلفان، وكانتا تظهران متطابقتين. */
                bool has = false;
                try { has = File.Exists(LicPath()); } catch { }
                SendJson(s, "{\"ok\":true,\"active\":" + (ok ? "true" : "false") +
                    ",\"hasFile\":" + (has ? "true" : "false") +
                    ",\"fp\":" + JsonStr(fp) + ",\"until\":" + JsonStr(until) + "}");
                return;
            }

            if (path == "/api/activate" && method == "POST")
            {
                try
                {
                    string code = ExtractJsonValue(Encoding.UTF8.GetString(body), "code");
                    string until2 = "";
                    bool okAct = false;
                    string[] fps2 = AcceptedFingerprints();
                    for (int i = 0; i < fps2.Length && !okAct; i++)
                    {
                        string u2;
                        if (VerifyLicense(fps2[i], code, out u2)) { okAct = true; until2 = u2; }
                        else if (u2 == "expired") until2 = "expired";
                    }
                    if (!okAct)
                    {
                        SendJson(s, "{\"ok\":false,\"error\":" +
                            JsonStr(until2 == "expired" ? "انتهت صلاحية هذا الرمز" : "الرمز غير صحيح لهذا الجهاز") + "}");
                        return;
                    }
                    File.WriteAllText(LicPath(), code.Trim(), new UTF8Encoding(false));
                    Log("فُعّل الترخيص حتى: " + until2);
                    SendJson(s, "{\"ok\":true,\"until\":" + JsonStr(until2) + "}");
                }
                catch (Exception ex)
                {
                    SendJson(s, "{\"ok\":false,\"error\":" + JsonStr(ex.Message) + "}");
                }
                return;
            }

            if (path == "/api/preset")
            {
                try
                {
                    string pf = Path.Combine(BaseDir, "preset.json");
                    if (File.Exists(pf))
                    {
                        Send(s, 200, "OK", "application/json; charset=utf-8", File.ReadAllBytes(pf));
                        return;
                    }
                }
                catch { }
                SendJson(s, "{\"ok\":false}");
                return;
            }

            // إشعارات ntfy — تمر عبر النواة لتفادي قيود المتصفح
            if (path == "/api/notify" && method == "POST")
            {
                try
                {
                    string req = Encoding.UTF8.GetString(body);
                    string nurl = ExtractJsonValue(req, "url");
                    string payload = ExtractJsonRaw(req, "payload");

                    if (string.IsNullOrEmpty(nurl)) throw new Exception("لم يُضبط خادم الإشعارات");
                    if (!nurl.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                        !nurl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                        throw new Exception("عنوان غير صالح");
                    if (string.IsNullOrEmpty(payload)) throw new Exception("لا يوجد محتوى");

                    HttpSend(nurl.TrimEnd(new char[] { '/' }) + "/", "POST", null, payload);
                    SendJson(s, "{\"ok\":true}");
                }
                catch (Exception ex)
                {
                    SendJson(s, "{\"ok\":false,\"error\":" + JsonStr(CleanNetError(ex)) + "}");
                }
                return;
            }

            if (path == "/api/sync" && method == "POST")
            {
                try
                {
                    string req = Encoding.UTF8.GetString(body);
                    string url = ExtractJsonValue(req, "url");
                    string skey = ExtractJsonValue(req, "key");
                    string upload = ExtractJsonRaw(req, "upload");

                    if (string.IsNullOrEmpty(url)) throw new Exception("لم يُضبط عنوان الربط");
                    url = url.TrimEnd(new char[] { '/' });

                    if (!string.IsNullOrEmpty(upload) && upload != "null")
                        HttpSend(url + "/put", "POST", skey, upload);

                    string all = HttpSend(url + "/all", "GET", skey, null);
                    Send(s, 200, "OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(all));
                }
                catch (Exception ex)
                {
                    SendJson(s, "{\"ok\":false,\"error\":" + JsonStr(CleanNetError(ex)) + "}");
                }
                return;
            }

            // static files
            if (path == "/") path = "/index.html";
            if (path.Contains("..")) { Send(s, 400, "Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("bad path")); return; }

            string rel = path.TrimStart(new char[] { '/' });

            /* 1) مجلد app بجانب البرنامج — للتطوير فقط.
               Path.Combine يُرجع الوسيط الثاني كما هو إن كان مساراً مطلقاً،
               فطلب /C:/Windows/win.ini كان يخرج من مجلد الواجهة ويقدّم أي
               ملف على القرص. نتحقق أن المسار النهائي داخل المجلد فعلاً. */
            if (DevMode)
            {
                string root = Path.GetFullPath(WebDir);
                if (!root.EndsWith(Path.DirectorySeparatorChar.ToString())) root += Path.DirectorySeparatorChar;
                string file = null;
                try { file = Path.GetFullPath(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar))); }
                catch { file = null; }

                if (file == null || !file.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                {
                    Log("رُفض مسار خارج مجلد الواجهة: " + rel);
                    Send(s, 400, "Bad Request", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("bad path"));
                    return;
                }
                if (File.Exists(file))
                {
                    Send(s, 200, "OK", ContentType(file), File.ReadAllBytes(file));
                    return;
                }
            }

            // 2) النسخة المدمجة داخل الملف التنفيذي
            byte[] emb = GetEmbedded(rel);
            if (emb != null)
            {
                Send(s, 200, "OK", ContentType(rel), emb);
                return;
            }

            Log("غير موجود: " + rel + "  |  الموارد المدمجة: " + ResourceNames());
            Send(s, 404, "Not Found", "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("not found"));
        }

        static byte[] GetEmbedded(string rel)
        {
            try
            {
                Assembly asm = Assembly.GetExecutingAssembly();
                using (Stream st = asm.GetManifestResourceStream(rel))
                {
                    if (st == null) return null;
                    using (MemoryStream ms = new MemoryStream())
                    {
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = st.Read(buf, 0, buf.Length)) > 0) ms.Write(buf, 0, n);
                        return ms.ToArray();
                    }
                }
            }
            catch { return null; }
        }

        static string ResourceNames()
        {
            try
            {
                string[] names = Assembly.GetExecutingAssembly().GetManifestResourceNames();
                return string.Join(", ", names);
            }
            catch (Exception ex) { return "تعذّرت القراءة: " + ex.Message; }
        }

        /* عكس ترتيب مصفوفة يدوياً — أضمن من الاعتماد على أشكال عامة قد لا توجد */
        static void ReverseStrings(string[] a)
        {
            for (int i = 0, j = a.Length - 1; i < j; i++, j--)
            {
                string t = a[i];
                a[i] = a[j];
                a[j] = t;
            }
        }

        static string ContentType(string file)
        {
            string ext = Path.GetExtension(file).ToLowerInvariant();
            if (ext == ".html" || ext == ".htm") return "text/html; charset=utf-8";
            if (ext == ".css") return "text/css; charset=utf-8";
            if (ext == ".js") return "application/javascript; charset=utf-8";
            if (ext == ".json") return "application/json; charset=utf-8";
            if (ext == ".svg") return "image/svg+xml; charset=utf-8";
            if (ext == ".png") return "image/png";
            if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
            if (ext == ".ico") return "image/x-icon";
            return "application/octet-stream";
        }

        static void SendJson(Stream s, string json)
        {
            Send(s, 200, "OK", "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
        }

        static void Send(Stream s, int code, string status, string contentType, byte[] body)
        {
            if (ReqLogged < 25)
            {
                ReqLogged++;
                Log("رد " + code.ToString(CultureInfo.InvariantCulture) + " — " +
                    body.Length.ToString(CultureInfo.InvariantCulture) + " بايت — " + contentType);
            }
            StringBuilder head = new StringBuilder();
            head.Append("HTTP/1.1 ").Append(code.ToString(CultureInfo.InvariantCulture)).Append(" ").Append(status).Append("\r\n");
            head.Append("Content-Type: ").Append(contentType).Append("\r\n");
            head.Append("Content-Length: ").Append(body.Length.ToString(CultureInfo.InvariantCulture)).Append("\r\n");
            head.Append("Cache-Control: no-store\r\n");
            head.Append("Connection: close\r\n\r\n");
            byte[] h = Encoding.ASCII.GetBytes(head.ToString());
            s.Write(h, 0, h.Length);
            if (body.Length > 0) s.Write(body, 0, body.Length);
            s.Flush();
        }

        static string JsonStr(string v)
        {
            if (v == null) return "\"\"";
            StringBuilder sb = new StringBuilder("\"");
            foreach (char c in v)
            {
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c == '\n') sb.Append("\\n");
                else if (c == '\r') sb.Append("\\r");
                else if (c == '\t') sb.Append("\\t");
                else if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                else sb.Append(c);
            }
            sb.Append("\"");
            return sb.ToString();
        }

        static string ExtractJsonValue(string json, string key)
        {
            string needle = "\"" + key + "\"";
            int i = json.IndexOf(needle, StringComparison.Ordinal);
            if (i < 0) return null;
            i = json.IndexOf(':', i + needle.Length);
            if (i < 0) return null;
            i++;
            while (i < json.Length && (json[i] == ' ' || json[i] == '\t')) i++;
            if (i >= json.Length || json[i] != '"') return null;
            i++;
            /* فكّ الهروب الصحيح. سابقاً كان الخط المائل يُتجاهَل فقط،
               فتصير \n حرف n و م تصير u0645 — يظهر الأثر في اسم نسخة
               احتياطية أو رمز تفعيل فيه محرف خاص. */
            StringBuilder sb = new StringBuilder();
            while (i < json.Length && json[i] != '"')
            {
                if (json[i] != '\\') { sb.Append(json[i]); i++; continue; }
                i++;
                if (i >= json.Length) break;
                char e = json[i];
                if (e == 'n') sb.Append('\n');
                else if (e == 't') sb.Append('\t');
                else if (e == 'r') sb.Append('\r');
                else if (e == 'b') sb.Append('\b');
                else if (e == 'f') sb.Append('\f');
                else if (e == '/') sb.Append('/');
                else if (e == '"') sb.Append('"');
                else if (e == '\\') sb.Append('\\');
                else if (e == 'u' && i + 4 < json.Length)
                {
                    int cp;
                    if (int.TryParse(json.Substring(i + 1, 4), NumberStyles.HexNumber,
                        CultureInfo.InvariantCulture, out cp))
                    {
                        sb.Append((char)cp);
                        i += 4;
                    }
                    else sb.Append(e);
                }
                else sb.Append(e);
                i++;
            }
            return sb.ToString();
        }

        // ---------- sync over the internet (best effort) ----------

        static void EnableTls()
        {
            int[] tries = new int[] { 12288 | 3072 | 768, 3072 | 768, 3072 };
            for (int i = 0; i < tries.Length; i++)
            {
                try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)tries[i]; return; }
                catch { }
            }
        }

        static string HttpSend(string url, string method, string shopKey, string payload)
        {
            HttpWebRequest rq = (HttpWebRequest)WebRequest.Create(url);
            rq.Method = method;
            rq.Timeout = 20000;
            rq.ReadWriteTimeout = 20000;
            rq.UserAgent = "Qirtasiya/1.1";
            rq.Accept = "application/json";
            if (!string.IsNullOrEmpty(shopKey)) rq.Headers.Add("X-Shop-Key", shopKey);

            if (payload != null)
            {
                byte[] data = Encoding.UTF8.GetBytes(payload);
                rq.ContentType = "application/json; charset=utf-8";
                rq.ContentLength = data.Length;
                using (Stream rs = rq.GetRequestStream()) rs.Write(data, 0, data.Length);
            }

            using (HttpWebResponse rp = (HttpWebResponse)rq.GetResponse())
            using (StreamReader sr = new StreamReader(rp.GetResponseStream(), Encoding.UTF8))
            {
                return sr.ReadToEnd();
            }
        }

        static string CleanNetError(Exception ex)
        {
            WebException we = ex as WebException;
            if (we != null)
            {
                if (we.Status == WebExceptionStatus.NameResolutionFailure) return "لا يوجد اتصال بالإنترنت";
                if (we.Status == WebExceptionStatus.Timeout) return "انتهت المهلة — الإنترنت بطيء";
                if (we.Status == WebExceptionStatus.ConnectFailure) return "تعذّر الوصول للعنوان (قد يكون محجوباً)";
                HttpWebResponse rp = we.Response as HttpWebResponse;
                if (rp != null)
                {
                    if ((int)rp.StatusCode == 401 || (int)rp.StatusCode == 403) return "كلمة سر الربط غير صحيحة";
                    return "الخادم رد بالرمز " + ((int)rp.StatusCode).ToString(CultureInfo.InvariantCulture);
                }
            }
            return ex.Message;
        }

        static string ExtractJsonRaw(string json, string key)
        {
            string needle = "\"" + key + "\"";
            int i = json.IndexOf(needle, StringComparison.Ordinal);
            if (i < 0) return null;
            i = json.IndexOf(':', i + needle.Length);
            if (i < 0) return null;
            i++;
            while (i < json.Length && (json[i] == ' ' || json[i] == '\t' || json[i] == '\n' || json[i] == '\r')) i++;
            if (i >= json.Length) return null;
            if (json[i] == 'n') return "null";
            if (json[i] != '{' && json[i] != '[') return null;

            char open = json[i], close = (open == '{') ? '}' : ']';
            int depth = 0; bool inStr = false; int start = i;
            for (; i < json.Length; i++)
            {
                char c = json[i];
                if (inStr)
                {
                    if (c == '\\') { i++; continue; }
                    if (c == '"') inStr = false;
                    continue;
                }
                if (c == '"') { inStr = true; continue; }
                if (c == open) depth++;
                else if (c == close)
                {
                    depth--;
                    if (depth == 0) return json.Substring(start, i - start + 1);
                }
            }
            return null;
        }

        // ---------- window + tray ----------

        static string FindBrowser()
        {
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string la = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            string[] paths = new string[] {
                Path.Combine(pf86, "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(pf,   "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(la,   "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(pf86, "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(pf,   "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(la,   "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(pf,   "BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
                Path.Combine(pf86, "BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
                Path.Combine(pf86, "Microsoft\\Edge Beta\\Application\\msedge.exe"),
                Path.Combine(pf86, "Microsoft\\Edge Dev\\Application\\msedge.exe")
            };
            for (int i = 0; i < paths.Length; i++)
            {
                if (File.Exists(paths[i])) { Log("وُجد المتصفح: " + paths[i]); return paths[i]; }
            }

            // البحث في سجل ويندوز
            string[] regKeys = new string[] {
                "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe",
                "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
                "HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe",
                "HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe"
            };
            for (int i = 0; i < regKeys.Length; i++)
            {
                try
                {
                    object v = Registry.GetValue(regKeys[i], null, null);
                    if (v != null)
                    {
                        string pth = v.ToString().Trim(new char[] { '"' });
                        if (File.Exists(pth)) { Log("وُجد المتصفح من السجل: " + pth); return pth; }
                    }
                }
                catch { }
            }
            Log("لم يُعثر على Edge أو Chrome في أي مكان معروف");
            return null;
        }

        static void OpenWindow(string url)
        {
            string profile = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Qirtasiya", "window_" + InstanceKey);
            try { Directory.CreateDirectory(profile); }
            catch (Exception ex) { Log("تعذّر إنشاء مجلد النافذة: " + ex.Message); profile = null; }

            string browser = FindBrowser();

            // 1) نافذة تطبيق مستقلة
            if (browser != null)
            {
                string args = "--app=" + url
                    + (profile != null ? " --user-data-dir=\"" + profile + "\"" : "")
                    + " --no-first-run --no-default-browser-check --window-size=1440,900";
                try { Process.Start(browser, args); Log("فُتحت النافذة كتطبيق"); return; }
                catch (Exception ex) { Log("فشل الفتح كتطبيق: " + ex.Message); }

                // 2) تبويب عادي في نفس المتصفح
                try { Process.Start(browser, url); Log("فُتح تبويب عادي"); return; }
                catch (Exception ex) { Log("فشل فتح التبويب: " + ex.Message); }
            }

            // 3) المتصفح الافتراضي عبر مستكشف ويندوز
            try { Process.Start("explorer.exe", url); Log("فُتح بالمتصفح الافتراضي"); return; }
            catch (Exception ex) { Log("فشل explorer: " + ex.Message); }

            // 4) الطريقة التقليدية
            try { Process.Start(url); Log("فُتح بالطريقة الافتراضية"); return; }
            catch (Exception ex) { Log("فشل Process.Start: " + ex.Message); }

            // 5) آخر حل: أعطِ المستخدم العنوان
            Log("تعذّر فتح أي متصفح — عُرض العنوان للمستخدم");
            try
            {
                Clipboard.SetText(url);
                MessageBox.Show(
                    "البرنامج يعمل، لكن تعذّر فتح المتصفح تلقائياً.\n\n" +
                    "نُسخ العنوان التالي إلى الحافظة — الصقه في Edge أو Chrome:\n\n" + url,
                    AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch
            {
                MessageBox.Show("البرنامج يعمل. افتح المتصفح على:\n\n" + url,
                    AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }

        static void SetupTray()
        {
            Tray = new NotifyIcon();
            try { Tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { Tray.Icon = SystemIcons.Application; }
            if (Tray.Icon == null) Tray.Icon = SystemIcons.Application;
            Tray.Text = AppTitle;
            Tray.Visible = true;

            ContextMenuStrip menu = new ContextMenuStrip();
            menu.RightToLeft = RightToLeft.Yes;

            ToolStripMenuItem open = new ToolStripMenuItem("فتح النافذة");
            open.Click += delegate { OpenWindow(Url()); };
            menu.Items.Add(open);

            ToolStripMenuItem backup = new ToolStripMenuItem("نسخة احتياطية الآن");
            backup.Click += delegate
            {
                try
                {
                    string n = MakeManualBackup();
                    Tray.ShowBalloonTip(3000, AppTitle,
                        string.IsNullOrEmpty(n) ? "لا توجد بيانات بعد." : "تم حفظ نسخة: " + n, ToolTipIcon.Info);
                }
                catch (Exception ex) { MessageBox.Show(ex.Message, AppTitle); }
            };
            menu.Items.Add(backup);

            ToolStripMenuItem folder = new ToolStripMenuItem("فتح مجلد البيانات");
            folder.Click += delegate
            {
                try { Process.Start("explorer.exe", "\"" + DataDir + "\""); }
                catch { }
            };
            menu.Items.Add(folder);

            menu.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem quit = new ToolStripMenuItem("إغلاق البرنامج");
            quit.Click += delegate
            {
                DialogResult r = MessageBox.Show("سيتم إغلاق البرنامج. تأكد أنك أنهيت أي فاتورة مفتوحة.",
                    AppTitle, MessageBoxButtons.OKCancel, MessageBoxIcon.Question);
                if (r == DialogResult.OK) ExitApp();
            };
            menu.Items.Add(quit);

            Tray.ContextMenuStrip = menu;
            Tray.DoubleClick += delegate { OpenWindow(Url()); };
        }

        static void ExitApp()
        {
            try { MakeDailyBackup(); }
            catch { }
            try { if (Tray != null) { Tray.Visible = false; Tray.Dispose(); } }
            catch { }
            try { if (Listener != null) Listener.Stop(); }
            catch { }
            Application.Exit();
            Environment.Exit(0);
        }
    }
}
