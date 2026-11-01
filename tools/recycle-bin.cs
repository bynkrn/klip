using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

class RecycleBinHelper {
 public class Request {public string action{get;set;}public string[] roots{get;set;}public string[] files{get;set;}public string physicalPath{get;set;}public string originalPath{get;set;}}
 public class Entry {public string physicalPath;public string originalPath;public string fileName;public string deletedAt;public long size;}
 static bool Allowed(string original,Request request){
  string full=Path.GetFullPath(original);
  foreach(string root in request.roots??new string[0])if(full.StartsWith(Path.GetFullPath(root).TrimEnd('\\','/')+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))return true;
  foreach(string file in request.files??new string[0])if(String.Equals(full,Path.GetFullPath(file),StringComparison.OrdinalIgnoreCase))return true;
  return false;
 }
 static Entry Read(dynamic item,Request request){
  if((bool)item.IsFolder)return null;
  string physical=Path.GetFullPath((string)item.Path);
  if(physical.IndexOf("\\$Recycle.Bin\\",StringComparison.OrdinalIgnoreCase)<0||!File.Exists(physical))return null;
  string from=Convert.ToString(item.ExtendedProperty("System.Recycle.DeletedFrom"));
  string name=Convert.ToString(item.ExtendedProperty("System.FileName"));
  if(String.IsNullOrEmpty(from))return null;if(String.IsNullOrEmpty(name))name=(string)item.Name;
  string ext=Path.GetExtension(physical);if(!name.EndsWith(ext,StringComparison.OrdinalIgnoreCase))name+=ext;
  string original=Path.GetFullPath(Path.Combine(from,Path.GetFileName(name)));
  if(!Allowed(original,request)||Array.IndexOf(new[]{".mp4",".mkv",".mov",".webm"},Path.GetExtension(original).ToLowerInvariant())<0)return null;
  object stamp=item.ExtendedProperty("System.Recycle.DateDeleted");DateTime date=stamp is DateTime?(DateTime)stamp:File.GetLastWriteTimeUtc(physical);
  if(date.Kind==DateTimeKind.Unspecified)date=DateTime.SpecifyKind(date,DateTimeKind.Utc);
  return new Entry{physicalPath=physical,originalPath=original,fileName=Path.GetFileName(original),deletedAt=date.ToUniversalTime().ToString("o"),size=new FileInfo(physical).Length};
 }
 [STAThread]static int Main(){
  Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);var json=new JavaScriptSerializer();json.MaxJsonLength=8*1024*1024;
  try{
   var request=json.Deserialize<Request>(Console.In.ReadToEnd());if(request==null)throw new Exception("Geçersiz istek.");
   dynamic shell=Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
   if(request.action=="open"){shell.Explore(10);Console.WriteLine(json.Serialize(new{data=true}));return 0;}
   dynamic folder=shell.NameSpace(10);if(folder==null)throw new Exception("Windows Çöp Kutusu açılamadı.");
   var entries=new List<Entry>();dynamic restoreItem=null;Entry restoreEntry=null;
   foreach(dynamic item in folder.Items()){
    try{Entry entry=Read(item,request);if(entry==null)continue;entries.Add(entry);if(request.action=="restore"&&String.Equals(entry.physicalPath,request.physicalPath,StringComparison.OrdinalIgnoreCase)&&String.Equals(entry.originalPath,request.originalPath,StringComparison.OrdinalIgnoreCase)){restoreItem=item;restoreEntry=entry;}}catch{}
   }
   if(request.action=="list"){Console.WriteLine(json.Serialize(new{data=entries}));return 0;}
   if(request.action!="restore")throw new Exception("Bilinmeyen Çöp Kutusu işlemi.");
   if(restoreEntry==null)throw new Exception("Klip artık Çöp Kutusu’nda bulunamadı.");
   if(File.Exists(restoreEntry.originalPath)||Directory.Exists(restoreEntry.originalPath))throw new Exception("Aynı adlı bir dosya zaten var. Mevcut dosya değiştirilmedi.");
   Directory.CreateDirectory(Path.GetDirectoryName(restoreEntry.originalPath));
   restoreItem.InvokeVerb("undelete");
   for(int i=0;i<100;i++){if(File.Exists(restoreEntry.originalPath)&&!File.Exists(restoreEntry.physicalPath)){Console.WriteLine(json.Serialize(new{data=new{file=restoreEntry.originalPath}}));return 0;}Thread.Sleep(50);}
   throw new Exception("Windows geri yüklemeyi tamamlamadı. Listeyi yenileyip yeniden dene.");
  }catch(Exception error){Console.WriteLine(json.Serialize(new{error=error.Message}));return 0;}
 }
}
