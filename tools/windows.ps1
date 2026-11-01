$ErrorActionPreference = 'SilentlyContinue'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class KlipWindows {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder b,int n);
}
'@
while ($true) {
 $handle = [KlipWindows]::GetForegroundWindow()
 [uint32]$processId = 0
 [KlipWindows]::GetWindowThreadProcessId($handle,[ref]$processId) | Out-Null
 $title = [Text.StringBuilder]::new(1024)
 $class = [Text.StringBuilder]::new(256)
 [KlipWindows]::GetWindowText($handle,$title,1024) | Out-Null
 [KlipWindows]::GetClassName($handle,$class,256) | Out-Null
 $processInfo = Get-Process -Id $processId
 @{ pid=$processId; title=$title.ToString(); class=$class.ToString(); exe=($processInfo.ProcessName+'.exe'); hwnd=$handle.ToInt64().ToString() } | ConvertTo-Json -Compress
 Start-Sleep -Milliseconds 350
}
