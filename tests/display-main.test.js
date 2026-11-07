const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{captureSettingsChanged}=require('../src/settings-policy');
const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
function harness(running=false){
 const handlers={},writes=[],state={monitorId:'',followGameMonitor:false,qualityMode:'quality',videoBitrate:60,storage:'disk',language:'tr',mode:'auto',duration:120,resolution:'1920x1080',fps:'60',customFps:90,folder:path.resolve('clips')};
 const h={path,state,defaults:{monitorId:'',followGameMonitor:false},capture:{running},captureSettingsChanged,isDeepStrictEqual:require('node:util').isDeepStrictEqual,notificationSounds:{validate:async()=>{},settings:async c=>c},refreshTray(){},fs:{writeFile:async(file,body)=>writes.push(JSON.parse(body))},stateFile:'unused',handle:(name,fn)=>handlers[name]=fn};vm.createContext(h);const start=source.indexOf("handle('settings',"),end=source.indexOf("\nhandle('toggle'",start);vm.runInContext(source.slice(start,end),h);return{h,writes,settings:handlers.settings};
}
test('exact monitor interface identifiers and optional follow are saved without modifying source dimensions',async()=>{
 const {h,writes,settings}=harness(),id='\\\\?\\DISPLAY#Türkçe Ekran#Device';const saved=await settings({monitorId:id,followGameMonitor:true});assert.equal(saved.monitorId,id);assert.equal(saved.followGameMonitor,true);assert.equal(saved.resolution,'1920x1080');assert.equal(saved.fps,'60');assert.equal(writes.length,1);assert.equal(h.capture.running,false);
});
test('monitor preference changes reject malformed IDs and cannot interrupt a running buffer',async()=>{
 for(const id of ['bad\0id','x'.repeat(1025)]){const {settings,writes}=harness();await assert.rejects(settings({monitorId:id}),/Geçersiz ekran/);assert.equal(writes.length,0);}
 for(const patch of [{monitorId:'display-two'},{followGameMonitor:true}]){const {settings,writes}=harness(true);await assert.rejects(settings(patch),/tamponu durdur/);assert.equal(writes.length,0);}
});
test('enumeration IPC uses current stopped preferences and never replaces an active capture config',async()=>{
 const handlers={},h={state:{monitorId:'new-choice',followGameMonitor:true},capture:{running:false,config:{monitorId:'old-choice'},listDisplays:async()=>[{id:'new-choice'}],get displaySelection(){return{requestedMonitorId:this.config.monitorId};}},trackOperation:fn=>fn(),handle:(name,fn)=>handlers[name]=fn};vm.createContext(h);vm.runInContext(source.split(/\r?\n/).find(line=>line.startsWith("handle('capture-displays',")),h);const result=await handlers['capture-displays']();assert.equal(result.selection.requestedMonitorId,'new-choice');h.capture.running=true;h.capture.config={monitorId:'running-choice'};await handlers['capture-displays']();assert.equal(h.capture.config.monitorId,'running-choice');
});
