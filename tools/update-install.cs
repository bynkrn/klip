using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// The helper, its working directory and its journals live outside the application tree.
// Backups and failed packages are retained; no user library/settings are deleted here.
class UpdateInstaller {
 public class Job {
  public int schema{get;set;} public string appRoot{get;set;} public string cacheDir{get;set;} public string archivePath{get;set;} public string sha256{get;set;} public string version{get;set;} public long size{get;set;} public int parentPid{get;set;} public int healthTimeoutMs{get;set;} public int waitTimeoutMs{get;set;} public bool showProgress{get;set;} public string language{get;set;}
  public Job(){healthTimeoutMs=120000;waitTimeoutMs=30000;showProgress=true;language="tr";}
 }
 class Health {public string nonce{get;set;}public string version{get;set;}public int pid{get;set;}public string phase{get;set;}public bool? bufferRunning{get;set;}public string bufferError{get;set;}}
 public class State {
  public int schema=1; public string version; public string appRoot; public string status; public string phase; public double? progress; public long? doneBytes; public long? totalBytes; public string error; public string backup; public bool? bufferRunning; public string bufferError; public string updatedAtUtc; public int helperPid=Process.GetCurrentProcess().Id; public string logPath; public bool reopened;
 }
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
 static readonly UTF8Encoding Utf8=new UTF8Encoding(false);
 const string ArchiveRoot="Ember-win32-x64";
 static Journal Current;
 static string Full(string value){if(String.IsNullOrWhiteSpace(value)||!Regex.IsMatch(value,@"^[A-Za-z]:[\\/]"))throw new Exception("An absolute local drive path is required.");string full=Path.GetFullPath(value).TrimEnd('\\','/');if(full.Length<4||String.Equals(full,Path.GetPathRoot(full).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))throw new Exception("A volume root is not an application directory.");return full;}
 static bool Within(string file,string root){return String.Equals(file,root,StringComparison.OrdinalIgnoreCase)||file.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase);}
 static void NoReparse(string value){for(string current=value;!String.IsNullOrEmpty(current);current=Path.GetDirectoryName(current)){if((File.Exists(current)||Directory.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new Exception("Reparse paths are not allowed.");}}
 static int[] Version(string value){if(value==null||!Regex.IsMatch(value,@"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$"))throw new Exception("Invalid stable version.");string[] parts=value.Split('.');return new[]{Int32.Parse(parts[0]),Int32.Parse(parts[1]),Int32.Parse(parts[2])};}
 static int Compare(string a,string b){int[] x=Version(a),y=Version(b);for(int i=0;i<3;i++)if(x[i]!=y[i])return x[i].CompareTo(y[i]);return 0;}
 static string PackageVersion(string root){string file=Path.Combine(root,"resources","app","package.json");if(!File.Exists(file)||!File.Exists(Path.Combine(root,"Ember.exe")))throw new Exception("A packaged Ember application is required.");var metadata=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));string version=Convert.ToString(metadata["version"]);Version(version);return version;}
 // Only fixed journal filenames beside the validated job are writable; no job-supplied result path is used.
 static string JournalDirectory(Job job,string jobFile){
  if(job==null||job.schema!=1)throw new Exception("Invalid update job.");
  string cache=Full(job.cacheDir),app=Full(job.appRoot),file=Full(jobFile),directory=Path.GetDirectoryName(file);
  if(Within(app,cache)||Within(cache,app)||!Within(file,cache)||!Within(directory,cache)||Within(Full(Assembly.GetExecutingAssembly().Location),app))throw new Exception("Application, updater and cache paths must be separate.");
  NoReparse(app);NoReparse(cache);NoReparse(file);if(!Directory.Exists(directory))throw new Exception("Update operation directory is missing.");
  foreach(string name in new[]{"progress.json","result.json","install.log"})NoReparse(Path.Combine(directory,name));
  return directory;
 }
 static void Validate(Job job,string jobFile){
  JournalDirectory(job,jobFile);job.appRoot=Full(job.appRoot);job.cacheDir=Full(job.cacheDir);job.archivePath=Full(job.archivePath);
  if(!Within(job.archivePath,job.cacheDir))throw new Exception("Archive must be inside the update cache.");
  if(job.parentPid<=0||job.size<=0||job.size>8L*1024*1024*1024||job.sha256==null||!Regex.IsMatch(job.sha256,"^[a-f0-9]{64}$"))throw new Exception("Invalid archive identity.");
  if(job.healthTimeoutMs<250||job.healthTimeoutMs>300000||job.waitTimeoutMs<250||job.waitTimeoutMs>300000)throw new Exception("Invalid timeout.");
  NoReparse(job.archivePath);if(Directory.Exists(Path.Combine(job.appRoot,".git")))throw new Exception("Source checkouts cannot be updated.");if(Compare(job.version,PackageVersion(job.appRoot))<=0)throw new Exception("Update must be newer than the installed version.");
 }
 static string NewNonce(){byte[] bytes=new byte[32];using(var random=RandomNumberGenerator.Create())random.GetBytes(bytes);return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();}
 class Journal {
  readonly Job job; readonly string directory; readonly ProgressWindow window; string lastPhase; readonly Stopwatch throttle=Stopwatch.StartNew();
  public string Backup; public bool Reopened; public bool ReopenAttempted; public bool ParentWaitFailed; public bool Validated; public bool? BufferRunning; public string BufferError;
  public Journal(Job j,string d,ProgressWindow w){job=j;directory=d;window=w;}
  public void Log(string message){try{string file=Path.Combine(directory,"install.log");NoReparse(file);File.AppendAllText(file,DateTime.UtcNow.ToString("o")+" "+message+Environment.NewLine,Utf8);}catch{}}
  void Atomic(string name,string value){string target=Path.Combine(directory,name),temp=Path.Combine(directory,"."+name+"-"+NewNonce()+".tmp");NoReparse(directory);NoReparse(target);try{using(var stream=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None)){byte[] bytes=Utf8.GetBytes(value);stream.Write(bytes,0,bytes.Length);stream.Flush(true);}if(File.Exists(target))File.Replace(temp,target,null);else File.Move(temp,target);}finally{if(File.Exists(temp))File.Delete(temp);}}
  public State Write(string phase,double? progress,long? done,long? total,string status,string error,bool terminal){
   State state=new State{version=job.version,appRoot=job.appRoot,status=status,phase=phase,progress=progress,doneBytes=done,totalBytes=total,error=error,backup=Backup,bufferRunning=BufferRunning,bufferError=BufferError,updatedAtUtc=DateTime.UtcNow.ToString("o"),logPath=Path.Combine(directory,"install.log"),reopened=Reopened};
   if(phase!=lastPhase){Log(phase+(error==null?"":": "+error));lastPhase=phase;}
   string json=Json.Serialize(state);Atomic("progress.json",json);if(terminal)Atomic("result.json",json);if(window!=null)window.Publish(state,terminal,terminal&&(status=="rejected"||status=="rolled-back")&&Validated&&!ReopenAttempted?new Action(delegate{TryReopenOld(job,this);}):null);return state;
  }
  public void Progress(string phase,long done,long total){if(done==total)Log(phase+" bytes="+done+"/"+total);if(phase!=lastPhase||done==total||throttle.ElapsedMilliseconds>=100){throttle.Restart();Write(phase,total>0?(double?)Math.Max(0,Math.Min(1,(double)done/total)):null,done,total,"installing",null,false);}}
  public void Phase(string phase){Write(phase,null,null,null,"installing",null,false);}
  public void Finish(string status,string error){State state=null;try{state=Write(status=="installed"?"completed":"failed",status=="installed"?(double?)1:null,null,null,status,error,true);}catch(Exception journalError){Log("Could not persist final result: "+journalError.Message);state=new State{version=job.version,appRoot=job.appRoot,backup=Backup,reopened=Reopened,updatedAtUtc=DateTime.UtcNow.ToString("o"),status=status,phase="failed",error=(error==null?"":error+" ")+"Could not persist final result: "+journalError.Message,logPath=Path.Combine(directory,"install.log"),bufferRunning=BufferRunning,bufferError=BufferError};if(window!=null)window.Publish(state,true,null);}Console.WriteLine(Json.Serialize(state));}
 }
 static void Phase(string phase){if(Current!=null)Current.Phase(phase);}
 static void Segment(string value){if(value.Length==0||value=="."||value==".."||value.EndsWith(".")||value.EndsWith(" ")||value.IndexOfAny(Path.GetInvalidFileNameChars())>=0||Regex.IsMatch(value,@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)",RegexOptions.IgnoreCase))throw new Exception("Unsafe ZIP entry.");}
 static void Extract(ZipArchive archive,string staging){
  var destinations=new HashSet<string>(StringComparer.OrdinalIgnoreCase);long total=0;if(archive.Entries.Count>100000)throw new Exception("Too many ZIP entries.");
  foreach(ZipArchiveEntry entry in archive.Entries){
   string name=entry.FullName;if(name.IndexOf('\\')>=0||!name.StartsWith(ArchiveRoot+"/",StringComparison.Ordinal)||name.Length>24000)throw new Exception("ZIP must contain only the expected application root.");
   string relative=name.Substring(ArchiveRoot.Length+1);if(relative.Length==0){if(entry.Length!=0)throw new Exception("Invalid root ZIP entry.");continue;}
   string trimmed=relative.TrimEnd('/');foreach(string part in trimmed.Split('/'))Segment(part);
   bool directory=name.EndsWith("/",StringComparison.Ordinal);string destination=Path.GetFullPath(Path.Combine(staging,trimmed.Replace('/',Path.DirectorySeparatorChar)));
   if(!Within(destination,staging)||String.Equals(destination,staging,StringComparison.OrdinalIgnoreCase)||!destinations.Add(destination))throw new Exception("Duplicate or escaping ZIP entry.");
   int unixType=(entry.ExternalAttributes>>16)&0xF000;if(unixType==0xA000||(entry.ExternalAttributes&(int)FileAttributes.ReparsePoint)!=0)throw new Exception("ZIP links are not allowed.");
   if(entry.Length<0||entry.Length>4L*1024*1024*1024||directory&&entry.Length!=0)throw new Exception("Invalid ZIP entry size.");total=checked(total+entry.Length);if(total>16L*1024*1024*1024)throw new Exception("Expanded ZIP is too large.");
  }
  Directory.CreateDirectory(staging);long done=0;byte[] buffer=new byte[65536];if(Current!=null)Current.Progress("extracting",0,total);
  foreach(ZipArchiveEntry entry in archive.Entries){string relative=entry.FullName.Substring(ArchiveRoot.Length+1);if(relative.Length==0)continue;string destination=Path.Combine(staging,relative.Replace('/',Path.DirectorySeparatorChar));if(entry.FullName.EndsWith("/",StringComparison.Ordinal)){Directory.CreateDirectory(destination);continue;}Directory.CreateDirectory(Path.GetDirectoryName(destination));NoReparse(Path.GetDirectoryName(destination));using(Stream source=entry.Open())using(var output=new FileStream(destination,FileMode.CreateNew,FileAccess.Write,FileShare.None)){int count;while((count=source.Read(buffer,0,buffer.Length))>0){if(output.Length+count>entry.Length)throw new Exception("ZIP entry exceeds its declared size.");output.Write(buffer,0,count);done=checked(done+count);if(Current!=null)Current.Progress("extracting",done,total);}if(output.Length!=entry.Length)throw new Exception("Truncated ZIP entry.");}}
 }
 static void WaitForParent(Job job){Process parent;try{parent=Process.GetProcessById(job.parentPid);}catch(ArgumentException){return;}using(parent){try{if(parent.HasExited)return;string expected=Path.Combine(job.appRoot,"Ember.exe");if(!String.Equals(Path.GetFullPath(parent.MainModule.FileName),expected,StringComparison.OrdinalIgnoreCase))throw new Exception("Parent process is not the installed Ember application.");}catch(InvalidOperationException){return;}if(!parent.WaitForExit(job.waitTimeoutMs))throw new Exception("Application did not exit; installation cancelled.");}}
 static Process Launch(string root,string args){return Process.Start(new ProcessStartInfo{FileName=Path.Combine(root,"Ember.exe"),Arguments=args,WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true});}
 static void TryReopenOld(Job job,Journal journal){if(journal.ReopenAttempted||!journal.Validated)return;journal.ReopenAttempted=true;if(journal.ParentWaitFailed){journal.Log("Unchanged application was not reopened: the parent did not pass the previous exit wait.");return;}try{journal.Log("Waiting for the installed parent before reopening the unchanged application.");WaitForParent(job);using(Process old=Launch(job.appRoot,"")){journal.Reopened=old!=null;journal.Log(journal.Reopened?"Reopened the unchanged application.":"The unchanged application could not be reopened.");}}catch(Exception error){journal.Log("Could not reopen unchanged application: "+error.Message);}}
 static Health ReadHealth(string file,Job job,string nonce,Process process,bool requireCompletion=false){try{if(!File.Exists(file))return null;NoReparse(file);if(new FileInfo(file).Length>65536)return null;var data=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));if(data==null)return null;if(requireCompletion&&(!data.ContainsKey("completed")||!(data["completed"] is bool)||!(bool)data["completed"]||!data.ContainsKey("bufferRunning")||!(data["bufferRunning"] is bool)))return null;Health health=Json.ConvertToType<Health>(data);return health!=null&&health.nonce==nonce&&health.version==job.version&&health.pid==process.Id?health:null;}catch{return null;}}
 static Health WaitHealth(Job job,string nonce,Process process){string file=Path.Combine(job.cacheDir,"health-"+nonce+".json"),progressFile=Path.Combine(job.cacheDir,"health-"+nonce+".progress.json");bool starting=false,requireCompletion=Compare(job.version,"0.8.2")>=0;Stopwatch timer=Stopwatch.StartNew();while(timer.ElapsedMilliseconds<job.healthTimeoutMs){Health health=ReadHealth(file,job,nonce,process,requireCompletion);if(health!=null)return health;if(!starting){Health progress=ReadHealth(progressFile,job,nonce,process);if(progress!=null&&progress.phase=="starting-buffer"){Phase("starting-buffer");starting=true;}}Thread.Sleep(50);}return null;}
 static void StopLaunched(Process process){if(process==null)return;try{if(!process.HasExited){using(Process killer=Process.Start(new ProcessStartInfo{FileName=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"taskkill.exe"),Arguments="/PID "+process.Id+" /T /F",UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true})){if(killer!=null)killer.WaitForExit(10000);}if(!process.HasExited)process.Kill();process.WaitForExit(10000);}}catch{}}
 static void Move(string source,string target){for(int i=0;;i++){try{Directory.Move(source,target);return;}catch(IOException){if(i>=39)throw;Thread.Sleep(100);}catch(UnauthorizedAccessException){if(i>=39)throw;Thread.Sleep(100);}}}
 static int Install(Job job,string jobFile,ProgressWindow window){
  Journal journal=null;bool oldMoved=false,newMoved=false;Process launched=null;string staging=null,backup=null,failed=null;
  try{
   journal=new Journal(job,JournalDirectory(job,jobFile),window);Current=journal;Phase("validating");Validate(job,jobFile);journal.Validated=true;
   string parent=Path.GetDirectoryName(job.appRoot),leaf=Path.GetFileName(job.appRoot),nonce=NewNonce();staging=Path.Combine(parent,"."+leaf+"-stage-"+nonce);backup=Path.Combine(parent,"."+leaf+"-backup-"+nonce);failed=Path.Combine(parent,"."+leaf+"-failed-"+nonce);
   using(var input=new FileStream(job.archivePath,FileMode.Open,FileAccess.Read,FileShare.Read)){
    if(input.Length!=job.size)throw new Exception("Archive size verification failed.");journal.Progress("verifying",0,input.Length);string hash;
    using(SHA256 sha=SHA256.Create()){byte[] buffer=new byte[65536];int count;long done=0;while((count=input.Read(buffer,0,buffer.Length))>0){sha.TransformBlock(buffer,0,count,buffer,0);done+=count;journal.Progress("verifying",done,input.Length);}sha.TransformFinalBlock(new byte[0],0,0);hash=BitConverter.ToString(sha.Hash).Replace("-","").ToLowerInvariant();}
    if(hash!=job.sha256)throw new Exception("Archive SHA256 verification failed.");input.Position=0;using(var zip=new ZipArchive(input,ZipArchiveMode.Read,true))Extract(zip,staging);
   }
   if(PackageVersion(staging)!=job.version)throw new Exception("Staged package version does not match the signed manifest.");
   Phase("waiting-exit");try{WaitForParent(job);}catch{journal.ParentWaitFailed=true;throw;}NoReparse(job.appRoot);NoReparse(parent);Phase("replacing");Move(job.appRoot,backup);oldMoved=true;journal.Backup=backup;Move(staging,job.appRoot);newMoved=true;
   Phase("launching");launched=Launch(job.appRoot,"--update-health="+nonce+" --update-version="+job.version+" --resume-buffer --show-after-update");Health health=launched==null?null:WaitHealth(job,nonce,launched);if(health==null)throw new Exception("Updated application did not acknowledge startup.");
   journal.BufferRunning=health.bufferRunning;journal.BufferError=health.bufferError;journal.Finish("installed",null);return 0;
  }catch(Exception error){
   if(journal==null){State rejected=new State{version=job==null?null:job.version,status="rejected",phase="failed",error=error.Message,updatedAtUtc=DateTime.UtcNow.ToString("o")};Console.WriteLine(Json.Serialize(rejected));if(window!=null)window.Publish(rejected,true,null);return 1;}
   if(oldMoved){StopLaunched(launched);try{try{Phase("rolling-back");}catch{}if(newMoved&&Directory.Exists(job.appRoot))Move(job.appRoot,failed);if(!Directory.Exists(job.appRoot)&&Directory.Exists(backup))Move(backup,job.appRoot);TryReopenOld(job,journal);journal.Finish("rolled-back",error.Message);return 2;}catch(Exception recovery){journal.Log("Recovery failed: "+recovery.Message);journal.Finish("recovery-required",error.Message+" Recovery failed: "+recovery.Message);return 3;}}
   if(!journal.Validated){try{Validate(job,jobFile);journal.Validated=true;}catch{}}TryReopenOld(job,journal);journal.Finish("rejected",error.Message);return 1;
  }finally{if(launched!=null)launched.Dispose();Current=null;}
 }
 sealed class ProgressMeter:Control {
  public double? Value;
  public ProgressMeter(){DoubleBuffered=true;Height=9;}
  protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);using(var back=new SolidBrush(Color.FromArgb(65,42,49)))e.Graphics.FillRectangle(back,ClientRectangle);if(Value.HasValue)using(var fill=new SolidBrush(Color.FromArgb(242,157,113)))e.Graphics.FillRectangle(fill,0,0,(int)(Width*Math.Max(0,Math.Min(1,Value.Value))),Height);}
 }
 sealed class ProgressWindow:Form {
  readonly bool english; readonly Label heading,phase,percent; readonly TextBox details; readonly ProgressMeter meter; readonly Button close,open; bool terminal; Action reopen; System.Windows.Forms.Timer finishedTimer;
  string TextFor(string tr,string en){return english?en:tr;}
  public ProgressWindow(Job job){
   english=job!=null&&job.language!=null&&job.language.StartsWith("en",StringComparison.OrdinalIgnoreCase);Text=TextFor("Ember Güncellemesi","Ember Update")+(job!=null&&!String.IsNullOrWhiteSpace(job.version)?" · "+job.version:"");ClientSize=new Size(620,395);BackColor=Color.FromArgb(29,22,30);ForeColor=Color.FromArgb(250,231,219);Font=new Font("Segoe UI",10);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;MinimizeBox=true;StartPosition=FormStartPosition.CenterScreen;
   try{Icon=Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);}catch{}
   heading=new Label{Text=TextFor("Ember güncelleniyor","Updating Ember"),Location=new Point(30,28),Size=new Size(555,42),Font=new Font("Segoe UI Semibold",21)};
   phase=new Label{Text=TextFor("Güncelleme hazırlanıyor…","Preparing the update…"),Location=new Point(32,91),Size=new Size(550,32),Font=new Font("Segoe UI",12)};
   meter=new ProgressMeter{Location=new Point(33,142),Size=new Size(550,9)};
   percent=new Label{Location=new Point(33,163),Size=new Size(550,24),ForeColor=Color.FromArgb(221,171,147)};
   details=new TextBox{Multiline=true,ReadOnly=true,BorderStyle=BorderStyle.None,ScrollBars=ScrollBars.None,WordWrap=true,BackColor=Color.FromArgb(29,22,30),Text=TextFor("Uygulama ve tampon hazır olunca Ember açılacak. Bu pencereyi açık bırakın.","Ember will open when the app and recording buffer are ready. Keep this window open."),Location=new Point(33,204),Size=new Size(550,109),ForeColor=Color.FromArgb(219,198,192)};
   close=MakeButton(TextFor("Kapat","Close"),465);close.Enabled=false;close.Visible=false;close.Click+=delegate{Close();};open=MakeButton(TextFor("Ember'ı aç","Open Ember"),311);open.Enabled=false;open.Visible=false;open.Click+=delegate{if(reopen!=null){Action action=reopen;reopen=null;open.Enabled=false;action();}};
   Controls.AddRange(new Control[]{heading,phase,meter,percent,details,close,open});FormClosing+=delegate(object sender,FormClosingEventArgs e){if(!terminal)e.Cancel=true;};
  }
  Button MakeButton(string text,int x){return new Button{Text=text,Location=new Point(x,331),Size=new Size(120,35),FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(66,42,46),ForeColor=Color.FromArgb(250,225,210)};}
  public void Publish(State state,bool done,Action action){if(IsDisposed)return;if(InvokeRequired){try{BeginInvoke(new Action(delegate{Publish(state,done,action);}));}catch(InvalidOperationException){}return;}terminal=done;reopen=action;meter.Value=state.progress;meter.Invalidate();percent.Text=state.progress.HasValue?Math.Round(state.progress.Value*100)+"%"+(state.totalBytes.HasValue?"  ·  "+FormatBytes(state.doneBytes.Value)+" / "+FormatBytes(state.totalBytes.Value):""):"";
   switch(state.phase){
    case "validating":phase.Text=TextFor("Güncelleme denetleniyor…","Checking the update…");break;
    case "verifying":phase.Text=TextFor("Paket doğrulanıyor…","Verifying the package…");break;
    case "extracting":phase.Text=TextFor("Dosyalar hazırlanıyor…","Preparing the files…");break;
    case "waiting-exit":phase.Text=TextFor("Ember'ın kapanması bekleniyor…","Waiting for Ember to close…");break;
    case "replacing":phase.Text=TextFor("Uygulama dosyaları değiştiriliyor…","Replacing application files…");break;
    case "launching":phase.Text=TextFor("Yeni Ember başlatılıyor…","Starting the updated Ember…");break;
    case "starting-buffer":phase.Text=TextFor("Tampon başlatılıyor…","Starting the recording buffer…");break;
    case "rolling-back":phase.Text=TextFor("Önceki sürüm geri yükleniyor…","Restoring the previous version…");break;
   }
   if(done){close.Enabled=true;close.Visible=true;open.Enabled=action!=null;open.Visible=action!=null;if(state.status=="installed"){
     bool bufferWarning=state.bufferRunning==false,reportWarning=!String.IsNullOrEmpty(state.error),warning=bufferWarning||reportWarning;heading.Text=warning?TextFor("Ember güncellendi — uyarı","Ember updated — warning"):TextFor("Ember güncellendi","Ember updated");phase.Text=bufferWarning?TextFor("Tampon başlatılamadı.","The recording buffer could not start."):reportWarning?TextFor("Güncelleme sonucu kaydedilemedi.","The update result could not be saved."):TextFor("Ember hazır.","Ember is ready.");details.Text=reportWarning?state.error:bufferWarning?(state.bufferError??TextFor("Ember'da kayıt ayarlarını denetleyin.","Check the recording settings in Ember.")):TextFor("Güncelleme tamamlandı. Ember açılıyor.","The update is complete. Ember is opening.");
     if(!warning){finishedTimer=new System.Windows.Forms.Timer{Interval=1200};finishedTimer.Tick+=delegate{finishedTimer.Stop();Close();};finishedTimer.Start();}
    }else{heading.Text=TextFor("Güncelleme tamamlanamadı","The update could not finish");phase.Text=state.status=="rolled-back"?TextFor("Önceki sürüm geri yüklendi.","The previous version was restored."):state.status=="recovery-required"?TextFor("Kurtarma gerekiyor. Yedek korundu.","Recovery is required. The backup was retained."):TextFor("Mevcut sürüm korundu.","The existing version was kept.");details.Text=(state.error??"")+Environment.NewLine+Environment.NewLine+(state.logPath==null?"":TextFor("Günlük: ","Log: ")+state.logPath);percent.Text="";}
   }
   details.ScrollBars=TextRenderer.MeasureText(details.Text,details.Font,new Size(details.Width-4,Int32.MaxValue),TextFormatFlags.WordBreak|TextFormatFlags.TextBoxControl).Height>details.Height-4?ScrollBars.Vertical:ScrollBars.None;
  }
  static string FormatBytes(long bytes){return (bytes/1048576d).ToString("0.0")+" MB";}
  protected override void Dispose(bool disposing){if(disposing&&finishedTimer!=null)finishedTimer.Dispose();base.Dispose(disposing);}
 }
 [STAThread]static int Main(string[] args){
  // Windows inherits the caller's directory handle. Release it before any tree rename.
  Environment.CurrentDirectory=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
  try{Console.OutputEncoding=Utf8;}catch{}try{Console.SetOut(new StreamWriter(Console.OpenStandardOutput(),Utf8){AutoFlush=true});}catch{}
  Job job=null;string file=null;
  try{if(args.Length!=2||args[0]!="--job")throw new Exception("Expected --job <absolute job path>.");file=Full(args[1]);NoReparse(file);if(new FileInfo(file).Length>65536)throw new Exception("Update job is too large.");job=Json.Deserialize<Job>(File.ReadAllText(file));}
  catch(Exception error){Console.WriteLine(Json.Serialize(new State{status="rejected",phase="failed",error=error.Message,updatedAtUtc=DateTime.UtcNow.ToString("o")}));return 1;}
  if(job!=null&&!job.showProgress)return Install(job,file,null);
  Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);int result=1;
  using(var window=new ProgressWindow(job)){window.Shown+=delegate{Thread worker=new Thread(delegate(){result=Install(job,file,window);});worker.IsBackground=true;worker.Start();};Application.Run(window);}return result;
 }
}
