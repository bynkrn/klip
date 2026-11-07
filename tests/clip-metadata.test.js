const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const modulePath=path.join(__dirname,'../src/clip-metadata');

async function fixture(t,options={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ember-metadata-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'Original source.mp4'),bytes=Buffer.from('controlled original clip bytes');await fs.writeFile(file,bytes);const stat=await fs.stat(file),clip={id:file,file,fileName:path.basename(file),name:'Original source',game:'Test',mtime:stat.mtimeMs,size:stat.size,seconds:12};
 const {ClipMetadata}=require(modulePath),metadataFile=path.join(dir,'user-data','clip-metadata.json'),store=new ClipMetadata({file:metadataFile,...options});await store.initialize();return{dir,file,bytes,clip,known:new Map([[clip.id,clip]]),store,metadataFile,ClipMetadata};
}

test('unicode display names, favorites and normalized tags persist without changing the source path or bytes',async t=>{
 const f=await fixture(t),before=await fs.stat(f.file);await f.store.patch({ids:[f.clip.id],patch:{displayName:'  İyi oyun 🎮 / final  ',favorite:true,tags:['  Quake  ','quake','İstanbul']}},f.known);
 const saved=f.store.decorate(f.clip);assert.equal(saved.name,'İyi oyun 🎮 / final');assert.equal(saved.displayName,'İyi oyun 🎮 / final');assert.equal(saved.favorite,true);assert.deepEqual(saved.tags,['Quake','İstanbul']);assert.equal(saved.file,f.file);assert.equal(saved.fileName,'Original source.mp4');assert.equal(saved.mtime,before.mtimeMs);assert.equal(saved.size,before.size);assert.deepEqual(await fs.readFile(f.file),f.bytes);assert.equal((await fs.stat(f.file)).mtimeMs,before.mtimeMs);
 const reloaded=new f.ClipMetadata({file:f.metadataFile});await reloaded.initialize();assert.deepEqual(reloaded.decorate(f.clip),saved);
 await reloaded.patch({ids:[f.clip.id],patch:{displayName:'   '}},f.known);assert.equal(reloaded.decorate(saved).name,'Original source');assert.equal(reloaded.decorate(saved).displayName,'');assert.equal(reloaded.decorate(saved).favorite,true);
});

test('invalid patches and unknown or changed sources never change any selected clip metadata',async t=>{
 const f=await fixture(t);await f.store.patch({ids:[f.clip.id],patch:{favorite:true}},f.known);const before=await fs.readFile(f.metadataFile,'utf8');
 const invalid=[null,{}, {ids:[],patch:{favorite:true}}, {ids:[f.clip.id],patch:{}}, {ids:[f.clip.id],patch:{favorite:'yes'}}, {ids:[f.clip.id],patch:{displayName:7}}, {ids:[f.clip.id],patch:{displayName:'bad\nname'}}, {ids:[f.clip.id],patch:{displayName:'x'.repeat(201)}}, {ids:[f.clip.id],patch:{tags:'a'}}, {ids:[f.clip.id],patch:{tags:['a',3]}}, {ids:[f.clip.id],patch:{tags:['']}}, {ids:[f.clip.id],patch:{tags:['x'.repeat(41)]}}, {ids:[f.clip.id],patch:{tags:Array.from({length:21},(_,i)=>'tag'+i)}}, {ids:[f.clip.id],patch:{file:'/changed.mp4'}}, {ids:[f.clip.id,'missing'],patch:{favorite:false}}, {ids:[f.clip.id,'missing'],patch:{displayName:'batch'}}];
 for(const payload of invalid){await assert.rejects(f.store.patch(payload,f.known));assert.equal(await fs.readFile(f.metadataFile,'utf8'),before);assert.equal(f.store.decorate(f.clip).favorite,true);}
 await fs.writeFile(f.file,'replacement bytes');await assert.rejects(f.store.patch({ids:[f.clip.id],patch:{favorite:false}},f.known),/değişti/);assert.equal(await fs.readFile(f.metadataFile,'utf8'),before);
});

