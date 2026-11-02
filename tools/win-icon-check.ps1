# ============================================================
#  win-icon-check.ps1 - does Windows show the program's logo?
#  ------------------------------------------------------------
#  The shop saw a blank white page instead of the logo on the taskbar
#  (the .ico held PNG images only, see tools/make-ico.py). This asks
#  Windows itself, the way the shell and the taskbar do:
#    - the installed .exe (ExtractIconEx, SHGetFileInfo), 16 and 32
#    - its desktop and Start menu shortcuts (SHGetFileInfo on the .lnk)
#    - the open window (WM_GETICON: what the taskbar button draws)
#    - a screenshot of the taskbar: are the logo's colours on it?
#  Each icon is compared with the logo in the .ico: most of it opaque,
#  and its average colour close to the logo's (the generic icon is white).
#  One line per check: "ICON {json}" / "TASKBAR {json}".
#
#    pwsh tools/win-icon-check.ps1 -Exe <exe> -Ico app/app.ico [-ProcId <pid>] [-Out dir]
# ============================================================
param([string]$Exe, [string]$Ico, [int]$ProcId = 0, [string]$Out = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class IconProbe {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint n);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SHFILEINFO {
    public IntPtr hIcon; public int iIcon; public uint attr;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string name;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string type;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr SHGetFileInfo(string path, uint attr, ref SHFILEINFO info, uint size, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", EntryPoint = "GetClassLongPtrW")] public static extern IntPtr GetClassLongPtr(IntPtr h, int i);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);

  /* هدف الاختصار بواجهة ويندوز نفسها (IShellLinkW): WScript.Shell لا يقرأ اختصاراً اسمه بالعربي
     على ويندوز لغته غير العربية (يعطي هدفاً فارغاً)، واختصاراتنا «منظومة مصراتة» و«منظومة طرابلس» */
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class CShellLink { }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
  interface IShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int cch, IntPtr findData, uint flags);
  }
  public static string LinkTarget(string lnk) {
    object o = new CShellLink();
    try {
      ((System.Runtime.InteropServices.ComTypes.IPersistFile)o).Load(lnk, 0);
      StringBuilder s = new StringBuilder(1024);
      ((IShellLinkW)o).GetPath(s, s.Capacity, IntPtr.Zero, 0);
      return s.ToString();
    } catch (Exception) { return ""; }
    finally { Marshal.ReleaseComObject(o); }
  }
  public static IntPtr ShellIcon(string path, bool small) {
    SHFILEINFO i = new SHFILEINFO();
    SHGetFileInfo(path, 0, ref i, (uint)Marshal.SizeOf(i), 0x100u | (small ? 1u : 0u));
    return i.hIcon;
  }
  public static IntPtr MainWindow(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p != pid || !IsWindowVisible(h)) return true;
      StringBuilder s = new StringBuilder(256);
      GetWindowText(h, s, 256);
      if (s.Length == 0) return true;
      found = h;
      return false;
    }, IntPtr.Zero);
    return found;
  }
}
'@

function Stats($bmp) {
  $n = 0; $r = 0; $g = 0; $b = 0
  for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      $c = $bmp.GetPixel($x, $y)
      if ($c.A -gt 128) { $n++; $r += $c.R; $g += $c.G; $b += $c.B }
    }
  }
  if ($n -eq 0) { return @{ cover = 0.0; r = 255; g = 255; b = 255 } }
  return @{ cover = [math]::Round($n / ($bmp.Width * $bmp.Height), 2); r = [int]($r / $n); g = [int]($g / $n); b = [int]($b / $n) }
}

function Dist($a, $b) { [math]::Round([math]::Sqrt(($a.r - $b.r) * ($a.r - $b.r) + ($a.g - $b.g) * ($a.g - $b.g) + ($a.b - $b.b) * ($a.b - $b.b))) }

$ref = Stats ((New-Object System.Drawing.Icon($Ico, 32, 32)).ToBitmap())
if ($Out) { New-Item -ItemType Directory -Force $Out | Out-Null }
$tag = [IO.Path]::GetFileNameWithoutExtension($Exe)

function Probe([string]$name, [IntPtr]$h) {
  $res = [ordered]@{ name = $name; ok = $false }
  if ($h -eq [IntPtr]::Zero) { $res.why = 'no icon'; Write-Output ('ICON ' + ($res | ConvertTo-Json -Compress)); return }
  $bmp = ([System.Drawing.Icon]::FromHandle($h)).ToBitmap()
  $s = Stats $bmp
  $d = Dist $s $ref
  $res.size = $bmp.Width
  $res.cover = $s.cover
  $res.rgb = @($s.r, $s.g, $s.b)
  $res.logo = @($ref.r, $ref.g, $ref.b)
  $res.dist = $d
  $res.ok = ($s.cover -ge 0.5 -and $d -lt 70)
  if ($Out) { $bmp.Save((Join-Path $Out ($tag + '-' + $name + '.png')), [System.Drawing.Imaging.ImageFormat]::Png) }
  Write-Output ('ICON ' + ($res | ConvertTo-Json -Compress))
}

