;  ============================================================
;   مثبِّت منظومة المكتبة والقرطاسية
;  ------------------------------------------------------------
;   يُبنى من لينكس:  makensis -DVERSION=2.5 installer/qirtasiya.nsi
;
;   لماذا مجلد بيانات منفصل؟ لأن Program Files لا يقبل الكتابة،
;   ولأن ربط البيانات بمجلد البرنامج يعني ضياعها الظاهري مع كل
;   إعادة تثبيت. البيانات في مجلد المستخدم ولا يمسّها التحديث.
;  ============================================================

Unicode true

!ifndef VERSION
  !define VERSION "2.5"
!endif

!define APPNAME   "منظومة المكتبة والقرطاسية"
!define SHORTNAME "Qirtasiya"
!define PUBLISHER "مكتبة دار الحكمة"
!define EXENAME   "Qirtasiya.exe"
!define REGKEY    "Software\Microsoft\Windows\CurrentVersion\Uninstall\${SHORTNAME}"
!define APPKEY    "Software\${SHORTNAME}"

Name "${APPNAME}"
OutFile "../build/Qirtasiya-Setup-${VERSION}.exe"
InstallDir "$PROGRAMFILES64\${SHORTNAME}"
InstallDirRegKey HKLM "${APPKEY}" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${VERSION}.0.0"
VIAddVersionKey /LANG=1025 "ProductName"     "${APPNAME}"
VIAddVersionKey /LANG=1025 "CompanyName"     "${PUBLISHER}"
VIAddVersionKey /LANG=1025 "FileDescription" "${APPNAME}"
VIAddVersionKey /LANG=1025 "FileVersion"     "${VERSION}"
VIAddVersionKey /LANG=1025 "ProductVersion"  "${VERSION}"
VIAddVersionKey /LANG=1025 "LegalCopyright"  "${PUBLISHER}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define MUI_ICON   "../app/app.ico"
!define MUI_UNICON "../app/app.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "شغّل المنظومة الآن"

Var OldVersion
Var Upgrading

;  ---------- الصفحات ----------
!insertmacro MUI_PAGE_WELCOME
Page custom UpgradePage
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
UninstPage custom un.KeepDataPage
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Arabic"

;  ---------- كشف النسخة السابقة ----------
Function .onInit
  StrCpy $Upgrading "0"
  ReadRegStr $OldVersion HKLM "${APPKEY}" "Version"
  ${If} $OldVersion != ""
    StrCpy $Upgrading "1"
  ${EndIf}

  ;  أغلق البرنامج إن كان يعمل، وإلا فشل استبدال الملف
  nsExec::Exec 'taskkill /F /IM "${EXENAME}"'
  Pop $0
FunctionEnd

;  صفحة تُعرض فقط حين توجد نسخة سابقة
Function UpgradePage
  ${If} $Upgrading != "1"
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "توجد نسخة مثبَّتة" "سيجري تحديثها، وبياناتك تبقى كما هي."

  nsDialogs::CreateControl STATIC ${WS_VISIBLE}|${WS_CHILD}|${SS_RIGHT} 0 0 0 100% 60u \
    "وُجدت النسخة $OldVersion على هذا الجهاز.$\r$\n$\r$\nسيُحدَّث البرنامج إلى النسخة ${VERSION}.$\r$\n$\r$\nكتبك وقرطاسيتك وفواتيرك وزبائنك وكل إعداداتك تبقى كما هي — البيانات محفوظة في مجلد منفصل لا يمسّه التحديث، ويؤخذ منها نسخ احتياطي يومي."
  Pop $0

  nsDialogs::Show
FunctionEnd

;  ---------- التثبيت ----------
Section "البرنامج" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  SetOverwrite on

  File "/oname=${EXENAME}" "../build/Qirtasiya-1.exe"

  ;  علامة «مثبَّت»: البرنامج يقرأها فيكتب بياناته في مجلد المستخدم
  FileOpen $0 "$INSTDIR\installed.flag" w
  FileWrite $0 "${VERSION}"
  FileClose $0

  ;  مجلد البيانات — يُنشأ إن لم يوجد، ولا يُمسّ إن وُجد
  CreateDirectory "$LOCALAPPDATA\${SHORTNAME}\data"

  WriteRegStr HKLM "${APPKEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${APPKEY}" "Version"    "${VERSION}"

  ;  يظهر في «التطبيقات المثبَّتة» مثل أي برنامج رسمي
  WriteRegStr   HKLM "${REGKEY}" "DisplayName"     "${APPNAME}"
  WriteRegStr   HKLM "${REGKEY}" "DisplayVersion"  "${VERSION}"
  WriteRegStr   HKLM "${REGKEY}" "Publisher"       "${PUBLISHER}"
  WriteRegStr   HKLM "${REGKEY}" "DisplayIcon"     "$INSTDIR\${EXENAME}"
  WriteRegStr   HKLM "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKLM "${REGKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr   HKLM "${REGKEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
  WriteRegDWORD HKLM "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${REGKEY}" "NoRepair" 1

  WriteUninstaller "$INSTDIR\uninstall.exe"

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${REGKEY}" "EstimatedSize" "$0"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\إلغاء التثبيت.lnk" "$INSTDIR\uninstall.exe"
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0
SectionEnd

;  ---------- إلغاء التثبيت ----------
Var KeepCheck

Function un.KeepDataPage

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "بياناتك" "اختر ما يحدث لكتبك وفواتيرك."

  nsDialogs::CreateControl STATIC ${WS_VISIBLE}|${WS_CHILD}|${SS_RIGHT} 0 0 0 100% 40u \
    "بياناتك في:$\r$\n$LOCALAPPDATA\${SHORTNAME}\data$\r$\n$\r$\nالإبقاء عليها يعني أنك تجدها كما هي إن أعدت التثبيت لاحقاً."
  Pop $0

  ${NSD_CreateCheckbox} 0 50u 100% 12u "أبقِ بياناتي على الجهاز (موصى به)"
  Pop $KeepCheck
  ${NSD_Check} $KeepCheck

  nsDialogs::Show
FunctionEnd

Section "Uninstall"
  ;  الإلغاء الصامت (/S) لا يعرض الصفحة، فلا مقبض للمربّع.
  ;  الافتراضي عندها: أبقِ البيانات — الحذف لا يكون إلا باختيار صريح.
  StrCpy $0 ${BST_CHECKED}
  ${If} $KeepCheck != ""
    ${NSD_GetState} $KeepCheck $0
  ${EndIf}

  nsExec::Exec 'taskkill /F /IM "${EXENAME}"'
  Pop $1

  Delete "$INSTDIR\${EXENAME}"
  Delete "$INSTDIR\installed.flag"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR\data"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\إلغاء التثبيت.lnk"
  RMDir  "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\${APPNAME}.lnk"

  DeleteRegKey HKLM "${REGKEY}"
  DeleteRegKey HKLM "${APPKEY}"

  ;  البيانات تُحذف فقط إن أزال المستخدم العلامة صراحةً
  ${If} $0 == ${BST_UNCHECKED}
    RMDir /r "$LOCALAPPDATA\${SHORTNAME}"
  ${EndIf}
SectionEnd
