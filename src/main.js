const {app,BrowserWindow,ipcMain,dialog,shell,globalShortcut,Tray,Menu,nativeImage,protocol}=require('electron');
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),crypto=require('node:crypto');
const {Capture}=require('./capture'),files=require('./files');
const {fileResponse}=require('./media');
const {trashClips}=require('./library-actions');
const {WindowsTrash}=require('./windows-trash');
const {TrashMedia}=require('./trash-media');
const {EditorAudio,audioOutput}=require('./audio-editor');
const {TimelinePreviews}=require('./timeline');
const {Updates,healthAckPath}=require('./updates');
const {captureSettingsChanged}=require('./settings-policy');
const {translate}=require('./i18n');
const updateConfig=require('./update-config.json');
const {STARTUP_ARG,loginSettings,shouldStartHidden}=require('./startup');
const {isDeepStrictEqual}=require('node:util');
const {AsyncLocalStorage}=require('node:async_hooks');
const updateMediaScope=new AsyncLocalStorage();
app.setName('Klip');app.setPath('userData',path.join(app.getPath('appData'),'Klip'));
if(process.platform==='win32')app.setAppUserModelId('Klip.Local');
protocol.registerSchemesAsPrivileged([{scheme:'klipmedia',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
let win,tray,quitting=false,quitReady=false,busy=false,saving=false,deleting=false,capture,state,timer,updateTimer,updating=false,deviceChanging=false,revealRequested=false;const assets=new Map(),known=new Map(),operations=new Set();
function trackOperation(fn){const pending=Promise.resolve().then(fn);operations.add(pending);const done=()=>operations.delete(pending);pending.then(done,done);return pending;}
const root=path.join(__dirname,'..'),toolDir=path.join(root,'tools'),stateFile=path.join(app.getPath('userData'),'settings.json');
const recycle=new WindowsTrash({historyFile:path.join(app.getPath('userData'),'trash-history.json'),root:()=>state.folder,helper:path.join(toolDir,'recycle-bin.exe')});
const trashMedia=new TrashMedia({trash:recycle,cacheDir:path.join(app.getPath('userData'),'previews'),run,probe,asset,revoke:url=>assets.delete(new URL(url).pathname.slice(1))});
const editorAudio=new EditorAudio({cacheDir:path.join(app.getPath('userData'),'previews'),resolve:id=>known.get(id),run,asset,revoke:url=>assets.delete(new URL(url).pathname.slice(1))});
const timeline=new TimelinePreviews({cacheDir:path.join(app.getPath('userData'),'previews'),resolve:id=>known.get(id),run,asset,revoke:url=>assets.delete(new URL(url).pathname.slice(1))});
const updateCache=path.join(app.getPath('userData'),'updates');
const updates=new Updates({currentVersion:app.getVersion(),...updateConfig,ghPath:path.join(toolDir,'github','gh.exe'),cacheDir:updateCache,appRoot:path.dirname(process.execPath),installerPath:path.join(toolDir,'update-install.exe'),packaged:app.isPackaged});
updates.on('state',update=>status('',{update}));
const defaults={mode:'auto',duration:120,resolution:'1920x1080',fps:'60',customFps:90,codec:'h264',storage:'ram',stretch:true,holdFrame:true,cursor:true,hotkey:'F8',sound:true,launch:false,autoBuffer:false,autoAudio:true,folder:path.join(app.getPath('videos'),'Klip')};
defaults.audioEnabled={};
defaults.targetExe='';
defaults.launchMinimized=false;
defaults.language='tr';
function showMainWindow(){if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}}
if(!app.requestSingleInstanceLock()){app.quit();process.exit(0);}app.on('second-instance',(_event,argv)=>{if(argv.includes(STARTUP_ARG))return;revealRequested=true;showMainWindow();});
function status(message,extra={}){(!win?.isDestroyed()&&!win?.webContents.isDestroyed())&&win?.webContents.send('native-state',{message,running:!!capture?.running,buffered:capture?.running?Math.min(state.duration,Math.floor((Date.now()-capture.started)/1000)):0,...extra});}
function refreshTray(){if(!tray)return;const text=message=>translate(message,state.language);tray.setContextMenu(Menu.buildFromTemplate([{label:text('Klip’i Aç'),click:showMainWindow},{label:text('Klip Al'),click:()=>save().then(clips=>status('Klip kaydedildi',{clips,saved:true})).catch(e=>status(e.message))},{label:text('Çıkış'),click:()=>app.quit()}]));}
async function restartAfterAudioChange(){
 if(deviceChanging||quitting||updating)return;deviceChanging=true;
 try{return await trackOperation(async()=>{
  while(busy||saving||deleting){if(quitting)return;await new Promise(resolve=>setTimeout(resolve,100));}
  if(quitting||!capture.running)return;busy=true;
  try{status('Ses aygıtı değişti; tampon korunuyor…');const clips=await saveClipFile();await capture.stop();busy=false;if(!quitting){await start();status('Ses aygıtı yenilendi; önceki tampon klip olarak korundu.',{clips});}}
  finally{busy=false;}
 });}catch(error){status('Ses aygıtı değişimi tamamlanamadı: '+error.message);}finally{deviceChanging=false;}
}
async function acknowledgeUpdate(){
 const nonce=process.argv.find(arg=>arg.startsWith('--update-health='))?.slice('--update-health='.length),version=process.argv.find(arg=>arg.startsWith('--update-version='))?.slice('--update-version='.length);if(!nonce||version!==app.getVersion())return;
 for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript("document.documentElement.dataset.nativeReady==='true'")){const target=healthAckPath(updateCache,nonce);await fs.mkdir(updateCache,{recursive:true});const temp=target+'.tmp';await fs.writeFile(temp,JSON.stringify({nonce,version:app.getVersion(),pid:process.pid}),{flag:'wx'});await fs.rename(temp,target);return;}await new Promise(resolve=>setTimeout(resolve,100));}
 throw new Error('Güncelleme sonrası arayüz başlatılamadı.');
}
async function assertExternalLibrary(){const appRoot=await fs.realpath(path.dirname(process.execPath)),folder=await fs.realpath(state.folder).catch(()=>path.resolve(state.folder)),relative=path.relative(appRoot,folder);if(relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw new Error('Güncellemeden önce klip klasörünü uygulama klasörünün dışına taşı.');}
async function applyUpdate(){
 if(updating)return updates.state();if(busy||saving||operations.size)throw new Error('Devam eden işlemin bitmesini bekle.');
 updating=true;return trackOperation(async()=>{try{
  await assertExternalLibrary();
  const plan=await updates.prepareInstall({parentPid:process.pid});
  if(capture.running){const clips=await updateMediaScope.run(true,()=>saveClipFile());status('Güncelleme öncesi tampon klip olarak korundu.',{clips});}
  await assertExternalLibrary();await capture.stop();
  await new Promise((resolve,reject)=>{const child=spawn(plan.helperPath,plan.args,{detached:true,windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
  app.quit();return updates.state();
 }catch(error){updating=false;const verified=!!updates.archivePath&&!!updates.release;updates.failure(error);if(verified)updates.update({status:'ready'});throw error;}});
}
function run(name,args){if(updating&&!updateMediaScope.getStore())return Promise.reject(new Error('Güncelleme hazırlanıyor.'));return trackOperation(()=>new Promise((resolve,reject)=>{const p=spawn(path.join(toolDir,name+'.exe'),args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err=(err+b).slice(-10000));p.on('error',reject);p.on('close',c=>c===0?resolve(out):reject(new Error(err||name+' başarısız'))); }));}
async function probe(file){return JSON.parse(await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));}
function asset(file){const id=crypto.randomUUID();assets.set(id,file);return 'klipmedia://local/'+id;}
const cache=new Map();
async function describe(item){
 const key=item.file+'|'+item.mtime+'|'+item.size;if(cache.has(key))return cache.get(key);
 const m=await probe(item.file),v=m.streams.find(s=>s.codec_type==='video');if(!v)throw new Error('Video akışı yok');const audio=m.streams.filter(s=>s.codec_type==='audio');
 const [n,d]=(v.avg_frame_rate||'30/1').split('/').map(Number),seconds=Number(m.format.duration);
 const cacheDir=path.join(app.getPath('userData'),'previews');await fs.mkdir(cacheDir,{recursive:true});const hash=crypto.createHash('sha256').update(key).digest('hex'),thumb=path.join(cacheDir,hash+'.jpg');
 if(!sync.existsSync(thumb))await run('ffmpeg',['-v','error','-n','-ss',String(Math.min(1,seconds/2)),'-i',item.file,'-frames:v','1','-vf','scale=320:-2','-q:v','4',thumb]).catch(()=>{});
 let preview=item.file;if(path.extname(item.file).toLowerCase()!=='.mp4'){preview=path.join(cacheDir,hash+'.mp4');if(!sync.existsSync(preview))await run('ffmpeg',['-v','error','-n','-i',item.file,'-map','0:v:0','-map','0:a:0?','-c','copy','-movflags','+faststart',preview]);}
 const clip={...item,seconds,resolution:v.width+'x'+v.height,fps:n/d||30,tracks:audio.length,audio:audio.map((a,i)=>({index:i,name:a.tags?.title||a.tags?.name||a.tags?.handler_name||'Ses '+(i+1),codec:a.codec_name})),codec:v.codec_name,videoUrl:asset(preview),thumbnail:sync.existsSync(thumb)?asset(thumb):'',thumb:0,day:new Date(item.mtime).toDateString()===new Date().toDateString()?'today':'yesterday',clock:new Date(item.mtime).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})};known.set(clip.id,clip);cache.set(key,clip);return clip;
}
async function library(){const clips=[];for(const item of await files.scan(state.folder))try{clips.push(await describe(item));}catch(e){status('Dosya okunamadı: '+item.fileName);}return clips;}
function save(){if(updating||deviceChanging)return Promise.reject(new Error('Uygulama hazırlanıyor; birazdan tekrar dene.'));if(quitting)return Promise.reject(new Error('Uygulama kapanıyor.'));return trackOperation(saveClipFile);}
async function saveClipFile(){if(deleting)throw new Error('Klipler siliniyor; birazdan tekrar dene.');if(saving)throw new Error('Önceki klip hâlâ kaydediliyor.');saving=true;status('Klip hazırlanıyor…');let staged;
 try{const file=await capture.save(),game=files.safeName(state.mode==='screen'?'Masaüstü':capture.lastGame);const dir=path.join(state.folder,game);await fs.mkdir(dir,{recursive:true});const target=await files.unique(path.join(dir,new Date().toISOString().replace(/[:.]/g,'-')+'.mp4'));staged=path.join(dir,'.'+crypto.randomUUID()+'.mp4');
 const args=['-v','error','-n','-i',file,'-map','0','-c','copy','-movflags','+faststart'];const titles=['Birleşik ses',...Array.from({length:4},(_,i)=>capture.audio.find(a=>a.track===i+2)?.name||['Oyun (bekleniyor)','Discord (bekleniyor)','Tarayıcı (bekleniyor)','Müzik (bekleniyor)'][i]),'Mikrofon'];titles.forEach((t,i)=>args.push('-metadata:s:a:'+i,'title='+t,'-metadata:s:a:'+i,'handler_name='+t));args.push(staged);await run('ffmpeg',args);await probe(staged);await fs.link(staged,target);await fs.unlink(file).catch(()=>{});status('Klip kaydedildi');return await library();}
 finally{saving=false;if(staged)await fs.unlink(staged).catch(()=>{});}
}
async function start(){if(busy)return;busy=true;try{status('Kayıt motoru açılıyor…');await fs.mkdir(state.folder,{recursive:true});const buffer=path.join(app.getPath('userData'),'buffer');await fs.mkdir(buffer,{recursive:true});await capture.start(state,buffer);status(capture.video?.method==='window'?'Tampon hazır · Windows pencere yakalama':'Tampon hazır');}catch(e){await capture.stop().catch(()=>{});throw e;}finally{busy=false;}}
function bindHotkey(key){if(!globalShortcut.register(key,()=>save().then(clips=>status('Klip kaydedildi',{clips,saved:true})).catch(e=>status(e.message))))throw new Error('Bu kısayol başka bir uygulamada kullanılıyor.');}
function handle(name,fn){ipcMain.handle('klip:'+name,async(e,...args)=>{if(e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame)throw new Error('İstek reddedildi');try{if(quitting)throw new Error('Uygulama kapanıyor.');if((updating||deviceChanging)&&!['window','update-state','update-install'].includes(name))throw new Error('Güncelleme hazırlanıyor.');return{data:await (['trim','toggle','delete','trash-restore','settings','audio','import','library','trash-list','trash-preview','editor-audio','editor-timeline'].includes(name)?trackOperation(()=>fn(...args)):fn(...args))};}catch(error){return{error:error.message};}});}
handle('init',async()=>({settings:state,clips:[]}));handle('library',library);
handle('window',action=>{if(action==='minimize')win.minimize();else if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();else if(action==='close')win.close();});
handle('audio',async({track,enabled})=>{if(!Number.isInteger(track)||track<1||track>6||typeof enabled!=='boolean')throw new Error('Geçersiz ses izi');const name=track===1?'Klip Sistem Sesi':track===6?'Klip Mikrofon':'Klip Ses '+track;if(capture.running){await capture.obs.call('SetInputMute',{inputName:name,inputMuted:!enabled});if(track===1)await capture.obs.call('SetInputAudioTracks',{inputName:'Klip Mikrofon',inputAudioTracks:{1:enabled,2:false,3:false,4:false,5:false,6:true}});}state.audioEnabled={...state.audioEnabled,[track]:enabled};await fs.writeFile(stateFile,JSON.stringify(state,null,2));return state.audioEnabled;});
handle('settings',async next=>{const c={...state};for(const k in defaults)if(typeof next[k]===typeof defaults[k])c[k]=next[k];if(isDeepStrictEqual(c,state))return state;if(capture.running&&captureSettingsChanged(state,c))throw new Error('Kayıt ayarlarını değiştirmek için önce tamponu durdur.');if(!['tr','en'].includes(c.language)||!['screen','game','auto'].includes(c.mode)||![30,60,90,120,180,240,300].includes(c.duration)||!['1920x1080','2560x1440','1280x720'].includes(c.resolution)||!['24','30','60','120','144','240','custom'].includes(c.fps)||!Number.isInteger(c.customFps)||c.customFps<1||c.customFps>360||!path.isAbsolute(c.folder))throw new Error('Geçersiz kayıt ayarı.');if(c.folder!==state.folder)await recycle.addRoot(c.folder);if(c.hotkey!==state.hotkey){bindHotkey(c.hotkey);globalShortcut.unregister(state.hotkey);}if(c.launch!==state.launch||c.launchMinimized!==state.launchMinimized)app.setLoginItemSettings(loginSettings(c,process.execPath));state=c;if(capture.running)capture.config=c;refreshTray();await fs.writeFile(stateFile,JSON.stringify(state,null,2));return state;});
handle('toggle',async()=>{if(capture.running){await capture.stop();status('Tampon durduruldu');}else await start();return{running:capture.running};});handle('save',save);
handle('explorer',id=>{const clip=known.get(id);if(!clip)throw new Error('Klip bulunamadı');shell.showItemInFolder(clip.file);});
handle('delete',async({ids})=>{if(busy||saving)throw new Error('Devam eden işlemin bitmesini bekle.');busy=true;deleting=true;try{const result=await trashClips(ids,{known,trashItem:async file=>{await recycle.remember(file);await shell.trashItem(file);}});for(const id of result.deleted){editorAudio.invalidate(id);timeline.invalidate(id); }for(const [key,clip]of cache)if(result.deleted.includes(clip.id)){cache.delete(key);for(const url of [clip.videoUrl,clip.thumbnail])if(url)assets.delete(new URL(url).pathname.slice(1));}return{...result,clips:await library()};}finally{busy=false;deleting=false;}});
handle('trash-list',async()=>trashMedia.entries(await recycle.list()));
handle('trash-preview',({id})=>trashMedia.preview(id));
handle('editor-audio',payload=>editorAudio.get(payload));
handle('editor-timeline',payload=>timeline.get(payload));
handle('update-state',()=>updates.state());
handle('update-check',()=>updates.check({manual:true,source:'manual'}));
handle('update-download',()=>updates.download());
handle('update-login',()=>updates.login());
handle('update-install',applyUpdate);
handle('trash-open',()=>recycle.open());
handle('trash-restore',async({ids})=>{if(busy||saving)throw new Error('Devam eden işlemin bitmesini bekle.');busy=true;try{const result=await trashMedia.restore(ids);result.entries=trashMedia.entries(result.entries);let clips=null,libraryError;try{clips=await library();for(const restored of result.restored)if(!clips.some(clip=>clip.file===restored.file)){try{const stat=await fs.stat(restored.file);clips.unshift(await describe({file:restored.file,id:restored.file,name:path.parse(restored.file).name,fileName:path.basename(restored.file),game:restored.game||'İçe aktarılanlar',mtime:stat.mtimeMs,size:stat.size}));}catch(error){libraryError=error.message;}}}catch(error){libraryError=error.message;}return{...result,clips,...libraryError?{libraryError}:{}};}finally{busy=false;}});
handle('import',async()=>{const pick=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Video',extensions:['mp4','mkv','mov','webm']}]});if(pick.canceled)return null;const file=pick.filePaths[0],st=await fs.stat(file);return describe({file,id:file,name:path.parse(file).name,fileName:path.basename(file),game:'İçe aktarılanlar',mtime:st.mtimeMs,size:st.size});});
handle('trim',async({id,start,end,name,tracks,volumes})=>{if(busy)throw new Error('Başka bir işlem devam ediyor');const clip=known.get(id);if(!clip||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>clip.seconds+.03||end-start<.1)throw new Error('Geçersiz kesim aralığı');const outputAudio=audioOutput(clip,tracks,volumes);busy=true;let temp;
 try{const dir=path.join(state.folder,files.safeName(clip.game));await fs.mkdir(dir,{recursive:true});const filename=files.safeName(path.parse(name||clip.name+'-kesit').name)+'.mp4',target=await files.unique(path.join(dir,filename));temp=path.join(dir,'.'+crypto.randomUUID()+'.mp4');const encoder=clip.codec==='hevc'?'hevc_nvenc':clip.codec==='av1'?'av1_nvenc':'h264_nvenc';const args=['-v','error','-n','-ss',String(start),'-i',clip.file,'-t',String(end-start),'-map','0:v:0'];args.push(...outputAudio.args);args.push('-c:v',encoder,'-preset','p5','-rc','constqp','-qp','16','-fps_mode','passthrough','-c:a','aac','-b:a','256k','-movflags','+faststart');outputAudio.names.forEach((title,i)=>args.push('-metadata:s:a:'+i,'title='+title,'-metadata:s:a:'+i,'handler_name='+title));args.push(temp);status('Klip kesiliyor…');await run('ffmpeg',args);const check=await probe(temp),v=check.streams.find(s=>s.codec_type==='video');if(!v||v.width!==Number(clip.resolution.split('x')[0])||v.height!==Number(clip.resolution.split('x')[1]))throw new Error('Çıktı doğrulanamadı');await fs.link(temp,target);return{clips:await library(),file:target};}finally{busy=false;if(temp)await fs.unlink(temp).catch(()=>{});}});
app.whenReady().then(async()=>{
 await fs.mkdir(app.getPath('userData'),{recursive:true});state={...defaults,...await fs.readFile(stateFile,'utf8').then(JSON.parse).catch(()=>({}))};
 await recycle.addRoot(state.folder).catch(error=>console.error(error.message));
 protocol.handle('klipmedia',async req=>{if(quitting||updating)return new Response(null,{status:404});try{const value=assets.get(new URL(req.url).pathname.slice(1)),file=typeof value==='function'?await trackOperation(value):value;return file?fileResponse(file,req):new Response('Not found',{status:404});}catch{return new Response('Not found',{status:404});}});
 const audioSyncProfile=await fs.readFile(path.join(app.getPath('userData'),'audio-sync.json'),'utf8').then(JSON.parse).catch(()=>null);capture=new Capture(path.join(root,'engine/obs'),{audioSyncProfile});capture.on('audio-sync',audioSync=>status('',{audioSync}));capture.on('audio-device-changed',restartAfterAudioChange);capture.on('warning',message=>status(message));capture.on('audio',audio=>status('',{audio}));capture.on('focus',focus=>status('',{focus}));capture.on('capture-source',source=>status(source.method==='window'?'Windows pencere yakalamaya geçildi.':'Oyun yakalama etkin.',{captureSource:source.method}));
 win=new BrowserWindow({width:1280,height:800,minWidth:850,minHeight:650,show:revealRequested||!shouldStartHidden(state,process.argv),backgroundColor:'#19171d',frame:false,title:'Klip',icon:path.join(__dirname,'icon.ico'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.setWindowOpenHandler(({url})=>{if(url==='https://github.com/login/device'||url==='https://github.com/login/device/')shell.openExternal(url).catch(error=>status(error.message));return{action:'deny'};});win.webContents.on('will-navigate',(e,url)=>{if(url!==require('node:url').pathToFileURL(path.join(__dirname,'index.html')).href)e.preventDefault();});await win.loadFile(path.join(__dirname,'index.html'));
 try{bindHotkey(state.hotkey);}catch(e){status(e.message);}timer=setInterval(()=>status(''),1000);win.on('close',e=>{if(!quitting){e.preventDefault();win.hide();}});
 const icon=nativeImage.createFromPath(path.join(__dirname,'icon.png'));tray=new Tray(icon);tray.setToolTip('Klip');refreshTray();tray.on('double-click',showMainWindow);
 if(state.autoBuffer)trackOperation(start).catch(e=>status(e.message));
 await acknowledgeUpdate().catch(error=>status(error.message));
 updates.check({source:'startup'}).catch(error=>updates.failure(error));updateTimer=setInterval(()=>{if(!quitting&&!updating)updates.check({source:'background'}).catch(error=>updates.failure(error));},15*60*1000);updateTimer.unref();
});
app.on('before-quit',e=>{if(quitReady)return;e.preventDefault();if(quitting)return;quitting=true;clearInterval(timer);clearInterval(updateTimer);globalShortcut.unregisterAll();if(operations.size)status('Devam eden işlem tamamlanıp kapanılacak…');Promise.allSettled([...operations]).then(()=>capture?.stop()).catch(error=>status(error.message)).finally(()=>{quitReady=true;app.quit();});});
