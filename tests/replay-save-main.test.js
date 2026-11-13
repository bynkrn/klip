const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
function production(name){const start=source.indexOf('function '+name+'(');assert(start>=0,name+' is implemented');const end=source.indexOf('\n}',start);assert(end>=0);return source.slice(source.slice(start-6,start)==='async '?start-6:start,end+2);}
// Evaluate the actual main-process functions; only file/media boundaries are
// replaced, so an accidental library rescan or eager thumbnail is observable.
function harness(extra={}){const h={path,crypto,performance,console,Date,Map,sync:{existsSync:()=>false},fs:{mkdir:async()=>{}},app:{getPath:()=>'/cache'},clipMetadata:new (require('../src/clip-metadata').ClipMetadata)({file:path.join(require('node:os').tmpdir(),'ember-unused-metadata-test.json')}),previewQueue:{run:job=>job(),wake(){}},cache:new Map(),known:new Map(),librarySnapshot:[],publicationRevision:0,publishedClips:new Map(),state:{folder:'/clips'},asset:value=>{h.assets.push(value);return 'klipmedia://local/'+h.assets.length;},assets:[],probe:async()=>{throw new Error('unexpected probe');},run:async()=>{throw new Error('unexpected media work');},status:()=>{},...extra};vm.createContext(h);for(const name of ['clipKey','clipDescription','describe','library'])vm.runInContext(production(name),h);return h;}
const item={id:'/clips/Game/new.mp4',file:'/clips/Game/new.mp4',game:'Game',mtime:1700000000000,size:200};
const media={streams:[{codec_type:'video',codec_name:'h264',width:1920,height:1080,avg_frame_rate:'60000/1001'},{codec_type:'audio',codec_name:'aac',tags:{title:'Oyun'}}],format:{duration:'20'}};

test('a saved descriptor uses its verified probe and defers thumbnail until media is requested',async()=>{
 let thumbnails=0;const h=harness({run:async()=>{thumbnails++;},fs:{mkdir:async()=>{}}});
 const clip=h.clipDescription(item,media,{lazyThumbnail:true});
 assert.equal(clip.seconds,20);assert.equal(clip.resolution,'1920x1080');assert.equal(clip.tracks,1);assert.equal(clip.audio[0].name,'Oyun');assert.equal(thumbnails,0);assert.equal(h.assets.filter(value=>typeof value==='function').length,1);
 const thumbnail=h.assets.find(value=>typeof value==='function');await Promise.all([thumbnail(),thumbnail()]);assert.equal(thumbnails,1);
});

test('an initial library scan cannot overwrite a clip published while its probe was pending',async()=>{
 let release;const blocked=new Promise(resolve=>release=resolve),old={...item,id:'/clips/Game/old.mp4',file:'/clips/Game/old.mp4'};
 const h=harness({files:{scan:async()=>[old]},probe:async()=>{await blocked;return media;},run:async()=>{}});
 const pending=h.library();await new Promise(resolve=>setImmediate(resolve));
 const saved={...item,mtime:item.mtime+1,seconds:20};h.publicationRevision++;h.publishedClips.set(saved.id,{revision:h.publicationRevision,clip:saved});h.known.set(saved.id,saved);h.librarySnapshot=[saved];release();
 const clips=await pending;assert.deepEqual(Array.from(clips,clip=>clip.id),[saved.id,old.id]);assert.equal(h.librarySnapshot.length,2);
});

test('overlapping scans both retain a replay published after the older scan began',async()=>{
 let release,calls=0;const blocked=new Promise(resolve=>release=resolve),old={...item,id:'/clips/Game/old.mp4',file:'/clips/Game/old.mp4'};
 const h=harness({files:{scan:async()=>{if(++calls===1){await blocked;return[old];}return[old,item];}},probe:async()=>media});
 const pending=h.library();await new Promise(resolve=>setImmediate(resolve));h.publicationRevision=1;h.known.set(item.id,item);h.publishedClips.set(item.id,{revision:1,clip:item});await h.library();release();assert.equal((await pending).some(clip=>clip.id===item.id),true);
});

