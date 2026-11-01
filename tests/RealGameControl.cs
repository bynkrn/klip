using System;using System.Diagnostics;using System.Runtime.InteropServices;using System.Text;using System.Web.Script.Serialization;
class RealGameControl{
 delegate bool EnumProc(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc f,IntPtr p);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]static extern bool GetClientRect(IntPtr h,out Rect r);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]static extern bool AttachThreadInput(uint a,uint b,bool on);
 [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")]static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")]static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 struct Rect{public int left,top,right,bottom;}
 static void Main(string[] args){try{uint pid=UInt32.Parse(args[1]);IntPtr window=IntPtr.Zero;long area=0;EnumWindows((h,p)=>{uint candidate;GetWindowThreadProcessId(h,out candidate);if(candidate==pid&&IsWindowVisible(h)){Rect r;GetClientRect(h,out r);StringBuilder caption=new StringBuilder(512);GetWindowText(h,caption,512);long size=(long)r.right*r.bottom;if(!caption.ToString().Contains("Console")&&size>area){window=h;area=size;}}return true;},IntPtr.Zero);if(window==IntPtr.Zero)throw new Exception("Owned game renderer window not ready (console is not a game)");
  if(args[0]=="focus"||args[0]=="command"||args[0]=="spin"){ShowWindow(window,9);uint current=GetCurrentThreadId(),ignored,foregroundThread=GetWindowThreadProcessId(GetForegroundWindow(),out ignored);bool attached=foregroundThread!=current&&AttachThreadInput(current,foregroundThread,true);keybd_event(0x12,0,0,UIntPtr.Zero);try{SetForegroundWindow(window);}finally{keybd_event(0x12,0,2,UIntPtr.Zero);if(attached)AttachThreadInput(current,foregroundThread,false);}}
  if(args[0]=="command"){if(GetForegroundWindow()!=window)throw new Exception("Cannot send a test console command without foreground ownership");keybd_event(0x79,0,0,UIntPtr.Zero);keybd_event(0x79,0,2,UIntPtr.Zero);System.Threading.Thread.Sleep(250);foreach(char c in args[2])PostMessage(window,0x0102,(IntPtr)c,IntPtr.Zero);PostMessage(window,0x0100,(IntPtr)0x0D,(IntPtr)0x001C0001);PostMessage(window,0x0101,(IntPtr)0x0D,(IntPtr)unchecked((int)0xC01C0001));}
  if(args[0]=="spin")PostMessage(window,0x0100,(IntPtr)0x76,(IntPtr)0x00410001);
  if(args[0]=="close")PostMessage(window,0x0010,IntPtr.Zero,IntPtr.Zero);
  Rect rect;GetClientRect(window,out rect);StringBuilder title=new StringBuilder(512);GetWindowText(window,title,512);Console.WriteLine(new JavaScriptSerializer().Serialize(new{pid,hwnd=window.ToInt64().ToString(),title=title.ToString(),width=rect.right,height=rect.bottom,foreground=GetForegroundWindow()==window}));
 }catch(Exception e){Console.Error.WriteLine(e.Message);Environment.ExitCode=1;}}
}
