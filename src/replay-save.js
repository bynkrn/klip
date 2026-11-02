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
  const args=['-v','error','-n','-i',original,'-map','0','-c','copy','-movflags','+faststart'];
  const titles=['Birleşik ses',...Array.from({length:4},(_,i)=>capture.audio.find(a=>a.track===i+2)?.name||['Oyun (bekleniyor)','Discord (bekleniyor)','Tarayıcı (bekleniyor)','Müzik (bekleniyor)'][i]),'Mikrofon'];
  titles.forEach((title,i)=>args.push('-metadata:s:a:'+i,'title='+title,'-metadata:s:a:'+i,'handler_name='+title));args.push(staged);
  await measure('remuxMs',()=>run('ffmpeg',args));
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
