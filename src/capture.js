const {OBS}=require('./obs');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {EventEmitter}=require('node:events');
const {VideoSources}=require('./video-sources');
const {normalizeDisplays,reconcileDisplays,selectDisplay,enumerateDisplays}=require('./display-selection');
const {resolveAudioSync,inputSyncOffset}=require('./audio-sync');
const {translate}=require('./i18n');
const recoveryManifestName=name=>/^Ember-Recovery-.*\.json$/.test(name);
const gameProcess=(exe,target)=>target?exe.toLowerCase()===target.toLowerCase():/^(VALORANT.*|cs2|quakelive.*|ddnet.*|r5apex|FortniteClient.*|Overwatch|dota2|RocketLeague|RainbowSix.*)\.exe$/i.test(exe);
const gameName=exe=>/VALORANT/i.test(exe)?'Valorant':/^cs2/i.test(exe)?'Counter-Strike 2':/quakelive/i.test(exe)?'Quake Live':exe.replace(/\.exe$/i,'');
class Capture extends EventEmitter{
 constructor(root,options={}){super();this.enumerateDisplays=options.enumerateDisplays||enumerateDisplays;this.audioSyncProfile=options.audioSyncProfile||null;this.syncOffsets=resolveAudioSync(null,null);this.obs=new OBS(root);this.root=root;this.inputs=new Set();this.inputSettings=new Map();this.audio=[];this.audioSources=new Map();this.audioApps=new Map();this.audioFailures=new Map();this.audioWarningKeys=new Set();this.replaySnapshots=new Map();this.pendingAudioClaims=new Map();this.recoveryConfirmations=new Map();this.recoveryManifests=[];this.recoveryRequired=null;this.owner=this;this.dynamicAudio=false;this.audioEpoch=0;this.lastGame='Masaüstü';this.focus=null;this.running=false;this.obs.on('ReplayBufferRecoveryRequired',d=>{this.recoveryRequired=d.keepAlive?d:null;this.emit('recovery-required',d);this.emit('save-failed',new Error(d.message||'Tampon kurtarma bekliyor.'));this.refreshRecoveries().catch(()=>{});});this.obs.on('AudioSessionsChanged',()=>{if(this.running)this.refreshAudio().catch(e=>this.emit('warning',e.message));});this.obs.on('ReplayBufferSaved',d=>{this.lastSnapshot=d;this.replaySnapshots.set(d.savedReplayPath,d);while(this.replaySnapshots.size>16)this.replaySnapshots.delete(this.replaySnapshots.keys().next().value);if(d.automatic){this.automaticPreservation=this.listenerCount('automatic-replay')?new Promise((complete,fail)=>this.emit('automatic-replay',{detail:d,complete,fail})):Promise.resolve();this.automaticPreservation.catch(error=>this.emit('warning','Tampon geçmişi ham dosyada korundu: '+error.message));}else{if(this.dynamicAudio&&this.listenerCount('saved')){let resolve;const promise=new Promise(done=>resolve=done);this.pendingAudioClaims.set(d.savedReplayPath,{promise,resolve});}this.emit('saved',d.savedReplayPath);}});this.obs.on('AudioReplayWarning',d=>this.emit('warning',d.message||String(d)));this.obs.on('ReplayBufferSaveFailed',d=>this.emit('save-failed',new Error(d.message||'Klip kaydedilemedi.')));this.obs.on('engine-error',e=>this.emit('warning',e));this.obs.on('engine-stopped',()=>{this.audioEpoch++;const wasRunning=this.running;this.running=false;clearInterval(this.audioTimer);clearInterval(this.videoTimer);clearInterval(this.syncTimer);clearInterval(this.healthTimer);this.watcher?.kill();const video=this.video;this.video=null;Promise.allSettled([Promise.resolve(video?.stop()),this.automaticPreservation||Promise.resolve(),...Array.from(this.pendingAudioClaims.values(),claim=>claim.promise)]).then(()=>this.obs.close().catch(()=>{}));this.inputs.clear();this.inputSettings.clear();if(wasRunning)this.emit('warning','Kayıt motoru kapandı. Tampon durdu; yeniden başlatabilirsin.');});}
 async configure(c,bufferDir){await fs.mkdir(bufferDir,{recursive:true});}
 get displays(){return this._displays||[];}
 get displaySelection(){return this._displaySelection||selectDisplay(this.config,this.displays,this.gameMonitorId);}
 publishDisplaySelection(selection){
  if(JSON.stringify(selection)===JSON.stringify(this._displaySelection))return;
  this._displaySelection=selection;this.emit('display-selection',selection);
 }
 async listDisplays(){
  const work=(this.displayQueue||Promise.resolve()).catch(()=>{}).then(async()=>{
   let displays;
   try{
    displays=normalizeDisplays(await this.enumerateDisplays());
    if(this.video){const {propertyItems}=await this.obs.call('GetInputPropertiesListPropertyItems',{inputName:'Klip Ekran',propertyName:'monitor_id'});displays=reconcileDisplays(displays,propertyItems);}
   }catch(error){this.publishDisplaySelection({...this.displaySelection,fallback:true,reason:'enumeration-failed',error:error.message});throw error;}
   await this.acceptDisplays(displays);return this.displays;
  });this.displayQueue=work;return work;
 }
 async acceptDisplays(displays){
  const next=normalizeDisplays(displays);
  if(JSON.stringify(next)!==JSON.stringify(this.displays)){this._displays=next;this.emit('displays',next);}
  await this.applyDisplaySelection();
 }
 async applyDisplaySelection(){
  const selected=selectDisplay(this.config,this.displays,this.gameMonitorId);
  if(!selected.activeMonitorId){this.publishDisplaySelection(selected);throw new Error('Kaydedilecek etkin ekran bulunamadı.');}
  try{if(this.video)await this.video.setDisplay(this.displays.find(display=>display.id===selected.activeMonitorId));}
  catch(error){this.publishDisplaySelection({...selected,activeMonitorId:this.video?.displayMonitorId||this.displaySelection.activeMonitorId,fallback:true,reason:'monitor-switch-failed',error:error.message});throw error;}
  this.publishDisplaySelection(selected);
 }
 async refreshSyncProfile(){
  if(!this.audioSyncProfile)return true;if(this.syncChangePending)return false;
  const endpoint=await this.obs.call('GetDefaultAudioEndpointInfo');
  if(this.running&&this.syncEndpointAtStart&&this.syncEndpointAtStart!==endpoint.endpointId){this.syncChangePending=true;this.emit('audio-device-changed',endpoint);return false;}
  if(!this.syncEndpointAtStart)this.syncEndpointAtStart=endpoint.endpointId;
  const next=resolveAudioSync(this.audioSyncProfile,endpoint);this.syncOffsets=next;this.emit('audio-sync',{...next,name:next.matched?this.audioSyncProfile.name:endpoint.name,endpointId:endpoint.endpointId});return true;
 }
 async ensureInput(name,kind,settings,sceneItemEnabled=true){
  const loopback=kind==='wasapi_output_capture'||kind==='wasapi_process_output_capture'||kind==='ember_system_audio_capture'||kind==='ember_process_audio_capture',offset=name==='Klip Ses Tarayıcı'?0:inputSyncOffset(kind,this.syncOffsets),key=JSON.stringify(settings)+'|'+offset;if(this.inputSettings.get(name)===key)return;
  const o=this.obs;const list=await o.call('GetInputList');if(list.inputs.some(i=>i.inputName===name)){await o.call('SetInputSettings',{inputName:name,inputSettings:settings,overlay:true});if(loopback)await o.call('SetInputAudioSyncOffset',{inputName:name,inputAudioSyncOffset:offset});}
  else await o.call('CreateInput',{sceneName:'Klip',inputName:name,inputKind:kind,inputSettings:settings,sceneItemEnabled,...loopback?{inputAudioSyncOffset:offset}:{}});
  this.inputSettings.set(name,key);
 }
 async start(c,bufferDir){
  if(this.recoveryRequired?.keepAlive)throw new Error('Önce bekleyen tamponu kurtar.');if(this.running)return;
  if(this.obs.socket?.readyState===1)await this.obs.close();
  this.audioEpoch++;this.health=null;this.healthObservedAt=0;this.lastSnapshot=null;this.replaySnapshots.clear();this.recoveryConfirmations.clear();this.recoveryRequired=null;this.pendingAudioClaims.clear();this.automaticPreservation=null;this.focus=null;this.syncEndpointAtStart=null;this.syncChangePending=false;this.syncOffsets=resolveAudioSync(null,null);this.lastWindow=null;this.lastGame='Masaüstü';this.activeGameExe=c.targetExe||null;this.gameMonitorId='';
  this.bufferDir=path.resolve(bufferDir);this.audioSnapshotRoot=path.join(this.bufferDir,'audio-snapshots');this.audioSignature=null;this.audioSources.clear();this.audioApps.clear();this.audioFailures.clear();await this.configure(c,bufferDir);await this.obs.launch(c,bufferDir);this.config=c;
  const o=this.obs;let scenes;for(let attempt=0;attempt<80;attempt++){try{scenes=await o.call('GetSceneList');break;}catch(e){if(attempt===79)throw e;await new Promise(r=>setTimeout(r,250));}}if(!scenes.scenes.some(s=>s.sceneName==='Klip'))await o.call('CreateScene',{sceneName:'Klip'});
  await o.call('SetCurrentProgramScene',{sceneName:'Klip'});
  for(const input of (await o.call('GetInputList')).inputs)if(!input.inputName.startsWith('Klip '))await o.call('SetInputMute',{inputName:input.inputName,inputMuted:true}).catch(()=>{});
  for(const input of (await o.call('GetInputList')).inputs)if(/^Klip Ses [2-5]$/.test(input.inputName))await o.call('SetInputMute',{inputName:input.inputName,inputMuted:true}).catch(()=>{});
  await o.call('SetStudioModeEnabled',{studioModeEnabled:false});
  await o.call('SetVideoSettings',{baseWidth:Number(c.resolution.split('x')[0]),baseHeight:Number(c.resolution.split('x')[1]),outputWidth:Number(c.resolution.split('x')[0]),outputHeight:Number(c.resolution.split('x')[1]),fpsNumerator:c.fps==='custom'?Number(c.customFps):Number(c.fps),fpsDenominator:1});
  const kinds=(await o.call('GetInputKindList')).inputKinds;this.dynamicAudio=kinds.includes('ember_process_audio_capture');this.emit('diagnostic',{kinds,dynamicAudio:this.dynamicAudio});
  const pending=await this.refreshRecoveries();
  if(c.storage!=='ram'){
   const message=pending.some(item=>item.unavailable)?'Bazı kurtarma kayıtları okunamıyor. Ayarlar → Kayıt bölümünden sağlam kayıtları kurtar ve kalan dosyaları arşivle.':pending.length>=4?'Dört kayıt kurtarma bekliyor. Tamponu başlatmadan önce Ayarlar → Kayıt bölümünden kurtar.':'';
   if(message)throw new Error(translate(message,c.language));
  }
  await this.ensureInput('Klip Ekran','monitor_capture',{monitor_id:'DUMMY',capture_cursor:c.cursor,method:0},c.mode!=='game');
  await this.ensureInput('Klip Oyun','game_capture',{capture_mode:'any_fullscreen',capture_cursor:c.cursor,allow_transparency:false,limit_framerate:true,capture_audio:false},false);
  const items=(await o.call('GetSceneItemList',{sceneName:'Klip'})).sceneItems;this.displayId=items.find(i=>i.sourceName==='Klip Ekran').sceneItemId;this.gameId=items.find(i=>i.sourceName==='Klip Oyun').sceneItemId;
  this.video=new VideoSources(o,{config:c,ensureInput:this.ensureInput.bind(this),onChange:source=>this.emit('capture-source',source),onWarning:message=>this.emit('warning',message)});
  await this.video.initialize({displayId:this.displayId,gameId:this.gameId,windowId:items.find(i=>i.sourceName==='Klip Pencere')?.sceneItemId});
  await this.listDisplays();
  if(c.mode!=='screen'){const windows=await o.call('GetInputPropertiesListPropertyItems',{inputName:'Klip Oyun',propertyName:'window'});const target=windows.propertyItems.find(i=>gameProcess(String(i.itemValue).split(':').at(-1),c.targetExe));if(target){const exe=String(target.itemValue).split(':').at(-1);await this.video.setTarget(target.itemValue);this.lastGame=gameName(exe);this.activeGameExe=exe;}else if(c.targetExe&&c.mode==='game')throw new Error('Hedef oyun penceresi bulunamadı. Oyunu açıp dosya adını kontrol et.');}
  await this.updateVisibility(false);
  this.audio=[];await this.refreshAudio();
  if(c.mode==='game'){let ready=false;for(let i=0;i<60;i++){if(await this.video.check()){ready=true;break;}await new Promise(r=>setTimeout(r,200));}if(!ready)throw new Error('Oyun ve Windows pencere yakalama görüntü alamadı. Oyunu açıp hedef adı kontrol et; gerekirse kenarlıksız pencere modunu dene.');}
  await o.call('StartReplayBuffer');this.running=true;this.started=Date.now();
  this.watcher=spawn(path.join(__dirname,'../tools/window-watcher.exe'),c.targetExe?['--target-exe',c.targetExe]:[],{windowsHide:true,stdio:['ignore','pipe','ignore']});let tail='';
  this.watcher.on('error',e=>this.emit('warning','Etkin pencere izlenemiyor: '+e.message));
  this.watcher.stdout.on('data',b=>{tail+=b.toString();const lines=tail.split(/\r?\n/);tail=lines.pop();for(const line of lines)try{this.onFocus(JSON.parse(line)).catch(e=>this.emit('warning',e.message));}catch{}});
  this.audioTimer=setInterval(()=>this.refreshAudio().catch(e=>this.emit('warning',e.message)),this.dynamicAudio?1000:12000);
  if(this.audioSyncProfile)this.syncTimer=setInterval(()=>{if(this.running)this.refreshSyncProfile().catch(e=>{if(this.running)this.emit('warning',e.message);});},1000);
  this.healthTimer=setInterval(()=>{if(this.running)this.obs.call('GetCaptureHealth').then(health=>{this.health=health;this.healthObservedAt=Date.now();this.emit('health',health);}).catch(()=>{});},1000);
  this.videoTimer=setInterval(()=>this.video?.check().catch(e=>this.emit('warning',e.message)),500);
 }
 async updateVisibility(isGame){await this.video?.setFocus(isGame);}
 async onFocus(f){
  const work=(this.focusQueue||Promise.resolve()).catch(()=>{}).then(()=>this.applyFocus(f));this.focusQueue=work;return work;
 }
 async applyFocus(f){
  if(!this.running)return;
  let displayError;
  if(f.displayError){this.publishDisplaySelection({...this.displaySelection,fallback:true,reason:'enumeration-failed',error:f.displayError});displayError=new Error(f.displayError);if(typeof f.exe!=='string')throw displayError;}
  const isGame=gameProcess(f.exe||'',this.config.targetExe);let targetError;
  if(isGame){this.activeGameExe=f.exe;this.lastGame=gameName(f.exe);
   if(this.lastWindow!==f.hwnd){const escape=s=>s.replaceAll('#','#22').replaceAll(':','#3A');try{await this.video?.setTarget([f.title,f.class,f.exe].map(escape).join(':'));this.lastWindow=f.hwnd;}catch(error){targetError=error;}}
  }
  const game=f.gameWindow&&gameProcess(f.gameWindow.exe,this.config.targetExe)?f.gameWindow:isGame?f:null;
  if(game?.monitorId)this.gameMonitorId=game.monitorId;
  try{
   if(displayError)throw displayError;
   if(f.displays){
    let displays;
    try{displays=reconcileDisplays(f.displays,(await this.obs.call('GetInputPropertiesListPropertyItems',{inputName:'Klip Ekran',propertyName:'monitor_id'})).propertyItems);}
    catch(error){this.publishDisplaySelection({...this.displaySelection,fallback:true,reason:'enumeration-failed',error:error.message});throw error;}
    await this.acceptDisplays(displays);
   }else if(this.displays.length)await this.applyDisplaySelection();
  }catch(error){displayError=error;}
  if(this.focus!==isGame){this.focus=isGame;await this.updateVisibility(isGame);this.emit('focus',{game:this.lastGame,isGame});if(isGame)this.refreshAudio().catch(()=>{});}
  if(targetError||displayError)throw targetError||displayError;
 }
 async refreshAudio(){
  if(this.recoveryRequired?.keepAlive)return;
  if(this.audioRefreshing){this.audioRefreshPending=true;return;}this.audioRefreshing=true;
  try{if(await this.refreshSyncProfile()===false)return;await this.refreshAudioInputs();}finally{this.audioRefreshing=false;if(this.audioRefreshPending&&this.running){this.audioRefreshPending=false;queueMicrotask(()=>this.refreshAudio().catch(e=>this.emit('warning',e.message)));}}
 }
 async refreshAudioInputs(){
  if(this.dynamicAudio){const epoch=this.audioEpoch;await this.refreshDynamicAudio();if(epoch===this.audioEpoch)await this.ensureBaseAudio();return;}
  const o=this.obs;if(!this.inputs.has('Klip Ses Tarayıcı')){await this.ensureInput('Klip Ses Tarayıcı','wasapi_process_output_capture',{window:'',priority:2});await o.call('SetInputAudioTracks',{inputName:'Klip Ses Tarayıcı',inputAudioTracks:Object.fromEntries([1,2,3,4,5,6].map(n=>[n,false]))});this.inputs.add('Klip Ses Tarayıcı');}
  const probe=(await o.call('GetSceneItemList',{sceneName:'Klip'})).sceneItems.find(i=>i.sourceName==='Klip Ses Tarayıcı');if(probe)await o.call('SetSceneItemEnabled',{sceneName:'Klip',sceneItemId:probe.sceneItemId,sceneItemEnabled:false});
  const props=await o.call('GetInputPropertiesListPropertyItems',{inputName:'Klip Ses Tarayıcı',propertyName:'window'});const candidates=new Map();
  for(const item of props.propertyItems||[]){const value=item.itemValue;if(typeof value!=='string')continue;const exe=value.split(':').at(-1);if(!exe||/obs64|electron|klip\.exe|ember\.exe/i.test(exe))continue;candidates.set(exe,item);}
  const category=exe=>gameProcess(exe,this.config.targetExe)?2:/discord/i.test(exe)?3:/chrome|msedge|firefox|brave/i.test(exe)?4:/spotify|music/i.test(exe)?5:0;
  if(this.config.autoAudio===false)candidates.clear();
  for(const [exe,item]of candidates){const track=category(exe),existing=this.audio.find(a=>a.track===track);if(!track||existing?.exe===exe)continue;if(existing&&candidates.has(existing.exe)&&!(track===2&&exe.toLowerCase()===this.activeGameExe?.toLowerCase()))continue;const name='Klip Ses '+track;await this.ensureInput(name,'wasapi_process_output_capture',{window:item.itemValue,priority:2});await o.call('SetInputAudioTracks',{inputName:name,inputAudioTracks:Object.fromEntries([1,2,3,4,5,6].map(n=>[n,n===track]))});await o.call('SetInputMute',{inputName:name,inputMuted:this.config.audioEnabled?.[track]===false});this.audio=this.audio.filter(a=>a.track!==track);this.audio.push({exe,name:exe.replace(/\.exe$/i,''),track});}
  // Exclude the Electron main process and every renderer/audio utility child.
  // Windows performs this continuously; game audio never ducks around a chime.
  await this.ensureInput('Klip Sistem Sesi','ember_system_audio_capture',{target_process_id:process.pid});await o.call('SetInputAudioTracks',{inputName:'Klip Sistem Sesi',inputAudioTracks:{1:true,2:false,3:false,4:false,5:false,6:false}});
  await this.ensureInput('Klip Mikrofon','wasapi_input_capture',{device_id:'default'});await o.call('SetInputAudioTracks',{inputName:'Klip Mikrofon',inputAudioTracks:{1:this.config.audioEnabled?.[1]!==false,2:false,3:false,4:false,5:false,6:true}});this.emit('audio',this.audio);
  for(const track of [1,2,3,4,5,6]){const assigned=track===1||track===6||this.config.autoAudio!==false&&this.audio.some(a=>a.track===track);const enabled=assigned&&this.config.audioEnabled?.[track]!==false;const name=track===1?'Klip Sistem Sesi':track===6?'Klip Mikrofon':'Klip Ses '+track;await o.call('SetInputMute',{inputName:name,inputMuted:!enabled}).catch(()=>{});}
 }
 async ensureBaseAudio(){
  await this.ensureInput('Klip Sistem Sesi','ember_system_audio_capture',{target_process_id:process.pid});await this.obs.call('SetInputAudioTracks',{inputName:'Klip Sistem Sesi',inputAudioTracks:{1:true,2:false,3:false,4:false,5:false,6:false}});
  await this.ensureInput('Klip Mikrofon','wasapi_input_capture',{device_id:'default'});await this.obs.call('SetInputAudioTracks',{inputName:'Klip Mikrofon',inputAudioTracks:{1:this.config.audioEnabled?.[1]!==false,2:false,3:false,4:false,5:false,6:true}});
  for(const track of [1,6])await this.obs.call('SetInputMute',{inputName:track===1?'Klip Sistem Sesi':'Klip Mikrofon',inputMuted:this.config.audioEnabled?.[track]===false});
 }
 async refreshDynamicAudio(){
  const epoch=this.audioEpoch;const result=await this.obs.call('ListAudioSessions',{excludedProcessId:process.pid}),seen=new Set(),now=Date.now();if(epoch!==this.audioEpoch)return;
  for(const session of this.config.autoAudio===false?[]:result.sessions||[]){
   const identity=String(session.exePath||session.id||session.name).toLowerCase(),id='app:'+crypto.createHash('sha256').update(identity).digest('hex').slice(0,16);
   this.audioApps.set(id,{track:id,id,name:session.name||path.basename(session.exePath||'Uygulama'),exe:session.exePath,lastSeen:now});
   for(const pid of session.roots||[session.processId]){if(!Number.isInteger(pid)||pid<=0||pid===process.pid)continue;const key=id+':'+pid;seen.add(key);if(this.audioSources.has(key)||now<(this.audioFailures.get(key)?.next||0))continue;
    const inputName='Klip Uygulama '+pid;try{
     await this.ensureInput(inputName,'ember_process_audio_capture',{target_process_id:pid});if(epoch!==this.audioEpoch)return;await this.obs.call('SetInputAudioTracks',{inputName,inputAudioTracks:Object.fromEntries([1,2,3,4,5,6].map(n=>[n,false]))});
     await this.obs.call('AttachAudioReplay',{inputName,id,name:session.name||'Uygulama',processId:pid,retentionSeconds:Math.min(360,this.config.duration+60),bufferDir:path.join(this.bufferDir,'application-audio')});
     if(epoch!==this.audioEpoch)return;this.audioSources.set(key,{inputName,id,pid});this.audioFailures.delete(key);
    }catch(error){if(epoch!==this.audioEpoch)return;const previous=this.audioFailures.get(key),attempt=(previous?.attempt||0)+1;this.audioFailures.set(key,{attempt,next:now+Math.min(30000,2500*2**Math.min(attempt-1,4))});if(!previous)this.emit('warning',(session.name||'Uygulama')+' ayrı ses izi başlatılamadı; birleşik ses korunuyor: '+error.message);}
   }
  }
  if(epoch!==this.audioEpoch)return;for(const [key,item]of this.audioSources)if(!seen.has(key)){await this.obs.call('DetachAudioReplay',{inputName:item.inputName});await this.obs.call('RemoveInput',{inputName:item.inputName});this.inputSettings.delete(item.inputName);this.audioSources.delete(key);}
  for(const [id,app]of this.audioApps)if(now-app.lastSeen>(this.config.duration+60)*1000&&!Array.from(this.audioSources.values()).some(source=>source.id===id))this.audioApps.delete(id);
  this.audio=Array.from(this.audioApps.values()).sort((a,b)=>a.name.localeCompare(b.name));const visible=this.audio.map(({track,id,name,exe})=>({track,id,name,exe})),signature=JSON.stringify(visible);if(signature!==this.audioSignature){this.audioSignature=signature;this.emit('audio',visible);}for(const key of this.audioFailures.keys())if(!seen.has(key))this.audioFailures.delete(key);
  const warningKeys=new Set();for(const warning of result.warnings||[]){const message=typeof warning==='string'?warning:warning.message||JSON.stringify(warning);warningKeys.add(message);if(!this.audioWarningKeys.has(message))this.emit('warning',message);}this.audioWarningKeys=warningKeys;
 }
 async setAudioEnabled(track,enabled){
  this.config.audioEnabled={...this.config.audioEnabled,[track]:enabled};if(this.dynamicAudio&&typeof track==='string')return;
  await this.obs.call('SetInputMute',{inputName:track===1?'Klip Sistem Sesi':track===6?'Klip Mikrofon':'Klip Ses '+track,inputMuted:!enabled});
 }
 async refreshRecoveries(){
  if(this.obs.ready){this.recoveryManifests=(await this.obs.call('ListRecoveryManifests')).manifests||[];}
  else if(this.bufferDir){
   const files=await fs.readdir(this.bufferDir).catch(error=>{if(error.code==='ENOENT')return[];throw error;});
   const previous=new Map(this.recoveryManifests.map(item=>[item.manifest,item]));
   this.recoveryManifests=files.filter(recoveryManifestName).map(name=>{
    const manifest=path.join(this.bufferDir,name);
    return previous.get(manifest)||{manifest};
   });
  }
  this.emit('recoveries',this.recoveryManifests);return this.recoveryManifests;
 }
 async recoverReplays(){
  if(!this.bufferDir||!this.config)throw new Error('Kurtarma klasörü hazır değil.');
  if(!this.obs.ready){await this.obs.launch(this.config,this.bufferDir);const kinds=(await this.obs.call('GetInputKindList')).inputKinds;this.dynamicAudio=kinds.includes('ember_process_audio_capture');}
  const manifests=await this.refreshRecoveries(),failures=[];
  for(const recovery of manifests){
   try{
    if(recovery.unavailable)throw new Error(recovery.message);
    await this.obs.call('RecoverReplay',{manifest:recovery.manifest},150000);
    await this.automaticPreservation;
   }catch(error){failures.push(error.message);}
  }
  await this.refreshRecoveries();
  if(failures.length)throw new Error('Bazı kayıtlar kurtarılamadı. Dosyaları arşivleyip yeni bir tampon başlatabilirsin. '+failures[0]);
  return this.recoveryManifests;
 }
 async archiveRecoveries(clipFolder){
  const text=value=>translate(value,this.config?.language);
  if(!this.bufferDir||this.running||this.recoveryRequired?.keepAlive)throw new Error(text('Önce tamponu durdur veya canlı tamponu kurtar.'));
  await this.automaticPreservation?.catch(()=>{});
  await this.obs.close();
  const source=this.bufferDir,info=await fs.lstat(source);
  if(!info.isDirectory()||info.isSymbolicLink())throw new Error(text('Kurtarma klasörü arşivlenemedi.'));
  const resolved=await fs.realpath(source);
  const library=await fs.realpath(clipFolder).catch(error=>{if(error.code==='ENOENT')return path.resolve(clipFolder);throw error;});
  const relative=path.relative(resolved,library);
  if(!relative||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep))throw new Error(text('Klip klasörü tamponun içinde. Arşivlemeden önce farklı bir klip klasörü seç.'));
  const pending=await this.refreshRecoveries();
  if(!pending.length)throw new Error(text('Arşivlenecek kayıt bulunamadı.'));
  // Move the whole cold journal together so unreadable manifests and their
  // relative payload paths survive without being swept by the new buffer.
  const archive=source+'-recovery-'+new Date().toISOString().slice(0,10)+'-'+crypto.randomUUID();
  await fs.rename(source,archive);
  await this.refreshRecoveries();
  return archive;
 }
 async completeRecovery(original){
  const owner=this.owner||this,detail=this.replaySnapshots.get(original)||this.lastSnapshot;
  if(detail?.recoveryManifest){const key=detail.recoveryManifest;if(!owner.recoveryConfirmations.has(key)){const work=owner.obs.call('CompleteRecovery',{manifest:key}).catch(error=>{owner.recoveryConfirmations.delete(key);throw error;});owner.recoveryConfirmations.set(key,work);}await owner.recoveryConfirmations.get(key);}
  owner.recoveryRequired=null;owner.emit('recovery-required',null);if(detail?.recoveryManifest)await owner.refreshRecoveries();
 }
 async snapshotAudio(original){
  try{
   const snapshot=this.replaySnapshots.get(original)||this.lastSnapshot;if(!snapshot?.replayStartMonotonicNs||!snapshot?.replayEndMonotonicNs)throw new Error('Ses izleri için video zaman aralığı doğrulanamadı.');
   const start=BigInt(snapshot.replayStartMonotonicNs),end=BigInt(snapshot.replayEndMonotonicNs);if(end<=start||end-start>301000000000n)throw new Error('Geçersiz ses zaman aralığı.');
   await fs.mkdir(this.audioSnapshotRoot,{recursive:true});if(snapshot.recovered&&!/^\d+-\d+-\d+$/.test(snapshot.snapshotId||''))throw new Error('Invalid recovery identity.');const folder=path.join(this.audioSnapshotRoot,snapshot.recovered?'recovered-'+snapshot.snapshotId:crypto.randomUUID());if(snapshot.recovered)await fs.rm(folder,{recursive:true,force:true});await fs.mkdir(folder);
   if(snapshot.recovered){const result=await this.obs.call('SnapshotRecoveryAudio',{manifest:snapshot.recoveryManifest,folder},120000);return{...result,folder,tracks:this.config.autoAudio===false?[]:(result.tracks||[]).filter(track=>this.config.audioEnabled?.[track.id]!==false)};}
   const result=await this.obs.call('SnapshotAudioReplay',{snapshotId:snapshot.snapshotId,startNs:String(start),endNs:String(end),folder},120000);
   return{...result,folder,tracks:this.config.autoAudio===false?[]:(result.tracks||[]).filter(track=>this.config.audioEnabled?.[track.id]!==false)};
  }finally{const claim=this.pendingAudioClaims.get(original);claim?.resolve();this.pendingAudioClaims.delete(original);}
 }
 async save(){if(!this.running&&!this.recoveryRequired?.keepAlive)throw new Error('Önce tamponu başlat.');return new Promise((resolve,reject)=>{const fail=e=>{clearTimeout(timeout);this.off('saved',done);this.off('save-failed',fail);reject(e);};const done=file=>{clearTimeout(timeout);this.off('save-failed',fail);resolve(file);};const timeout=setTimeout(()=>fail(new Error('Klip kaydedilemedi')),130000);this.once('saved',done);this.once('save-failed',fail);this.obs.call('SaveReplayBuffer').catch(fail);});}
 async stop({discardRecovery=false}={}){
  if(this.recoveryRequired?.keepAlive&&!discardRecovery)throw new Error('Önce bekleyen tamponu kurtar.');
  for(const claim of this.pendingAudioClaims.values())claim.resolve();this.pendingAudioClaims.clear();this.audioEpoch++;this.running=false;clearInterval(this.audioTimer);clearInterval(this.videoTimer);clearInterval(this.syncTimer);clearInterval(this.healthTimer);this.watcher?.kill();await this.video?.stop().catch(()=>{});this.video=null;
  if(this.obs.ready)await this.obs.call('StopReplayBuffer',{},150000);
  await this.automaticPreservation?.catch(()=>{});
  if(this.recoveryRequired?.keepAlive&&!discardRecovery)throw new Error('Önce bekleyen tamponu kurtar.');
  await this.obs.close();this.inputs.clear();this.inputSettings.clear();
 }
}
module.exports={Capture};