test('save returns the new clip and retained imports without rescanning the library',async()=>{
 const imported={id:'/external/import.mp4',game:'İçe aktarılanlar'},h=harness({deleting:false,saving:false,capture:{running:true},saveReplay:async()=>({item,media,timings:{totalMs:1}}),trackOperation:()=>{},console:{info(){}}});h.known.set(imported.id,imported);vm.runInContext(production('saveClipFile'),h);
 const clips=await h.saveClipFile();assert.deepEqual(Array.from(clips,clip=>clip.id),[item.id,imported.id]);assert.equal(h.known.get(item.id),clips[0]);assert.equal(h.saving,false);
});

test('failed publication reports no save success and resets the save guard',async()=>{
 const statuses=[],h=harness({deleting:false,saving:false,capture:{running:true},saveReplay:async()=>{throw new Error('verification failed');},status:(message,data)=>statuses.push({message,...data})});vm.runInContext(production('saveClipFile'),h);
 await assert.rejects(h.saveClipFile(),/verification failed/);assert.equal(h.saving,false);assert.equal(statuses.some(value=>value.message==='Klip kaydedildi'||value.saved),false);assert.equal(h.publicationRevision,0);
});

test('sound preferences accept supported choices and reject invalid volume or sound before persistence',async()=>{
 function settings(){let handler,writes=0;const h={path,isDeepStrictEqual:require('node:util').isDeepStrictEqual,notificationSounds:new (require('../src/notification-sound').NotificationSound)({directory:path.join(require('node:os').tmpdir(),'ember-unused-sound-test'),asset:()=>''}),defaults:{notificationVolume:75,notificationSound:'ember'},state:{notificationVolume:75,notificationSound:'ember',qualityMode:'quality',videoBitrate:60,monitorId:'',followGameMonitor:false,storage:'disk',language:'tr',mode:'auto',duration:120,resolution:'1920x1080',fps:'60',customFps:90,folder:'C:\\clips'},capture:{running:false},refreshTray(){},fs:{writeFile:async()=>writes++},stateFile:'/unused',handle:(_name,fn)=>handler=fn};vm.createContext(h);const start=source.indexOf("handle('settings',"),end=source.indexOf("\nhandle('toggle'",start);vm.runInContext(source.slice(start,end),h);return{change:handler,writes:()=>writes};}
 for(const next of [{notificationVolume:-1},{notificationVolume:101},{notificationVolume:1.5},{notificationVolume:NaN},{notificationSound:'unknown'}]){const h=settings();await assert.rejects(h.change(next),/bildirim/);assert.equal(h.writes(),0);}
 for(const [notificationVolume,notificationSound]of [[0,'soft'],[100,'glass'],[50,'arcade'],[60,'medal'],[75,'ember']]){const h=settings(),result=await h.change({notificationVolume,notificationSound});assert.equal(result.notificationVolume,notificationVolume);assert.equal(result.notificationSound,notificationSound);}
});

test('manual saves play one cue only after publication and reject overlapping or stopped requests',async()=>{
 let finish;
 const gate=new Promise(resolve=>finish=resolve),statuses=[];
 const h=harness({deleting:false,saving:false,capture:{running:true},saveReplay:async()=>{
  await gate;
  return{item,media,timings:{totalMs:1}};
 },console:{info(){}},status:(message,data)=>statuses.push({message,...data})});
 vm.runInContext(production('saveClipFile'),h);
 const pending=h.saveClipFile({notifyOnSuccess:true});
 assert.equal(h.saving,true);
 await assert.rejects(h.saveClipFile(),/Önceki/);
 assert.equal(statuses.some(s=>s.clipSavedCue),false);
 finish();
 await pending;
 assert.equal(statuses.filter(s=>s.clipSavedCue).length,1);
 h.capture.running=false;
 await assert.rejects(h.saveClipFile(),/tamponu/);
 assert.equal(statuses.filter(s=>s.clipSavedCue).length,1);
});

