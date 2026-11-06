const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile),root=path.join(__dirname,'..'),tool=name=>path.join(root,'tools',name+'.exe');
const {planClipExport,exportClip}=require('../src/clip-export');
const run=async(name,args)=>(await exec(tool(name),args,{windowsHide:true,maxBuffer:32*1024*1024})).stdout;
const probe=async file=>JSON.parse(await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));
const deps={run,probe,videoEncoderArgs:['-c:v','libx264','-preset','ultrafast','-crf','12']};
let directory,clip,originalHash;
const digest=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function packets(file){return JSON.parse(await run('ffprobe',['-v','error','-select_streams','v:0','-show_packets','-show_data_hash','sha256','-show_entries','packet=pts_time,dts_time,duration_time,flags,data_hash','-of','json',file])).packets;}
async function pcm(file,index=0,start=0,duration=1){return(await exec(tool('ffmpeg'),['-v','error','-ss',String(start),'-i',file,'-t',String(duration),'-map','0:a:'+index,'-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer',windowsHide:true,maxBuffer:8*1024*1024})).stdout;}
function rms(buffer){let sum=0;for(let i=0;i+4<=buffer.length;i+=4)sum+=buffer.readFloatLE(i)**2;return Math.sqrt(sum/(buffer.length/4));}
test.before(async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'ember-clip-export-'));const file=path.join(directory,'source.mp4');
 await run('ffmpeg',['-v','error','-n','-f','lavfi','-i','testsrc2=size=160x90:rate=10:duration=6','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=6','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=6','-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-preset','ultrafast','-g','20','-keyint_min','20','-sc_threshold','0','-bf','2','-c:a','aac','-b:a','192k','-metadata','title=Preserved recording','-metadata:s:a:0','title=Game','-metadata:s:a:1','title=Voice',file]);
 clip={id:file,file,name:'source',game:'Test Game',seconds:6,tracks:2,audio:[{index:0,name:'Game',codec:'aac'},{index:1,name:'Voice',codec:'aac'}],codec:'h264',resolution:'160x90',fps:10};originalHash=await digest(file);
});
test.after(async()=>{if(directory)await fs.rm(directory,{recursive:true,force:true});});
test('fast plan exposes enclosing indexed keyframe range and rejects an invalid request',async()=>{
 const plan=await planClipExport({clip,start:2.35,end:3.45,mode:'fast'},deps);
 assert.deepEqual(plan.range,{start:2,end:4,duration:2});assert.equal(plan.videoCopied,true);assert.equal(plan.mode,'fast');assert.equal(typeof plan.token,'string');
 const repeated=await planClipExport({clip,start:2,end:4,mode:'fast'},deps);assert.equal(repeated.token,plan.token);
 for(const input of [{start:-1,end:2},{start:0,end:8},{start:2,end:2},{start:'0',end:2},{start:0,end:2,mode:'unknown'}])await assert.rejects(planClipExport({clip,mode:'fast',...input},deps));
});
test('audio-only full-length export copies every video packet and applies gain without overwriting source',async()=>{
 const output=await exportClip({clip,start:0,end:6,mode:'precise',tracks:[0],volumes:{0:.25},name:'source',folder:directory},deps);
 assert.equal(output.videoCopied,true);assert.deepEqual((await packets(output.file)).map(p=>p.data_hash),(await packets(clip.file)).map(p=>p.data_hash));assert.equal(await digest(clip.file),originalHash);
 assert.equal(output.media.streams.filter(s=>s.codec_type==='audio').length,1);assert.equal(output.media.format.tags.title,'Preserved recording');
 const gain=rms(await pcm(output.file))/rms(await pcm(clip.file));assert(gain>.24&&gain<.26,`gain ${gain}`);
 const second=await exportClip({clip,start:0,end:6,mode:'fast',tracks:[],name:'source',folder:directory},deps);assert.notEqual(second.file,output.file);assert.equal(second.media.streams.filter(s=>s.codec_type==='audio').length,0);
});
test('fast cut excludes the next GOP including reordered B-frames, retaining original packet payloads',async()=>{
 const plan=await planClipExport({clip,start:2.35,end:3.45,mode:'fast'},deps);
 const output=await exportClip({clip,start:2.35,end:3.45,mode:'fast',planToken:plan.token,tracks:[0,1],volumes:{0:.5,1:0},name:'fast',folder:directory},deps);
 assert.deepEqual(output.range,{start:2,end:4,duration:2});const source=(await packets(clip.file)).filter(p=>Number(p.pts_time)>=2&&Number(p.pts_time)<4),result=await packets(output.file);
 assert.deepEqual(result.map(p=>p.data_hash),source.map(p=>p.data_hash));assert.equal(result.length,20);assert.equal(Number(output.media.streams[0].duration),2);
 const audio=output.media.streams.filter(s=>s.codec_type==='audio');assert.equal(audio.length,3);assert.equal(audio[0].disposition.default,1);assert(audio.slice(1).every(s=>s.disposition.default===0));
 assert(rms(await pcm(output.file,2))<.00001);assert(rms(await pcm(output.file,0))>.03);assert(rms(await pcm(output.file,1))>.03);assert.equal(await digest(clip.file),originalHash);
});
test('precise cut starts on the requested frame without changing geometry or cadence',async()=>{
 const output=await exportClip({clip,start:2.3,end:3.4,mode:'precise',tracks:[0],name:'precise',folder:directory},deps),video=output.media.streams.find(s=>s.codec_type==='video');
 assert.equal(output.videoCopied,false);assert.deepEqual(output.range,{start:2.3,end:3.4,duration:1.1});assert.equal(video.width,160);assert.equal(video.height,90);assert.equal(video.sample_aspect_ratio,'1:1');assert.equal(video.nb_frames,'11');assert.equal(video.avg_frame_rate,'10/1');assert.equal(Number(video.duration),1.1);
 // Compare the first decoded frame with source 2.3s. A wrong seek to a keyframe
 // produces a very different moving test pattern even after high quality encode.
 const frame=async(file,start)=>(await exec(tool('ffmpeg'),['-v','error','-ss',String(start),'-i',file,'-frames:v','1','-pix_fmt','gray','-f','rawvideo','pipe:1'],{encoding:'buffer',windowsHide:true,maxBuffer:1024*1024})).stdout;
 const expected=await frame(clip.file,2.3),actual=await frame(output.file,0);assert.equal(actual.length,expected.length);let delta=0;for(let i=0;i<actual.length;i++)delta+=Math.abs(expected[i]-actual[i]);assert(delta/actual.length<2);
});
test('stale plan and bad output names cannot publish files; failed output is removed',async()=>{
 await assert.rejects(exportClip({clip,start:2,end:4,mode:'fast',planToken:'stale',tracks:[],name:'stale',folder:directory},deps),/değişti|yeniden/i);
 for(const name of ['../escape','..\\escape','C:\\escape','NUL'])await assert.rejects(exportClip({clip,start:0,end:6,mode:'fast',tracks:[],name,folder:directory},deps),/ad|isim/i);
 const before=await fs.readdir(path.join(directory,'Test Game'));await assert.rejects(exportClip({clip,start:0,end:6,mode:'fast',tracks:[],name:'failed',folder:directory},{...deps,run:async(name,args)=>{if(name==='ffmpeg'){await fs.writeFile(args.at(-1),'partial');throw new Error('interrupted');}return run(name,args);}}),/interrupted/);
 await assert.rejects(exportClip({clip,start:0,end:6,mode:'fast',tracks:[],name:'unverified',folder:directory},{...deps,run:async(name,args)=>{if(name==='ffmpeg'){await fs.writeFile(args.at(-1),'not a media file');return '';}return run(name,args);}}));
 assert.deepEqual(await fs.readdir(path.join(directory,'Test Game')),before);assert.equal(await digest(clip.file),originalHash);
 const replaced=path.join(directory,'replaced.mp4');await fs.copyFile(clip.file,replaced);const changed={...clip,file:replaced},plan=await planClipExport({clip:changed,start:0,end:6,mode:'fast'},deps);await fs.appendFile(replaced,'changed');
 await assert.rejects(exportClip({clip:changed,start:0,end:6,mode:'fast',planToken:plan.token,tracks:[],name:'changed',folder:directory},deps),/değişti/);
});
test('MP4 codec compatibility is checked before writing and non-MP4 H264 sources remain lossless',async()=>{
 const mkv=path.join(directory,'source.mkv');await run('ffmpeg',['-v','error','-n','-i',clip.file,'-map','0','-c','copy',mkv]);const original=await packets(mkv),source={...clip,file:mkv};
 const output=await exportClip({clip:source,start:0,end:Number((await probe(mkv)).format.duration),mode:'fast',tracks:[1],name:'from-mkv',folder:directory},deps);assert.deepEqual((await packets(output.file)).map(p=>p.data_hash),original.map(p=>p.data_hash));
 const webm=path.join(directory,'vp8.webm');await run('ffmpeg',['-v','error','-n','-f','lavfi','-i','testsrc2=size=160x90:rate=10:duration=2','-c:v','libvpx','-deadline','realtime',webm]);const unsupported={...clip,file:webm,seconds:2,tracks:0,audio:[]};
 await assert.rejects(planClipExport({clip:unsupported,start:0,end:2,mode:'fast'},deps),/MP4.*Hassas/);
 const converted=await exportClip({clip:unsupported,start:.2,end:1.2,mode:'precise',tracks:[],name:'converted',folder:directory},deps);assert.equal(converted.videoCopied,false);assert.equal(converted.media.streams[0].codec_name,'h264');
});
test('delayed audio stays delayed in both playback mix and preserved stem',async()=>{
 const file=path.join(directory,'delayed.mp4');await run('ffmpeg',['-v','error','-n','-f','lavfi','-i','testsrc2=size=160x90:rate=10:duration=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-itsoffset','0.5','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=1.5','-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-preset','ultrafast','-c:a','aac',file]);
 const output=await exportClip({clip:{...clip,file,seconds:2},start:0,end:2,mode:'fast',tracks:[0,1],name:'aligned',folder:directory},deps);
 const earlyMix=rms(await pcm(output.file,0,.05,.2)),lateMix=rms(await pcm(output.file,0,.8,.2));assert(earlyMix<lateMix*.8,`early mix ${earlyMix}; late mix ${lateMix}`);
 assert(rms(await pcm(output.file,2,.05,.2))<.00001);assert(rms(await pcm(output.file,2,.8,.2))>.05);
});
test('simultaneous exports publish distinct verified files without replacing an existing name',async()=>{
 const options={clip,start:0,end:6,mode:'fast',tracks:[],name:'racing',folder:directory},result=await Promise.all([exportClip(options,deps),exportClip(options,deps)]);assert.notEqual(result[0].file,result[1].file);
 assert.equal((await packets(result[0].file)).length,60);assert.equal((await packets(result[1].file)).length,60);assert.equal(await digest(clip.file),originalHash);
});
test('production NVENC precise path preserves cadence and geometry when an encoder is available',async t=>{
 try{await run('ffmpeg',['-v','error','-i',clip.file,'-frames:v','1','-an','-c:v','h264_nvenc','-f','null','NUL']);}catch(error){if(/nvenc|nvidia|cuda|driver|device|capable/i.test(error.stderr||'')){t.skip('NVIDIA encoder unavailable on this machine');return;}throw error;}
 const output=await exportClip({clip,start:2.3,end:3.4,mode:'precise',tracks:[0],name:'nvenc',folder:directory},{run,probe}),video=output.media.streams[0];assert.equal(output.videoCopied,false);assert.equal(video.nb_frames,'11');assert.equal(video.avg_frame_rate,'10/1');assert.equal(video.width,160);assert.equal(video.height,90);assert.equal(Number(video.duration),1.1);
});
test('open GOP dependencies at either boundary are rejected before promising a clean fast range',async()=>{
 const file=path.join(directory,'open-gop.mp4');await run('ffmpeg',['-v','error','-n','-f','lavfi','-i','testsrc2=size=160x90:rate=10:duration=6','-c:v','libx264','-preset','medium','-g','20','-keyint_min','20','-sc_threshold','0','-bf','3','-x264-params','open-gop=1',file]);
 await assert.rejects(planClipExport({clip:{...clip,file,tracks:0,audio:[]},start:0,end:1.6,mode:'fast'},deps),/bağımlılık|Hassas/);
});
