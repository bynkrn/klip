const {app,BrowserWindow,ipcMain,dialog,shell,globalShortcut,Tray,Menu,nativeImage,protocol}=require('electron');
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),crypto=require('node:crypto');
const {Capture}=require('./capture'),files=require('./files');
const {fileResponse}=require('./media');
const {trashClips}=require('./library-actions');
const {WindowsTrash}=require('./windows-trash');
const {TrashMedia}=require('./trash-media');
const {EditorAudio}=require('./audio-editor');
const {RecordingHealth}=require('./recording-health');
const {planClipExport,exportClip}=require('./clip-export');
const {EditorAudioPreferences}=require('./editor-audio-preferences');
const {AudioWaveforms}=require('./audio-waveform');
const {assertClipSource}=require('./clip-source');
const {ClipMetadata}=require('./clip-metadata');
const {TimelinePreviews}=require('./timeline');
const {Updates,healthAckPath}=require('./updates');
const {captureSettingsChanged}=require('./settings-policy');
const {translate}=require('./i18n');
const updateConfig=require('./update-config.json');
const {STARTUP_ARG,shouldStartHidden,reconcileStartup}=require('./startup');
const {userDataDirectory,migrateDefaultClipFolder,relocateRestoredClip}=require('./brand-migration');
const {normalizeVideoQuality}=require('./video-quality');
const {loadInstallationPreferences}=require('./installation-preferences');
const {ProjectTransfer,validateEditorExecutable}=require('./project-transfer');
const {saveReplay}=require('./replay-save');
const {NotificationSound}=require('./notification-sound');
const {RecoveryController,RecoveryExitGuard}=require('./recovery-controller');
const {PreviewQueue,mediaArguments,lowerMediaPriority}=require('./media-work');
const {isDeepStrictEqual}=require('node:util');
const {AsyncLocalStorage}=require('node:async_hooks');
const updateMediaScope=new AsyncLocalStorage();
app.setName('Ember');app.setPath('userData',userDataDirectory(app.getPath('appData')));
if(process.platform==='win32')app.setAppUserModelId('Ember.Local');
protocol.registerSchemesAsPrivileged([{scheme:'klipmedia',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}]);
let win,tray,quitting=false,quitReady=false,quitAttempt=null,busy=false,saving=false,deleting=false,capture,state,timer,updateTimer,updating=false,deviceChanging=false,revealRequested=false;const assets=new Map(),known=new Map(),operations=new Set();
function trackOperation(fn){const pending=Promise.resolve().then(fn);operations.add(pending);const done=()=>operations.delete(pending);pending.then(done,done);return pending;}
const previewQueue=new PreviewQueue(()=>!!win&&!win.isDestroyed()&&win.isVisible()&&!win.isMinimized()&&win.isFocused()&&!saving&&!quitting&&!updating&&!deviceChanging);
const root=path.join(__dirname,'..'),toolDir=path.join(root,'tools'),stateFile=path.join(app.getPath('userData'),'settings.json');
const recordingHealth=new RecordingHealth();
const audioPreferences=new EditorAudioPreferences({file:path.join(app.getPath('userData'),'editor-audio-mixes.json')});
const clipMetadata=new ClipMetadata({file:path.join(app.getPath('userData'),'clip-metadata.json')});
const waveforms=new AudioWaveforms({cacheDir:path.join(app.getPath('userData'),'previews'),resolve:id=>known.get(id),run});
const notificationSounds=new NotificationSound({directory:path.join(app.getPath('userData'),'sounds'),asset});
const recycle=new WindowsTrash({historyFile:path.join(app.getPath('userData'),'trash-history.json'),root:()=>state.folder,helper:path.join(toolDir,'recycle-bin.exe')});
const trashMedia=new TrashMedia({trash:recycle,cacheDir:path.join(app.getPath('userData'),'previews'),run,probe,asset,revoke:url=>assets.delete(new URL(url).pathname.slice(1))});
const editorAudio=new EditorAudio({cacheDir:path.join(app.getPath('userData'),'previews'),resolve:id=>known.get(id),run,asset,revoke:url=>assets.delete(new URL(url).pathname.slice(1))});
const timeline=new TimelinePreviews({cacheDir:path.join(app.getPath('userData'),'previews'),resolve:id=>known.get(id),run,asset,revoke:url=>assets.delete(new URL(url).pathname.slice(1))});
const updateCache=path.join(app.getPath('userData'),'updates');
const updates=new Updates({currentVersion:app.getVersion(),...updateConfig,ghPath:path.join(toolDir,'github','gh.exe'),cacheDir:updateCache,appRoot:path.dirname(process.execPath),installerPath:path.join(toolDir,'update-install.exe'),packaged:app.isPackaged});
updates.on('state',update=>status('',{update}));
const projectTransfers=new ProjectTransfer({directory:path.join(app.getPath('userData'),'project-imports'),resolveClip:id=>known.get(id),getEditor:()=>state?.editorExecutable||'',probe});
projectTransfers.on('change',jobs=>status('',{projectTransfers:jobs}));
const defaults={mode:'auto',duration:120,resolution:'1920x1080',fps:'60',customFps:90,codec:'h264',storage:'disk',stretch:true,holdFrame:true,cursor:true,hotkey:'F8',sound:true,launch:true,autoBuffer:true,autoAudio:true,folder:path.join(app.getPath('videos'),'Ember')};
defaults.audioEnabled={};
defaults.targetExe='';
defaults.launchMinimized=false;
defaults.language='tr';
defaults.qualityMode='quality';defaults.videoBitrate=60;
defaults.notificationVolume=75;defaults.notificationSound='ember';
defaults.showCaptureHealth=false;
defaults.monitorId='';defaults.followGameMonitor=false;
const recovery=new RecoveryController({getCapture:()=>capture,isSaving:()=>saving||busy||deleting,save,onChange:()=>status('')});
const recoveryExit=new RecoveryExitGuard({getCapture:()=>capture,waitForOperations,confirmDiscard:confirmRecoveryDiscard});
async function waitForOperations(){while(operations.size)await Promise.allSettled([...operations]);}
async function confirmRecoveryDiscard(){
 const text=value=>translate(value,state.language),choice=await dialog.showMessageBox(win,{type:'warning',title:text('Kaydedilmemiş RAM Tamponu'),message:text('RAM tamponu henüz güvenli bir klip olarak kaydedilmedi.'),detail:text('Çıkarsan bu tampon silinir. Ember’ı açık tutup diskte yer açtıktan sonra Kurtar’a basabilirsin.'),buttons:[text('Vazgeç'),text('Tamponu Sil Ve Çık')],defaultId:0,cancelId:0,noLink:true});return choice.response===1;
}
function showMainWindow(){if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}}
if(!app.requestSingleInstanceLock()){app.quit();process.exit(0);}app.on('second-instance',(_event,argv)=>{if(argv.includes(STARTUP_ARG))return;revealRequested=true;showMainWindow();});
function status(message,extra={}){(!win?.isDestroyed()&&!win?.webContents.isDestroyed())&&win?.webContents.send('native-state',{message,saving,running:!!capture?.running,captureHealth:capture?.health,recordingHealth:recordingHealth.read(capture),displaySelection:capture?.displaySelection,recovery:recovery.state(),buffered:capture?.running?Math.min(state.duration,Math.floor((Date.now()-capture.started)/1000)):0,...extra});}
function refreshTray(){if(!tray)return;const text=message=>translate(message,state.language);tray.setContextMenu(Menu.buildFromTemplate([{label:text('Ember’ı Aç'),click:showMainWindow},{label:text('Klip Al'),click:()=>save().then(clips=>status('',{clips,saved:true})).catch(e=>status(e.message))},{label:text('Çıkış'),click:()=>app.quit()}]));}
async function restartAfterAudioChange(){
 if(deviceChanging||quitting||updating)return;deviceChanging=true;
 try{return await trackOperation(async()=>{
  while(busy||saving||deleting){if(quitting)return;await new Promise(resolve=>setTimeout(resolve,100));}
  if(quitting||!capture.running)return;busy=true;
  try{status('Ses aygıtı değişti; tampon korunuyor…');const clips=await saveClipFile();await capture.stop();busy=false;if(!quitting){await start();status('Ses aygıtı yenilendi; önceki tampon klip olarak korundu.',{clips});}}
  finally{busy=false;}
 });}catch(error){status('Ses aygıtı değişimi tamamlanamadı: '+error.message);}finally{deviceChanging=false;previewQueue.wake();}
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
 }catch(error){updating=false;previewQueue.wake();const verified=!!updates.archivePath&&!!updates.release;updates.failure(error);if(verified)updates.update({status:'ready'});throw error;}});
}
function run(name,args){if(updating&&!updateMediaScope.getStore())return Promise.reject(new Error('Güncelleme hazırlanıyor.'));return trackOperation(()=>new Promise((resolve,reject)=>{const p=spawn(path.join(toolDir,name+'.exe'),mediaArguments(name,args),{windowsHide:true,stdio:['ignore','pipe','pipe']});lowerMediaPriority(p);let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err=(err+b).slice(-10000));p.on('error',reject);p.on('close',c=>c===0?resolve(out):reject(new Error(err||name+' başarısız'))); }));}
async function probe(file){return JSON.parse(await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));}
function asset(file){const id=crypto.randomUUID();assets.set(id,file);return 'klipmedia://local/'+id;}
const cache=new Map(),publishedClips=new Map();let librarySnapshot=[],publicationRevision=0;
function clipKey(item){
 return item.file+'|'+item.mtime+'|'+item.size;
}
function clipDescription(item,m,{preview=item.file}={}){
 const key=clipKey(item),v=m.streams.find(s=>s.codec_type==='video');if(!v)throw new Error('Video akışı yok');const audio=m.streams.filter(s=>s.codec_type==='audio');
 const [n,d]=(v.avg_frame_rate||'30/1').split('/').map(Number),seconds=Number(m.format.duration),cacheDir=path.join(app.getPath('userData'),'previews'),hash=crypto.createHash('sha256').update(key).digest('hex'),thumb=path.join(cacheDir,hash+'.jpg');
 let thumbnailJob;const thumbnail=()=>thumbnailJob||=(async()=>{await fs.mkdir(cacheDir,{recursive:true});if(!sync.existsSync(thumb))await previewQueue.run(()=>run('ffmpeg',['-v','error','-n','-ss',String(Math.min(1,seconds/2)),'-i',item.file,'-frames:v','1','-vf','scale=320:-2','-q:v','4',thumb])).catch(()=>{});return sync.existsSync(thumb)?thumb:undefined;})();
 return clipMetadata.decorate({...item,seconds,resolution:v.width+'x'+v.height,fps:n/d||30,tracks:audio.length,audio:audio.map((a,i)=>({index:i,name:a.tags?.title||a.tags?.name||a.tags?.handler_name||'Ses '+(i+1),codec:a.codec_name})),codec:v.codec_name,videoUrl:asset(preview),thumbnail:asset(sync.existsSync(thumb)?thumb:thumbnail),thumb:0,day:new Date(item.mtime).toDateString()===new Date().toDateString()?'today':'yesterday',clock:new Date(item.mtime).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})});
}
async function describe(item){
 const key=clipKey(item);if(cache.has(key)){const clip=clipMetadata.decorate(cache.get(key));known.set(clip.id,clip);cache.set(key,clip);return clip;}
 const m=await probe(item.file);let preview=item.file;
 if(path.extname(item.file).toLowerCase()!=='.mp4'){const cacheDir=path.join(app.getPath('userData'),'previews');await fs.mkdir(cacheDir,{recursive:true});preview=path.join(cacheDir,crypto.createHash('sha256').update(key).digest('hex')+'.mp4');if(!sync.existsSync(preview))await run('ffmpeg',['-v','error','-n','-i',item.file,'-map','0:v:0','-map','0:a:0?','-c','copy','-movflags','+faststart',preview]);}
 const clip=clipDescription(item,m,{preview});known.set(clip.id,clip);cache.set(key,clip);return clip;
}
async function library(){
 const revision=publicationRevision,clips=[];for(const item of await files.scan(state.folder))try{clips.push(await describe(item));}catch(e){status('Dosya okunamadı: '+item.fileName);}
 const merged=new Map(clips.map(clip=>[clip.id,clip]));for(const {revision:published,clip}of publishedClips.values())if(published>revision&&known.has(clip.id))merged.set(clip.id,clip);
 for(const imported of known.values())if(imported.game==='İçe aktarılanlar'&&!merged.has(imported.id))merged.set(imported.id,imported);
 librarySnapshot=[...merged.values()].map(clip=>clipMetadata.decorate(clip)).sort((a,b)=>b.mtime-a.mtime);for(const clip of librarySnapshot)known.set(clip.id,clip);return librarySnapshot;
}
async function updateClipMetadata(payload){
 if(busy||saving||deleting)throw new Error('Devam eden işlemin bitmesini bekle.');await clipMetadata.patch(payload,known);
 for(const [id,clip]of known)known.set(id,clipMetadata.decorate(clip));
 for(const [key,clip]of cache)cache.set(key,clipMetadata.decorate(clip));
 for(const [id,published]of publishedClips)publishedClips.set(id,{...published,clip:clipMetadata.decorate(published.clip)});
 const merged=new Map(librarySnapshot.filter(clip=>known.has(clip.id)).map(clip=>[clip.id,known.get(clip.id)]));for(const imported of known.values())if(imported.game==='İçe aktarılanlar'&&!merged.has(imported.id))merged.set(imported.id,imported);
 librarySnapshot=[...merged.values()].sort((a,b)=>b.mtime-a.mtime);return{clips:librarySnapshot};
}
function save(){if(updating||deviceChanging)return Promise.reject(new Error('Uygulama hazırlanıyor; birazdan tekrar dene.'));if(quitting)return Promise.reject(new Error('Uygulama kapanıyor.'));return trackOperation(async()=>{const detail=capture.recoveryRequired,clips=await saveClipFile({announceRequest:true});if(detail?.keepAlive&&capture.recoveryRequired===detail)capture.recoveryRequired=null;return clips;});}
async function saveClipFile({announceRequest=false,source=capture}={}){if(deleting)throw new Error('Klipler siliniyor; birazdan tekrar dene.');if(saving)throw new Error('Önceki klip hâlâ kaydediliyor.');const automatic=source!==capture&&!!source.lastSnapshot?.automatic;if(!source.running&&!automatic&&!source.recoveryRequired?.keepAlive)throw new Error('Önce tamponu başlat.');saving=true;status('Klip hazırlanıyor…',{saveRequested:announceRequest&&!automatic});
 try{
  const result=await saveReplay({capture:source,folder:state.folder,mode:state.mode,run,probe,defer:job=>{trackOperation(()=>new Promise(resolve=>setImmediate(resolve)).then(job));}}),clip=clipDescription(result.item,result.media);
  known.set(clip.id,clip);cache.set(clipKey(result.item),clip);publishedClips.set(clip.id,{revision:++publicationRevision,clip});const merged=new Map([clip,...librarySnapshot].map(item=>[item.id,item]));for(const imported of known.values())if(imported.game==='İçe aktarılanlar'&&!merged.has(imported.id))merged.set(imported.id,imported);librarySnapshot=[...merged.values()];
  console.info('[replay-save]',JSON.stringify(result.timings));const warnings=result.warnings||[];status(warnings.length?'Klip kaydedildi. Bazı uygulamaların ayrı ses izi kullanılamadı; birleşik ses korundu.':'Klip kaydedildi',{saveTiming:result.timings,warnings});return librarySnapshot;
 }finally{saving=false;previewQueue.wake();}
}
async function preserveAutomaticReplay({detail,complete,fail}){
 return trackOperation(()=>updateMediaScope.run(true,async()=>{
  try{
   while(saving||deleting)await new Promise(resolve=>setTimeout(resolve,100));
   const source=Object.create(capture);source.lastSnapshot=detail;source.save=async()=>detail.savedReplayPath;
   const clips=await saveClipFile({source});if(detail.recoveryManifest)try{await source.completeRecovery?.(detail.savedReplayPath);}catch(error){status('Klip kaydedildi; kurtarma günlüğü temizlenemedi: '+error.message);}
   status(detail.recovered?'Kayıt kurtarıldı; görüntü ve kullanılabilir ayrı ses izleri klibe eklendi.':'Tampon sınırına ulaşıldı; mevcut klip otomatik korundu.',{clips,automaticReplay:true});complete?.(clips);
  }catch(error){status('Otomatik klip tamamlanamadı; orijinal kayıt kurtarma için korundu: '+error.message);fail?.(error);}
 }));
}
async function start(){if(busy)return;busy=true;try{status('Kayıt motoru açılıyor…');await fs.mkdir(state.folder,{recursive:true});const buffer=path.join(app.getPath('userData'),'buffer');await fs.mkdir(buffer,{recursive:true});await capture.start(state,buffer);status(capture.video?.method==='window'?'Tampon hazır · Windows pencere yakalama':'Tampon hazır');}catch(e){await capture.stop().catch(()=>{});throw e;}finally{busy=false;}}
function bindHotkey(key){if(!globalShortcut.register(key,()=>save().then(clips=>status('',{clips,saved:true})).catch(e=>status(e.message))))throw new Error('Bu kısayol başka bir uygulamada kullanılıyor.');}
function handle(name,fn){ipcMain.handle('klip:'+name,async(e,...args)=>{if(e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame)throw new Error('İstek reddedildi');try{if(quitting)throw new Error('Uygulama kapanıyor.');if((updating||deviceChanging)&&!['window','update-state','update-install'].includes(name))throw new Error('Güncelleme hazırlanıyor.');return{data:await (['trim','toggle','delete','trash-restore','settings','audio','import','notification-sound-import','recover-replays','library','clip-metadata','trash-list','trash-preview','editor-audio','editor-timeline'].includes(name)?trackOperation(()=>fn(...args)):fn(...args))};}catch(error){return{error:error.message};}});}
handle('capture-displays',()=>trackOperation(async()=>{if(!capture.running)capture.config=state;return{displays:await capture.listDisplays(),selection:capture.displaySelection};}));
handle('init',async()=>({settings:await notificationSounds.settings(state),clips:[],recovery:recovery.state(),recordingHealth:recordingHealth.read(capture),projectTransfers:projectTransfers.list()}));handle('library',library);
handle('clip-metadata',updateClipMetadata);
handle('project-transfer-state',()=>projectTransfers.list());
handle('project-transfer-start',payload=>trackOperation(()=>projectTransfers.create(payload)));
handle('project-transfer-retry',({requestId})=>trackOperation(()=>projectTransfers.retry(requestId)));
handle('project-editor-select',async()=>{
 const pick=await dialog.showOpenDialog(win,{title:translate('Video Editörünü Seç',state.language),properties:['openFile'],filters:[{name:'Windows EXE',extensions:['exe']}]});if(pick.canceled)return null;
 const editorExecutable=await validateEditorExecutable(pick.filePaths[0]),next={...state,editorExecutable};await fs.writeFile(stateFile,JSON.stringify(next,null,2));state=next;if(capture.running)capture.config=state;return{editorExecutable};
});
handle('recovery-state',()=>recovery.state());
handle('recover-replays',async()=>{await recovery.recover();return{recovery:recovery.state(),clips:librarySnapshot};});
handle('window',action=>{if(action==='minimize')win.minimize();else if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();else if(action==='close')win.close();});
handle('audio',async({track,enabled})=>{const base=track===1||track===6,application=typeof track==='string'&&/^app:[0-9a-f]{16}$/.test(track)&&capture.audio?.some(app=>app.track===track),legacy=!capture.dynamicAudio&&Number.isInteger(track)&&track>=2&&track<=5;if(typeof enabled!=='boolean'||!base&&!application&&!legacy)throw new Error('Geçersiz ses izi');const previous=capture.config,next={...state,audioEnabled:{...state.audioEnabled,[track]:enabled}};try{if(capture.running){if(capture.dynamicAudio){capture.config=next;await capture.setAudioEnabled(track,enabled);}else{const name=track===1?'Klip Sistem Sesi':track===6?'Klip Mikrofon':'Klip Ses '+track;await capture.obs.call('SetInputMute',{inputName:name,inputMuted:!enabled});if(track===1)await capture.obs.call('SetInputAudioTracks',{inputName:'Klip Mikrofon',inputAudioTracks:{1:enabled,2:false,3:false,4:false,5:false,6:true}});}}await fs.writeFile(stateFile,JSON.stringify(next,null,2));state=next;if(capture.running)capture.config=state;return state.audioEnabled;}catch(error){capture.config=previous;throw error;}});
handle('settings',async next=>{const c={...state,storage:state.storage||'disk'};for(const k in defaults)if(typeof next[k]===typeof defaults[k])c[k]=next[k];if(typeof c.monitorId!=='string'||c.monitorId.length>1024||/[\x00-\x1f]/.test(c.monitorId)||typeof c.followGameMonitor!=='boolean')throw new Error('Geçersiz ekran ayarı.');if(isDeepStrictEqual(c,state))return notificationSounds.settings(state);await notificationSounds.validate(c);if(!['quality','bitrate'].includes(c.qualityMode)||!Number.isInteger(c.videoBitrate)||c.videoBitrate<5||c.videoBitrate>250)throw new Error('Bitrate 5 ile 250 Mbps arasında olmalı.');if(capture.running&&captureSettingsChanged(state,c))throw new Error('Kayıt ayarlarını değiştirmek için önce tamponu durdur.');if(!['tr','en'].includes(c.language)||!['screen','game','auto'].includes(c.mode)||!['ram','disk'].includes(c.storage)||![30,60,90,120,180,240,300].includes(c.duration)||!['1920x1080','2560x1440','1280x720'].includes(c.resolution)||!['24','30','60','120','144','240','custom'].includes(c.fps)||!Number.isInteger(c.customFps)||c.customFps<1||c.customFps>360||!path.isAbsolute(c.folder))throw new Error('Geçersiz kayıt ayarı.');if(c.folder!==state.folder)await recycle.addRoot(c.folder);if(c.hotkey!==state.hotkey){bindHotkey(c.hotkey);globalShortcut.unregister(state.hotkey);}if(c.launch!==state.launch||c.launchMinimized!==state.launchMinimized){const registration=await reconcileStartup({app,settings:c});if(registration.status==='error')throw new Error(registration.message);if(registration.status==='os-disabled')status('Windows başlangıç izni kapalı. Görev Yöneticisi → Başlangıç Uygulamaları bölümünden Ember’ı etkinleştir.');}state=c;if(capture.running)capture.config=c;refreshTray();await fs.writeFile(stateFile,JSON.stringify(state,null,2));return notificationSounds.settings(state);});
handle('toggle',async()=>{if(saving)throw new Error('Klip hazırlanırken tampon durdurulamaz.');if(capture.recoveryRequired?.keepAlive)throw new Error('Önce bekleyen tamponu kurtar.');if(capture.running){await capture.stop();status('Tampon durduruldu');}else await start();return{running:capture.running};});handle('save',save);
handle('explorer',id=>{const clip=known.get(id);if(!clip)throw new Error('Klip bulunamadı');shell.showItemInFolder(clip.file);});
handle('delete',async({ids})=>{if(busy||saving)throw new Error('Devam eden işlemin bitmesini bekle.');busy=true;deleting=true;try{const result=await trashClips(ids,{known,trashItem:async file=>{await recycle.remember(file);await shell.trashItem(file);}});for(const id of result.deleted){editorAudio.invalidate(id);timeline.invalidate(id);waveforms.invalidate(id);}for(const [key,clip]of cache)if(result.deleted.includes(clip.id)){cache.delete(key);for(const url of [clip.videoUrl,clip.thumbnail])if(url)assets.delete(new URL(url).pathname.slice(1));}return{...result,clips:await library()};}finally{busy=false;deleting=false;}});
handle('trash-list',async()=>trashMedia.entries(await recycle.list()));
handle('trash-preview',({id})=>trashMedia.preview(id));
handle('editor-audio',payload=>editorAudio.get(payload));
handle('editor-timeline',payload=>timeline.get(payload));
handle('editor-audio-preferences',payload=>trackOperation(()=>audioPreferences.handle(payload,known.get(payload?.id))));
handle('editor-audio-waveform',payload=>trackOperation(()=>waveforms.get(payload)));
handle('editor-audio-waveform-cancel',({id})=>{waveforms.invalidate(id);return true;});
handle('update-state',()=>updates.state());
handle('update-check',()=>updates.check({manual:true,source:'manual'}));
handle('update-download',()=>updates.download());
handle('update-login',()=>updates.login());
handle('update-install',applyUpdate);
handle('trash-open',()=>recycle.open());
handle('trash-restore',async({ids})=>{if(busy||saving)throw new Error('Devam eden işlemin bitmesini bekle.');busy=true;try{const result=await trashMedia.restore(ids);for(const restored of result.restored){try{restored.file=await relocateRestoredClip(restored.file,app.getPath('videos'),state.folder);}catch(error){result.refreshError=[result.refreshError,error.message].filter(Boolean).join(' ');}}result.entries=trashMedia.entries(result.entries);let clips=null,libraryError;try{clips=await library();for(const restored of result.restored)if(!clips.some(clip=>clip.file===restored.file)){try{const stat=await fs.stat(restored.file);clips.unshift(await describe({file:restored.file,id:restored.file,name:path.parse(restored.file).name,fileName:path.basename(restored.file),game:restored.game||'İçe aktarılanlar',mtime:stat.mtimeMs,size:stat.size}));}catch(error){libraryError=error.message;}}}catch(error){libraryError=error.message;}return{...result,clips,...libraryError?{libraryError}:{}};}finally{busy=false;}});
handle('import',async()=>{const pick=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Video',extensions:['mp4','mkv','mov','webm']}]});if(pick.canceled)return null;const file=pick.filePaths[0],st=await fs.stat(file);return describe({file,id:file,name:path.parse(file).name,fileName:path.basename(file),game:'İçe aktarılanlar',mtime:st.mtimeMs,size:st.size});});
handle('notification-sound-import',async()=>{const pick=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Audio',extensions:['wav','mp3','ogg','m4a']}]});if(pick.canceled||!pick.filePaths.length)return null;const imported=await notificationSounds.importFile(pick.filePaths[0]);state={...state,...imported};if(capture.running)capture.config=state;await fs.writeFile(stateFile,JSON.stringify(state,null,2));return notificationSounds.settings(state);});
handle('export-plan',({id,start,end,mode,sourceVersion})=>trackOperation(async()=>planClipExport({clip:await assertClipSource(known.get(id),sourceVersion),start,end,mode},{run,probe})));
handle('trim',async({id,start,end,mode='precise',name,tracks,volumes,planToken,sourceVersion})=>{
 if(busy)throw new Error('Başka bir işlem devam ediyor');busy=true;
 try{status('Klip dışa aktarılıyor…');const result=await exportClip({clip:await assertClipSource(known.get(id),sourceVersion),start,end,mode,name,tracks,volumes,folder:state.folder,planToken},{run,probe});return{...result,media:undefined,clips:await library()};}finally{busy=false;}
});
app.whenReady().then(async()=>{
 await clipMetadata.initialize().catch(error=>console.error(error.message));
 await fs.mkdir(app.getPath('userData'),{recursive:true});state=migrateDefaultClipFolder({...defaults,...await fs.readFile(stateFile,'utf8').then(JSON.parse).catch(()=>({}))},app.getPath('videos'));if(app.isPackaged)state=await loadInstallationPreferences(state,path.join(path.dirname(process.execPath),'installation.ini'));Object.assign(state,normalizeVideoQuality(state));state=await notificationSounds.initialize(state);await fs.writeFile(stateFile,JSON.stringify(state,null,2));
 const startup=await reconcileStartup({app,settings:state});if(startup.status==='error')console.error(startup.message);
 await recycle.addRoot(state.folder).catch(error=>console.error(error.message));
 protocol.handle('klipmedia',async req=>{if(quitting||updating)return new Response(null,{status:404});try{const value=assets.get(new URL(req.url).pathname.slice(1)),file=typeof value==='function'?await value():value;return file?fileResponse(file,req):new Response('Not found',{status:404});}catch{return new Response('Not found',{status:404});}});
 const audioSyncProfile=await fs.readFile(path.join(app.getPath('userData'),'audio-sync.json'),'utf8').then(JSON.parse).catch(()=>null);capture=new Capture(path.join(root,'engine/obs'),{audioSyncProfile});capture.config=state;capture.bufferDir=path.join(app.getPath('userData'),'buffer');capture.audioSnapshotRoot=path.join(capture.bufferDir,'audio-snapshots');capture.on('recovery-required',detail=>status(detail?.message||'',{recovery:recovery.state()}));capture.on('recoveries',()=>status('',{recovery:recovery.state()}));await capture.refreshRecoveries?.().catch(error=>status(error.message));capture.on('audio-sync',audioSync=>status('',{audioSync}));capture.on('audio-device-changed',restartAfterAudioChange);capture.on('automatic-replay',preserveAutomaticReplay);capture.on('warning',message=>status(message));capture.on('audio',audio=>status('',{audio}));capture.on('focus',focus=>status('',{focus}));capture.on('capture-source',source=>status(source.method==='window'?'Windows pencere yakalamaya geçildi.':'Oyun yakalama etkin.',{captureSource:source.method}));
 capture.on('displays',displays=>status('',{displays}));capture.on('display-selection',displaySelection=>status('',{displaySelection}));
 win=new BrowserWindow({width:1280,height:800,minWidth:850,minHeight:650,show:revealRequested||!shouldStartHidden(state,process.argv),backgroundColor:'#19171d',frame:false,title:'Ember',icon:path.join(__dirname,'icon.ico'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.setWindowOpenHandler(({url})=>{if(url==='https://github.com/login/device'||url==='https://github.com/login/device/')shell.openExternal(url).catch(error=>status(error.message));return{action:'deny'};});win.webContents.on('will-navigate',(e,url)=>{if(url!==require('node:url').pathToFileURL(path.join(__dirname,'index.html')).href)e.preventDefault();});await win.loadFile(path.join(__dirname,'index.html'));
 projectTransfers.initialize().catch(error=>status('Aktarım geçmişi okunamadı: '+error.message));
 try{bindHotkey(state.hotkey);}catch(e){status(e.message);}timer=setInterval(()=>status(''),1000);win.on('focus',()=>previewQueue.wake());win.on('close',e=>{if(!quitting){e.preventDefault();win.hide();}});
 const icon=nativeImage.createFromPath(path.join(__dirname,'icon.png'));tray=new Tray(icon);tray.setToolTip('Ember');refreshTray();tray.on('double-click',showMainWindow);
 if(startup.status==='os-disabled')status('Windows başlangıç izni kapalı. Görev Yöneticisi → Başlangıç Uygulamaları bölümünden Ember’ı etkinleştir.');if(startup.status==='error')status('Windows başlangıç kaydı onarılamadı: '+startup.message);
 if(state.autoBuffer)trackOperation(start).catch(e=>status(e.message));
 await acknowledgeUpdate().catch(error=>status(error.message));
 updates.check({source:'startup'}).catch(error=>updates.failure(error));updateTimer=setInterval(()=>{if(!quitting&&!updating)updates.check({source:'background'}).catch(error=>updates.failure(error));},15*60*1000);updateTimer.unref();
});
app.on('will-quit',()=>projectTransfers.close());
app.on('before-quit',e=>{if(quitReady)return;e.preventDefault();if(quitting||quitAttempt)return;if(operations.size)status('Devam eden işlem tamamlanıp kapanılacak…');quitAttempt=recoveryExit.request().then(async choice=>{if(!choice.allowed)return;await waitForOperations();if(capture?.recoveryRequired?.keepAlive&&!choice.discardRecovery){status('Önce bekleyen tamponu kurtar.');return;}quitting=true;try{await capture?.stop({discardRecovery:choice.discardRecovery});}catch(error){quitting=false;previewQueue.wake();status(error.message);return;}await waitForOperations();previewQueue.close();clearInterval(timer);clearInterval(updateTimer);globalShortcut.unregisterAll();quitReady=true;app.quit();}).catch(error=>{quitting=false;status(error.message);}).finally(()=>{quitAttempt=null;});});