test('an update pauses thumbnail creation and a failed update can resume the same pending thumbnail',async()=>{let created=false,attempts=0;const h=harness({PreviewQueue:require('../src/media-work').PreviewQueue,win:{isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,isFocused:()=>true},saving:false,quitting:false,updating:true,deviceChanging:false,sync:{existsSync:()=>created},run:async()=>{attempts++;if(h.updating)throw Error('update preparing');created=true;}});const line=source.split(/\r?\n/).find(line=>line.startsWith('const previewQueue=new PreviewQueue'));assert(line);vm.runInContext(line,h);const queue=vm.runInContext('previewQueue',h);h.clipDescription(item,media);const preview=h.assets.find(value=>typeof value==='function'),pending=preview();await new Promise(resolve=>setImmediate(resolve));assert.equal(attempts,0);h.updating=false;queue.wake();assert(await pending);assert.equal(attempts,1);assert(await preview());assert.equal(attempts,1);});
test('automatic preservation before an update or audio device restart does not play the manual request cue',async()=>{const statuses=[],h=harness({deleting:false,saving:false,capture:{running:true},saveReplay:async()=>({item,media,timings:{totalMs:1}}),console:{info(){}},status:(message,data)=>statuses.push({message,...data})});vm.runInContext(production('saveClipFile'),h);await h.saveClipFile();assert.equal(statuses.some(status=>status.clipSavedCue),false);});
test('an automatic native replay can publish after capture stops and preserves its own snapshot source',async()=>{const statuses=[],base={running:false},automatic=Object.assign(Object.create(base),{lastSnapshot:{automatic:true,savedReplayPath:'/raw/recovery.mkv'}});let actual;const h=harness({deleting:false,saving:false,capture:base,saveReplay:async options=>{actual=options.capture;return{item,media,timings:{totalMs:1},warnings:['One separate stream was unavailable.']};},console:{info(){}},status:(message,data)=>statuses.push({message,...data})});vm.runInContext(production('saveClipFile'),h);await h.saveClipFile({source:automatic,notifyOnSuccess:true});assert.equal(actual,automatic);assert(!statuses.some(value=>value.clipSavedCue));assert(statuses.some(value=>value.warnings?.length===1));assert.equal(h.known.size,1);});
test('automatic preservation waits for a manual save and completes only after publication without a cue',async()=>{const statuses=[],detail={automatic:true,savedReplayPath:'/raw/recovery.mkv'},h=harness({setTimeout,updating:true,deleting:false,saving:true,capture:{running:false,dynamicAudio:true},trackOperation:fn=>Promise.resolve().then(fn),updateMediaScope:{run:(allowed,fn)=>{assert.equal(allowed,true);return fn();}},status:(message,data)=>statuses.push({message,...data})});let saved=0,completed=0,failed=0;h.saveClipFile=async({source})=>{saved++;assert.equal(source.lastSnapshot,detail);assert.equal(await source.save(),detail.savedReplayPath);assert.equal(source.dynamicAudio,true);return[item];};vm.runInContext(production('preserveAutomaticReplay'),h);const pending=h.preserveAutomaticReplay({detail,complete:()=>completed++,fail:()=>failed++});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(saved,0);h.saving=false;await pending;assert.equal(saved,1);assert.equal(completed,1);assert.equal(failed,0);assert(statuses.some(value=>value.automaticReplay&&value.clips));assert(!statuses.some(value=>value.clipSavedCue));});
test('automatic publication failure signals failure and leaves recovery to the original native replay',async()=>{const statuses=[],detail={automatic:true,savedReplayPath:'/raw/recovery.mkv'},h=harness({setTimeout,deleting:false,saving:false,capture:{running:false},trackOperation:fn=>Promise.resolve().then(fn),updateMediaScope:{run:(_allowed,fn)=>fn()},saveClipFile:async()=>{throw Error('verification failed');},status:(message,data)=>statuses.push({message,...data})});let completed=0,failure;vm.runInContext(production('preserveAutomaticReplay'),h);await h.preserveAutomaticReplay({detail,complete:()=>completed++,fail:error=>failure=error});assert.equal(completed,0);assert.match(failure.message,/verification failed/);assert(!statuses.some(value=>value.automaticReplay&&value.clips));assert(statuses.some(value=>/korundu/.test(value.message)));});
