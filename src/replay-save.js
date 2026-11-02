const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const files=require('./files');

// The success boundary is the verified file's atomic publication. Preview work
// and deletion of the redundant raw/staging files must not delay that boundary.
async function saveReplay({capture,folder,mode,run,probe,defer=job=>setImmediate(()=>job().catch(()=>{}))}){
 const timings={},started=performance.now();let staged;
 const measure=async(name,fn)=>{const start=performance.now();try{return await fn();}finally{timings[name]=Math.round((performance.now()-start)*10)/10;}};
 try{
  const original=await measure('captureMs',()=>capture.save()),game=files.safeName(mode==='screen'?'Masaüstü':capture.lastGame),dir=path.join(folder,game);
  await fs.mkdir(dir,{recursive:true});const target=await files.unique(path.join(dir,new Date().toISOString().replace(/[:.]/g,'-')+'.mp4'));staged=path.join(dir,'.'+crypto.randomUUID()+'.mp4');
  const args=['-v','error','-n','-i',original,'-map','0','-c','copy'];
  const titles=['Birleşik ses',...Array.from({length:4},(_,i)=>capture.audio.find(a=>a.track===i+2)?.name||['Oyun (bekleniyor)','Discord (bekleniyor)','Tarayıcı (bekleniyor)','Müzik (bekleniyor)'][i]),'Mikrofon'];
  titles.forEach((title,i)=>args.push('-metadata:s:a:'+i,'title='+title,'-metadata:s:a:'+i,'handler_name='+title));args.push(staged);
  // Reserve a conservative index up front: faststart otherwise rereads and
  // shifts the entire recording after copying it. Both paths remain stream copy.
  const seconds=Math.min(300,Math.max(1,Number(capture.config?.duration)||300)),fps=Math.min(360,Math.max(1,Number(capture.config?.fps==='custom'?capture.config.customFps:capture.config?.fps)||360));
  const headerBytes=Math.ceil((262144+seconds*(fps+6*Math.ceil(48000/1024))*64)/1048576)*1048576;
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
   return{media,stat};
  });
  const item={id:target,name:path.parse(target).name,fileName:path.basename(target),file:target,game,mtime:stat.mtimeMs,size:stat.size};
  await measure('publishMs',()=>fs.link(staged,target));
  const redundant=staged;staged=undefined;timings.totalMs=Math.round((performance.now()-started)*10)/10;
  // A failed cleanup is recoverable and must never turn a published clip into
  // a reported failed save. Keep each deletion independent.
  const cleanup=()=>Promise.allSettled([fs.unlink(redundant),fs.unlink(original)]);
  try{defer(cleanup);}catch{setImmediate(()=>cleanup());}
  return{item,media,timings};
 }finally{if(staged)await fs.unlink(staged).catch(()=>{});}
}

module.exports={saveReplay};
