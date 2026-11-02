using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Qirtasiya
{
    /* ============================================================
       نافذة البرنامج الخاصة (المرحلة 4، WebView2)
       ------------------------------------------------------------
       نافذة واحدة بأيقونة البرنامج على شريط المهام، بدل نافذة متصفح:
       - فتحها مرة ثانية (أيقونة سطح المكتب أو الشريط) يعيد النافذة نفسها.
       - ما يخرج للإنترنت (رابط خارجي) يُفتح في المتصفح، لا يأخذ النافذة.
       - إن لم يوجد WebView2 Runtime، أو فشل لأي سبب، يفتح البرنامج المتصفح
         كما في 3.x، فلا يقف المحل.
       كل أنواع WebView2 هنا وحدها: البرنامج على لينكس (الاختبار) لا يحمّلها.
       ============================================================ */
    static class WindowHost
    {
        static AppWindow current;
        static Control invoker;
        static bool unavailable;

        /* على خيط الواجهة، قبل Application.Run: لإظهار النافذة من خيط آخر */
        public static void Init()
        {
            invoker = new Control();
            invoker.CreateControl();
        }

        /* يُظهر النافذة (أو يعيدها). false = لا WebView2: افتح المتصفح */
        public static bool Show(string url, string userData, string loaderDir, string title, bool devTools, Action<string> log)
        {
            if (unavailable) return false;
            if (invoker != null && invoker.InvokeRequired)
            {
                bool r = false;
                invoker.Invoke((MethodInvoker)delegate { r = Show(url, userData, loaderDir, title, devTools, log); });
                return r;
            }
            try
            {
                if (current != null && !current.IsDisposed)
                {
                    current.Restore();
                    log("نافذة البرنامج: أُعيدت النافذة نفسها");
                    return true;
                }
                CoreWebView2Environment.SetLoaderDllFolderPath(loaderDir);
                string version = CoreWebView2Environment.GetAvailableBrowserVersionString();
                log("نافذة البرنامج: WebView2 " + version);
                current = new AppWindow(url, userData, title, devTools, log);
                current.Show();
                return true;
            }
            catch (Exception ex)
            {
                /* لا Runtime، أو المحمِّل ناقص: المتصفح من الآن */
                unavailable = true;
                log("WebView2 غير متاح، يُفتح المتصفح: " + ex.GetType().Name + ": " + ex.Message);
                return false;
            }
        }
    }

    /* أيقونة البرنامج من ملفه التنفيذي بالمقاس الذي يطلبه ويندوز: الصغيرة (16) لشريط
       المهام والعنوان وبجانب الساعة، والكبيرة (32). ExtractAssociatedIcon يعطي 32 وحدها
       فتُصغَّر. على لينكس (الاختبار) لا user32: الطريقة القديمة */
    static class AppIcons
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr GetModuleHandle(string name);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr LoadImage(IntPtr hinst, IntPtr name, uint type, int cx, int cy, uint load);
        [DllImport("user32.dll")]
        static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);

        /* مجموعة الأيقونة التي يكتبها المترجم من -win32icon */
        const int GroupId = 32512;

        public static Icon Get(bool small)
        {
            try
            {
                int size = GetSystemMetrics(small ? 49 : 11);   // SM_CXSMICON أو SM_CXICON
                if (size <= 0) size = small ? 16 : 32;
                IntPtr h = LoadImage(GetModuleHandle(null), (IntPtr)GroupId, 1, size, size, 0);   // IMAGE_ICON
                if (h != IntPtr.Zero) return Icon.FromHandle(h);
            }
            catch (Exception) { }
            try { return Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch (Exception) { return null; }
        }

        /* الأيقونتان للنافذة نفسها (WM_SETICON): شريط المهام يأخذ منها */
        public static void Apply(Form f)
        {
            try
            {
                Icon small = Get(true), big = Get(false);
                if (small != null) SendMessage(f.Handle, 0x80, (IntPtr)0, small.Handle);
                if (big != null) SendMessage(f.Handle, 0x80, (IntPtr)1, big.Handle);
            }
            catch (Exception) { }
        }
    }

    sealed class AppWindow : Form
    {
        readonly WebView2 web;
        readonly Uri home;
        readonly Action<string> log;
        readonly bool devTools;

        public AppWindow(string url, string userData, string title, bool devTools, Action<string> log)
        {
            this.log = log;
            this.devTools = devTools;
            home = new Uri(url);
            Text = title;
            Icon big = AppIcons.Get(false);
            if (big != null) Icon = big;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1440, 900);
            MinimumSize = new Size(900, 600);
            WindowState = FormWindowState.Maximized;
            BackColor = Color.White;

            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Color.White;
            CoreWebView2CreationProperties p = new CoreWebView2CreationProperties();
            p.UserDataFolder = userData;
            p.Language = "ar";
            web.CreationProperties = p;
            web.CoreWebView2InitializationCompleted += Ready;
            Controls.Add(web);
            web.Source = home;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            AppIcons.Apply(this);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            AppIcons.Apply(this);
        }

        void Ready(object sender, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (!e.IsSuccess)
            {
                log("تعذّر تشغيل نافذة البرنامج: " + (e.InitializationException != null ? e.InitializationException.Message : "") +
                    " — يُفتح المتصفح");
                OpenOutside(home.ToString());
                Close();
                return;
            }
            CoreWebView2 core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = devTools;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = true;
            core.DocumentTitleChanged += delegate { if (!string.IsNullOrEmpty(core.DocumentTitle)) Text = core.DocumentTitle; };
            /* الروابط الخارجية للمتصفح: النافذة للبرنامج وحده */
            core.NavigationStarting += delegate (object s, CoreWebView2NavigationStartingEventArgs a)
            {
                if (Local(a.Uri)) return;
                a.Cancel = true;
                OpenOutside(a.Uri);
            };
            core.NewWindowRequested += delegate (object s, CoreWebView2NewWindowRequestedEventArgs a)
            {
                a.Handled = true;
                if (Local(a.Uri)) web.CoreWebView2.Navigate(a.Uri);
                else OpenOutside(a.Uri);
            };
            core.ProcessFailed += delegate (object s, CoreWebView2ProcessFailedEventArgs a)
            {
                log("نافذة البرنامج: توقفت عملية العرض (" + a.ProcessFailedKind + ")، تُعاد");
                try { web.Reload(); }
                catch { }
            };
        }

        bool Local(string uri)
        {
            Uri u;
            if (!Uri.TryCreate(uri, UriKind.Absolute, out u)) return true;
            if (u.Scheme == "about" || u.Scheme == "data" || u.Scheme == "blob") return true;
            return u.Host == home.Host && u.Port == home.Port;
        }

        void OpenOutside(string uri)
        {
            try { Process.Start(uri); }
            catch (Exception ex) { log("تعذّر فتح الرابط في المتصفح: " + ex.Message); }
        }

        public void Restore()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Maximized;
            Show();
            Activate();
            BringToFront();
        }
    }
}