test('metadata survives removal and same path restoration but does not attach to a replacement',async t=>{
 const f=await fixture(t);await f.store.patch({ids:[f.clip.id],patch:{displayName:'Restored clip',favorite:true,tags:['keep']}},f.known);
 const recycled=path.join(f.dir,'recycled.mp4');await fs.rename(f.file,recycled);f.known.delete(f.clip.id);await fs.rename(recycled,f.file);const stat=await fs.stat(f.file),restored={...f.clip,mtime:stat.mtimeMs,size:stat.size};assert.equal(f.store.decorate(restored).name,'Restored clip');
 await fs.writeFile(f.file,'unrelated source with different bytes and length');const replacementStat=await fs.stat(f.file),replacement={...f.clip,mtime:replacementStat.mtimeMs,size:replacementStat.size};assert.equal(f.store.decorate(replacement).name,'Original source');assert.equal(f.store.decorate(replacement).favorite,false);assert.deepEqual(f.store.decorate(replacement).tags,[]);
});

test('queued concurrent patches retain both edits and batch changes are committed together',async t=>{
 const f=await fixture(t),second=path.join(f.dir,'Second.mp4');await fs.writeFile(second,'another source');const stat=await fs.stat(second),clip={id:second,file:second,fileName:'Second.mp4',mtime:stat.mtimeMs,size:stat.size};f.known.set(clip.id,clip);
 await Promise.all([f.store.patch({ids:[f.clip.id],patch:{displayName:'New title'}},f.known),f.store.patch({ids:[f.clip.id,clip.id],patch:{favorite:true,tags:['batch']}},f.known)]);
 assert.equal(f.store.decorate(f.clip).name,'New title');assert.equal(f.store.decorate(f.clip).favorite,true);assert.deepEqual(f.store.decorate(clip).tags,['batch']);const reloaded=new f.ClipMetadata({file:f.metadataFile});await reloaded.initialize();assert.equal(reloaded.decorate(f.clip).name,'New title');assert.equal(reloaded.decorate(clip).favorite,true);
});

test('failed atomic replacement preserves persisted and in-memory metadata and a later write succeeds',async t=>{
 let fail=false;const io={...fs,rename:async(...args)=>{if(fail)throw new Error('disk denied replacement');return fs.rename(...args);}},f=await fixture(t,{io});
 await f.store.patch({ids:[f.clip.id],patch:{displayName:'Before'}},f.known);const before=await fs.readFile(f.metadataFile,'utf8');fail=true;await assert.rejects(f.store.patch({ids:[f.clip.id],patch:{displayName:'After',favorite:true}},f.known),/disk denied/);assert.equal(f.store.decorate(f.clip).name,'Before');assert.equal(f.store.decorate(f.clip).favorite,false);assert.equal(await fs.readFile(f.metadataFile,'utf8'),before);assert.deepEqual(await fs.readdir(path.dirname(f.metadataFile)),['clip-metadata.json']);fail=false;await f.store.patch({ids:[f.clip.id],patch:{favorite:true}},f.known);assert.equal(f.store.decorate(f.clip).name,'Before');assert.equal(f.store.decorate(f.clip).favorite,true);
});

test('a corrupt metadata file remains intact and cannot be overwritten by a new patch',async t=>{
 const f=await fixture(t);await fs.mkdir(path.dirname(f.metadataFile),{recursive:true});await fs.writeFile(f.metadataFile,'{"broken":');const store=new f.ClipMetadata({file:f.metadataFile});await assert.rejects(store.initialize(),/okunamadı/);assert.equal(store.decorate(f.clip).name,'Original source');await assert.rejects(store.patch({ids:[f.clip.id],patch:{favorite:true}},f.known),/okunamadı/);assert.equal(await fs.readFile(f.metadataFile,'utf8'),'{"broken":');
});
