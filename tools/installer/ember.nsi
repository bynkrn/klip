Unicode true
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!ifndef VERSION
 !error "VERSION is required"
!endif
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ember"
Name "Ember"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Ember"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
RequestExecutionLevel user
AllowRootDirInstall false
SetCompressor /SOLID lzma
SetCompressorDictSize 16
!uninstfinalize '"${NODE}" "${UNINSTALL_EXPORT}" "%1" "${RUNTIME}\Uninstall.exe"' = 0
BrandingText "Ember ${VERSION}"
ShowInstDetails nevershow
ShowUninstDetails nevershow
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "Ember"
VIAddVersionKey /LANG=1033 "FileDescription" "Ember Setup"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Ember contributors"
!define MUI_ICON "..\..\src\icon.ico"
!define MUI_UNICON "..\..\src\icon.ico"
!define MUI_ABORTWARNING
!define MUI_LANGDLL_ALWAYSSHOW
!define MUI_LANGDLL_WINDOWTITLE "Ember — Dil / Language"
!define MUI_LANGDLL_INFO "Kurulum Ve Uygulama Dili / Setup And App Language"
!define MUI_LANGDLL_REGISTRY_ROOT HKCU
!define MUI_LANGDLL_REGISTRY_KEY "${UNINSTALL_KEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "InstallerLanguage"
!insertmacro MUI_PAGE_WELCOME
Page custom PreferencesPage PreferencesLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Ember.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Turkish"

LangString PrefTitle ${LANG_ENGLISH} "Startup Preferences"
LangString PrefTitle ${LANG_TURKISH} "Başlangıç Tercihleri"
LangString PrefDescription ${LANG_ENGLISH} "Choose how Ember starts."
LangString PrefDescription ${LANG_TURKISH} "Ember’ın nasıl başlayacağını seç."
LangString PrefHint ${LANG_ENGLISH} "Recording quality, audio, hotkey and other options can be changed in Settings. These choices can also be changed later."
LangString PrefHint ${LANG_TURKISH} "Kayıt kalitesi, sesler, kısayol ve diğer seçenekler Ayarlar’da. Bu seçimleri de daha sonra değiştirebilirsin."
LangString LaunchLabel ${LANG_ENGLISH} "Start Ember With Windows"
LangString LaunchLabel ${LANG_TURKISH} "Windows İle Başlat"
LangString MinimizedLabel ${LANG_ENGLISH} "Start In The System Tray With Windows"
LangString MinimizedLabel ${LANG_TURKISH} "Windows Açılışında Sistem Tepsisinde Başlat"
LangString BufferLabel ${LANG_ENGLISH} "Start Replay Buffer Automatically"
LangString BufferLabel ${LANG_TURKISH} "Tamponu Otomatik Başlat"
LangString DesktopLabel ${LANG_ENGLISH} "Create Desktop Shortcut"
LangString DesktopLabel ${LANG_TURKISH} "Masaüstü Kısayolu Oluştur"
LangString RestHint ${LANG_ENGLISH} "Default: 2 minutes, 1080p / 60 FPS, high quality. Press F8 to save a clip. Existing recording settings and clips are preserved."
LangString RestHint ${LANG_TURKISH} "Varsayılan: 2 dakika, 1080p / 60 FPS, yüksek kalite. Klip almak için F8. Mevcut kayıt ayarların ve kliplerin korunur."
LangString CloseEmber ${LANG_ENGLISH} "Ember is running. Save any clip you need, then choose Exit from Ember's system tray menu and press Retry. Setup will not close Ember or discard the replay buffer."
LangString CloseEmber ${LANG_TURKISH} "Ember açık. İstediğin klibi kaydet, ardından Ember’ın sistem tepsisi menüsünden Çıkış’ı seçip Yeniden Dene’ye bas. Kurulum uygulamayı kapatmaz veya tamponu silmez."
LangString WindowsRequired ${LANG_ENGLISH} "Ember requires 64-bit Windows 10 or Windows 11."
LangString WindowsRequired ${LANG_TURKISH} "Ember, 64 bit Windows 10 veya Windows 11 gerektirir."
LangString Installing ${LANG_ENGLISH} "Ember"
LangString Installing ${LANG_TURKISH} "Ember"

