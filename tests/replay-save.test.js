const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {saveReplay}=require('../src/replay-save');
const media={streams:[{codec_type:'video',codec_name:'h264',width:1920,height:1080,avg_frame_rate:'60/1'},{codec_type:'audio',codec_name:'aac',tags:{title:'Birleşik ses'}},{codec_type:'audio',codec_name:'aac',tags:{title:'Oyun'}}],format:{duration:'12.5'}};
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ember-save-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const original=path.join(root,'raw.mkv');await fs.writeFile(original,'recorded replay');return{root,original};}
async function dynamicFixture(t,count=9,mic=true){
 const f=await fixture(t),audioSnapshotRoot=path.join(f.root,'audio-snapshots'),snapshotFolder=path.join(audioSnapshotRoot,'owned-snapshot');await fs.mkdir(snapshotFolder,{recursive:true});
 const tracks=[];for(let i=0;i<count;i++){const file=path.join(snapshotFolder,'application-'+i+'.wav');await fs.writeFile(file,'native aligned WAV');tracks.push({id:'app-'+i,name:'Application '+i,file,peak:.3});}
 const inputMedia={streams:[media.streams[0],...Array.from({length:6},()=>({codec_type:'audio',codec_name:'aac'}))],format:{duration:'12.5'}};
 const outputMedia={streams:[media.streams[0],...Array.from({length:1+count+Number(mic)},()=>({codec_type:'audio',codec_name:'aac'}))],format:{duration:'12.5'}};
 const capture={dynamicAudio:true,audioSnapshotRoot,bufferDir:f.root,config:{duration:300,fps:'custom',customFps:360,audioEnabled:{6:mic}},lastGame:'Game',audio:[],save:async()=>f.original,snapshotAudio:async original=>{assert.equal(original,f.original);return{tracks,folder:snapshotFolder,warnings:['A process ended during this clip.']};}};
 return{...f,snapshotFolder,tracks,capture,inputMedia,outputMedia};
}

