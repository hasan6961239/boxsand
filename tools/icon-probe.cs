/* ============================================================
   icon-probe.cs — نافذة صغيرة تضع أيقونة ملفها كما كان البرنامج يضعها
   ------------------------------------------------------------
   تُبنى في CI مرتين بالمترجم نفسه الذي يبني ملف التثبيت (mcs على لينكس):
   بالأيقونة القديمة (PNG في كل المقاسات) وبالجديدة (tools/make-ico.py)،
   ثم يسأل tools/win-icon-check.ps1 ويندوز عن أيقونة كل نافذة: قبل وبعد.
   ============================================================ */
using System;
using System.Drawing;
using System.Windows.Forms;

static class IconProbe
{
    [STAThread]
    static void Main()
    {
        Form f = new Form();
        f.Text = "icon probe";
        try { f.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
        catch { }
        Application.Run(f);
    }
}
