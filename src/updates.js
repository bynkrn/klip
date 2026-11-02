const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{EventEmitter}=require('node:events'),{spawn}=require('node:child_process'),{Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const stable=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function version(value){if(typeof value!=='string'||!stable.test(value)||value.split('.').some(n=>!Number.isSafeInteger(Number(n))))throw new Error('Yalnızca kararlı sürümler desteklenir.');return value.split('.').map(Number);}
function compare(a,b){const x=version(a),y=version(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]<y[i]?-1:1;return 0;}
function healthAckPath(cacheDir,nonce){if(typeof nonce!=='string'||!/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(nonce))throw new Error('Geçersiz güncelleme sağlık anahtarı.');return path.join(cacheDir,'health-'+nonce+'.json');}
function inside(file,root){const rel=path.relative(path.resolve(root),path.resolve(file));return rel===''||rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);}
async function digest(file){const hash=crypto.createHash('sha256');let size=0;for await(const chunk of sync.createReadStream(file)){hash.update(chunk);size+=chunk.length;}return{sha256:hash.digest('hex'),size};}
function safeError(error){const text=String(error?.message||error);return text.replace(/(?:gh[opusr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|Bearer\s+\S+)/gi,'[gizlendi]').slice(0,1500);}
class GhTransport{
 constructor(executable){this.executable=executable;}
 command(args,{timeout=60000}={}){
  const env={...process.env,GH_HOST:'github.com',GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1',GH_NO_EXTENSION_UPDATE_NOTIFIER:'1',GH_PAGER:'cat',CLICOLOR:'0'};delete env.GH_DEBUG;
  const child=spawn(this.executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env});let stderr='';const timer=setTimeout(()=>child.kill(),timeout);timer.unref();
  child.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-16000));
  const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{clearTimeout(timer);if(code===0)return resolve();const auth=code===4||/gh auth login|not logged|authentication|HTTP 401|bad credentials/i.test(stderr);const error=new Error(auth?'GitHub oturumu gerekli.':'GitHub isteği tamamlanamadı. '+safeError({message:stderr}));const status=/\bHTTP\s+(\d{3})\b/i.exec(stderr);if(status)error.httpStatus=Number(status[1]);if(auth)error.code='AUTH_REQUIRED';reject(error);});});completed.catch(()=>{});return{child,completed};
 }
 async collect(args,limit){const {child,completed}=this.command(args);let length=0;const chunks=[];try{for await(const chunk of child.stdout){length+=chunk.length;if(length>limit)throw new Error('GitHub yanıtı beklenen boyutu aştı.');chunks.push(chunk);}await completed;return Buffer.concat(chunks);}catch(error){child.kill();await completed.catch(()=>{});throw error;}}
 async json(endpoint){return JSON.parse((await this.collect(['api',endpoint,'--hostname','github.com'],2*1024*1024)).toString('utf8'));}
 bytes(endpoint,limit=65536){return this.collect(['api',endpoint,'--hostname','github.com','-H','Accept: application/octet-stream'],limit);}
 async stream(endpoint){const {child,completed}=this.command(['api',endpoint,'--hostname','github.com','-H','Accept: application/octet-stream'],{timeout:30*60*1000});const source=child.stdout;return(async function*(){try{for await(const chunk of source)yield chunk;await completed;}finally{if(child.exitCode===null)child.kill();await completed.catch(()=>{});}})();}
 async login(onCode){
  const {child,completed}=this.command(['auth','login','--hostname','github.com','--git-protocol','https','--web','--skip-ssh-key'],{timeout:10*60*1000});let output='';const consume=chunk=>{output=(output+chunk.toString()).slice(-16000);const match=/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/.exec(output);if(match)onCode({loginCode:match[1],loginUrl:'https://github.com/login/device'});};child.stdout.on('data',consume);child.stderr.on('data',consume);await completed;
 }
}
class PublicGitHub{
 constructor({fetch=globalThis.fetch}={}){if(typeof fetch!=='function')throw new Error('GitHub bağlantısı kullanılamıyor.');this.fetch=fetch;}
 async request(endpoint,{accept='application/vnd.github+json',timeout=60000}={}){
  if(typeof endpoint!=='string'||!/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/releases\/(?:latest|assets\/[1-9]\d*))?$/.test(endpoint))throw new Error('Geçersiz GitHub istek adresi.');
  let url=new URL('https://api.github.com/'+endpoint);if(url.pathname!=='/'+endpoint)throw new Error('Geçersiz GitHub depo adresi.');
  const asset=accept==='application/octet-stream',hosts=new Set(asset?['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']:['api.github.com']);
  const signal=AbortSignal.timeout(timeout),headers={'Accept':accept,'User-Agent':'Ember-Updater','X-GitHub-Api-Version':'2022-11-28'};
  for(let redirects=0;redirects<=5;redirects++){
   if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.has(url.hostname)||(url.hostname==='github.com'&&!url.pathname.includes('/releases/download/')))throw new Error('Güncelleme yalnız güvenilir GitHub HTTPS adreslerinden indirilebilir.');
   let response;try{response=await this.fetch(url.href,{method:'GET',headers,redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',signal});}catch{throw new Error('GitHub bağlantısı kurulamadı.');}
   if([301,302,303,307,308].includes(response.status)){
    const location=response.headers.get('location');await response.body?.cancel().catch(()=>{});
    if(!location||redirects===5)throw new Error('GitHub yönlendirme sınırı aşıldı.');
    try{url=new URL(location,url);}catch{throw new Error('Geçersiz GitHub yönlendirme adresi.');}continue;
   }
   if(!response.ok){await response.body?.cancel().catch(()=>{});const error=new Error('GitHub isteği tamamlanamadı (HTTP '+response.status+').');error.httpStatus=response.status;throw error;}
   if(!response.body)throw new Error('GitHub yanıtı boş.');return response;
  }
 }
 async collect(endpoint,limit,accept){
  const response=await this.request(endpoint,{accept});const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>limit){await response.body.cancel().catch(()=>{});throw new Error('GitHub yanıtı beklenen boyutu aştı.');}
  let size=0;const chunks=[];for await(const value of response.body){const chunk=Buffer.from(value);size+=chunk.length;if(size>limit)throw new Error('GitHub yanıtı beklenen boyutu aştı.');chunks.push(chunk);}return Buffer.concat(chunks,size);
 }
 async json(endpoint){return JSON.parse((await this.collect(endpoint,2*1024*1024,'application/vnd.github+json')).toString('utf8'));}
 bytes(endpoint,limit=65536){return this.collect(endpoint,limit,'application/octet-stream');}
 async stream(endpoint){return(await this.request(endpoint,{accept:'application/octet-stream',timeout:30*60*1000})).body;}
}
class Updates extends EventEmitter{
 constructor(options){super();Object.assign(this,options);version(this.currentVersion);if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(this.repo||''))throw new Error('Geçersiz güncelleme deposu.');this.transport=options.transport||(this.mode==='public'?new PublicGitHub({fetch:options.fetch}):new GhTransport(this.ghPath));this.value={status:'idle',currentVersion:this.currentVersion,latestVersion:'',progress:0,checkedAt:null,notes:'',error:'',offer:false,noPublishedRelease:false,message:'',publicUpdates:this.mode==='public'||this.transport instanceof PublicGitHub};}
 state(){return{...this.value};}
 update(values){Object.assign(this.value,values);const state=this.state();this.emit('state',state);return state;}
 failure(error){return this.update({status:error.code==='AUTH_REQUIRED'?'auth-required':'error',error:safeError(error),offer:false});}
 check(options={}){
  if(this.checking)return this.checking;if(this.downloading)return this.downloading;if(this.value.status==='installing')return Promise.resolve(this.state());
  const work=this.performCheck(options).finally(()=>{this.checking=null;});this.checking=work;return work;
 }
 async performCheck({source='manual'}={}){
  const old=this.release,previous=this.state(),oldArchive=this.archivePath;this.update({status:'checking',error:'',offer:false,loginCode:'',loginUrl:'',noPublishedRelease:false,message:''});
  try{
   let release;try{release=await this.transport.json('repos/'+this.repo+'/releases/latest');}catch(error){if(error.httpStatus!==404)throw error;const repository=await this.transport.json('repos/'+this.repo);if(typeof repository?.full_name!=='string'||repository.full_name.toLowerCase()!==this.repo.toLowerCase())throw new Error('Güncelleme deposuna erişim doğrulanamadı.');this.release=null;this.archivePath=null;return this.update({status:'current',latestVersion:this.currentVersion,progress:0,checkedAt:new Date().toISOString(),notes:'',error:'',offer:false,noPublishedRelease:true,message:'Henüz yayımlanmış bir güncelleme yok.'});}
   if(release.draft||release.prerelease)throw new Error('Kararlı bir yayın bulunamadı.');const tag=String(release.tag_name||'').replace(/^v/,'');version(tag);const order=compare(tag,this.currentVersion);if(order<0)throw new Error('Eski sürüme geçiş reddedildi.');
   if(order===0){this.release=null;this.archivePath=null;return this.update({status:'current',latestVersion:tag,progress:0,checkedAt:new Date().toISOString(),notes:'',offer:false});}
   const assets=release.assets;if(!Array.isArray(assets))throw new Error('Güncelleme dosyaları bulunamadı.');const asset=name=>{const found=assets.filter(a=>a.name===name);if(found.length!==1||!Number.isSafeInteger(found[0].id)||found[0].id<=0)throw new Error('Güncelleme dosyası eksik: '+name);return found[0];};
   const manifestAsset=asset('ember-update.json'),signatureAsset=asset('ember-update.sig');if(manifestAsset.size>65536||signatureAsset.size>4096)throw new Error('İmzalı sürüm bilgisi çok büyük.');const endpoint=id=>'repos/'+this.repo+'/releases/assets/'+id;
   const [bytes,signature]=await Promise.all([this.transport.bytes(endpoint(manifestAsset.id),65536),this.transport.bytes(endpoint(signatureAsset.id),4096)]);if(bytes.length>65536||signature.length>4096)throw new Error('İmzalı sürüm bilgisi çok büyük.');const encoded=signature.toString('utf8').trim();if(!/^[A-Za-z0-9+/]{86}==$/.test(encoded))throw new Error('Güncelleme imzası geçersiz.');const key=crypto.createPublicKey(this.publicKey);if(key.asymmetricKeyType!=='ed25519'||!crypto.verify(null,bytes,key,Buffer.from(encoded,'base64')))throw new Error('Güncelleme imzası doğrulanamadı.');
   const manifest=JSON.parse(bytes.toString('utf8'));version(manifest.version);if(manifest.version!==tag||manifest.platform!=='win32'||manifest.arch!=='x64'||manifest.fileName!=='Ember-v'+tag+'-win32-x64.zip'||!Number.isSafeInteger(manifest.size)||manifest.size<=0||manifest.size>8*1024**3||typeof manifest.sha256!=='string'||!/^[a-f0-9]{64}$/.test(manifest.sha256))throw new Error('İmzalı güncelleme bilgileri geçersiz.');const archive=asset(manifest.fileName);if(archive.size!==manifest.size)throw new Error('Güncelleme boyutu imzayla eşleşmiyor.');
   const retained=old&&old.manifest.sha256===manifest.sha256&&old.manifest.version===tag&&this.archivePath&&this.value.progress===1;this.release={manifest,endpoint:endpoint(archive.id)};if(!retained)this.archivePath=null;
   return this.update({status:retained?'ready':'available',latestVersion:tag,progress:retained?1:0,checkedAt:new Date().toISOString(),notes:String(release.body||'').slice(0,20000),offer:source==='startup'});
  }catch(error){if(old&&oldArchive&&previous.status==='ready'){this.release=old;this.archivePath=oldArchive;return this.update({...previous,status:'ready',error:safeError(error),offer:false});}this.release=null;this.archivePath=null;return this.failure(error);}
 }
 download(){if(this.value.status==='installing')return Promise.resolve(this.state());if(this.downloading)return this.downloading;if(this.checking)return this.checking.then(()=>this.download());if(!this.release)return Promise.reject(new Error('Önce doğrulanmış bir güncelleme bul.'));if(this.value.status==='ready')return Promise.resolve(this.state());const work=this.performDownload().finally(()=>{this.downloading=null;});this.downloading=work;return work;}
 async performDownload(){
  const release=this.release,{manifest}=release;let part,target;this.update({status:'downloading',progress:0,error:''});
  try{await fs.mkdir(this.cacheDir,{recursive:true});target=path.join(this.cacheDir,manifest.fileName);part=target+'.'+crypto.randomUUID()+'.part';const hash=crypto.createHash('sha256');let size=0,last=0;const meter=new Transform({transform:(chunk,_encoding,done)=>{size+=chunk.length;if(size>manifest.size)return done(new Error('Güncelleme boyutu beklenenden büyük.'));hash.update(chunk);const progress=size/manifest.size;if(progress-last>=.01||size===manifest.size){last=progress;this.update({progress});}done(null,chunk);}});
   await pipeline(await this.transport.stream(release.endpoint),meter,sync.createWriteStream(part,{flags:'wx'}));if(size!==manifest.size||hash.digest('hex')!==manifest.sha256)throw new Error('Güncelleme hash/boyut doğrulaması başarısız.');await fs.rename(part,target);part=null;this.archivePath=target;return this.update({status:'ready',progress:1,error:''});
  }catch(error){if(part)await fs.unlink(part).catch(()=>{});this.archivePath=null;return this.failure(error);}
 }
 login(){if(this.value.status==='installing')return Promise.resolve(this.state());if(this.mode==='public'||this.transport instanceof PublicGitHub)return this.check({source:'manual'});if(this.loggingIn)return this.loggingIn;const work=(async()=>{this.update({status:'auth-required',error:'',loginCode:'',loginUrl:''});try{await this.transport.login(code=>this.update(code));this.update({loginCode:'',loginUrl:''});return await this.check({manual:true,source:'manual'});}catch(error){return this.failure(error);}})().finally(()=>{this.loggingIn=null;});this.loggingIn=work;return work;}
 prepareInstall(options={}){
  if(this.preparing)return this.preparing;
  const previous=this.state();let accept,decline;const shared=new Promise((resolve,reject)=>{accept=resolve;decline=reject;});this.preparing=shared;
  this.performPrepareInstall(options).then(descriptor=>{this.preparing=null;accept(descriptor);},error=>{this.preparing=null;if(this.value.status==='installing')this.update({...previous,error:safeError(error),offer:false});decline(error);});return shared;
 }
 async performPrepareInstall({parentPid,healthTimeoutMs=30000,waitTimeoutMs=60000}={}){
  if(!this.packaged)throw new Error('Geliştirme kopyası üzerine güncelleme kurulamaz; paketlenmiş uygulamayı aç.');if(this.value.status!=='ready'||!this.archivePath||!this.release)throw new Error('Doğrulanmış güncelleme henüz hazır değil.');if(!Number.isInteger(parentPid)||parentPid<=0)throw new Error('Geçersiz uygulama işlemi.');
  const appRoot=path.resolve(this.appRoot),cacheDir=path.resolve(this.cacheDir);if(appRoot===path.parse(appRoot).root||!path.isAbsolute(this.appRoot)||!path.isAbsolute(this.cacheDir)||inside(cacheDir,appRoot)||inside(appRoot,cacheDir))throw new Error('Güvenli uygulama ve güncelleme klasörleri gerekli.');
  this.update({status:'installing',offer:false,error:''});
  const actual=await digest(this.archivePath),manifest=this.release.manifest;if(actual.size!==manifest.size||actual.sha256!==manifest.sha256)throw new Error('Güncelleme hash/boyut doğrulaması başarısız.');
  const operationDir=path.join(cacheDir,'install-'+crypto.randomBytes(16).toString('hex'));await fs.mkdir(operationDir,{recursive:true});const helperPath=path.join(operationDir,'update-install.exe'),jobFile=path.join(operationDir,'job.json');await fs.copyFile(this.installerPath,helperPath);
  const job={schema:1,appRoot,cacheDir,archivePath:path.resolve(this.archivePath),sha256:manifest.sha256,size:manifest.size,version:manifest.version,parentPid,healthTimeoutMs,waitTimeoutMs};await fs.writeFile(jobFile,JSON.stringify(job,null,2),{flag:'wx'});this.update({status:'installing',offer:false});return{helperPath,args:['--job',jobFile],jobFile};
 }
}
module.exports={Updates,GhTransport,PublicGitHub,healthAckPath};
