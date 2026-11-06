const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process'),{EventEmitter}=require('node:events');
const REQUEST='kurgu-project-import',RESULT='kurgu-project-import-result',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(code,message){return Object.assign(new Error(message),{code});}
function projectName(value){if(typeof value!=='string'||!value.trim()||value.trim().length>200||/[\x00-\x1f]/.test(value))throw failure('INVALID_PROJECT_NAME','1–200 karakter arasında bir proje adı gir.');return value.trim();}
function contentKey(request){return JSON.stringify([request.projectName,request.files,request.copyMedia]);}
async function validateEditorExecutable(file){
 if(typeof file!=='string'||!file||!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.exe')throw failure('EDITOR_NOT_CONFIGURED','Önce video editörünün EXE dosyasını seç.');
 const stat=await fs.stat(file).catch(()=>null);if(!stat?.isFile()||!stat.size)throw failure('EDITOR_NOT_FOUND','Video editörü bulunamadı. Ayarlar’dan EXE dosyasını yeniden seç.');return file;
}
function validRequest(request,id){return request?.schema===REQUEST&&request.version===1&&request.requestId===id&&UUID.test(id)&&typeof request.projectName==='string'&&request.projectName.length>0&&request.projectName.length<=200&&Array.isArray(request.files)&&request.files.length>0&&request.files.every(file=>typeof file==='string'&&path.isAbsolute(file))&&typeof request.copyMedia==='boolean';}
function validResult(result,id){
 if(result?.schema!==RESULT||result.version!==1||result.requestId!==id)return false;
 if(result.status==='completed')return typeof result.projectPath==='string'&&path.isAbsolute(result.projectPath);
 if(result.status==='cancelled')return true;
 return result.status==='error'&&typeof result.error?.code==='string'&&result.error.code.length>0&&typeof result.error?.message==='string';
}
async function atomicRequest(file,request){
 const temp=file+'.'+crypto.randomUUID()+'.tmp';let handle;
 try{handle=await fs.open(temp,'wx',0o600);await handle.writeFile(JSON.stringify(request,null,2)+'\n','utf8');await handle.sync();await handle.close();handle=null;await fs.rename(temp,file);}
 finally{if(handle)await handle.close().catch(()=>{});await fs.unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
class ProjectTransfer extends EventEmitter{
 constructor({directory,resolveClip,getEditor,probe,spawn:launch=spawn,now=Date.now}){
  super();this.directory=directory;this.resolveClip=resolveClip;this.getEditor=getEditor;this.probe=probe;this.spawn=launch;this.now=now;this.jobs=new Map();this.byContent=new Map();this.prepareTail=Promise.resolve();this.closed=false;
 }
 initialize(){
  if(this.initializing)return this.initializing;
  return this.initializing=(async()=>{
   await fs.mkdir(this.directory,{recursive:true});
   for(const name of (await fs.readdir(this.directory)).sort()){
    const id=name.endsWith('.json')?name.slice(0,-5):'';if(!UUID.test(id))continue;
    try{const file=path.join(this.directory,name),stat=await fs.stat(file);if(!stat.isFile()||stat.size>16*1024*1024)continue;const request=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\ufeff/,''));if(!validRequest(request,id))continue;this.remember(request,file,stat.mtimeMs);}catch{}
   }
   await this.poll();this.changed();if(!this.closed){this.timer=setInterval(()=>this.poll().catch(()=>{}),1000);this.timer.unref?.();}return this.list();
  })();
 }
 remember(request,requestPath,createdAt=this.now()){
  const job={request,requestPath,resultPath:requestPath.slice(0,-5)+'.result.json',createdAt,status:'waiting',terminal:false,attempts:0,revision:0};this.jobs.set(request.requestId,job);this.byContent.set(contentKey(request),request.requestId);return job;
 }
 get(id){const job=this.jobs.get(id);if(!job)return null;return{requestId:id,projectName:job.request.projectName,files:[...job.request.files],copyMedia:job.request.copyMedia,requestPath:job.requestPath,resultPath:job.resultPath,createdAt:job.createdAt,status:job.status,attempts:job.attempts,revision:job.revision,resultReceived:job.terminal,...job.projectPath?{projectPath:job.projectPath}:{},...job.error?{error:{...job.error}}:{},...job.warning?{warning:job.warning}:{}};}
 list(){return [...this.jobs.values()].sort((a,b)=>b.createdAt-a.createdAt).slice(0,30).map(job=>this.get(job.request.requestId));}
 changed(){if(!this.closed)this.emit('change',this.list());}
 create(input){
  const work=this.prepareTail.then(()=>this.prepare(input));this.prepareTail=work.catch(()=>{});return work;
 }
 async prepare({ids,projectName:name,copyMedia}={}){
  if(this.closed)throw failure('SENDER_CLOSED','Aktarım servisi kapandı.');await this.initialize();
  name=projectName(name);if(typeof copyMedia!=='boolean'||!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id))throw failure('INVALID_SELECTION','Aktarmak için kullanılabilir bir klip seç.');
  await validateEditorExecutable(this.getEditor());const files=[];
  for(const id of new Set(ids)){const clip=this.resolveClip(id);if(!clip||clip.pending||clip.ready===false)throw failure('CLIP_NOT_READY','Seçilen klip henüz hazır değil veya artık bulunamıyor.');if(!files.includes(clip.file))files.push(clip.file);}
  await this.validateFiles(files);
  const data={projectName:name,files,copyMedia},previous=this.byContent.get(contentKey(data));
  if(previous)return this.get(previous);
  const request={schema:REQUEST,version:1,requestId:crypto.randomUUID(),...data},requestPath=path.join(this.directory,request.requestId+'.json');
  await atomicRequest(requestPath,request);const job=this.remember(request,requestPath);this.changed();await this.launch(job);return this.get(request.requestId);
 }
 async validateFiles(files){
  for(const file of files){
   if(typeof file!=='string'||!path.isAbsolute(file)||!['.mp4','.mkv','.mov','.webm'].includes(path.extname(file).toLowerCase())||path.basename(file).startsWith('.'))throw failure('CLIP_NOT_READY','Yalnızca tamamlanmış video klipleri aktarılabilir.');
   const before=await fs.stat(file).catch(()=>null);if(!before?.isFile()||!before.size)throw failure('SOURCE_MISSING','Kaynak klip bulunamadı veya boş: '+path.basename(file));
   let media;try{media=await this.probe(file);}catch{throw failure('CLIP_NOT_READY','Klip okunamadı: '+path.basename(file));}
   const video=media?.streams?.find(stream=>stream.codec_type==='video'),after=await fs.stat(file).catch(()=>null);
   if(!video?.width||!video.height||!Number.isFinite(Number(media?.format?.duration))||!(Number(media.format.duration)>0)||!after||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw failure('CLIP_NOT_READY','Klip henüz tamamlanmamış veya değişiyor: '+path.basename(file));
  }
 }
 async retry(id){
  if(this.closed)throw failure('SENDER_CLOSED','Aktarım servisi kapandı.');await this.initialize();const job=this.jobs.get(id);if(!job)throw failure('REQUEST_NOT_FOUND','Aktarım isteği bulunamadı.');await this.poll();if(job.terminal&&job.status!=='error')return this.get(id);
  if(job.launching){await job.launching;return this.get(id);}
  await validateEditorExecutable(this.getEditor());await this.validateFiles(job.request.files);
  if(job.terminal&&job.status!=='error')return this.get(id);
  if(job.terminal){job.resendBaseline=job.resultSignature;job.terminal=false;}
  await this.launch(job);return this.get(id);
 }
 async launch(job){
  if(job.terminal)return;if(job.launching)return job.launching;
  return job.launching=(async()=>{
   const editor=await validateEditorExecutable(this.getEditor());
   const stored=JSON.parse((await fs.readFile(job.requestPath,'utf8')).replace(/^\ufeff/,''));if(JSON.stringify(stored)!==JSON.stringify(job.request))throw failure('REQUEST_CHANGED','Aktarım isteği diskte değişmiş; yeni bir aktarım oluştur.');
   if(job.terminal)return;if(this.closed)throw failure('SENDER_CLOSED','Aktarım servisi kapandı.');
   job.status='waiting';delete job.error;delete job.warning;job.attempts++;job.revision++;this.changed();
   await new Promise(resolve=>{
    let child;const failed=error=>{if(!job.terminal){job.status='error';job.error={code:'EDITOR_START_FAILED',message:'Editör başlatılamadı: '+error.message};job.revision++;this.changed();}resolve();};
    try{child=this.spawn(editor,['--import-project',job.requestPath],{shell:false,detached:true,stdio:'ignore',windowsHide:false,cwd:path.dirname(editor)});}catch(error){failed(error);return;}
    child.once('error',failed);child.once('spawn',()=>{child.unref?.();resolve();});
    // Exiting may only mean the launcher forwarded arguments to an existing
    // editor window. Only a matching result file acknowledges the import.
   });
  })().finally(()=>{job.launching=null;});
 }
 poll(){
  if(this.polling)return this.polling;
  return this.polling=(async()=>{
   let changed=false;
   for(const job of this.jobs.values()){
    if(job.terminal||this.closed)continue;
    try{
     const stat=await fs.stat(job.resultPath);if(!stat.isFile()||stat.size>65536)throw Error('Invalid result size');const signature=[stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');if(signature===job.resendBaseline)continue;
     const result=JSON.parse((await fs.readFile(job.resultPath,'utf8')).replace(/^\ufeff/,''));if(!validResult(result,job.request.requestId))throw Error('Invalid result contract');
     job.terminal=true;job.status=result.status;job.resultSignature=signature;delete job.resendBaseline;delete job.warning;delete job.error;if(result.status==='error')job.error={...result.error};if(result.status==='completed')job.projectPath=result.projectPath;job.revision++;changed=true;
    }catch(error){if(error.code!=='ENOENT'){const warning='Sonuç dosyası doğrulanamadı. Geçerli editör yanıtı bekleniyor.';if(job.warning!==warning){job.warning=warning;job.revision++;changed=true;}}}
   }
   if(changed)this.changed();
  })().finally(()=>{this.polling=null;});
 }
 close(){this.closed=true;clearInterval(this.timer);}
}
module.exports={ProjectTransfer,validateEditorExecutable};
