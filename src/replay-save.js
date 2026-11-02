const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const files=require('./files');

const inside=(root,file)=>{const relative=path.relative(root,file);return relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
async function ownedSnapshot(capture,snapshot,original){
 const root=capture.audioSnapshotRoot||(capture.bufferDir&&path.join(capture.bufferDir,'audio-snapshots'));
 if(!root||!path.isAbsolute(root)||!snapshot||!path.isAbsolute(snapshot.folder||'')||!Array.isArray(snapshot.tracks))throw Error('Ses anlık görüntü klasörü doğrulanamadı.');
 const rootStat=await fs.lstat(root),folderStat=await fs.lstat(snapshot.folder),rootReal=await fs.realpath(root),folderReal=await fs.realpath(snapshot.folder);
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||!folderStat.isDirectory()||folderStat.isSymbolicLink()||!inside(rootReal,folderReal)||inside(folderReal,path.resolve(original)))throw Error('Ses anlık görüntü klasörü güvenilir kökün dışında.');
 const seen=new Set();for(const track of snapshot.tracks){
  if(!track||!path.isAbsolute(track.file||''))throw Error('Ses anlık görüntü dosyası doğrulanamadı.');
  const stat=await fs.lstat(track.file),real=await fs.realpath(track.file);
  if(!stat.isFile()||stat.isSymbolicLink()||!inside(folderReal,real)||seen.has(real))throw Error('Ses anlık görüntü dosyası klasörle eşleşmiyor.');seen.add(real);
 }
 return async()=>{
  const current=await fs.lstat(snapshot.folder);if(current.isSymbolicLink()||await fs.realpath(snapshot.folder)!==folderReal||await fs.realpath(root)!==rootReal||!inside(rootReal,folderReal))throw Error('Ses anlık görüntü klasörü değişti; kurtarma dosyaları korundu.');
  await fs.rm(folderReal,{recursive:true});
 };
}
const metadata=(args,index,title)=>args.push('-metadata:s:a:'+index,'title='+title,'-metadata:s:a:'+index,'handler_name='+title);
// Node quotes each argument for CreateProcess. This deliberately overestimates
// escaping and leaves room for the executable/output options under its 32767 limit.
const commandCost=args=>args.reduce((size,arg)=>size+String(arg).length*2+3,2048);
function dynamicArgs(groups,output,{original,microphone=false}={}){
 const args=['-v','error','-n'];if(original)args.push('-i',original);for(const group of groups)args.push('-i',group.file);
 if(original)args.push('-map','0:v:0','-map','0:a:0');groups.forEach((group,i)=>args.push('-map',(i+Number(!!original))+':a'+(group.encoded?'':':0')));if(microphone)args.push('-map','0:a:5');args.push('-c','copy');
 let audio=original?1:0;if(original)metadata(args,0,'Birleşik ses');
 for(const group of groups){for(const track of group.tracks){if(!group.encoded){args.push('-c:a:'+audio,'aac','-b:a:'+audio,'256k');metadata(args,audio,String(track.name||track.id||'Uygulama'));}audio++;}}
 if(microphone)metadata(args,audio,'Mikrofon');args.push(output);return args;
}
async function boundedAudioGroups(snapshot,original,microphone,staged,run){
 let groups=snapshot.tracks.map(track=>({file:track.file,tracks:[track],encoded:false}));
 // WAVs are encoded once. Larger sets are assembled into audio-only groups;
 // subsequent levels copy AAC and its stream titles without another encode.
 while(groups.length>64||commandCost(dynamicArgs(groups,staged,{original,microphone}))>24000){
  // MP4 audio groups retain AAC priming and the 48 kHz sample time base. A
  // Matroska intermediate rounds packet times to milliseconds and shifts samples.
  const next=[];let chunk=[];const output=()=>path.join(snapshot.folder,'.audio-'+crypto.randomUUID()+'.m4a');let target=output();
  const flush=async()=>{const args=dynamicArgs(chunk,target);if(commandCost(args)>24000)throw Error('Ses dosyası yolu veya adı Windows komut sınırına sığmıyor.');await run('ffmpeg',args);next.push({file:target,tracks:chunk.flatMap(group=>group.tracks),encoded:true});chunk=[];target=output();};
  for(const group of groups){if(chunk.length&&(chunk.length>=64||commandCost(dynamicArgs([...chunk,group],target))>24000))await flush();chunk.push(group);}
  if(chunk.length)await flush();if(next.length>=groups.length)throw Error('Tüm ses akışları Windows komut sınırı içinde birleştirilemedi; kurtarma dosyaları korundu.');groups=next;
 }
 return groups;
}

