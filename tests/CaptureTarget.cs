using System;using System.Drawing;using System.IO;using System.Media;using System.Runtime.InteropServices;using System.Windows.Forms;
class CaptureTarget:Form{
 [StructLayout(LayoutKind.Sequential)]struct PFD{public ushort size,version;public uint flags;public byte pixelType,colorBits,redBits,redShift,greenBits,greenShift,blueBits,blueShift,alphaBits,alphaShift,accumBits,accumRedBits,accumGreenBits,accumBlueBits,accumAlphaBits,depthBits,stencilBits,auxBuffers,layerType,reserved;public uint layerMask,visibleMask,damageMask;}
 [DllImport("user32.dll")]static extern IntPtr GetDC(IntPtr hwnd);
 [DllImport("gdi32.dll")]static extern int ChoosePixelFormat(IntPtr h,ref PFD p);
 [DllImport("gdi32.dll")]static extern bool SetPixelFormat(IntPtr h,int i,ref PFD p);
 [DllImport("gdi32.dll")]static extern bool SwapBuffers(IntPtr h);
 [DllImport("opengl32.dll")]static extern IntPtr wglCreateContext(IntPtr h);
 [DllImport("opengl32.dll")]static extern bool wglMakeCurrent(IntPtr h,IntPtr r);
 [DllImport("opengl32.dll")]static extern void glClearColor(float r,float g,float b,float a);
 [DllImport("opengl32.dll")]static extern void glClear(uint m);
 [DllImport("opengl32.dll")]static extern void glBegin(uint m);
 [DllImport("opengl32.dll")]static extern void glEnd();
 [DllImport("opengl32.dll")]static extern void glColor3f(float r,float g,float b);
 [DllImport("opengl32.dll")]static extern void glVertex2f(float x,float y);
 IntPtr dc,rc;Timer timer=new Timer();float angle;
 CaptureTarget(){Text="Klip 4:3 capture verification";ClientSize=new Size(800,600);StartPosition=FormStartPosition.CenterScreen;timer.Interval=16;timer.Tick+=(s,e)=>Invalidate();}
 protected override void OnLoad(EventArgs e){base.OnLoad(e);dc=GetDC(Handle);PFD p=new PFD();p.size=(ushort)Marshal.SizeOf(typeof(PFD));p.version=1;p.flags=0x25;p.colorBits=32;p.depthBits=24;SetPixelFormat(dc,ChoosePixelFormat(dc,ref p),ref p);rc=wglCreateContext(dc);wglMakeCurrent(dc,rc);timer.Start();}
 protected override void OnPaintBackground(PaintEventArgs e){}
 protected override void OnPaint(PaintEventArgs e){if(rc==IntPtr.Zero)return;wglMakeCurrent(dc,rc);glClearColor(.12f,.24f,.4f,1);glClear(0x4000);glBegin(4);glColor3f(1,.65f,.05f);glVertex2f(-.8f,-.7f);glColor3f(.1f,1,.4f);glVertex2f(.8f,-.7f);glColor3f(.95f,.2f,.5f);glVertex2f((float)Math.Sin(angle)*.6f,.8f);glEnd();SwapBuffers(dc);angle+=.02f;}
 static SoundPlayer sound;
 static void Tone(){var stream=new MemoryStream();var w=new BinaryWriter(stream);int rate=48000,bytes=rate*2;w.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));w.Write(36+bytes);w.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt "));w.Write(16);w.Write((short)1);w.Write((short)1);w.Write(rate);w.Write(bytes);w.Write((short)2);w.Write((short)16);w.Write(System.Text.Encoding.ASCII.GetBytes("data"));w.Write(bytes);for(int i=0;i<rate;i++)w.Write((short)(Math.Sin(2*Math.PI*440*i/rate)*1200));stream.Position=0;sound=new SoundPlayer(stream);sound.Load();sound.PlayLooping();}
 [STAThread]static void Main(string[] args){if(Array.IndexOf(args,"--tone")>=0)Tone();Application.EnableVisualStyles();Application.Run(new CaptureTarget());}
}
