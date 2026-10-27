using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
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
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { }
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
