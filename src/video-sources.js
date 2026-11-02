// All sources share the existing scene/encoder. Switching never changes output settings.
class VideoSources {
 constructor(obs,{config,ensureInput,now=Date.now,onChange=()=>{},onWarning=()=>{}}){
  this.obs=obs;this.config=config;this.ensureInput=ensureInput;this.now=now;
  this.onChange=onChange;this.onWarning=onWarning;this.enabled=new Map();
  this.method='game';this.target='';this.pendingTarget=null;this.focus=false;this.serial=Promise.resolve();
  this.stopped=false;this.failedSince=null;this.probing=false;this.windowUnavailable=false;this.hadGameImage=false;
 }
 enqueue(fn){const result=this.serial.then(()=>this.stopped?undefined:fn());this.serial=result.catch(()=>{});return result;}
 get wanted(){return this.config.mode==='game'||this.config.mode==='auto'&&this.focus;}
 async setEnabled(id,enabled){if(id==null||this.enabled.get(id)===enabled)return;await this.obs.call('SetSceneItemEnabled',{sceneName:'Klip',sceneItemId:id,sceneItemEnabled:enabled});this.enabled.set(id,enabled);}
 async geometry(id){const [width,height]=this.config.resolution.split('x').map(Number);await this.obs.call('SetSceneItemTransform',{sceneName:'Klip',sceneItemId:id,sceneItemTransform:{positionX:0,positionY:0,rotation:0,scaleX:1,scaleY:1,cropLeft:0,cropTop:0,cropRight:0,cropBottom:0,boundsType:this.config.stretch?'OBS_BOUNDS_STRETCH':'OBS_BOUNDS_SCALE_INNER',boundsWidth:width,boundsHeight:height,boundsAlignment:5}});}
 async visibility(){
  await this.setEnabled(this.displayId,this.config.mode!=='game');
  if(this.pendingTarget){await this.setEnabled(this.gameId,false);await this.setEnabled(this.windowId,false);return;}
  if(this.method==='window'){
   await this.setEnabled(this.windowId,this.wanted);
   await this.setEnabled(this.gameId,false);
  }else{
   await this.setEnabled(this.gameId,this.wanted);
   await this.setEnabled(this.windowId,this.wanted&&this.probing);
  }
 }
 initialize({displayId,gameId,windowId}){return this.enqueue(async()=>{
  this.displayId=displayId;this.gameId=gameId;this.windowId=windowId;
  await this.setEnabled(gameId,false);await this.setEnabled(windowId,false);
  for(const id of [displayId,gameId,windowId].filter(id=>id!=null))await this.geometry(id);
  await this.obs.call('SetSceneItemIndex',{sceneName:'Klip',sceneItemId:gameId,sceneItemIndex:windowId==null?1:2});
  this.failedSince=this.now();await this.visibility();
 });}
 setTarget(selector){return this.enqueue(()=>this.bindTarget(selector));}
 async bindTarget(selector){
  if(!selector||selector===this.target)return;
  const previous=this.method;this.pendingTarget=selector;
  try{
   await this.setEnabled(this.gameId,false);await this.setEnabled(this.windowId,false);
   this.method='game';this.probing=false;this.windowUnavailable=false;this.failedSince=this.now();this.hadGameImage=false;
   // Quake Live's OpenGL shared-texture transport can retain a stale frame.
   // Shared memory avoids that interop path; other games keep texture capture.
   const compatibility=/^quakelive(?:_steam)?\.exe$/i.test(selector.split(':').at(-1));
   await this.obs.call('SetInputSettings',{inputName:'Klip Oyun',inputSettings:{capture_mode:'window',window:selector,priority:2,sli_compatibility:compatibility},overlay:true});
   if(this.windowId!=null)await this.obs.call('SetInputSettings',{inputName:'Klip Pencere',inputSettings:{window:selector,priority:2,method:2},overlay:true});
   this.pendingTarget=null;await this.visibility();this.target=selector;
   if(previous!=='game')this.onChange({method:'game',target:selector});
  }catch(error){this.target='';this.pendingTarget=selector;this.enabled.clear();await this.setEnabled(this.gameId,false).catch(()=>{});await this.setEnabled(this.windowId,false).catch(()=>{});throw error;}
 }
 setFocus(isGame){return this.enqueue(async()=>{if(this.focus!==isGame&&isGame)this.failedSince=this.now();this.focus=isGame;await this.visibility();});}
 async ready(id){if(id==null)return false;const {sceneItemTransform:t}=await this.obs.call('GetSceneItemTransform',{sceneName:'Klip',sceneItemId:id});return t.sourceWidth>0&&t.sourceHeight>0;}
 async prepareWindow(){
  await this.ensureInput('Klip Pencere','window_capture',{window:this.target,priority:2,method:2,cursor:this.config.cursor,client_area:true,capture_audio:false},false);
  const {sceneItems}=await this.obs.call('GetSceneItemList',{sceneName:'Klip'});
  this.windowId=sceneItems.find(i=>i.sourceName==='Klip Pencere')?.sceneItemId;
  if(this.windowId==null)throw new Error('Windows pencere kaynağı oluşturulamadı.');
  await this.geometry(this.windowId);
  await this.obs.call('SetSceneItemIndex',{sceneName:'Klip',sceneItemId:this.windowId,sceneItemIndex:1});
  await this.obs.call('SetSceneItemIndex',{sceneName:'Klip',sceneItemId:this.gameId,sceneItemIndex:2});
  this.probing=true;await this.visibility();
 }
 check(){
  if(this.checking)return this.checking;
  const work=this.enqueue(async()=>{
   if(!this.wanted)return false;
   if(this.pendingTarget)await this.bindTarget(this.pendingTarget);
   if(this.method==='window')return this.ready(this.windowId);
   if(await this.ready(this.gameId)){
    this.failedSince=null;this.hadGameImage=true;
    if(this.probing){this.probing=false;await this.setEnabled(this.windowId,false);}
    return true;
   }
   if(this.failedSince==null)this.failedSince=this.now();
   if(!this.hadGameImage&&this.now()-this.failedSince<2500||!this.target||this.windowUnavailable)return false;
   if(!this.probing){try{await this.prepareWindow();}catch(error){this.windowUnavailable=true;this.onWarning('Windows pencere yakalama açılamadı: '+error.message);return false;}}
   if(!await this.ready(this.windowId))return false;
   this.method='window';this.probing=false;await this.visibility();
   this.onChange({method:'window',target:this.target});return true;
  });
  this.checking=work;work.then(()=>{this.checking=null;},()=>{this.checking=null;});return work;
 }
 async stop(){this.stopped=true;await this.serial;await this.setEnabled(this.gameId,false);await this.setEnabled(this.windowId,false);}
}
module.exports={VideoSources};
