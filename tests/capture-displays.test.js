const {test}=require('node:test'),assert=require('node:assert/strict');
const {Capture}=require('../src/capture'),{VideoSources}=require('../src/video-sources');
const primary={id:'primary-device-id',name:'Main',width:1920,height:1080,x:0,y:0,primary:true,available:true};
const second={id:'second-device-id',name:'Side',width:1280,height:1024,x:-1280,y:0,primary:false,available:true};
async function fixture(config={}){
 const state={native:[primary,second],calls:[]};
 const capture=new Capture('unused',{enumerateDisplays:async()=>{if(state.error)throw state.error;return state.native;}});
 capture.config={mode:'auto',resolution:'1920x1080',stretch:true,cursor:false,targetExe:'quakelive.exe',...config};
 capture.obs.call=async(type,data={})=>{state.calls.push({type,...data});if(type==='GetInputPropertiesListPropertyItems')return{propertyItems:state.native.map(d=>({itemName:d.name,itemValue:d.id,itemEnabled:true}))};return{};};
 await capture.listDisplays();
 capture.video=new VideoSources(capture.obs,{config:capture.config,ensureInput:async()=>{}});
 await capture.video.initialize({displayId:1,gameId:2});capture.running=true;capture.refreshAudio=async()=>{};
 await capture.applyDisplaySelection();state.calls=[];
 return{capture,state};
}
test('display choices are available before the capture engine starts without launching it',async()=>{
 const capture=new Capture('unused',{enumerateDisplays:async()=>[second,primary]});
 const displays=await capture.listDisplays();assert.deepEqual(displays,[second,primary]);assert.equal(capture.obs.ready,false);
 assert.equal(capture.displaySelection.activeMonitorId,primary.id);
});
test('moving the same game window follows its monitor and retains it while Ember is foreground',async()=>{
 const {capture,state}=await fixture({followGameMonitor:true});
 await capture.onFocus({exe:'quakelive.exe',hwnd:41,title:'Quake',class:'Quake',monitorId:primary.id});
 state.calls=[];
 await capture.onFocus({exe:'quakelive.exe',hwnd:41,title:'Quake',class:'Quake',monitorId:second.id});
 assert.equal(capture.displaySelection.activeMonitorId,second.id);
 const switches=state.calls.filter(call=>call.type==='SetInputSettings'&&call.inputName==='Klip Ekran');assert.equal(switches.length,1);assert.equal(switches[0].inputSettings.monitor_id,second.id);
 const settings=state.calls.indexOf(switches[0]),geometry=state.calls.findIndex(call=>call.type==='SetSceneItemTransform'&&call.sceneItemId===1);assert(geometry>settings);
 assert.equal(state.calls[geometry].sceneItemTransform.boundsType,'OBS_BOUNDS_STRETCH');assert.equal(state.calls[geometry].sceneItemTransform.boundsWidth,1920);assert.equal(state.calls[geometry].sceneItemTransform.boundsHeight,1080);
 await capture.onFocus({exe:'Ember.exe',hwnd:99,title:'Ember',class:'App',monitorId:primary.id,gameWindow:{exe:'quakelive.exe',hwnd:41,monitorId:second.id}});
 assert.equal(capture.displaySelection.activeMonitorId,second.id);
 assert.equal(state.calls.filter(call=>call.type==='SetInputSettings'&&call.inputName==='Klip Ekran').length,1);
 assert(!state.calls.some(call=>/ReplayBuffer|VideoSettings|Encoder/.test(call.type)));
});
test('a tracked game moving in the background updates the followed monitor',async()=>{
 const {capture}=await fixture({followGameMonitor:true});
 await capture.onFocus({exe:'explorer.exe',hwnd:99,monitorId:primary.id,gameWindow:{exe:'quakelive.exe',hwnd:41,monitorId:second.id}});
 assert.equal(capture.displaySelection.activeMonitorId,second.id);
});
test('explicit monitor choice stays steady when follow is disabled',async()=>{
 const {capture,state}=await fixture({monitorId:second.id,followGameMonitor:false});
 await capture.onFocus({exe:'quakelive.exe',hwnd:41,title:'Quake',class:'Quake',monitorId:primary.id});
 await capture.onFocus({exe:'Ember.exe',hwnd:99,monitorId:primary.id});
 assert.equal(capture.displaySelection.activeMonitorId,second.id);assert(!state.calls.some(call=>call.type==='SetInputSettings'&&call.inputName==='Klip Ekran'));
});
test('monitor disconnection falls back in place, reports the missing saved choice, and reconnect restores it',async()=>{
 const {capture,state}=await fixture({monitorId:second.id});const changes=[];capture.on('display-selection',s=>changes.push(s));
 state.native=[primary];await capture.listDisplays();assert.equal(capture.displaySelection.activeMonitorId,primary.id);assert.equal(capture.displaySelection.fallback,true);assert.equal(changes.at(-1).reason,'selected-monitor-unavailable');assert.equal(capture.config.monitorId,second.id);
 state.native=[second,primary];await capture.listDisplays();assert.equal(capture.displaySelection.activeMonitorId,second.id);assert.equal(capture.displaySelection.fallback,false);
 assert(!state.calls.some(call=>/ReplayBuffer|VideoSettings|Encoder/.test(call.type)));
});
test('enumeration failure preserves the last proven source and exposes the error',async()=>{
 const {capture,state}=await fixture({monitorId:second.id});state.error=new Error('enumeration unavailable');
 await assert.rejects(capture.listDisplays(),/enumeration unavailable/);assert.equal(capture.displaySelection.activeMonitorId,second.id);assert.equal(capture.displaySelection.reason,'enumeration-failed');assert.deepEqual(capture.displays,[primary,second]);assert(!state.calls.some(call=>call.type==='SetInputSettings'));
});
test('following a game monitor never enables desktop capture in game-only mode',async()=>{
 const {capture,state}=await fixture({mode:'game',followGameMonitor:true});
 await capture.onFocus({exe:'quakelive.exe',hwnd:41,title:'Quake',class:'Quake',monitorId:second.id});
 await capture.onFocus({exe:'explorer.exe',hwnd:99,monitorId:primary.id});
 assert.equal(capture.video.enabled.get(1),false);assert(!state.calls.some(call=>call.type==='SetSceneItemEnabled'&&call.sceneItemId===1&&call.sceneItemEnabled));
});
test('monitor changes and source transforms remain serialized across rapid focus updates',async()=>{
 const {capture,state}=await fixture({followGameMonitor:true});
 await Promise.all([capture.onFocus({exe:'quakelive.exe',hwnd:41,title:'Quake',class:'Quake',monitorId:second.id}),capture.onFocus({exe:'quakelive.exe',hwnd:41,title:'Quake',class:'Quake',monitorId:primary.id})]);
 const writes=state.calls.filter(call=>call.type==='SetInputSettings'&&call.inputName==='Klip Ekran'||call.type==='SetSceneItemTransform'&&call.sceneItemId===1);
 assert.deepEqual(writes.map(call=>call.type),['SetInputSettings','SetSceneItemTransform','SetInputSettings','SetSceneItemTransform']);
 assert.equal(capture.displaySelection.activeMonitorId,primary.id);
});
test('a display enumeration error cannot leave desktop visible over a newly focused game',async()=>{
 const {capture}=await fixture({followGameMonitor:true});
 capture.obs.call=async(type)=>{if(type==='GetInputPropertiesListPropertyItems')throw new Error('properties unavailable');return{};};
 await assert.rejects(capture.onFocus({exe:'quakelive.exe',hwnd:41,title:'Quake',class:'Quake',monitorId:second.id,displays:[primary,second]}),/properties unavailable/);
 assert.equal(capture.video.enabled.get(1),false);assert.equal(capture.focus,true);assert.equal(capture.displaySelection.reason,'enumeration-failed');
});
test('watcher enumeration errors preserve the proven monitor until a successful topology refresh',async()=>{
 const {capture,state}=await fixture({monitorId:second.id});
 await assert.rejects(capture.onFocus({displayError:'display enumeration failed'}),/display enumeration failed/);
 assert.equal(capture.displaySelection.activeMonitorId,second.id);assert.equal(capture.displaySelection.reason,'enumeration-failed');assert(!state.calls.some(call=>call.type==='SetInputSettings'));
 await capture.onFocus({exe:'explorer.exe',hwnd:99,displays:[primary,second]});assert.equal(capture.displaySelection.reason,'selected-monitor');
});
test('a watcher display failure still hides desktop when its foreground record is a game',async()=>{
 const {capture}=await fixture({followGameMonitor:true});
 await assert.rejects(capture.onFocus({exe:'quakelive.exe',hwnd:41,title:'Quake',class:'Quake',monitorId:second.id,displayError:'display enumeration failed'}),/display enumeration failed/);
 assert.equal(capture.video.enabled.get(1),false);assert.equal(capture.focus,true);assert.equal(capture.displaySelection.reason,'enumeration-failed');
});
test('monitor switching preserves a native display fallback to Windows Graphics Capture',async()=>{
 const {capture}=await fixture({followGameMonitor:true});
 const nativeSettings={method:2,monitor_id:primary.id};const call=capture.obs.call;
 capture.obs.call=async(type,data)=>{if(type==='SetInputSettings'&&data.inputName==='Klip Ekran')Object.assign(nativeSettings,data.inputSettings);return call(type,data);};
 await capture.onFocus({exe:'quakelive.exe',hwnd:41,title:'Quake',class:'Quake',monitorId:second.id});
 assert.equal(nativeSettings.monitor_id,second.id);assert.equal(nativeSettings.method,2);
});
test('monitor resolution changes refresh only geometry and retain fit mode without redundant writes',async()=>{
 const {capture,state}=await fixture({monitorId:second.id,stretch:false});
 state.native=[primary,{...second,width:1024,height:1280}];await capture.listDisplays();await capture.listDisplays();
 assert(!state.calls.some(call=>call.type==='SetInputSettings'&&call.inputName==='Klip Ekran'));
 const transforms=state.calls.filter(call=>call.type==='SetSceneItemTransform'&&call.sceneItemId===1);assert.equal(transforms.length,1);assert.equal(transforms[0].sceneItemTransform.boundsType,'OBS_BOUNDS_SCALE_INNER');assert.equal(transforms[0].sceneItemTransform.boundsWidth,1920);assert.equal(transforms[0].sceneItemTransform.boundsHeight,1080);
});