# the .exe
$large = New-Object IntPtr[] 1; $small = New-Object IntPtr[] 1
[IconProbe]::ExtractIconEx($Exe, 0, $large, $small, 1) | Out-Null
Probe 'exe-32' $large[0]
Probe 'exe-16' $small[0]
Probe 'shell-32' ([IconProbe]::ShellIcon($Exe, $false))
Probe 'shell-16' ([IconProbe]::ShellIcon($Exe, $true))

# its shortcuts
$dirs = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'),
  [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))
$links = 0
Write-Output ('LINK ' + (@{ dirs = $dirs } | ConvertTo-Json -Compress))
foreach ($d in $dirs) {
  if (-not $d -or -not (Test-Path $d)) { continue }
  foreach ($l in Get-ChildItem -Path $d -Filter *.lnk -Recurse -ErrorAction SilentlyContinue) {
    $t = [IconProbe]::LinkTarget($l.FullName)
    Write-Output ('LINK ' + (@{ path = $l.FullName; target = $t } | ConvertTo-Json -Compress))
    if ($t -and ([IO.Path]::GetFullPath($t) -eq [IO.Path]::GetFullPath($Exe))) {
      $links++
      Probe ('shortcut' + $links + '-32') ([IconProbe]::ShellIcon($l.FullName, $false))
      Probe ('shortcut' + $links + '-16') ([IconProbe]::ShellIcon($l.FullName, $true))
    }
  }
}
Write-Output ('ICON ' + (@{ name = 'shortcuts'; ok = ($links -ge 2); count = $links } | ConvertTo-Json -Compress))

# the open window, and the taskbar
if ($ProcId -gt 0) {
  $w = [IntPtr]::Zero
  for ($i = 0; $i -lt 120 -and $w -eq [IntPtr]::Zero; $i++) {
    $w = [IconProbe]::MainWindow([uint32]$ProcId)
    if ($w -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 500 }
  }
  if ($w -eq [IntPtr]::Zero) {
    Write-Output ('ICON ' + (@{ name = 'window'; ok = $false; why = 'no visible window' } | ConvertTo-Json -Compress))
  } else {
    Start-Sleep -Seconds 3
    $hs = [IconProbe]::SendMessage($w, 0x7F, [IntPtr]2, [IntPtr]::Zero)          # WM_GETICON, ICON_SMALL2
    if ($hs -eq [IntPtr]::Zero) { $hs = [IconProbe]::GetClassLongPtr($w, -34) }  # GCLP_HICONSM
    $hb = [IconProbe]::SendMessage($w, 0x7F, [IntPtr]1, [IntPtr]::Zero)          # ICON_BIG
    if ($hb -eq [IntPtr]::Zero) { $hb = [IconProbe]::GetClassLongPtr($w, -14) }  # GCLP_HICON
    Probe 'window-16' $hs
    Probe 'window-32' $hb

    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $shot = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $gfx = [System.Drawing.Graphics]::FromImage($shot)
    $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    if ($Out) { $shot.Save((Join-Path $Out ($tag + '-screen.png')), [System.Drawing.Imaging.ImageFormat]::Png) }
    $tray = [IconProbe]::FindWindow('Shell_TrayWnd', $null)
    $r = New-Object IconProbe+RECT
    $res = [ordered]@{ found = ($tray -ne [IntPtr]::Zero) }
    if ($tray -ne [IntPtr]::Zero -and [IconProbe]::GetWindowRect($tray, [ref]$r)) {
      $x0 = [math]::Max(0, $r.Left); $y0 = [math]::Max(0, $r.Top)
      $x1 = [math]::Min($bounds.Width, $r.Right); $y1 = [math]::Min($bounds.Height, $r.Bottom)
      $hits = 0
      for ($y = $y0; $y -lt $y1; $y++) {
        for ($x = $x0; $x -lt $x1; $x++) {
          $c = $shot.GetPixel($x, $y)
          if ((Dist @{ r = $c.R; g = $c.G; b = $c.B } $ref) -lt 40) { $hits++ }
        }
      }
      $res.rect = @($x0, $y0, $x1, $y1)
      $res.logoPixels = $hits
    }
    Write-Output ('TASKBAR ' + ($res | ConvertTo-Json -Compress))
  }
}