// The success boundary is the verified file's atomic publication. Preview work
// and deletion of the redundant raw/staging files must not delay that boundary.
async function saveReplay({capture,folder,mode,run,probe,defer=job=>setImmediate(()=>job().catch(()=>{}))}){
 const timings={},started=performance.now();let staged;
 const measure=async(name,fn)=>{const start=performance.now();try{return await fn();}finally{timings[name]=Math.round((performance.now()-start)*10)/10;}};
 try{
  const original=await measure('captureMs',()=>capture.save());
  let args,audioCount=6,sourceMedia,cleanupSnapshot,snapshot,warnings=[];
  // Claim native pinned PCM into owned recovery WAVs before touching the clip
  // destination: an unavailable library must not leave its audio snapshot pinned.
  if(capture.dynamicAudio){snapshot=await measure('audioSnapshotMs',()=>capture.snapshotAudio(original));cleanupSnapshot=await ownedSnapshot(capture,snapshot,original);warnings=Array.isArray(snapshot.warnings)?snapshot.warnings.map(warning=>typeof warning==='string'?warning:(warning?.name?warning.name+': ':'')+(warning?.message||'Ayrı ses izi kullanılamadı.')):[];}
  const game=files.safeName(mode==='screen'?'Masaüstü':capture.lastGame),dir=path.join(folder,game);
  await fs.mkdir(dir,{recursive:true});const target=await files.unique(path.join(dir,new Date().toISOString().replace(/[:.]/g,'-')+'.mp4'));staged=path.join(dir,'.'+crypto.randomUUID()+'.mp4');
  if(capture.dynamicAudio){
   sourceMedia=await measure('sourceProbeMs',()=>probe(original));const sourceVideo=sourceMedia.streams?.find(s=>s.codec_type==='video'),sourceAudio=sourceMedia.streams?.filter(s=>s.codec_type==='audio')||[],microphone=capture.config?.audioEnabled?.[6]!==false;
   if(!sourceVideo?.width||!sourceVideo.height||!Number.isFinite(Number(sourceMedia.format?.duration))||Number(sourceMedia.format.duration)<=0||sourceAudio.length<(microphone?6:1))throw Error('Kaynak klibin video/ses akışları doğrulanamadı.');
   const groups=await measure('audioMuxMs',()=>boundedAudioGroups(snapshot,original,microphone,staged,run));args=dynamicArgs(groups,staged,{original,microphone});
   audioCount=1+snapshot.tracks.length+Number(microphone);
  }else{
   args=['-v','error','-n','-i',original,'-map','0','-c','copy'];
   const titles=['Birleşik ses',...Array.from({length:4},(_,i)=>capture.audio.find(a=>a.track===i+2)?.name||['Oyun (bekleniyor)','Discord (bekleniyor)','Tarayıcı (bekleniyor)','Müzik (bekleniyor)'][i]),'Mikrofon'];
   titles.forEach((title,i)=>metadata(args,i,title));args.push(staged);
  }
  // Reserve a conservative index up front: faststart otherwise rereads and
  // shifts the entire recording after copying it. Both paths remain stream copy.
  const seconds=Math.min(300,Math.max(1,Number(capture.config?.duration)||300)),fps=Math.min(360,Math.max(1,Number(capture.config?.fps==='custom'?capture.config.customFps:capture.config?.fps)||360));
  const headerBytes=Math.ceil((262144+seconds*(fps+audioCount*Math.ceil(48000/1024))*64)/1048576)*1048576;
  const base=args.slice(0,-1);
  await measure('remuxMs',async()=>{
   try{await run('ffmpeg',[...base,'-moov_size',String(headerBytes),staged]);}
   catch(error){if(!/reserved_moov_size is too small/i.test(error.message))throw error;await fs.unlink(staged).catch(e=>{if(e.code!=='ENOENT')throw e;});await run('ffmpeg',[...base,'-movflags','+faststart',staged]);}
  });
  const {media,stat}=await measure('verifyMs',async()=>{
   const media=await probe(staged),video=media.streams?.find(stream=>stream.codec_type==='video');
   if(!video)throw new Error('Video akışı yok');
   const stat=await fs.stat(staged);
   if(!stat.size||!video.width||!video.height||!Number.isFinite(Number(media.format?.duration))||Number(media.format.duration)<=0)throw new Error('Klip doğrulanamadı');
   if(capture.dynamicAudio){const sourceVideo=sourceMedia.streams.find(s=>s.codec_type==='video'),duration=Number(sourceMedia.format.duration),wrongDuration=media.streams.some(stream=>Number.isFinite(Number(stream.duration))&&Math.abs(Number(stream.duration)-duration)>.25);if(media.streams.filter(s=>s.codec_type==='video').length!==1||media.streams.filter(s=>s.codec_type==='audio').length!==audioCount||video.width!==sourceVideo.width||video.height!==sourceVideo.height||Math.abs(Number(media.format.duration)-duration)>.25||wrongDuration)throw Error('Klip akış sayısı, boyutu veya süresi kaynakla eşleşmiyor.');}
   return{media,stat};
  });
  const item={id:target,name:path.parse(target).name,fileName:path.basename(target),file:target,game,mtime:stat.mtimeMs,size:stat.size};
  await measure('publishMs',()=>fs.link(staged,target));
  const redundant=staged;staged=undefined;timings.totalMs=Math.round((performance.now()-started)*10)/10;
  // A failed cleanup is recoverable and must never turn a published clip into
  // a reported failed save. Keep each deletion independent.
  const cleanup=async()=>{
   try{await capture.completeRecovery?.(original);}
   catch(error){capture.emit?.('warning','Klip kaydedildi; kurtarma onayı alınamadığı için orijinal kayıt ve sesler korundu: '+error.message);return Promise.allSettled([fs.unlink(redundant)]);}
   return Promise.allSettled([fs.unlink(redundant),fs.unlink(original),...(cleanupSnapshot?[cleanupSnapshot()]:[])]);
  };
  try{defer(cleanup);}catch{setImmediate(()=>cleanup());}
  return{item,media,timings,warnings};
 }finally{if(staged)await fs.unlink(staged).catch(()=>{});}
}

module.exports={saveReplay};
