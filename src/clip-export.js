const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {audioOutput,audioSelection}=require('./audio-editor');
const {safeName}=require('./files');
const {assertClipVersion}=require('./clip-source');

// These codecs retain their original compressed video in MP4. Other source
// codecs can be converted by a precise cut, but cannot promise a lossless copy.
const COPY_CODECS=new Set(['h264','hevc','av1']);
const EPSILON=.00001;
const round=value=>Number(value.toFixed(6));
function requireDependencies(deps){if(typeof deps?.probe!=='function'||typeof deps?.run!=='function')throw new TypeError('probe ve run gerekli.');}
function sourceKey(file,stat){return[file,stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join('|');}
async function sourceStat(file){const stat=await fs.stat(file);if(!stat.isFile()||!stat.size)throw new Error('Klip dosyası bulunamadı.');return stat;}
function parseOutput(value){return typeof value==='string'||Buffer.isBuffer(value)?JSON.parse(String(value)):value;}
function positive(value){const n=Number(value);return Number.isFinite(n)&&n>0?n:null;}
function frameRate(video){const [n,d]=String(video.avg_frame_rate||video.r_frame_rate||'0/1').split('/').map(Number);return n/d||30;}
function validClip(clip){if(!clip||typeof clip.file!=='string'||!path.isAbsolute(clip.file))throw new Error('Geçersiz klip.');}
function tokenFor(source,mode,range){return crypto.createHash('sha256').update(JSON.stringify({source,mode,range})).digest('hex');}

async function prepare(options,deps){
 requireDependencies(deps);const {clip,start,end,mode='precise'}=options||{};validClip(clip);
 if(!['fast','precise'].includes(mode)||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<.1)throw new Error('Geçersiz kesim aralığı.');
 const stat=await sourceStat(clip.file);
 if(clip.mtime!==undefined||clip.size!==undefined)assertClipVersion(clip,stat);
 const source=sourceKey(clip.file,stat),media=await deps.probe(clip.file),video=media?.streams?.find(s=>s.codec_type==='video');
 if(!video||!positive(video.width)||!positive(video.height))throw new Error('Video akışı okunamadı.');
 const duration=positive(media.format?.duration)||positive(video.duration);if(!duration||end>duration+.03)throw new Error('Geçersiz kesim aralığı.');
 // End positions from the player's duration can differ by container rounding.
 const requested={start:round(start),end:round(Math.min(end,duration))};
 const fullLength=requested.start===0&&Math.abs(requested.end-duration)<=EPSILON;
 const videoCopied=fullLength||mode==='fast';
 if(videoCopied&&!COPY_CODECS.has(video.codec_name))throw new Error('Bu video kodlaması ('+video.codec_name+') MP4 içine özgün video olarak aktarılamıyor. Kesim için Hassas modunu kullan veya kaynağı H.264, HEVC ya da AV1 olarak dönüştür.');
 let actual={...requested},packetCount=null;
 if(mode==='fast'&&!fullLength){
  // Decode indexed keyframes to confirm the random-access points. Retain the
  // decode-order packet indexes to bound the GOP correctly with B-frames.
  // Merely setting -t would copy packets from the next GOP before its PTS.
  const indexed=parseOutput(await deps.run('ffprobe',['-v','error','-select_streams','v:0','-skip_frame','nokey','-show_packets','-show_frames','-show_entries','packet=pts_time,dts_time,duration_time,flags:frame=key_frame,best_effort_timestamp_time','-of','json',clip.file]));
  const rows=indexed?.packets_and_frames,packets=rows?.filter(row=>row.type==='packet'),frames=rows?.filter(row=>row.type==='frame'&&row.key_frame===1),origin=Number(media.format?.start_time)||0;if(!packets?.length||!frames?.length)throw new Error('Anahtar kare dizini okunamadı. Hassas modunu kullan.');
  const frameTimes=new Set(frames.map(frame=>round(Number(frame.best_effort_timestamp_time)-origin)));
  const keys=packets.map((packet,index)=>({index,time:round(Number(packet.pts_time)-origin),key:String(packet.flags||'').includes('K')})).filter(row=>row.key&&Number.isFinite(row.time)&&frameTimes.has(row.time));
  if(!keys.length||keys.some((key,i)=>i&&key.time<=keys[i-1].time))throw new Error('Anahtar kare dizini güvenilir değil. Hassas modunu kullan.');
  const first=[...keys].reverse().find(key=>key.time<=requested.start+EPSILON),last=keys.find(key=>key.time>=requested.end-EPSILON);
  if(!first&&requested.start>EPSILON)throw new Error('Başlangıç için anahtar kare bulunamadı. Hassas modunu kullan.');
  const firstIndex=requested.start===0?0:first?.index??0,lastIndex=last?.index??packets.length;
  actual.start=round(Math.max(0,first?.time??0));actual.end=round(Math.min(duration,last?.time??duration));packetCount=lastIndex-firstIndex;
  if(packetCount<=0||actual.end-actual.start<.1)throw new Error('Geçerli hızlı kesim aralığı bulunamadı. Hassas modunu kullan.');
  // Leading pictures of an open GOP may depend on frames outside the range.
  // Do not silently export a corrupt or differently timed "lossless" result.
  const leadingBeforeStart=actual.start>0&&packets.slice(firstIndex,lastIndex).some(packet=>Number(packet.pts_time)-origin<actual.start-EPSILON);
  const leadingAfterEnd=lastIndex<packets.length&&packets.slice(lastIndex+1).some(packet=>Number(packet.pts_time)-origin<actual.end-EPSILON);
  if(leadingBeforeStart||leadingAfterEnd)throw new Error('Bu anahtar kare aralığında dışarıdaki karelere bağımlılık var. Hassas modunu kullan.');
 }
 const range={start:actual.start,end:actual.end,duration:round(actual.end-actual.start)};
 if(sourceKey(clip.file,await sourceStat(clip.file))!==source)throw new Error('Klip değişti; aralığı yeniden hazırla.');
 const plan={mode,requestedRange:{...requested,duration:round(requested.end-requested.start)},range,videoCopied,fullLength,token:tokenFor(source,mode,range)};
 return{plan,media,video,source,packetCount};
}

/** Plan before showing an export confirmation. Fast ranges enclose the request.
 * Dependencies: probe(file) -> ffprobe streams/format; run(tool,args) -> stdout.
 */
async function planClipExport(options,deps){return(await prepare(options,deps)).plan;}

function outputName(name){
 if(typeof name!=='string'||!name.trim()||name.length>180||/[<>:"/\\|?*\x00-\x1f]/.test(name)||name!==name.trim()||/[. ]$/.test(name)||/^\.{1,2}$/.test(name))throw new Error('Geçersiz çıktı adı.');
 const stem=name.replace(/\.mp4$/i,'');if(!stem||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))throw new Error('Geçersiz çıktı adı.');return stem+'.mp4';
}
function isWithin(root,directory){const relative=path.relative(root,directory);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}
async function outputDirectory(folder,game){
 if(typeof folder!=='string'||!path.isAbsolute(folder))throw new Error('Geçersiz çıktı klasörü.');
 await fs.mkdir(folder,{recursive:true});const root=await fs.realpath(folder),directory=path.join(root,safeName(game));
 await fs.mkdir(directory,{recursive:true});const actual=await fs.realpath(directory);if(!isWithin(root,actual))throw new Error('Çıktı klasörü kitaplığın dışında.');return actual;
}
function defaultEncoder(video){return['-c:v',video.codec_name==='hevc'?'hevc_nvenc':video.codec_name==='av1'?'av1_nvenc':'h264_nvenc','-preset','p5','-rc','constqp','-qp','12'];}
function verifyOutput(media,prepared,audioCount){
 const video=media?.streams?.find(s=>s.codec_type==='video'),audio=media?.streams?.filter(s=>s.codec_type==='audio')||[],source=prepared.video,{plan}=prepared;
 if(!video||video.width!==source.width||video.height!==source.height||audio.length!==audioCount||audio.some(s=>s.codec_name!=='aac'))throw new Error('Çıktı doğrulanamadı.');
 if(plan.videoCopied&&video.codec_name!==source.codec_name)throw new Error('Özgün video akışı korunamadı.');
 const expectedFrames=prepared.packetCount??(plan.videoCopied?positive(source.nb_frames):null);
 if(expectedFrames&&Number(video.nb_frames)!==expectedFrames)throw new Error('Çıktı kare sayısı doğrulanamadı.');
 if(source.sample_aspect_ratio&&source.sample_aspect_ratio!=='N/A'&&video.sample_aspect_ratio!==source.sample_aspect_ratio)throw new Error('Çıktı en boy oranı değişti.');
 const expected=plan.fullLength?positive(source.duration):plan.range.duration,actual=positive(video.duration),tolerance=Math.max(.06,1.1/frameRate(source));
 if(expected&&actual&&Math.abs(expected-actual)>tolerance)throw new Error('Çıktı kesim aralığı doğrulanamadı.');
 if(!positive(media?.format?.duration))throw new Error('Çıktı süresi okunamadı.');
}
async function publish(temp,directory,filename,source){
 const parsed=path.parse(filename);for(let suffix=1;suffix<10000;suffix++){
  const target=path.join(directory,parsed.name+(suffix===1?'':' ('+suffix+')')+parsed.ext);
  if(path.resolve(target).toLowerCase()===path.resolve(source).toLowerCase())continue;
  try{await fs.link(temp,target);return target;}catch(error){if(error.code!=='EEXIST')throw error;}
 }throw new Error('Benzersiz çıktı adı oluşturulamadı.');
}

/** Write, probe, then atomically publish a new MP4. The source is read-only.
 * Pass planToken from planClipExport to reject a stale reviewed range/source.
 * videoEncoderArgs is an optional trusted platform encoder configuration.
 */
async function exportClip(options,deps){
 const {clip,name=clip?.name+'-kesit',folder,tracks,volumes={},planToken}=options||{},filename=outputName(name);
 const prepared=await prepare(options,deps),{plan,video,source}=prepared;
 if(planToken!==undefined&&(typeof planToken!=='string'||planToken!==plan.token))throw new Error('Klip veya kesim aralığı değişti; aralığı yeniden hazırla.');
 const sourceAudio=prepared.media.streams.filter(s=>s.codec_type==='audio'),effectiveClip={...clip,tracks:sourceAudio.length,audio:sourceAudio.map((stream,index)=>({index,name:clip.audio?.find(row=>row.index===index)?.name||stream.tags?.title||stream.tags?.handler_name||'Ses '+(index+1),codec:stream.codec_name}))};
 const audio=audioOutput(effectiveClip,tracks,volumes,{alignTimeline:true}),selected=audioSelection(effectiveClip,tracks),directory=await outputDirectory(folder,clip.game),temp=path.join(directory,'.'+crypto.randomUUID()+'.mp4');
 try{
  const args=['-v','error','-n'];
  if(plan.range.start>0)args.push('-ss',String(plan.range.start));
  args.push('-noautorotate','-i',clip.file);
  if(!plan.fullLength)args.push('-t',String(plan.range.duration));
  args.push('-map','0:v:0',...audio.args,'-map_metadata','0','-map_metadata:s:v:0','0:s:v:0','-map_chapters','-1');
  if(plan.videoCopied){args.push('-c:v','copy');if(prepared.packetCount!==null)args.push('-frames:v',String(prepared.packetCount));}
  else args.push(...(deps.videoEncoderArgs||defaultEncoder(video)),'-fps_mode','passthrough');
  if(audio.names.length){args.push('-c:a','aac','-b:a','256k');audio.names.forEach((title,index)=>{
   const originalIndex=selected.length===1?selected[0]:selected[index-1];
   if(originalIndex!==undefined)args.push('-map_metadata:s:a:'+index,'0:s:a:'+originalIndex);
   args.push('-metadata:s:a:'+index,'title='+title,'-metadata:s:a:'+index,'handler_name='+title,'-disposition:a:'+index,index===0?'default':'0');
  });}
  else args.push('-an');
  args.push('-sn','-dn','-movflags','+faststart','-f','mp4',temp);
  await deps.run('ffmpeg',args);const media=await deps.probe(temp);verifyOutput(media,prepared,audio.names.length);
  if(sourceKey(clip.file,await sourceStat(clip.file))!==source)throw new Error('Klip dışa aktarma sırasında değişti; yeniden dene.');
  const file=await publish(temp,directory,filename,clip.file);if(media.format)media.format.filename=file;return{file,media,range:plan.range,videoCopied:plan.videoCopied};
 }finally{await fs.unlink(temp).catch(()=>{});}
}

module.exports={planClipExport,exportClip};
