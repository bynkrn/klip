const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {saveReplay}=require('../src/replay-save');
const media={streams:[{codec_type:'video',codec_name:'h264',width:1920,height:1080,avg_frame_rate:'60/1'},{codec_type:'audio',codec_name:'aac',tags:{title:'Birleşik ses'}},{codec_type:'audio',codec_name:'aac',tags:{title:'Oyun'}}],format:{duration:'12.5'}};
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ember-save-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const original=path.join(root,'raw.mkv');await fs.writeFile(original,'recorded replay');return{root,original};}

test('save resolves with an atomically published verified file before deferred cleanup',async t=>{
 const {root,original}=await fixture(t),jobs=[];let release;const gate=new Promise(resolve=>release=resolve);let validationStarted;
 const started=new Promise(resolve=>validationStarted=resolve);
 const pending=saveReplay({capture:{save:async()=>original,audio:[{track:2,name:'Quake Live'}],lastGame:'Quake/Live'},folder:path.join(root,'clips'),mode:'game',run:async(_name,args)=>{await fs.copyFile(original,args.at(-1));assert(args.includes('title=Quake Live'));},probe:async()=>{validationStarted();await gate;return media;},defer:job=>jobs.push(job)});
 await started;assert.equal((await fs.readdir(path.join(root,'clips','Quake_Live'))).filter(name=>!name.startsWith('.')).length,0);
 release();const result=await pending;
 assert.equal(result.item.game,'Quake_Live');assert.equal(result.media.streams.length,3);assert.equal(result.item.size,15);assert.equal(await fs.readFile(result.item.file,'utf8'),'recorded replay');assert.equal(await fs.readFile(original,'utf8'),'recorded replay');assert.equal(jobs.length,1);
 await jobs[0]();assert.equal(await fs.readFile(result.item.file,'utf8'),'recorded replay');await assert.rejects(fs.stat(original),{code:'ENOENT'});assert.deepEqual(await fs.readdir(path.dirname(result.item.file)),[result.item.fileName]);
 assert(result.timings.captureMs>=0);assert(result.timings.remuxMs>=0);assert(result.timings.verifyMs>=0);assert(result.timings.totalMs>=result.timings.verifyMs);
});

test('invalid video cannot publish success and preserves the original replay',async t=>{
 const {root,original}=await fixture(t),jobs=[];
 await assert.rejects(saveReplay({capture:{save:async()=>original,audio:[],lastGame:'Game'},folder:path.join(root,'clips'),run:async(_name,args)=>fs.copyFile(original,args.at(-1)),probe:async()=>({streams:[],format:{duration:'1'}}),defer:job=>jobs.push(job)}),/Video/);
 assert.equal(await fs.readFile(original,'utf8'),'recorded replay');assert.deepEqual(await fs.readdir(path.join(root,'clips','Game')),[]);assert.equal(jobs.length,0);
});

test('a remux failure preserves source data and never schedules success cleanup',async t=>{
 const {root,original}=await fixture(t),jobs=[];
 await assert.rejects(saveReplay({capture:{save:async()=>original,audio:[],lastGame:'Game'},folder:path.join(root,'clips'),run:async()=>{throw new Error('disk full');},probe:async()=>media,defer:job=>jobs.push(job)}),/disk full/);
 assert.equal(await fs.readFile(original,'utf8'),'recorded replay');assert.deepEqual(await fs.readdir(path.join(root,'clips','Game')),[]);assert.equal(jobs.length,0);
});

test('verification rejects zero duration and empty output rather than announcing a saved replay',async t=>{
 for(const [bytes,metadata]of [['replay',{...media,format:{duration:'0'}}],['',media]]){const {root,original}=await fixture(t);await assert.rejects(saveReplay({capture:{save:async()=>original,audio:[],lastGame:'Game'},folder:path.join(root,'clips'),run:async(_name,args)=>fs.writeFile(args.at(-1),bytes),probe:async()=>metadata,defer:()=>{throw new Error('unexpected success');}}),/doğrulanamadı/);assert.equal(await fs.readFile(original,'utf8'),'recorded replay');}
});

test('remux reserves the MP4 index before copying streams to avoid a second whole-file rewrite',async t=>{const {root,original}=await fixture(t);await saveReplay({capture:{config:{duration:300,fps:'custom',customFps:360},save:async()=>original,audio:[],lastGame:'Game'},folder:path.join(root,'clips'),run:async(_name,args)=>{const at=args.indexOf('-moov_size');assert(at>=0);assert(Number(args[at+1])>1000000);assert(!args.includes('+faststart'));assert.equal(args[args.indexOf('-c')+1],'copy');await fs.copyFile(original,args.at(-1));},probe:async()=>media});});
test('an underestimated MP4 index retries safely without leaving a partial target',async t=>{const {root,original}=await fixture(t);let calls=0;const result=await saveReplay({capture:{save:async()=>original,audio:[],lastGame:'Game'},folder:path.join(root,'clips'),run:async(_name,args)=>{if(++calls===1){await fs.writeFile(args.at(-1),'partial');throw Error('reserved_moov_size is too small, needed 512 additional');}await assert.rejects(fs.stat(args.at(-1)),{code:'ENOENT'});assert(args.includes('+faststart'));await fs.copyFile(original,args.at(-1));},probe:async()=>media});assert.equal(calls,2);assert.equal(await fs.readFile(result.item.file,'utf8'),'recorded replay');});
