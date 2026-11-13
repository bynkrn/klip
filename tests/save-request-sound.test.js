const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../src/index.html'),'utf8');
function fixture(){let acknowledge,finish;const calls=[];const context={displaySettings:{receive(){}},saving:false,running:true,buffered:0,config:{sound:true},clips:[],games:[],nativeAudio:[],renderBuffer(){},renderClips(){},renderAudio(){},receiveUpdateState(){},notify(){},chime(){calls.push('sound');},window:{klip:{onState:fn=>acknowledge=fn,call:()=>new Promise(resolve=>finish=resolve)}}};vm.createContext(context);const a=html.indexOf('async function saveClip(){'),b=html.indexOf('function setSettingsTab(',a);vm.runInContext(html.slice(a,b),context);const c=html.indexOf('window.klip.onState(s=>{'),d=html.indexOf('});',c);vm.runInContext(html.slice(c,d+3),context);return{context,calls,ack:data=>acknowledge(data),finish:()=>finish([])};}
test('button save stays silent while publication is pending and plays only on the saved cue',async()=>{
 const h=fixture(),pending=h.context.saveClip();
 h.ack({saving:true,message:'Preparing clip'});
 assert.deepEqual(h.calls,[]);
 h.ack({clipSavedCue:true});
 h.finish();
 await pending;
 h.ack({saved:true,clips:[]});
 assert.deepEqual(h.calls,['sound']);
});
test('global and tray saves share the saved cue and honor the sound preference',()=>{
 const h=fixture();
 h.ack({clipSavedCue:true});
 h.ack({saved:true});
 h.context.config.sound=false;
 h.ack({clipSavedCue:true});
 assert.deepEqual(h.calls,['sound']);
});
test('a failed save clears the busy state without playing the clip cue',()=>{
 const h=fixture();
 h.ack({saving:true});
 assert.equal(h.context.saving,true);
 h.ack({saving:false,message:'disk full'});
 assert.equal(h.context.saving,false);
 assert.deepEqual(h.calls,[]);
});
