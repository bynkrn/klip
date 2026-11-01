const {OBS}=require('./obs');
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {EventEmitter}=require('node:events');
const {VideoSources}=require('./video-sources');
const {resolveAudioSync,inputSyncOffset}=require('./audio-sync');
const gameProcess=(exe,target)=>target?exe.toLowerCase()===target.toLowerCase():/^(VALORANT.*|cs2|quakelive.*|ddnet.*|r5apex|FortniteClient.*|Overwatch|dota2|RocketLeague|RainbowSix.*)\.exe$/i.test(exe);
const gameName=exe=>/VALORANT/i.test(exe)?'Valorant':/^cs2/i.test(exe)?'Counter-Strike 2':/quakelive/i.test(exe)?'Quake Live':exe.replace(/\.exe$/i,'');
class Capture extends EventEmitter{
 constructor(root,options={}){super();this.audioSyncProfile=options.audioSyncProfile||null;this.syncOffsets=resolveAudioSync(null,null);this.obs=new OBS(root);this.root=root;this.inputs=new Set();this.inputSettings=new Map();this.audio=[];this.lastGame='Masaüstü';this.focus=null;this.running=false;this.obs.on('ReplayBufferSaved',d=>this.emit('saved',d.savedReplayPath));this.obs.on('engine-error',e=>this.emit('warning',e));this.obs.on('engine-stopped',()=>{const wasRunning=this.running;this.running=false;clearInterval(this.audioTimer);clearInterval(this.videoTimer);clearInterval(this.syncTimer);this.watcher?.kill();const video=this.video;this.video=null;Promise.resolve(video?.stop()).catch(()=>{}).finally(()=>this.obs.close().catch(()=>{}));this.inputs.clear();this.inputSettings.clear();if(wasRunning)this.emit('warning','Kayıt motoru kapandı. Tampon durdu; yeniden başlatabilirsin.');});}
 async configure(c,bufferDir){await fs.mkdir(bufferDir,{recursive:true});}
 async refreshSyncProfile(){
  if(!this.audioSyncProfile)return true;if(this.syncChangePending)return false;
  const endpoint=await this.obs.call('GetDefaultAudioEndpointInfo');
  if(this.running&&this.syncEndpointAtStart&&this.syncEndpointAtStart!==endpoint.endpointId){this.syncChangePending=true;this.emit('audio-device-changed',endpoint);return false;}
  if(!this.syncEndpointAtStart)this.syncEndpointAtStart=endpoint.endpointId;
  const next=resolveAudioSync(this.audioSyncProfile,endpoint);this.syncOffsets=next;this.emit('audio-sync',{...next,name:next.matched?this.audioSyncProfile.name:endpoint.name,endpointId:endpoint.endpointId});return true;
 }
 async ensureInput(name,kind,settings,sceneItemEnabled=true){
  const loopback=kind==='wasapi_output_capture'||kind==='wasapi_process_output_capture',offset=name==='Klip Ses Tarayıcı'?0:inputSyncOffset(kind,this.syncOffsets),key=JSON.stringify(settings)+'|'+offset;if(this.inputSettings.get(name)===key)return;
  const o=this.obs;const list=await o.call('GetInputList');if(list.inputs.some(i=>i.inputName===name)){await o.call('SetInputSettings',{inputName:name,inputSettings:settings,overlay:true});if(loopback)await o.call('SetInputAudioSyncOffset',{inputName:name,inputAudioSyncOffset:offset});}
  else await o.call('CreateInput',{sceneName:'Klip',inputName:name,inputKind:kind,inputSettings:settings,sceneItemEnabled,...loopback?{inputAudioSyncOffset:offset}:{}});
  this.inputSettings.set(name,key);
 }
 async start(c,bufferDir){
  if(this.running)return;
  if(this.obs.socket?.readyState===1)await this.obs.close();
  this.focus=null;this.syncEndpointAtStart=null;this.syncChangePending=false;this.syncOffsets=resolveAudioSync(null,null);this.lastWindow=null;this.lastGame='Masaüstü';this.activeGameExe=c.targetExe||null;
  await this.configure(c,bufferDir);await this.obs.launch(c,bufferDir);this.config=c;
  const o=this.obs;let scenes;for(let attempt=0;attempt<80;attempt++){try{scenes=await o.call('GetSceneList');break;}catch(e){if(attempt===79)throw e;await new Promise(r=>setTimeout(r,250));}}if(!scenes.scenes.some(s=>s.sceneName==='Klip'))await o.call('CreateScene',{sceneName:'Klip'});
  await o.call('SetCurrentProgramScene',{sceneName:'Klip'});
  for(const input of (await o.call('GetInputList')).inputs)if(!input.inputName.startsWith('Klip '))await o.call('SetInputMute',{inputName:input.inputName,inputMuted:true}).catch(()=>{});
  for(const input of (await o.call('GetInputList')).inputs)if(/^Klip Ses [2-5]$/.test(input.inputName))await o.call('SetInputMute',{inputName:input.inputName,inputMuted:true}).catch(()=>{});
  await o.call('SetStudioModeEnabled',{studioModeEnabled:false});
  await o.call('SetVideoSettings',{baseWidth:Number(c.resolution.split('x')[0]),baseHeight:Number(c.resolution.split('x')[1]),outputWidth:Number(c.resolution.split('x')[0]),outputHeight:Number(c.resolution.split('x')[1]),fpsNumerator:c.fps==='custom'?Number(c.customFps):Number(c.fps),fpsDenominator:1});
  const kinds=(await o.call('GetInputKindList')).inputKinds;this.emit('diagnostic',{kinds});
  await this.ensureInput('Klip Ekran','monitor_capture',{monitor:0,capture_cursor:c.cursor,method:0},c.mode!=='game');
  const monitors=await o.call('GetInputPropertiesListPropertyItems',{inputName:'Klip Ekran',propertyName:'monitor_id'});
  const monitor=monitors.propertyItems.find(m=>/0,\s*0|primary|birincil/i.test(m.itemName))||monitors.propertyItems[0];
  if(!monitor)throw new Error('Kaydedilecek ekran bulunamadı.');
  await o.call('SetInputSettings',{inputName:'Klip Ekran',inputSettings:{monitor_id:monitor.itemValue,capture_cursor:c.cursor,method:0},overlay:true});
  await this.ensureInput('Klip Oyun','game_capture',{capture_mode:'any_fullscreen',capture_cursor:c.cursor,allow_transparency:false,limit_framerate:true,capture_audio:false},false);
  const items=(await o.call('GetSceneItemList',{sceneName:'Klip'})).sceneItems;this.displayId=items.find(i=>i.sourceName==='Klip Ekran').sceneItemId;this.gameId=items.find(i=>i.sourceName==='Klip Oyun').sceneItemId;
  this.video=new VideoSources(o,{config:c,ensureInput:this.ensureInput.bind(this),onChange:source=>this.emit('capture-source',source),onWarning:message=>this.emit('warning',message)});
  await this.video.initialize({displayId:this.displayId,gameId:this.gameId,windowId:items.find(i=>i.sourceName==='Klip Pencere')?.sceneItemId});
  if(c.mode!=='screen'){const windows=await o.call('GetInputPropertiesListPropertyItems',{inputName:'Klip Oyun',propertyName:'window'});const target=windows.propertyItems.find(i=>gameProcess(String(i.itemValue).split(':').at(-1),c.targetExe));if(target){const exe=String(target.itemValue).split(':').at(-1);await this.video.setTarget(target.itemValue);this.lastGame=gameName(exe);this.activeGameExe=exe;}else if(c.targetExe&&c.mode==='game')throw new Error('Hedef oyun penceresi bulunamadı. Oyunu açıp dosya adını kontrol et.');}
  await this.updateVisibility(false);
  this.audio=[];await this.refreshAudio();
  if(c.mode==='game'){let ready=false;for(let i=0;i<60;i++){if(await this.video.check()){ready=true;break;}await new Promise(r=>setTimeout(r,200));}if(!ready)throw new Error('Oyun ve Windows pencere yakalama görüntü alamadı. Oyunu açıp hedef adı kontrol et; gerekirse kenarlıksız pencere modunu dene.');}
  await o.call('StartReplayBuffer');this.running=true;this.started=Date.now();
  this.watcher=spawn(path.join(__dirname,'../tools/window-watcher.exe'),[],{windowsHide:true,stdio:['ignore','pipe','ignore']});let tail='';
  this.watcher.on('error',e=>this.emit('warning','Etkin pencere izlenemiyor: '+e.message));
  this.watcher.stdout.on('data',b=>{tail+=b.toString();const lines=tail.split(/\r?\n/);tail=lines.pop();for(const line of lines)try{this.onFocus(JSON.parse(line)).catch(e=>this.emit('warning',e.message));}catch{}});
  this.audioTimer=setInterval(()=>this.refreshAudio().catch(e=>this.emit('warning',e.message)),12000);
  if(this.audioSyncProfile)this.syncTimer=setInterval(()=>{if(this.running)this.refreshSyncProfile().catch(e=>{if(this.running)this.emit('warning',e.message);});},1000);
  this.videoTimer=setInterval(()=>this.video?.check().catch(e=>this.emit('warning',e.message)),500);
 }
 async updateVisibility(isGame){await this.video?.setFocus(isGame);}
 async onFocus(f){
  const work=(this.focusQueue||Promise.resolve()).catch(()=>{}).then(()=>this.applyFocus(f));this.focusQueue=work;return work;
 }
 async applyFocus(f){
  if(!this.running)return;const isGame=gameProcess(f.exe,this.config.targetExe);let targetError;
  if(isGame){this.activeGameExe=f.exe;this.lastGame=gameName(f.exe);
   if(this.lastWindow!==f.hwnd){const escape=s=>s.replaceAll('#','#22').replaceAll(':','#3A');try{await this.video?.setTarget([f.title,f.class,f.exe].map(escape).join(':'));this.lastWindow=f.hwnd;}catch(error){targetError=error;}}
  }
  if(this.focus!==isGame){this.focus=isGame;await this.updateVisibility(isGame);this.emit('focus',{game:this.lastGame,isGame});if(isGame)this.refreshAudio().catch(()=>{});}
  if(targetError)throw targetError;
 }
 async refreshAudio(){
  if(this.audioRefreshing)return;this.audioRefreshing=true;
  try{if(await this.refreshSyncProfile()===false)return;await this.refreshAudioInputs();}finally{this.audioRefreshing=false;}
 }
 async refreshAudioInputs(){
  const o=this.obs;if(!this.inputs.has('Klip Ses Tarayıcı')){await this.ensureInput('Klip Ses Tarayıcı','wasapi_process_output_capture',{window:'',priority:2});await o.call('SetInputAudioTracks',{inputName:'Klip Ses Tarayıcı',inputAudioTracks:Object.fromEntries([1,2,3,4,5,6].map(n=>[n,false]))});this.inputs.add('Klip Ses Tarayıcı');}
  const probe=(await o.call('GetSceneItemList',{sceneName:'Klip'})).sceneItems.find(i=>i.sourceName==='Klip Ses Tarayıcı');if(probe)await o.call('SetSceneItemEnabled',{sceneName:'Klip',sceneItemId:probe.sceneItemId,sceneItemEnabled:false});
  const props=await o.call('GetInputPropertiesListPropertyItems',{inputName:'Klip Ses Tarayıcı',propertyName:'window'});const candidates=new Map();
  for(const item of props.propertyItems||[]){const value=item.itemValue;if(typeof value!=='string')continue;const exe=value.split(':').at(-1);if(!exe||/obs64|electron|klip\.exe/i.test(exe))continue;candidates.set(exe,item);}
  const category=exe=>gameProcess(exe,this.config.targetExe)?2:/discord/i.test(exe)?3:/chrome|msedge|firefox|brave/i.test(exe)?4:/spotify|music/i.test(exe)?5:0;
  if(this.config.autoAudio===false)candidates.clear();
  for(const [exe,item]of candidates){const track=category(exe),existing=this.audio.find(a=>a.track===track);if(!track||existing?.exe===exe)continue;if(existing&&candidates.has(existing.exe)&&!(track===2&&exe.toLowerCase()===this.activeGameExe?.toLowerCase()))continue;const name='Klip Ses '+track;await this.ensureInput(name,'wasapi_process_output_capture',{window:item.itemValue,priority:2});await o.call('SetInputAudioTracks',{inputName:name,inputAudioTracks:Object.fromEntries([1,2,3,4,5,6].map(n=>[n,n===track]))});await o.call('SetInputMute',{inputName:name,inputMuted:this.config.audioEnabled?.[track]===false});this.audio=this.audio.filter(a=>a.track!==track);this.audio.push({exe,name:exe.replace(/\.exe$/i,''),track});}
  await this.ensureInput('Klip Sistem Sesi','wasapi_output_capture',{device_id:'default'});await o.call('SetInputAudioTracks',{inputName:'Klip Sistem Sesi',inputAudioTracks:{1:true,2:false,3:false,4:false,5:false,6:false}});
  await this.ensureInput('Klip Mikrofon','wasapi_input_capture',{device_id:'default'});await o.call('SetInputAudioTracks',{inputName:'Klip Mikrofon',inputAudioTracks:{1:this.config.audioEnabled?.[1]!==false,2:false,3:false,4:false,5:false,6:true}});this.emit('audio',this.audio);
  for(const track of [1,2,3,4,5,6]){const assigned=track===1||track===6||this.config.autoAudio!==false&&this.audio.some(a=>a.track===track);const enabled=assigned&&this.config.audioEnabled?.[track]!==false;const name=track===1?'Klip Sistem Sesi':track===6?'Klip Mikrofon':'Klip Ses '+track;await o.call('SetInputMute',{inputName:name,inputMuted:!enabled}).catch(()=>{});}
 }
 async save(){if(!this.running)throw new Error('Önce tamponu başlat.');return new Promise((resolve,reject)=>{const fail=e=>{clearTimeout(timeout);this.off('saved',done);reject(e);};const done=file=>{clearTimeout(timeout);resolve(file);};const timeout=setTimeout(()=>fail(new Error('Klip kaydedilemedi')),20000);this.once('saved',done);this.obs.call('SaveReplayBuffer').catch(fail);});}
 async stop(){this.running=false;clearInterval(this.audioTimer);clearInterval(this.videoTimer);clearInterval(this.syncTimer);this.watcher?.kill();await this.video?.stop().catch(()=>{});this.video=null;await this.obs.close();this.inputs.clear();this.inputSettings.clear();}
}
module.exports={Capture};