test('dynamic replay maps every application beyond six tracks and leaves microphone last',async t=>{
 const {root,original,snapshotFolder,tracks,capture,inputMedia,outputMedia}=await dynamicFixture(t),jobs=[];let args;
 const result=await saveReplay({capture,folder:path.join(root,'clips'),mode:'game',run:async(_tool,values)=>{args=values;await fs.writeFile(values.at(-1),'dynamic container');},probe:async file=>file===original?inputMedia:outputMedia,defer:job=>jobs.push(job)});
 assert.deepEqual(args.flatMap((value,index)=>value==='-map'?[args[index+1]]:[]),['0:v:0','0:a:0',...tracks.map((_,i)=>(i+1)+':a:0'),'0:a:5']);
 for(let i=0;i<tracks.length;i++){assert(args.includes('title=Application '+i));assert.equal(args[args.indexOf('-c:a:'+(i+1))+1],'aac');assert.equal(args[args.indexOf('-b:a:'+(i+1))+1],'256k');}
 assert(args.includes('title=Mikrofon'));assert.equal(result.media.streams.length,12);assert.deepEqual(result.warnings,['A process ended during this clip.']);
 assert((await fs.stat(original)).size>0);assert((await fs.stat(snapshotFolder)).isDirectory());await jobs[0]();await assert.rejects(fs.stat(original),{code:'ENOENT'});await assert.rejects(fs.stat(snapshotFolder),{code:'ENOENT'});assert((await fs.stat(result.item.file)).size>0);
});
test('disabling microphone omits its native input while retaining all dynamic application streams',async t=>{
 const {root,original,capture,inputMedia,outputMedia}=await dynamicFixture(t,8,false);let args;
 const result=await saveReplay({capture,folder:path.join(root,'clips'),run:async(_tool,values)=>{args=values;await fs.writeFile(values.at(-1),'dynamic container');},probe:async file=>file===original?inputMedia:outputMedia,defer:()=>{}});
 assert(!args.includes('0:a:5'));assert(!args.includes('title=Mikrofon'));assert.equal(result.media.streams.filter(s=>s.codec_type==='audio').length,9);
});
test('dynamic verification preserves native replay and all snapshots on missing tracks, dimensions or duration mismatch',async t=>{
 for(const change of [out=>out.streams.pop(),out=>out.streams[0]={...out.streams[0],width:1280},out=>out.format.duration='15',out=>out.streams[0]={...out.streams[0],duration:'8'},out=>out.streams[2].duration='6']){
  const {root,original,snapshotFolder,capture,inputMedia,outputMedia}=await dynamicFixture(t,8),jobs=[];change(outputMedia);
  await assert.rejects(saveReplay({capture,folder:path.join(root,'clips'),run:async(_tool,args)=>fs.writeFile(args.at(-1),'invalid container'),probe:async file=>file===original?inputMedia:outputMedia,defer:job=>jobs.push(job)}),/doğrulanamadı|eşleş|akış/i);
  assert.equal(jobs.length,0);assert((await fs.stat(original)).size>0);assert((await fs.stat(snapshotFolder)).isDirectory());assert.deepEqual(await fs.readdir(path.join(root,'clips','Game')),[]);
 }
});
test('a snapshot outside the owned root is rejected without deleting unrelated files',async t=>{
 const {root,original,capture}=await dynamicFixture(t,1),outside=path.join(root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep.txt'),'keep');capture.snapshotAudio=async()=>({tracks:[],folder:outside,warnings:[]});
 await assert.rejects(saveReplay({capture,folder:path.join(root,'clips'),run:async()=>{throw Error('must not remux');},probe:async()=>media}),/snapshot|anlık|klasör/i);assert.equal(await fs.readFile(path.join(outside,'keep.txt'),'utf8'),'keep');assert((await fs.stat(original)).size>0);
});
test('hundreds of dynamic stems use bounded commands and retain every application without truncation',async t=>{
 const {root,original,capture,inputMedia,outputMedia,tracks}=await dynamicFixture(t,400),calls=[];
 const result=await saveReplay({capture,folder:path.join(root,'clips'),run:async(_tool,args)=>{assert(args.join(' ').length<24000,'a save command must fit Windows command-line limits');calls.push(args);await fs.writeFile(args.at(-1),'many-track container');},probe:async file=>file===original?inputMedia:outputMedia,defer:()=>{}});
 assert(calls.length>1);assert.equal(result.media.streams.filter(s=>s.codec_type==='audio').length,402);for(const track of tracks)assert(calls.some(args=>args.includes('title='+track.name)));const final=calls.at(-1);assert.equal(final[final.indexOf('-c')+1],'copy');
});
test('a failed dynamic intermediate keeps the original and all audio snapshots for recovery',async t=>{
 const {root,original,snapshotFolder,capture,inputMedia,outputMedia}=await dynamicFixture(t,400),jobs=[];
 await assert.rejects(saveReplay({capture,folder:path.join(root,'clips'),run:async(_tool,args)=>{await fs.writeFile(args.at(-1),'partial owned audio group');throw Error('intermediate disk failure');},probe:async file=>file===original?inputMedia:outputMedia,defer:job=>jobs.push(job)}),/intermediate disk failure/);
 assert((await fs.stat(original)).size>0);assert.equal((await fs.readdir(snapshotFolder)).filter(file=>file.endsWith('.wav')).length,400);assert.equal(jobs.length,0);
});
test('an unavailable destination claims pinned audio before failing and preserves raw replay plus WAV snapshots',async t=>{
 const {root,original,snapshotFolder,tracks,capture}=await dynamicFixture(t,2),blocked=path.join(root,'blocked-destination'),snapshot=capture.snapshotAudio,jobs=[];let pinned=0,claimed=0,mediaWork=0;
 await fs.writeFile(blocked,'existing file prevents directory creation');capture.save=async()=>{pinned++;return original;};capture.snapshotAudio=async file=>{const result=await snapshot(file);pinned--;claimed++;return result;};
 await assert.rejects(saveReplay({capture,folder:blocked,run:async()=>mediaWork++,probe:async()=>mediaWork++,defer:job=>jobs.push(job)}),error=>['ENOTDIR','ENOENT','EEXIST'].includes(error.code));
 assert.equal(claimed,1);assert.equal(pinned,0);assert.equal(mediaWork,0);assert.equal(jobs.length,0);assert.equal(await fs.readFile(original,'utf8'),'recorded replay');assert((await fs.stat(snapshotFolder)).isDirectory());for(const track of tracks)assert.equal(await fs.readFile(track.file,'utf8'),'native aligned WAV');
});
test('a recovery checkpoint is acknowledged only after publication and before removing raw or snapshot files',async t=>{
 const {root,original,snapshotFolder,capture,inputMedia,outputMedia}=await dynamicFixture(t,2),jobs=[];let completed=0,result;
 capture.completeRecovery=async file=>{assert.equal(file,original);assert((await fs.stat(result.item.file)).size>0);assert((await fs.stat(original)).size>0);assert((await fs.stat(snapshotFolder)).isDirectory());completed++;};
 result=await saveReplay({capture,folder:path.join(root,'clips'),run:async(_tool,args)=>fs.writeFile(args.at(-1),'verified container'),probe:async file=>file===original?inputMedia:outputMedia,defer:job=>jobs.push(job)});
 assert.equal(completed,0);await jobs[0]();assert.equal(completed,1);await assert.rejects(fs.stat(original),{code:'ENOENT'});await assert.rejects(fs.stat(snapshotFolder),{code:'ENOENT'});
});
test('failed publication cannot acknowledge a recovery checkpoint',async t=>{
 const {root,original,capture,inputMedia,outputMedia}=await dynamicFixture(t,2);let completed=0;capture.completeRecovery=async()=>completed++;outputMedia.streams.pop();
 await assert.rejects(saveReplay({capture,folder:path.join(root,'clips'),run:async(_tool,args)=>fs.writeFile(args.at(-1),'invalid container'),probe:async file=>file===original?inputMedia:outputMedia}),/eşleş/);assert.equal(completed,0);assert((await fs.stat(original)).size>0);
});
test('a failed recovery acknowledgment keeps original data and reports a warning after successful publication',async t=>{
 const {root,original,snapshotFolder,capture,inputMedia,outputMedia}=await dynamicFixture(t,2),jobs=[],warnings=[];capture.completeRecovery=async()=>{throw Error('recovery service unavailable');};capture.emit=(type,message)=>{if(type==='warning')warnings.push(message);};
 const result=await saveReplay({capture,folder:path.join(root,'clips'),run:async(_tool,args)=>fs.writeFile(args.at(-1),'verified container'),probe:async file=>file===original?inputMedia:outputMedia,defer:job=>jobs.push(job)});
 await jobs[0]();assert((await fs.stat(result.item.file)).size>0);assert((await fs.stat(original)).size>0);assert((await fs.stat(snapshotFolder)).isDirectory());assert.equal(warnings.length,1);assert.match(warnings[0],/recovery service unavailable/);
});
test('real FFmpeg keeps nine distinct application stems, copied video and microphone order without playback',async t=>{
 const ffmpeg=path.join(__dirname,'../tools/ffmpeg.exe'),ffprobe=path.join(__dirname,'../tools/ffprobe.exe');if(process.platform!=='win32'||!await fs.access(ffmpeg).then(()=>true,()=>false))return t.skip('Native media tools unavailable.');
 const {execFile}=require('node:child_process'),{promisify}=require('node:util'),exec=promisify(execFile),run=async(_tool,args)=>(await exec(ffmpeg,args,{windowsHide:true,maxBuffer:4*1024*1024})).stdout;
 const probe=async file=>JSON.parse((await exec(ffprobe,['-v','error','-show_streams','-show_format','-of','json',file],{windowsHide:true,maxBuffer:4*1024*1024})).stdout);
 const {root,original,capture,tracks}=await dynamicFixture(t,9);capture.config.duration=1;capture.config.fps='60';await fs.unlink(original);
 await run('ffmpeg',['-v','error','-n','-f','lavfi','-i','testsrc2=size=320x180:rate=60','-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000','-map','0:v:0',...Array.from({length:6},()=>['-map','1:a:0']).flat(),'-t','1','-c:v','libx264','-preset','ultrafast','-g','60','-c:a','aac','-b:a','256k',original]);
 for(let i=0;i<tracks.length;i++)await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency='+(300+i*100)+':sample_rate=48000','-t','1','-ac','2','-c:a','pcm_f32le',tracks[i].file]);
 const hash=async file=>(await run('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-c','copy','-f','hash','-hash','sha256','-'])).trim();
 const before=await hash(original),result=await saveReplay({capture,folder:path.join(root,'clips'),run,probe,defer:()=>{}}),audio=result.media.streams.filter(stream=>stream.codec_type==='audio');
 assert.equal(audio.length,11);assert.deepEqual(audio.map(stream=>stream.tags?.handler_name),['Birleşik ses',...tracks.map(track=>track.name),'Mikrofon']);assert(audio.every(stream=>stream.codec_name==='aac'));assert.equal(await hash(result.item.file),before);assert.equal(result.media.streams[0].width,320);assert.equal(result.media.streams[0].height,180);
 for(let i=0;i<tracks.length;i++){const decoded=await exec(ffmpeg,['-v','error','-i',result.item.file,'-map','0:a:'+(i+1),'-ac','1','-f','f32le','-'],{windowsHide:true,encoding:'buffer',maxBuffer:1024*1024}),bytes=decoded.stdout;let changes=0,previous=0,energy=0;for(let at=0;at+4<=bytes.length;at+=4){const sample=bytes.readFloatLE(at);energy+=sample*sample;if(at>0&&(sample>=0)!==(previous>=0))changes++;previous=sample;}assert(energy>1);assert(Math.abs(changes/2-(300+i*100))<15,'each stream retains its own tone rather than another application');}
});
test('real FFmpeg grouped audio retains all 65 stream names and copies each encoded stem once',async t=>{
 const ffmpeg=path.join(__dirname,'../tools/ffmpeg.exe'),ffprobe=path.join(__dirname,'../tools/ffprobe.exe');if(process.platform!=='win32'||!await fs.access(ffmpeg).then(()=>true,()=>false))return t.skip('Native media tools unavailable.');
 const {execFile}=require('node:child_process'),{promisify}=require('node:util'),exec=promisify(execFile),calls=[],run=async(_tool,args)=>{calls.push(args);return(await exec(ffmpeg,args,{windowsHide:true,maxBuffer:8*1024*1024})).stdout;},probe=async file=>JSON.parse((await exec(ffprobe,['-v','error','-show_streams','-show_format','-of','json',file],{windowsHide:true,maxBuffer:8*1024*1024})).stdout);
 const {root,original,capture,tracks}=await dynamicFixture(t,65);capture.config.duration=1;capture.config.fps='60';await fs.unlink(original);
 await run('ffmpeg',['-v','error','-n','-f','lavfi','-i','color=size=320x180:rate=60','-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000','-map','0:v:0',...Array.from({length:6},()=>['-map','1:a:0']).flat(),'-t','1','-c:v','libx264','-preset','ultrafast','-c:a','aac',original]);
 await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-ac','2','-c:a','pcm_f32le',tracks[0].file]);for(const track of tracks.slice(1))await fs.copyFile(tracks[0].file,track.file);calls.length=0;
 const result=await saveReplay({capture,folder:path.join(root,'clips'),run,probe,defer:()=>{}}),audio=result.media.streams.filter(stream=>stream.codec_type==='audio');assert.equal(audio.length,67);assert.deepEqual(audio.map(stream=>stream.tags?.handler_name),['Birleşik ses',...tracks.map(track=>track.name),'Mikrofon']);assert(calls.length>=3);assert(!calls.at(-1).includes('aac'),'final grouped remux must copy already encoded AAC');
 const decoded=await exec(ffmpeg,['-v','error','-i',result.item.file,'-map','0:a:1','-ac','1','-f','f32le','-'],{windowsHide:true,encoding:'buffer',maxBuffer:1024*1024});assert.equal(decoded.stdout.length/4,48000,'intermediate containers must preserve sample-accurate AAC priming and duration');
});

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
