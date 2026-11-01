using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

class ForegroundWatcher {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

    static void Main() {
        Console.OutputEncoding=new UTF8Encoding(false);
        var json=new JavaScriptSerializer();
        IntPtr previous=IntPtr.Zero;
        while (true) {
            try {
                var h=GetForegroundWindow();
                if(h!=IntPtr.Zero && h!=previous) {
                    uint pid; GetWindowThreadProcessId(h,out pid);
                    using(var p=Process.GetProcessById((int)pid)) {
                        var title=new StringBuilder(1024);var cls=new StringBuilder(256);
                        GetWindowText(h,title,title.Capacity);GetClassName(h,cls,cls.Capacity);
                        Console.WriteLine(json.Serialize(new {hwnd=h.ToInt64(),title=title.ToString(),@class=cls.ToString(),exe=p.ProcessName+".exe"}));
                        previous=h;
                    }
                }
            } catch { }
            Thread.Sleep(350);
        }
    }
}
