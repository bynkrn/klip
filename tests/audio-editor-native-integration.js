const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{execFile}=require('node:child_process');
const {EditorAudio,audioOutput}=require('../src/audio-editor');
const run=(name,args,binary=false)=>new Promise((resolve,reject)=>execFile(path.resolve(__dirname,'../tools',name+'.exe'),args,{windowsHide:true,timeout:30000,maxBuffer:8*1024*1024,encoding:binary?'buffer':'utf8'},(error,out)=>error?reject(error):resolve(out)));
const probe=async file=>JSON.parse(await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));
async function frequencies(file,index){const raw=await run('ffmpeg',['-v','error','-ss','0.5','-i',file,'-t','2','-map','0:a:'+index,'-ac','1','-ar','48000','-f','f32le','pipe:1'],true),n=raw.length/4,result={};for(const hz of [350,700,1050]){let a=0,b=0;for(let i=0;i<n;i++){const value=raw.readFloatLE(i*4),phase=2*Math.PI*hz*i/48000;a+=value*Math.cos(phase);b+=value*Math.sin(phase);}result[hz]=Math.hypot(a,b)*2/n;}return result;}
(async()=>{
 const root=path.resolve(__dirname,'capture-results','audio-editor-'+Date.now());await fs.mkdir(root,{recursive:true});const source=path.join(root,'four-tracks.mp4');
 await run('ffmpeg',['-v','error','-n','-f','lavfi','-i','color=c=black:s=640x480:r=30:d=4',...['350','700','1050'].flatMap(hz=>['-f','lavfi','-i','sine=frequency='+hz+':sample_rate=48000:duration=4']),'-filter_complex','[1:a][2:a][3:a]amix=inputs=3:normalize=0[all]','-map','0:v:0','-map','[all]','-map','1:a:0','-map','2:a:0','-map','3:a:0','-c:v','h264_nvenc','-preset','p5','-rc','constqp','-qp','16','-c:a','aac','-b:a','256k',...['Birleşik ses','Quake Live','Discord','Müzik'].flatMap((name,i)=>['-metadata:s:a:'+i,'handler_name='+name]),source]);
 const metadata=await probe(source),audioStreams=metadata.streams.filter(s=>s.codec_type==='audio'),clip={id:source,file:source,tracks:audioStreams.length,audio:audioStreams.map((a,index)=>({index,name:a.tags.handler_name,codec:a.codec_name}))},links=new Map();
 const service=new EditorAudio({cacheDir:path.join(root,'audio-cache'),resolve:id=>id===source?clip:null,run,asset:file=>{const url='klipmedia://local/'+links.size;links.set(url,file);return url;},revoke:url=>links.delete(url)});
 const extracted=await service.get({id:source,tracks:[1,3]});assert.equal(extracted.length,2);const game=await frequencies(links.get(extracted[0].url),0);assert(game[350]>.08&&game[700]<.003&&game[1050]<.003);
 const checks=[];for(const selection of [[1],[1,3],[]]){
  const output=path.join(root,'selected-'+(selection.join('-')||'silent')+'.mp4'),planned=audioOutput(clip,selection);
  await run('ffmpeg',['-v','error','-n','-ss','0','-i',source,'-t','3','-map','0:v:0',...planned.args,'-c:v','h264_nvenc','-preset','p5','-rc','constqp','-qp','16','-fps_mode','passthrough','-c:a','aac','-b:a','256k',...planned.names.flatMap((name,i)=>['-metadata:s:a:'+i,'handler_name='+name]),'-movflags','+faststart',output]);
  const info=await probe(output),streams=info.streams.filter(s=>s.codec_type==='audio');assert.equal(streams.length,selection.length>1?selection.length+1:selection.length);const spectra=[];
  for(let i=0;i<streams.length;i++){const f=await frequencies(output,i);assert(f[700]<.003,'Muted Discord must be absent from every output track');spectra.push(f);}
  if(selection.length){assert(spectra[0][350]>.08);if(selection.includes(3))assert(spectra[0][1050]>.08);else assert(spectra[0][1050]<.003);}
  assert.equal(info.streams[0].width,640);assert.equal(info.streams[0].height,480);checks.push({selection,outputTracks:streams.length,spectra});
 }
 const result={isolatedPreview:true,mutedApplicationAbsent:true,renderMatchesEditorSelection:true,selectedStemsPreserved:true,silentExport:true,checks};await fs.writeFile(path.resolve(__dirname,'audio-editor-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
