const {app,BrowserWindow,protocol,shell}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFile}=require('node:child_process');
const {WindowsTrash}=require('../src/windows-trash'),{TrashMedia}=require('../src/trash-media'),{fileResponse}=require('../src/media');
app.setName('Klip Trash Media Test');app.setPath('userData',path.join(os.tmpdir(),'klip-trash-media-runtime-'+process.pid));app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{scheme:'klipmedia',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
const run=(name,args)=>new Promise((resolve,reject)=>execFile(path.resolve(__dirname,'../tools',name+'.exe'),args,{windowsHide:true,timeout:20000,maxBuffer:1024*1024},(error,out)=>error?reject(error):resolve(out.toString())));
const digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
app.whenReady().then(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'klip-trash-playback-')),file=path.join(dir,'Kendi önizleme testim.mp4'),assets=new Map(),responses=[];let window,service,entry;
 const timeout=setTimeout(()=>{console.error('Native media test timed out');app.exit(1);},45000);
 try{
  const original=await fs.readFile(path.resolve(__dirname,'capture-results/native-wgc-2026-11-01T19-02-32-913Z.mp4'));await fs.writeFile(file,original);
  service=new WindowsTrash({historyFile:path.join(dir,'history.json'),root:()=>dir,helper:path.resolve(__dirname,'../tools/recycle-bin.exe')});await service.addRoot(dir);await shell.trashItem(file);
  const rows=await service.list();assert.equal(rows.length,1);entry=rows[0];
  const media=new TrashMedia({trash:service,cacheDir:path.join(dir,'cache'),run,probe:async file=>JSON.parse(await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file])),asset:value=>{const id=crypto.randomUUID();assets.set(id,value);return 'klipmedia://local/'+id;},revoke:url=>assets.delete(new URL(url).pathname.slice(1))});
  protocol.handle('klipmedia',async request=>{try{const value=assets.get(new URL(request.url).pathname.slice(1)),file=typeof value==='function'?await value():value;if(!file)return new Response(null,{status:404});const response=await fileResponse(file,request);responses.push({status:response.status,type:response.headers.get('content-type'),range:response.headers.get('content-range')});return response;}catch{return new Response(null,{status:404});}});
  window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});await window.loadURL('data:text/html,<body><img id="thumb"><video id="video" controls muted></video>');
  const [listed]=media.entries(rows);await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const image=document.getElementById('thumb');image.onload=()=>resolve(image.naturalWidth);image.onerror=()=>reject(new Error('Thumbnail failed'));image.src=${JSON.stringify(listed.thumbnail)};})`).then(width=>assert.equal(width,320));
  const preview=await media.preview(entry.id);assert(preview.seconds>1);
  const watched=await window.webContents.executeJavaScript(`(async()=>{const v=document.getElementById('video');await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=()=>reject(new Error('Video decode failed'));v.src=${JSON.stringify(preview.videoUrl)};v.load();});await v.play();const target=v.duration*.65;await new Promise((resolve,reject)=>{v.onseeked=resolve;v.currentTime=target;setTimeout(()=>reject(new Error('Seek timed out')),5000);});return{width:v.videoWidth,height:v.videoHeight,seek:v.currentTime,target,ready:v.readyState};})()`);
  assert.equal(watched.width,1920);assert.equal(watched.height,1080);assert(Math.abs(watched.seek-watched.target)<.15);assert(watched.ready>=2);
  const physical=(await service.resolve(entry.id)).physicalPath;assert.equal(digest(await fs.readFile(physical)),digest(original));
  await window.webContents.executeJavaScript(`(()=>{const v=document.getElementById('video');v.pause();v.removeAttribute('src');v.removeAttribute('poster');v.load();document.getElementById('thumb').removeAttribute('src');})()`);
  const result=await media.restore([entry.id]);assert.equal(result.restored.length,1,JSON.stringify(result));assert.equal(digest(await fs.readFile(file)),digest(original));assert.equal((await service.list()).length,0);assert(responses.some(r=>r.type==='image/jpeg'&&r.status===200));assert(responses.some(r=>r.type==='video/mp4'&&r.status===206&&r.range));
  console.log(JSON.stringify({thumbnail:true,readOnlyPlayback:true,seek:true,range206:true,restoreAfterWatching:true,originalBytesUnchanged:true,dimensions:watched.width+'x'+watched.height}));
 }catch(error){console.error(error);process.exitCode=1;}finally{
  clearTimeout(timeout);if(window&&!window.isDestroyed())window.destroy();
  if(service&&entry)try{if((await service.list()).some(row=>row.id===entry.id))await service.restore([entry.id]);}catch{}
  assert(path.resolve(dir).startsWith(path.join(os.tmpdir(),'klip-trash-playback-')));await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});app.quit();
 }
}).catch(error=>{console.error(error);app.exit(1);});
