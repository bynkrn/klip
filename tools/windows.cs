using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

class ForegroundWatcher {
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct MonitorInfo {
        public int Size; public Rect Bounds,Work; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string DeviceName;
    }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct DisplayDevice {
        public int Size;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string DeviceString;
        public uint StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string DeviceKey;
    }
    class Display {
        public string id,name; public int width,height,x,y; public bool primary,available=true;
    }
    class Window {
        public long hwnd; public string title,@class,exe,monitorId;
    }
    delegate bool MonitorCallback(IntPtr monitor,IntPtr dc,ref Rect rect,IntPtr data);
    delegate bool WindowCallback(IntPtr window,IntPtr data);
    static readonly Dictionary<IntPtr,string> MonitorIds=new Dictionary<IntPtr,string>();
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr rect,MonitorCallback callback,IntPtr data);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool EnumDisplayDevices(string device,uint index,ref DisplayDevice display,uint flags);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window,uint flags);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback,IntPtr data);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int max);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);

    // OBS monitor_capture uses this exact interface ID, not DISPLAY1 or an index.
    static Display ReadDisplay(IntPtr monitor) {
        var info=new MonitorInfo();info.Size=Marshal.SizeOf(typeof(MonitorInfo));
        if(monitor==IntPtr.Zero || !GetMonitorInfo(monitor,ref info))return null;
        var device=new DisplayDevice();device.Size=Marshal.SizeOf(typeof(DisplayDevice));
        if(!EnumDisplayDevices(info.DeviceName,0,ref device,1) || String.IsNullOrEmpty(device.DeviceID) || device.DeviceID=="DUMMY")return null;
        int width=info.Bounds.Right-info.Bounds.Left,height=info.Bounds.Bottom-info.Bounds.Top;
        if(width<=0 || height<=0)return null;
        return new Display { id=device.DeviceID,name=String.IsNullOrEmpty(device.DeviceString)?info.DeviceName:device.DeviceString,width=width,height=height,x=info.Bounds.Left,y=info.Bounds.Top,primary=(info.Flags&1)!=0 };
    }
    static List<Display> ListDisplays() {
        var displays=new List<Display>();var ids=new Dictionary<IntPtr,string>();
        if(!EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,delegate(IntPtr monitor,IntPtr dc,ref Rect rect,IntPtr data){
            var display=ReadDisplay(monitor);if(display!=null){displays.Add(display);ids[monitor]=display.id;}return true;
        },IntPtr.Zero))throw new InvalidOperationException("Windows display enumeration failed.");
        MonitorIds.Clear();foreach(var entry in ids)MonitorIds[entry.Key]=entry.Value;
        return displays;
    }
    static string MonitorId(IntPtr window) {
        string id;return MonitorIds.TryGetValue(MonitorFromWindow(window,2),out id)?id:null;
    }
    static bool IsGame(string exe,string target) {
        return !String.IsNullOrEmpty(target)?String.Equals(exe,target,StringComparison.OrdinalIgnoreCase):Regex.IsMatch(exe,@"^(VALORANT.*|cs2|quakelive.*|ddnet.*|r5apex|FortniteClient.*|Overwatch|dota2|RocketLeague|RainbowSix.*)\.exe$",RegexOptions.IgnoreCase);
    }
    static Window ReadWindow(IntPtr h,bool monitor) {
        if(h==IntPtr.Zero || !IsWindow(h))return null;
        uint pid;GetWindowThreadProcessId(h,out pid);
        using(var process=Process.GetProcessById((int)pid)) {
            var title=new StringBuilder(1024);var cls=new StringBuilder(256);
            GetWindowText(h,title,title.Capacity);GetClassName(h,cls,cls.Capacity);
            return new Window {hwnd=h.ToInt64(),title=title.ToString(),@class=cls.ToString(),exe=process.ProcessName+".exe",monitorId=monitor?MonitorId(h):null};
        }
    }
    static IntPtr FindGame(string target) {
        IntPtr found=IntPtr.Zero;
        EnumWindows(delegate(IntPtr h,IntPtr data){
            try {if(IsWindowVisible(h)){var window=ReadWindow(h,false);if(window!=null && IsGame(window.exe,target)){found=h;return false;}}}catch { }
            return true;
        },IntPtr.Zero);
        return found;
    }
    static int Main(string[] args) {
        Console.OutputEncoding=new UTF8Encoding(false);SetProcessDPIAware();
        var json=new JavaScriptSerializer();
        if(args.Length==1 && args[0]=="--list-displays") {
            try {Console.WriteLine(json.Serialize(ListDisplays()));return 0;}
            catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
        }
        string target=null;
        if(args.Length==2 && args[0]=="--target-exe")target=args[1];
        else if(args.Length!=0){Console.Error.WriteLine("Unsupported window watcher arguments.");return 2;}
        string previous=null,previousDisplays=null,previousError=null,displayError=null;IntPtr gameWindow=IntPtr.Zero;DateTime nextGameSearch=DateTime.MinValue,nextDisplays=DateTime.MinValue;List<Display> displays=null;
        while(true) {
            try {
                if(DateTime.UtcNow>=nextDisplays) {
                    try {displays=ListDisplays();displayError=null;}catch(Exception error){displayError=error.Message;}
                    nextDisplays=DateTime.UtcNow.AddSeconds(2);
                }
                Window foreground=null;try {foreground=ReadWindow(GetForegroundWindow(),true);}catch { }
                if(foreground!=null && IsGame(foreground.exe,target))gameWindow=new IntPtr(foreground.hwnd);
                if((gameWindow==IntPtr.Zero || !IsWindow(gameWindow)) && DateTime.UtcNow>=nextGameSearch){gameWindow=FindGame(target);nextGameSearch=DateTime.UtcNow.AddSeconds(2);}
                Window game=null;
                try {game=ReadWindow(gameWindow,true);if(game!=null && !IsGame(game.exe,target)){gameWindow=IntPtr.Zero;game=null;}}catch {gameWindow=IntPtr.Zero;}
                var displaySignature=json.Serialize(displays);
                // Keep observing the target window after focus leaves it, including moves.
                var signature=json.Serialize(new {foreground,gameWindow=game,displays,displayError});
                if(signature!=previous) {
                    Console.WriteLine(json.Serialize(new {hwnd=foreground==null?0:foreground.hwnd,title=foreground==null?"":foreground.title,@class=foreground==null?"":foreground.@class,exe=foreground==null?"":foreground.exe,monitorId=foreground==null?null:foreground.monitorId,gameWindow=game,displays=displaySignature!=previousDisplays || previousError!=null?displays:null,displayError}));
                    previous=signature;previousDisplays=displaySignature;
                }
                previousError=displayError;
            }catch(Exception error){Console.Error.WriteLine(error.Message);}
            Thread.Sleep(350);
        }
    }
}
