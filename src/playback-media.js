const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const audioStreams=media=>media?.streams?.filter(s=>s.codec_type==='audio')||[];
const needsAudioPreview=media=>media?.format?.tags?.ember_audio_layout==='separate'&&audioStreams(media).length>1;
const signature=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs].join('|');
// The editing source always keeps independent streams. Only in-app playback
// gets a lazily generated mix; saving a clip never waits for this cache work.
class PlaybackMedia{
 constructor({cacheDir,run,probe,queue=job=>job()}){Object.assign(this,{cacheDir,run,probe,queue});this.pending=new Map();}
 async get(file,media){
  if(!needsAudioPreview(media))return file;
  const stat=await fs.stat(file);if(!stat.isFile())throw Error('Video dosyası bulunamadı.');
  const source=signature(stat),key=crypto.createHash('sha256').update('playback-mix-v1|'+file+'|'+source).digest('hex');
  if(this.pending.has(key))return this.pending.get(key);
  const pending=this.prepare(file,media,source,key);this.pending.set(key,pending);
  try{return await pending;}finally{if(this.pending.get(key)===pending)this.pending.delete(key);}
 }
 async prepare(file,media,source,key){
  const target=path.join(this.cacheDir,key+'.mp4');
  try{const stat=await fs.stat(target);if(stat.isFile()&&stat.size)return target;}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.mkdir(this.cacheDir,{recursive:true});const temporary=path.join(this.cacheDir,'.'+crypto.randomUUID()+'.mp4');
  try{
   await this.queue(async()=>{
    if(signature(await fs.stat(file))!==source)throw Error('Klip kaynağı değişti.');
    const streams=audioStreams(media),stems=streams.map((_,i)=>'[0:a:'+i+']aresample=async=1:first_pts=0[stem'+i+']'),filter=stems.join(';')+';'+streams.map((_,i)=>'[stem'+i+']').join('')+'amix=inputs='+streams.length+':duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.98:level=false:latency=true[mix]';
    const args=['-v','error','-n','-i',file,'-filter_complex',filter,'-map','0:v:0','-map','[mix]','-c:v','copy','-c:a','aac','-b:a','256k','-ac','2','-ar','48000','-threads','1','-metadata','ember_audio_layout=mixed','-movflags','+faststart+use_metadata_tags'];
    const duration=Number(media.format?.duration);if(duration>0&&Number.isFinite(duration))args.push('-t',String(duration));args.push(temporary);
    await this.run('ffmpeg',args);const output=await this.probe(temporary),video=output.streams?.filter(s=>s.codec_type==='video')||[],original=media.streams.find(s=>s.codec_type==='video');
    const outputDuration=Number(output.format?.duration);
    if(video.length!==1||audioStreams(output).length!==1||original?.width&&video[0].width!==original.width||original?.height&&video[0].height!==original.height||!Number.isFinite(outputDuration)||outputDuration<=0||duration>0&&Math.abs(outputDuration-duration)>.25||!(await fs.stat(temporary)).size)throw Error('Sesli önizleme doğrulanamadı.');
    if(signature(await fs.stat(file))!==source)throw Error('Klip kaynağı değişti.');
    await fs.link(temporary,target).catch(error=>{if(error.code!=='EEXIST')throw error;});
   });return target;
  }finally{await fs.unlink(temporary).catch(()=>{});}
 }
}
module.exports={PlaybackMedia,needsAudioPreview};
