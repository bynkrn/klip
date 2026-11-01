using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

// Runs outside the application tree. Only a verified staged application tree is moved.
// Backups and failed packages are retained: no user library/settings are deleted here.
class UpdateInstaller {
 public class Job {public int schema{get;set;}public string appRoot{get;set;}public string cacheDir{get;set;}public string archivePath{get;set;}public string sha256{get;set;}public string version{get;set;}public long size{get;set;}public int parentPid{get;set;}public int healthTimeoutMs{get;set;}public int waitTimeoutMs{get;set;}}
 class Health {public string nonce{get;set;}public string version{get;set;}public int pid{get;set;}}
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
 const string ArchiveRoot="Klip-win32-x64";
 static string Full(string value){if(String.IsNullOrWhiteSpace(value)||!Regex.IsMatch(value,@"^[A-Za-z]:[\\/]"))throw new Exception("An absolute local drive path is required.");string full=Path.GetFullPath(value).TrimEnd('\\','/');if(full.Length<4||String.Equals(full,Path.GetPathRoot(full).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))throw new Exception("A volume root is not an application directory.");return full;}
 static bool Within(string file,string root){return String.Equals(file,root,StringComparison.OrdinalIgnoreCase)||file.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase);}
 static void NoReparse(string value){for(string current=value;!String.IsNullOrEmpty(current);current=Path.GetDirectoryName(current)){if((File.Exists(current)||Directory.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new Exception("Reparse paths are not allowed.");}}
 static int[] Version(string value){if(value==null||!Regex.IsMatch(value,@"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$"))throw new Exception("Invalid stable version.");string[] parts=value.Split('.');return new[]{Int32.Parse(parts[0]),Int32.Parse(parts[1]),Int32.Parse(parts[2])};}
 static int Compare(string a,string b){int[] x=Version(a),y=Version(b);for(int i=0;i<3;i++)if(x[i]!=y[i])return x[i].CompareTo(y[i]);return 0;}
 static string PackageVersion(string root){string file=Path.Combine(root,"resources","app","package.json");if(!File.Exists(file)||!File.Exists(Path.Combine(root,"Klip.exe")))throw new Exception("A packaged Klip application is required.");var metadata=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));string version=Convert.ToString(metadata["version"]);Version(version);return version;}
 static void Validate(Job job,string jobFile){
  if(job==null||job.schema!=1)throw new Exception("Invalid update job.");job.appRoot=Full(job.appRoot);job.cacheDir=Full(job.cacheDir);job.archivePath=Full(job.archivePath);jobFile=Full(jobFile);
  if(Within(job.appRoot,job.cacheDir)||Within(job.cacheDir,job.appRoot)||!Within(job.archivePath,job.cacheDir)||!Within(jobFile,job.cacheDir)||Within(Full(Assembly.GetExecutingAssembly().Location),job.appRoot))throw new Exception("Application, updater and cache paths must be separate.");
  if(job.parentPid<=0||job.size<=0||job.size>8L*1024*1024*1024||job.sha256==null||!Regex.IsMatch(job.sha256,"^[a-f0-9]{64}$"))throw new Exception("Invalid archive identity.");
  if(job.healthTimeoutMs<250||job.healthTimeoutMs>300000||job.waitTimeoutMs<250||job.waitTimeoutMs>300000)throw new Exception("Invalid timeout.");
  NoReparse(job.appRoot);NoReparse(job.cacheDir);NoReparse(job.archivePath);NoReparse(jobFile);if(Directory.Exists(Path.Combine(job.appRoot,".git")))throw new Exception("Source checkouts cannot be updated.");if(Compare(job.version,PackageVersion(job.appRoot))<=0)throw new Exception("Update must be newer than the installed version.");
 }
 static string NewNonce(){byte[] bytes=new byte[32];using(var random=RandomNumberGenerator.Create())random.GetBytes(bytes);return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();}
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
  Directory.CreateDirectory(staging);
  foreach(ZipArchiveEntry entry in archive.Entries){string relative=entry.FullName.Substring(ArchiveRoot.Length+1);if(relative.Length==0)continue;string destination=Path.Combine(staging,relative.Replace('/',Path.DirectorySeparatorChar));if(entry.FullName.EndsWith("/",StringComparison.Ordinal)){Directory.CreateDirectory(destination);continue;}Directory.CreateDirectory(Path.GetDirectoryName(destination));NoReparse(Path.GetDirectoryName(destination));using(Stream source=entry.Open())using(var output=new FileStream(destination,FileMode.CreateNew,FileAccess.Write,FileShare.None)){source.CopyTo(output);if(output.Length!=entry.Length)throw new Exception("Truncated ZIP entry.");}}
 }
 static void WaitForParent(Job job){Process parent;try{parent=Process.GetProcessById(job.parentPid);}catch(ArgumentException){return;}using(parent){try{if(parent.HasExited)return;string expected=Path.Combine(job.appRoot,"Klip.exe");if(!String.Equals(Path.GetFullPath(parent.MainModule.FileName),expected,StringComparison.OrdinalIgnoreCase))throw new Exception("Parent process is not the installed Klip application.");}catch(InvalidOperationException){return;}if(!parent.WaitForExit(job.waitTimeoutMs))throw new Exception("Application did not exit; installation cancelled.");}}
 static Process Launch(string root,string args){return Process.Start(new ProcessStartInfo{FileName=Path.Combine(root,"Klip.exe"),Arguments=args,WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true});}
 static bool WaitHealth(Job job,string nonce,Process process){string file=Path.Combine(job.cacheDir,"health-"+nonce+".json");Stopwatch timer=Stopwatch.StartNew();while(timer.ElapsedMilliseconds<job.healthTimeoutMs){try{if(File.Exists(file)){var health=Json.Deserialize<Health>(File.ReadAllText(file));if(health!=null&&health.nonce==nonce&&health.version==job.version&&health.pid==process.Id)return true;}}catch{}Thread.Sleep(50);}return false;}
 static void StopLaunched(Process process){if(process==null)return;try{if(!process.HasExited){using(Process killer=Process.Start(new ProcessStartInfo{FileName=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"taskkill.exe"),Arguments="/PID "+process.Id+" /T /F",UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true})){if(killer!=null)killer.WaitForExit(10000);}if(!process.HasExited)process.Kill();process.WaitForExit(10000);}}catch{} }
 static void Move(string source,string target){for(int i=0;;i++){try{Directory.Move(source,target);return;}catch(IOException){if(i>=39)throw;Thread.Sleep(100);}catch(UnauthorizedAccessException){if(i>=39)throw;Thread.Sleep(100);}}}
 static int Install(Job job,string jobFile){
  Validate(job,jobFile);string parent=Path.GetDirectoryName(job.appRoot),leaf=Path.GetFileName(job.appRoot),nonce=NewNonce();string staging=Path.Combine(parent,"."+leaf+"-stage-"+nonce),backup=Path.Combine(parent,"."+leaf+"-backup-"+nonce),failed=Path.Combine(parent,"."+leaf+"-failed-"+nonce);bool oldMoved=false,newMoved=false;Process launched=null;
  try{
   using(var input=new FileStream(job.archivePath,FileMode.Open,FileAccess.Read,FileShare.Read)){if(input.Length!=job.size)throw new Exception("Archive size verification failed.");string hash;using(SHA256 sha=SHA256.Create())hash=BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant();if(hash!=job.sha256)throw new Exception("Archive SHA256 verification failed.");input.Position=0;using(var zip=new ZipArchive(input,ZipArchiveMode.Read,true))Extract(zip,staging);}
   if(PackageVersion(staging)!=job.version)throw new Exception("Staged package version does not match the signed manifest.");
   WaitForParent(job);NoReparse(job.appRoot);NoReparse(parent);Move(job.appRoot,backup);oldMoved=true;Move(staging,job.appRoot);newMoved=true;
   launched=Launch(job.appRoot,"--update-health="+nonce+" --update-version="+job.version);if(launched==null||!WaitHealth(job,nonce,launched))throw new Exception("Updated application did not acknowledge startup.");
   Console.WriteLine(Json.Serialize(new{status="installed",version=job.version,backup=backup}));return 0;
  }catch(Exception error){
   if(oldMoved){StopLaunched(launched);try{if(newMoved&&Directory.Exists(job.appRoot))Move(job.appRoot,failed);if(!Directory.Exists(job.appRoot)&&Directory.Exists(backup))Move(backup,job.appRoot);Launch(job.appRoot,"");Console.WriteLine(Json.Serialize(new{status="rolled-back",error=error.Message}));return 2;}catch(Exception recovery){Console.WriteLine(Json.Serialize(new{status="recovery-required",error=error.Message,recoveryError=recovery.Message,backup=backup}));return 3;}}
   throw;
  }finally{if(launched!=null)launched.Dispose();}
 }
 [STAThread]static int Main(string[] args){try{if(args.Length!=2||args[0]!="--job")throw new Exception("Expected --job <absolute job path>.");string file=Full(args[1]);if(new FileInfo(file).Length>65536)throw new Exception("Update job is too large.");return Install(Json.Deserialize<Job>(File.ReadAllText(file)),file);}catch(Exception error){Console.WriteLine(Json.Serialize(new{status="rejected",error=error.Message}));return 1;}}
}