Var Launch
Var Minimized
Var AutoBuffer
Var DesktopChoice
Var StartMenuChoice
Var LaunchControl
Var MinimizedControl
Var BufferControl
Var DesktopControl
Var Options

Function .onInit
 SetShellVarContext current
 ${IfNot} ${RunningX64}
  MessageBox MB_OK|MB_ICONSTOP "$(WindowsRequired)"
  SetErrorLevel 3
  Quit
 ${EndIf}
 ${IfNot} ${AtLeastWin10}
  MessageBox MB_OK|MB_ICONSTOP "$(WindowsRequired)"
  SetErrorLevel 3
  Quit
 ${EndIf}
 StrCpy $Launch 1
 StrCpy $Minimized 0
 StrCpy $AutoBuffer 1
 StrCpy $DesktopChoice 1
 StrCpy $StartMenuChoice 1
 ${GetParameters} $Options
 ${GetOptions} $Options "/LANG=" $0
 ${If} $0 == "tr"
  StrCpy $LANGUAGE ${LANG_TURKISH}
 ${ElseIf} $0 == "en"
  StrCpy $LANGUAGE ${LANG_ENGLISH}
 ${EndIf}
 ${GetOptions} $Options "/LAUNCH=" $0
 ${If} $0 == "0"
  StrCpy $Launch 0
 ${EndIf}
 ${GetOptions} $Options "/MINIMIZED=" $0
 ${If} $0 == "1"
  StrCpy $Minimized 1
 ${EndIf}
 ${GetOptions} $Options "/AUTOBUFFER=" $0
 ${If} $0 == "0"
  StrCpy $AutoBuffer 0
 ${EndIf}
 ${GetOptions} $Options "/DESKTOP=" $0
 ${If} $0 == "0"
  StrCpy $DesktopChoice 0
 ${EndIf}
 ${GetOptions} $Options "/STARTMENU=" $0
 ${If} $0 == "0"
  StrCpy $StartMenuChoice 0
 ${EndIf}
 IfSilent lang_done
 !insertmacro MUI_LANGDLL_DISPLAY
 lang_done:
FunctionEnd

Function ToggleMinimized
 EnableWindow $MinimizedControl $Launch
FunctionEnd
Function LaunchChanged
 ${NSD_GetState} $LaunchControl $Launch
 Call ToggleMinimized
FunctionEnd
Function PreferencesPage
 !insertmacro MUI_HEADER_TEXT "$(PrefTitle)" "$(PrefDescription)"
 nsDialogs::Create 1018
 Pop $0
 ${If} $0 == error
  Abort
 ${EndIf}
 ${NSD_CreateLabel} 0 0 100% 27u "$(PrefHint)"
 Pop $0
 ${NSD_CreateCheckbox} 0 34u 100% 14u "$(LaunchLabel)"
 Pop $LaunchControl
 ${NSD_SetState} $LaunchControl $Launch
 ${NSD_OnClick} $LaunchControl LaunchChanged
 ${NSD_CreateCheckbox} 12u 54u 95% 14u "$(MinimizedLabel)"
 Pop $MinimizedControl
 ${NSD_SetState} $MinimizedControl $Minimized
 ${NSD_CreateCheckbox} 0 74u 100% 14u "$(BufferLabel)"
 Pop $BufferControl
 ${NSD_SetState} $BufferControl $AutoBuffer
 ${NSD_CreateCheckbox} 0 94u 100% 14u "$(DesktopLabel)"
 Pop $DesktopControl
 ${NSD_SetState} $DesktopControl $DesktopChoice
 ${NSD_CreateLabel} 0 115u 100% 25u "$(RestHint)"
 Pop $0
 Call ToggleMinimized
 nsDialogs::Show
FunctionEnd
Function PreferencesLeave
 ${NSD_GetState} $LaunchControl $Launch
 ${NSD_GetState} $MinimizedControl $Minimized
 ${NSD_GetState} $BufferControl $AutoBuffer
 ${NSD_GetState} $DesktopControl $DesktopChoice
FunctionEnd

!macro RequireClosed Prefix
Function ${Prefix}RequireClosed
 check:
 FindWindow $0 "Chrome_WidgetWin_1" "Ember"
 ${If} $0 != 0
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CloseEmber)" /SD IDCANCEL IDRETRY check
  SetErrorLevel 2
  Quit
 ${EndIf}
