using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace Qirtasiya.Data
{
    /* ============================================================
       غلاف SQLite الصغير (قرار 0003)
       ------------------------------------------------------------
       نداءات مباشرة لمكتبة sqlite3 الرسمية، بلا مكتبة وسيطة. على
       ويندوز تُحمَّل النسخة التي معنا من مجلد x64 أو x86 بجانب البرنامج،
       وعلى لينكس (الاختبار) مكتبة النظام.

       النصوص كلها UTF-8 في الاتجاهين: أسماء الكتب والزبائن عربية، ومسار
       مجلد البيانات قد يكون عربياً (اسم مستخدم ويندوز).
       ============================================================ */

    /* خطأ من SQLite برمزه الموسّع ورسالته */
    public sealed class SqliteException : Exception
    {
        public readonly int Code;

        public SqliteException(int code, string message) : base(message) { Code = code; }

        /* الرمز الأساسي: 5 = مشغولة، 11 = تالفة، 19 = قيد (فريد، مفتاح...) */
        public int Primary { get { return Code & 0xFF; } }
    }

    static class Native
    {
        const string Lib = "sqlite3";

        public const int OK = 0, ROW = 100, DONE = 101;
        public const int OPEN_READONLY = 0x1, OPEN_READWRITE = 0x2, OPEN_CREATE = 0x4,
            OPEN_FULLMUTEX = 0x10000, OPEN_EXRESCODE = 0x2000000;
        public const int INTEGER = 1, FLOAT = 2, TEXT = 3, BLOB = 4, NULL = 5;

        /* SQLITE_TRANSIENT: تنسخ SQLite القيمة قبل أن يعود النداء، فلا يهمّ
           أن المصفوفة المُدارة تتحرّك بعده. */
        public static readonly IntPtr Transient = new IntPtr(-1);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_open_v2(byte[] filename, out IntPtr db, int flags, IntPtr vfs);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_close_v2(IntPtr db);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_extended_result_codes(IntPtr db, int onoff);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr sqlite3_errmsg(IntPtr db);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_extended_errcode(IntPtr db);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr sqlite3_errstr(int code);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_exec(IntPtr db, byte[] sql, IntPtr callback, IntPtr arg, out IntPtr errmsg);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern void sqlite3_free(IntPtr p);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int nByte, out IntPtr stmt, IntPtr tail);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_step(IntPtr stmt);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_reset(IntPtr stmt);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_clear_bindings(IntPtr stmt);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_finalize(IntPtr stmt);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_bind_int64(IntPtr stmt, int i, long v);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_bind_double(IntPtr stmt, int i, double v);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_bind_null(IntPtr stmt, int i);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_bind_text(IntPtr stmt, int i, byte[] v, int n, IntPtr destructor);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_bind_blob(IntPtr stmt, int i, byte[] v, int n, IntPtr destructor);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_bind_parameter_count(IntPtr stmt);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_column_count(IntPtr stmt);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_column_type(IntPtr stmt, int col);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern long sqlite3_column_int64(IntPtr stmt, int col);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern double sqlite3_column_double(IntPtr stmt, int col);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr sqlite3_column_text(IntPtr stmt, int col);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr sqlite3_column_blob(IntPtr stmt, int col);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_column_bytes(IntPtr stmt, int col);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr sqlite3_column_name(IntPtr stmt, int col);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern long sqlite3_last_insert_rowid(IntPtr db);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_changes(IntPtr db);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_busy_timeout(IntPtr db, int ms);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_get_autocommit(IntPtr db);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern void sqlite3_interrupt(IntPtr db);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr sqlite3_libversion();
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_libversion_number();
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr sqlite3_sourceid();
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr sqlite3_backup_init(IntPtr dest, byte[] destName, IntPtr src, byte[] srcName);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_backup_step(IntPtr backup, int pages);
        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        public static extern int sqlite3_backup_finish(IntPtr backup);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr LoadLibraryW(string path);

        static bool loaded;
        static readonly object Gate = new object();

        /* على ويندوز: نحمّل sqlite3.dll المناسب لمعمارية العملية قبل أول نداء،
           فيجده DllImport محمَّلاً باسمه ولا يبحث عن غيره في مجلدات النظام. */
        public static void EnsureLoaded()
        {
            lock (Gate)
            {
                if (loaded) return;
                if (Path.DirectorySeparatorChar == '\\')
                {
                    string dir = AppDomain.CurrentDomain.BaseDirectory;
                    string arch = IntPtr.Size == 8 ? "x64" : "x86";
                    string p = Path.Combine(dir, arch, "sqlite3.dll");
                    if (!File.Exists(p)) p = Path.Combine(dir, "sqlite3.dll");
                    if (!File.Exists(p))
                        throw new SqliteException(0, "ملف قاعدة البيانات sqlite3.dll (" + arch + ") ناقص بجانب البرنامج. أعد التثبيت.");
                    if (LoadLibraryW(p) == IntPtr.Zero)
                        throw new SqliteException(0, "تعذّر تحميل " + p + " (خطأ ويندوز " + Marshal.GetLastWin32Error() + ")");
                }
                loaded = true;
            }
        }

        public static byte[] Utf8z(string s)
        {
            int n = Encoding.UTF8.GetByteCount(s);
            byte[] b = new byte[n + 1];
            Encoding.UTF8.GetBytes(s, 0, s.Length, b, 0);
            return b;
        }

        public static string FromUtf8z(IntPtr p)
        {
            if (p == IntPtr.Zero) return "";
            int n = 0;
            while (Marshal.ReadByte(p, n) != 0) n++;
            byte[] b = new byte[n];
            Marshal.Copy(p, b, 0, n);
            return Encoding.UTF8.GetString(b);
        }
    }

    /* اتصال واحد بملف قاعدة. ليس آمناً لعدة خيوط معاً: من يستعمله يقفل. */
    public sealed class Sqlite : IDisposable
    {
        IntPtr db;
        readonly Dictionary<string, Stmt> cache = new Dictionary<string, Stmt>();
        public readonly string FilePath;
        public readonly bool ReadOnly;

        Sqlite(IntPtr h, string path, bool readOnly) { db = h; FilePath = path; ReadOnly = readOnly; }

        public static string Version
        {
            get { Native.EnsureLoaded(); return Native.FromUtf8z(Native.sqlite3_libversion()); }
        }

        public static int VersionNumber
        {
            get { Native.EnsureLoaded(); return Native.sqlite3_libversion_number(); }
        }

        public static string SourceId
        {
            get { Native.EnsureLoaded(); return Native.FromUtf8z(Native.sqlite3_sourceid()); }
        }

        public static Sqlite Open(string path, bool readOnly, bool create)
        {
            Native.EnsureLoaded();
            int flags = Native.OPEN_FULLMUTEX | Native.OPEN_EXRESCODE |
                (readOnly ? Native.OPEN_READONLY : Native.OPEN_READWRITE | (create ? Native.OPEN_CREATE : 0));
            IntPtr h;
            int rc = Native.sqlite3_open_v2(Native.Utf8z(path), out h, flags, IntPtr.Zero);
            if (rc != Native.OK)
            {
                string msg = h != IntPtr.Zero ? Native.FromUtf8z(Native.sqlite3_errmsg(h)) : Native.FromUtf8z(Native.sqlite3_errstr(rc));
                if (h != IntPtr.Zero) Native.sqlite3_close_v2(h);
                throw new SqliteException(rc, "تعذّر فتح " + path + ": " + msg);
            }
            Native.sqlite3_extended_result_codes(h, 1);
            Native.sqlite3_busy_timeout(h, 5000);
            return new Sqlite(h, path, readOnly);
        }

        internal IntPtr Handle
        {
            get
            {
                if (db == IntPtr.Zero) throw new ObjectDisposedException("Sqlite");
                return db;
            }
        }

        internal void Check(int rc)
        {
            if (rc == Native.OK || rc == Native.ROW || rc == Native.DONE) return;
            throw new SqliteException(Native.sqlite3_extended_errcode(db), Native.FromUtf8z(Native.sqlite3_errmsg(db)));
        }

        /* عدة أوامر بلا نتائج (الترقيات، الإعدادات) */
        public void Exec(string sql)
        {
            IntPtr err;
            int rc = Native.sqlite3_exec(Handle, Native.Utf8z(sql), IntPtr.Zero, IntPtr.Zero, out err);
            if (rc != Native.OK)
            {
                string msg = err != IntPtr.Zero ? Native.FromUtf8z(err) : Native.FromUtf8z(Native.sqlite3_errmsg(db));
                if (err != IntPtr.Zero) Native.sqlite3_free(err);
                throw new SqliteException(Native.sqlite3_extended_errcode(db), msg);
            }
        }

        /* أمر يُستعمل مرة: من يأخذه يغلقه */
        public Stmt Prepare(string sql)
        {
            byte[] b = Encoding.UTF8.GetBytes(sql);
            IntPtr h;
            int rc = Native.sqlite3_prepare_v2(Handle, b, b.Length, out h, IntPtr.Zero);
            if (rc != Native.OK) throw new SqliteException(Native.sqlite3_extended_errcode(db),
                Native.FromUtf8z(Native.sqlite3_errmsg(db)) + " — " + sql);
            return new Stmt(this, h);
        }

        /* أمر متكرر (البيع، القراءة): يُحضَّر مرة ويُعاد استعماله. لا يُغلق. */
        public Stmt Cached(string sql)
        {
            Stmt s;
            if (cache.TryGetValue(sql, out s)) { s.Reset(); return s; }
            s = Prepare(sql);
            s.Cached = true;
            cache[sql] = s;
            return s;
        }

        public int Run(string sql, params object[] args)
        {
            Stmt s = Cached(sql);
            try { s.BindAll(args); s.Step(); return Native.sqlite3_changes(db); }
            finally { s.Reset(); }
        }

        public long Insert(string sql, params object[] args)
        {
            Run(sql, args);
            return Native.sqlite3_last_insert_rowid(db);
        }

        /* أول عمود من أول صف، أو def إن لم يوجد صف أو كانت القيمة NULL */
        public long Long(string sql, long def, params object[] args)
        {
            Stmt s = Cached(sql);
            try
            {
                s.BindAll(args);
                if (!s.Step() || s.IsNull(0)) return def;
                return s.Long(0);
            }
            finally { s.Reset(); }
        }

        public string Text(string sql, params object[] args)
        {
            Stmt s = Cached(sql);
            try
            {
                s.BindAll(args);
                if (!s.Step() || s.IsNull(0)) return null;
                return s.Text(0);
            }
            finally { s.Reset(); }
        }

        public List<object[]> Rows(string sql, params object[] args)
        {
            List<object[]> rows = new List<object[]>();
            Stmt s = Cached(sql);
            try
            {
                s.BindAll(args);
                while (s.Step())
                {
                    object[] r = new object[s.Columns];
                    for (int i = 0; i < r.Length; i++) r[i] = s.Value(i);
                    rows.Add(r);
                }
            }
            finally { s.Reset(); }
            return rows;
        }

        public long LastInsertRowId { get { return Native.sqlite3_last_insert_rowid(Handle); } }
        public int Changes { get { return Native.sqlite3_changes(Handle); } }

        /* true = لا معاملة مفتوحة */
        public bool AutoCommit { get { return Native.sqlite3_get_autocommit(Handle) != 0; } }

        /* يوقف أمراً جارياً من خيط آخر (البحث القديم حين يُكتب حرف جديد) */
        public void Interrupt() { if (db != IntPtr.Zero) Native.sqlite3_interrupt(db); }

        /* نسخة كاملة متّسقة بواجهة النسخ في SQLite، والكتابة مستمرة */
        public void BackupTo(string destPath)
        {
            using (Sqlite dest = Open(destPath, false, true))
            {
                IntPtr b = Native.sqlite3_backup_init(dest.Handle, Native.Utf8z("main"), Handle, Native.Utf8z("main"));
                if (b == IntPtr.Zero) dest.Check(Native.sqlite3_extended_errcode(dest.Handle));
                int rc = Native.sqlite3_backup_step(b, -1);
                int rc2 = Native.sqlite3_backup_finish(b);
                if (rc != Native.DONE) throw new SqliteException(rc, "النسخ الاحتياطي لم يكتمل: " + Native.FromUtf8z(Native.sqlite3_errstr(rc)));
                dest.Check(rc2);
            }
        }

        public void Dispose()
        {
            if (db == IntPtr.Zero) return;
            foreach (Stmt s in cache.Values) s.Finalize0();
            cache.Clear();
            Native.sqlite3_close_v2(db);
            db = IntPtr.Zero;
        }
    }

    public sealed class Stmt : IDisposable
    {
        readonly Sqlite owner;
        IntPtr h;
        internal bool Cached;
        byte[] buf = new byte[256];
        static readonly byte[] Empty = new byte[1];

        internal Stmt(Sqlite db, IntPtr handle) { owner = db; h = handle; }

        public Stmt Bind(int i, object v)
        {
            int rc;
            if (v == null) rc = Native.sqlite3_bind_null(h, i);
            else if (v is long) rc = Native.sqlite3_bind_int64(h, i, (long)v);
            else if (v is int) rc = Native.sqlite3_bind_int64(h, i, (int)v);
            else if (v is bool) rc = Native.sqlite3_bind_int64(h, i, (bool)v ? 1 : 0);
            else if (v is string)
            {
                string s = (string)v;
                /* نص فارغ يُربط بمؤشر غير فارغ وطول صفر: المؤشر الفارغ يعني NULL */
                if (s.Length == 0) rc = Native.sqlite3_bind_text(h, i, Empty, 0, Native.Transient);
                else
                {
                    byte[] b = Encoding.UTF8.GetBytes(s);
                    rc = Native.sqlite3_bind_text(h, i, b, b.Length, Native.Transient);
                }
            }
            else if (v is double) rc = Native.sqlite3_bind_double(h, i, (double)v);
            else if (v is byte[])
            {
                byte[] b = (byte[])v;
                rc = Native.sqlite3_bind_blob(h, i, b.Length == 0 ? Empty : b, b.Length, Native.Transient);
            }
            else throw new ArgumentException("نوع لا يُخزَّن: " + v.GetType().Name);
            owner.Check(rc);
            return this;
        }

        public void BindAll(object[] args)
        {
            if (args == null) return;
            for (int i = 0; i < args.Length; i++) Bind(i + 1, args[i]);
        }

        /* true = صف جاهز للقراءة، false = انتهى الأمر */
        public bool Step()
        {
            int rc = Native.sqlite3_step(h);
            if (rc == Native.ROW) return true;
            if (rc == Native.DONE) return false;
            /* الرسالة تُقرأ قبل reset، حتى لا يمسحها */
            IntPtr dbh = owner.Handle;
            SqliteException e = new SqliteException(Native.sqlite3_extended_errcode(dbh), Native.FromUtf8z(Native.sqlite3_errmsg(dbh)));
            Native.sqlite3_reset(h);
            throw e;
        }

        public void Reset()
        {
            Native.sqlite3_reset(h);
            Native.sqlite3_clear_bindings(h);
        }

        public int Columns { get { return Native.sqlite3_column_count(h); } }
        public string Name(int col) { return Native.FromUtf8z(Native.sqlite3_column_name(h, col)); }
        public int Type(int col) { return Native.sqlite3_column_type(h, col); }
        public bool IsNull(int col) { return Native.sqlite3_column_type(h, col) == Native.NULL; }
        public long Long(int col) { return Native.sqlite3_column_int64(h, col); }
        public int Int(int col) { return (int)Native.sqlite3_column_int64(h, col); }
        public double Real(int col) { return Native.sqlite3_column_double(h, col); }

        public string Text(int col)
        {
            IntPtr p = Native.sqlite3_column_text(h, col);
            if (p == IntPtr.Zero) return Native.sqlite3_column_type(h, col) == Native.NULL ? null : "";
            int n = Native.sqlite3_column_bytes(h, col);
            if (n == 0) return "";
            if (buf.Length < n) buf = new byte[Math.Max(n, buf.Length * 2)];
            Marshal.Copy(p, buf, 0, n);
            return Encoding.UTF8.GetString(buf, 0, n);
        }

        public byte[] Blob(int col)
        {
            IntPtr p = Native.sqlite3_column_blob(h, col);
            int n = Native.sqlite3_column_bytes(h, col);
            byte[] b = new byte[n];
            if (n > 0) Marshal.Copy(p, b, 0, n);
            return b;
        }

        public object Value(int col)
        {
            switch (Type(col))
            {
                case Native.INTEGER: return Long(col);
                case Native.FLOAT: return Real(col);
                case Native.TEXT: return Text(col);
                case Native.BLOB: return Blob(col);
                default: return null;
            }
        }

        internal void Finalize0()
        {
            if (h == IntPtr.Zero) return;
            Native.sqlite3_finalize(h);
            h = IntPtr.Zero;
        }

        public void Dispose()
        {
            if (Cached) Reset();
            else Finalize0();
        }
    }
}
