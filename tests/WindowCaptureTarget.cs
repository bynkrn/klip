using System;using System.Drawing;using System.Windows.Forms;
class WindowCaptureTarget:Form {
 Timer timer=new Timer();float phase;
 WindowCaptureTarget(){Text="Klip WGC 4:3 verification";ClientSize=new Size(800,600);StartPosition=FormStartPosition.CenterScreen;DoubleBuffered=true;timer.Interval=16;timer.Tick+=(s,e)=>{phase+=.025f;Invalidate();};timer.Start();}
 protected override void OnPaint(PaintEventArgs e){e.Graphics.Clear(Color.FromArgb(31,61,102));PointF[] points={new PointF(80,510),new PointF(720,510),new PointF(400+(float)Math.Sin(phase)*220,60)};using(var brush=new SolidBrush(Color.FromArgb(255,168,18)))e.Graphics.FillPolygon(brush,points);}
 [STAThread]static void Main(){Application.EnableVisualStyles();Application.Run(new WindowCaptureTarget());}
}