FunctionEnd
!macroend
!insertmacro RequireClosed ""
!insertmacro RequireClosed "un."

Section "$(Installing)"
 Call RequireClosed
 SetOutPath "$INSTDIR"
 SetOverwrite on
 File /r "${RUNTIME}\*.*"
 System::Call 'ole32::CoCreateGuid(g .r0) i.r1'
 ${If} $1 != 0
  Abort
 ${EndIf}
 WriteINIStr "$INSTDIR\installation.ini" "Setup" "id" $0
 StrCpy $0 "en"
 ${If} $LANGUAGE == ${LANG_TURKISH}
  StrCpy $0 "tr"
 ${EndIf}
 WriteINIStr "$INSTDIR\installation.ini" "Setup" "language" $0
 WriteINIStr "$INSTDIR\installation.ini" "Setup" "launch" $Launch
 WriteINIStr "$INSTDIR\installation.ini" "Setup" "launchMinimized" $Minimized
 WriteINIStr "$INSTDIR\installation.ini" "Setup" "autoBuffer" $AutoBuffer
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 ; Apply login choice even when the user skips launching on the finish page.
 ; Windows' separate StartupApproved decision is deliberately left untouched.
 ${If} $Launch == 1
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Ember" '$\"$INSTDIR\Ember.exe$\" --startup'
 ${Else}
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Ember"
 ${EndIf}
 ; Remove previously owned links when the same installation opts out.
 ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "InstallLocation"
 ${If} $0 == $INSTDIR
  ReadRegDWORD $0 HKCU "${UNINSTALL_KEY}" "DesktopShortcut"
  ${If} $0 == 1
  ${AndIf} $DesktopChoice == 0
   Delete "$DESKTOP\Ember.lnk"
  ${EndIf}
  ReadRegDWORD $0 HKCU "${UNINSTALL_KEY}" "StartMenuShortcut"
  ${If} $0 == 1
  ${AndIf} $StartMenuChoice == 0
   Delete "$SMPROGRAMS\Ember\Ember.lnk"
   RMDir "$SMPROGRAMS\Ember"
  ${EndIf}
 ${EndIf}
 WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Ember"
 WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
 WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Ember.exe"
 WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
 WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
 WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/bynkrn/klip"
 WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
 WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
 WriteRegDWORD HKCU "${UNINSTALL_KEY}" "InstallerLanguage" $LANGUAGE
 WriteRegDWORD HKCU "${UNINSTALL_KEY}" "DesktopShortcut" $DesktopChoice
 WriteRegDWORD HKCU "${UNINSTALL_KEY}" "StartMenuShortcut" $StartMenuChoice
 ${If} $DesktopChoice == 1
  CreateShortcut "$DESKTOP\Ember.lnk" "$INSTDIR\Ember.exe" "" "$INSTDIR\Ember.exe"
 ${EndIf}
 ${If} $StartMenuChoice == 1
  CreateDirectory "$SMPROGRAMS\Ember"
  CreateShortcut "$SMPROGRAMS\Ember\Ember.lnk" "$INSTDIR\Ember.exe" "" "$INSTDIR\Ember.exe"
 ${EndIf}
SectionEnd

Function un.onInit
 SetShellVarContext current
 !insertmacro MUI_UNGETLANGUAGE
FunctionEnd
Section "Uninstall"
 Call un.RequireClosed
 ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Ember"
 ${If} $0 == '$\"$INSTDIR\Ember.exe$\" --startup'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Ember"
 ${EndIf}
 ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "InstallLocation"
 ${If} $0 == $INSTDIR
  ReadRegDWORD $0 HKCU "${UNINSTALL_KEY}" "DesktopShortcut"
  ${If} $0 == 1
   Delete "$DESKTOP\Ember.lnk"
  ${EndIf}
  ReadRegDWORD $0 HKCU "${UNINSTALL_KEY}" "StartMenuShortcut"
  ${If} $0 == 1
   Delete "$SMPROGRAMS\Ember\Ember.lnk"
   RMDir "$SMPROGRAMS\Ember"
  ${EndIf}
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
 ${EndIf}
 !include "${UNINSTALL_MANIFEST}"
SectionEnd
