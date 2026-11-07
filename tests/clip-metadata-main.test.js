const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto'),{ClipMetadata}=require('../src/clip-metadata');
const source=sync.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
function production(name){const start=source.indexOf('function '+name+'(');assert(start>=0,name+' is implemented');const end=source.indexOf('\n}',start);assert(end>=0);return source.slice(source.slice(start-6,start)==='async '?start-6:start,end+2);}
const media={streams:[{codec_type:'video',codec_name:'h264',width:1280,height:720,avg_frame_rate:'30/1'}],format:{duration:'12'}};
async function harness(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ember-metadata-main-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const folder=path.join(dir,'clips');await fs.mkdir(folder);const file=path.join(folder,'Actual.mp4');await fs.writeFile(file,'real controlled source');const stat=await fs.stat(file),item={id:file,file,fileName:'Actual.mp4',name:'Actual',game:'Game',mtime:stat.mtimeMs,size:stat.size};
 const metadata=new ClipMetadata({file:path.join(dir,'clip-metadata.json')});await metadata.initialize();let probes=0;const h={dir,path,crypto,Date,Map,sync:{existsSync:()=>false},fs,app:{getPath:()=>dir},previewQueue:{run:job=>job(),wake(){}},cache:new Map(),known:new Map(),librarySnapshot:[],publicationRevision:0,publishedClips:new Map(),state:{folder},files:{scan:async()=>[item]},asset:()=> 'klipmedia://local/test',probe:async()=>{probes++;return media;},run:async()=>{throw Error('unexpected media work');},status(){},clipMetadata:metadata,busy:false,saving:false,deleting:false};vm.createContext(h);for(const name of ['clipKey','clipDescription','describe','library','updateClipMetadata'])vm.runInContext(production(name),h);return{h,item,metadata,probes:()=>probes};
}

test('metadata edits refresh cached clips and every native library reference while retaining imports',async t=>{
 const {h,item,metadata,probes}=await harness(t),clip=await h.describe(item);h.librarySnapshot=[clip];h.publishedClips.set(clip.id,{revision:1,clip});h.publicationRevision=1;
 const importedFile=path.join(h.dir,'Imported.mp4');await fs.writeFile(importedFile,'external controlled source');const stat=await fs.stat(importedFile),imported=await h.describe({id:importedFile,file:importedFile,fileName:'Imported.mp4',name:'Imported',mtime:stat.mtimeMs,size:stat.size,game:'İçe aktarılanlar'});
 const result=await h.updateClipMetadata({ids:[clip.id],patch:{displayName:'Edited 🎯',favorite:true,tags:['Duel']}});assert.deepEqual(Array.from(result.clips,c=>c.id).sort(),[clip.id,imported.id].sort());assert.equal(h.known.get(clip.id).name,'Edited 🎯');assert.equal(h.publishedClips.get(clip.id).clip.name,'Edited 🎯');assert.equal(h.cache.get(h.clipKey(item)).name,'Edited 🎯');assert.equal((await h.describe(item)).favorite,true);assert.equal(probes(),2);
 await metadata.patch({ids:[clip.id],patch:{displayName:'Another edit'}},h.known);assert.equal((await h.describe(item)).name,'Another edit');assert.equal(probes(),2);assert.equal((await h.library()).find(c=>c.id===imported.id).name,'Imported');
});

test('an in-flight library refresh publishes the latest metadata rather than its earlier descriptor',async t=>{
 const {h,item}=await harness(t),clip=await h.describe(item);h.librarySnapshot=[clip];let release;const blocked=new Promise(resolve=>release=resolve);h.files.scan=async()=>{await blocked;return[item];};const pending=h.library();await h.updateClipMetadata({ids:[clip.id],patch:{favorite:true}});release();assert.equal((await pending)[0].favorite,true);
});

test('the metadata native handler is registered and a failed edit leaves library references unchanged',async t=>{
 const {h,item}=await harness(t),clip=await h.describe(item);h.librarySnapshot=[clip];const handlers={};h.handle=(name,handler)=>handlers[name]=handler;const line=source.split(/\r?\n/u).find(value=>value.startsWith("handle('clip-metadata',"));assert(line,'metadata IPC is registered');vm.runInContext(line,h);assert.equal(typeof handlers['clip-metadata'],'function');await assert.rejects(handlers['clip-metadata']({ids:[clip.id],patch:{favorite:'bad'}}));assert.equal(h.librarySnapshot[0],clip);assert.equal(h.known.get(clip.id),clip);h.saving=true;await assert.rejects(handlers['clip-metadata']({ids:[clip.id],patch:{favorite:true}}),/işlemin/);
});
