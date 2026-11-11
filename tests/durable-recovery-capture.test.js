const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Capture}=require('../src/capture');
test('a corrupt manifest does not prevent recovering and publishing later recordings',async()=>{
 const capture=new Capture('unused'),broken={manifest:'bad.json',unavailable:true,message:'Invalid manifest'},good={manifest:'good.json'};
 capture.config={language:'en'};capture.bufferDir='unused';capture.obs.ready=true;
 let manifests=[broken,good];
 const tried=[];
 capture.obs.call=async(type,{manifest}={})=>{
  if(type==='ListRecoveryManifests')return{manifests};
  assert.equal(type,'RecoverReplay');tried.push(manifest);
  capture.automaticPreservation=Promise.resolve().then(()=>{manifests=[broken];});
 };
 await assert.rejects(capture.recoverReplays(),/Bazı kayıtlar kurtarılamadı.*Invalid manifest/);
 assert.deepEqual(tried,[good.manifest]);
 assert.deepEqual(capture.recoveryManifests,[broken]);
});
test('archiving a stopped buffer preserves unreadable manifests and relative packet files',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ember-archive-recovery-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const capture=new Capture('unused'),buffer=path.join(root,'buffer'),ring='.ember-ring-1-2-3',manifest='Ember-Recovery-broken.json';
 const clips=path.join(root,'clips'),packet=path.join(ring,'1.packets');
 capture.bufferDir=buffer;
 await fs.mkdir(path.join(buffer,ring),{recursive:true});
 await fs.mkdir(clips);
 await fs.writeFile(path.join(buffer,manifest),'{');
 await fs.writeFile(path.join(buffer,packet),Buffer.from([1,2,3]));
 assert.equal((await capture.refreshRecoveries()).length,1);
 capture.recoveryRequired={keepAlive:true};
 await assert.rejects(capture.archiveRecoveries(clips),/canlı tamponu kurtar/);
 capture.recoveryRequired=null;
 await assert.rejects(capture.archiveRecoveries(path.join(buffer,ring)),/Klip klasörü tamponun içinde/);
 const archive=await capture.archiveRecoveries(clips);
 assert.equal(path.dirname(archive),root);
 assert.equal(await fs.readFile(path.join(archive,manifest),'utf8'),'{');
 assert.deepEqual(await fs.readFile(path.join(archive,packet)),Buffer.from([1,2,3]));
 assert.deepEqual(capture.recoveryManifests,[]);
 await fs.mkdir(buffer);
 assert.deepEqual(await fs.readdir(buffer),[]);
});
test('recovered app stems restore by durable manifest with offsets and disabled app filtering',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ember-capture-recovered-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const capture=new Capture('unused');capture.audioSnapshotRoot=path.join(root,'audio-snapshots');capture.config={autoAudio:true,audioEnabled:{muted:false}};capture.replaySnapshots.set('raw.mkv',{snapshotId:'1-2-3',recovered:true,recoveryManifest:path.join(root,'Ember-Recovery-1-2-3.json'),replayStartMonotonicNs:'1000000000',replayEndMonotonicNs:'2000000000'});const calls=[];capture.obs.call=async(type,data)=>{calls.push({type,data});return{tracks:[{id:'game',name:'Game',sourceOffsetNs:'10000000',videoOffsetNs:'0',file:path.join(data.folder,'app-1.wav')},{id:'muted',name:'Muted',file:path.join(data.folder,'app-2.wav')}],warnings:['Explicit unavailable app warning']};};
 const first=await capture.snapshotAudio('raw.mkv');assert.equal(calls[0].type,'SnapshotRecoveryAudio');assert.equal(calls[0].data.manifest,path.join(root,'Ember-Recovery-1-2-3.json'));assert.deepEqual(first.tracks.map(t=>t.id),['game']);assert.equal(first.tracks[0].sourceOffsetNs,'10000000');assert.deepEqual(first.warnings,['Explicit unavailable app warning']);await fs.writeFile(path.join(first.folder,'old-intermediate'),'bounded retry');const retry=await capture.snapshotAudio('raw.mkv');assert.equal(retry.folder,first.folder);await assert.rejects(fs.access(path.join(first.folder,'old-intermediate')),{code:'ENOENT'});
});
test('invalid recovered snapshot identity cannot escape the owned audio folder',async t=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'ember-recovery-path-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const capture=new Capture('unused');capture.audioSnapshotRoot=root;capture.lastSnapshot={snapshotId:'../../unrelated',recovered:true,replayStartMonotonicNs:'1',replayEndMonotonicNs:'2'};let called=false;capture.obs.call=async()=>{called=true;};await assert.rejects(capture.snapshotAudio('raw'),/identity/);assert(!called);});
