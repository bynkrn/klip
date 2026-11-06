const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
// This is offline editor work. Capture never calls this service. One decoder is
// shared across instances, and queued work for a previous source is discarded.
let active=false;const waiting=[];
const stale=()=>new Error('Ses dalgası isteği iptal edildi.');
function acquire(token){if(token.cancelled)return Promise.reject(stale());if(!active){active=true;return Promise.resolve();}return new Promise((resolve,reject)=>waiting.push({token,resolve,reject}));}
function release(){while(waiting.length){const row=waiting.shift();if(row.token.cancelled){row.reject(stale());continue;}row.resolve();return;}active=false;}
function cancel(token){token.cancelled=true;for(let i=waiting.length-1;i>=0;i--)if(waiting[i].token===token)waiting.splice(i,1)[0].reject(stale());}
class AudioWaveforms{
 constructor({cacheDir,resolve,run}){Object.assign(this,{cacheDir,resolve,run});this.pending=new Map();this.latest=null;}
 clip(id,index){const clip=typeof id==='string'&&id?this.resolve(id):null;if(!clip||clip.id!==id||typeof clip.file!=='string'||!path.isAbsolute(clip.file))throw new Error('Klip bulunamadı.');if(!Number.isFinite(clip.seconds)||clip.seconds<=0||clip.seconds>86400)throw new Error('Geçersiz klip süresi.');if(!Number.isSafeInteger(index)||index<0||!(Array.isArray(clip.audio)?clip.audio.some(track=>track.index===index):index<clip.tracks))throw new Error('Geçersiz ses izi.');return clip;}
 current(token){if(token.cancelled||this.latest!==token)throw stale();const clip=this.clip(token.id,token.index);if(clip.file!==token.file)throw new Error('Klip kaynağı değişti.');return clip;}
 async snapshot(token){const clip=this.current(token),stat=await fs.stat(clip.file);this.current(token);if(!stat.isFile()||!stat.size)throw new Error('Ses dosyası bulunamadı.');return{seconds:clip.seconds,key:[clip.file,stat.size,stat.mtimeMs,stat.dev,stat.ino,clip.seconds,token.index,token.bins].join('|')};}
 invalidate(id){for(const row of this.pending.values())if(row.token.id===id)cancel(row.token);}
 get(payload){
  let clip;const {id,index,bins=800}=payload||{};try{clip=this.clip(id,index);if(!Number.isInteger(bins)||bins<1||bins>1200)throw new Error('Geçersiz ses dalgası çözünürlüğü.');}catch(error){return Promise.reject(error);}
  const key=[id,index,bins].join('|'),existing=this.pending.get(key);if(existing&&!existing.token.cancelled)return existing.promise;
  for(const row of this.pending.values())cancel(row.token);const token={id,index,bins,file:clip.file,cancelled:false};this.latest=token;const promise=this.generate(token),row={token,promise};this.pending.set(key,row);const done=()=>{if(this.pending.get(key)===row)this.pending.delete(key);};promise.then(done,done);return promise;
 }
 async generate(token){
  const initial=await this.snapshot(token),hash=crypto.createHash('sha256').update('waveform-v3|'+initial.key).digest('hex'),target=path.join(this.cacheDir,hash+'.waveform.json');await fs.mkdir(this.cacheDir,{recursive:true});this.current(token);
  try{const stat=await fs.stat(target);if(stat.isFile()&&stat.size<=32000){const value=JSON.parse(await fs.readFile(target,'utf8'));if(Array.isArray(value.peaks)&&value.peaks.length===token.bins&&value.peaks.every(peak=>Number.isFinite(peak)&&peak>=0&&peak<=1)){if((await this.snapshot(token)).key!==initial.key)throw new Error('Klip kaynağı değişti.');return{id:token.id,index:token.index,seconds:initial.seconds,peaks:value.peaks};}}}catch(error){if(token.cancelled)throw stale();if(error.message==='Klip kaynağı değişti.')throw error;}
  await acquire(token);let temp;
  try{
   this.current(token);if((await this.snapshot(token)).key!==initial.key)throw new Error('Klip kaynağı değişti.');
   const totalSamples=Math.ceil(initial.seconds*48000),perBin=Math.max(1,Math.ceil(totalSamples/token.bins)),frames=Math.ceil(perBin/65536),samples=Math.ceil(perBin/frames);
   // Aggregate peak energy across channels without phase cancellation. Small
   // frames bound decoder buffering even when one bin spans a long source.
   const filter='aresample=48000:async=1:first_pts=0,atrim=end_sample='+totalSamples+',apad=whole_len='+(samples*frames*token.bins)+':packet_size='+samples+',asetnsamples=n='+samples+':p=1,astats=metadata=1:reset='+frames+':measure_perchannel=none:measure_overall=Peak_level'+(frames>1?',aselect=not(mod(n+1\\,'+frames+'))':'')+',ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file=-';
   // Only one scalar per bin reaches stdout; no PCM file is kept.
   const output=await this.run('ffmpeg',['-nostdin','-v','error','-t',String(initial.seconds),'-i',token.file,'-map','0:a:'+token.index,'-vn','-sn','-dn','-af',filter,'-frames:a',String(token.bins),'-f','null','-']);
   this.current(token);if((await this.snapshot(token)).key!==initial.key)throw new Error('Klip kaynağı değişti.');if(typeof output!=='string'||output.length>262144)throw new Error('Ses dalgası çözümlenemedi.');
   const matches=[...output.matchAll(/^lavfi\.astats\.Overall\.Peak_level=(-?inf|[-+\d.eE]+)\s*$/gmu)];if(!matches.length||matches.length>token.bins)throw new Error('Ses dalgası çözümlenemedi.');
   const peaks=matches.map(match=>{const db=Number(match[1]);if(match[1]==='-inf')return 0;if(!Number.isFinite(db))throw new Error('Ses dalgası çözümlenemedi.');return Math.round(Math.max(0,Math.min(1,10**(db/20)))*1000000)/1000000;});while(peaks.length<token.bins)peaks.push(0);
   temp=path.join(this.cacheDir,crypto.randomUUID()+'.waveform.tmp');await fs.writeFile(temp,JSON.stringify({peaks}));this.current(token);await fs.rename(temp,target);await this.prune();this.current(token);return{id:token.id,index:token.index,seconds:initial.seconds,peaks};
  }finally{if(temp)await fs.unlink(temp).catch(()=>{});release();}
 }
 async prune(){const names=(await fs.readdir(this.cacheDir)).filter(name=>/^[a-f0-9]{64}\.waveform\.json$/u.test(name));if(names.length<=256)return;const rows=await Promise.all(names.map(async name=>({file:path.join(this.cacheDir,name),modified:(await fs.stat(path.join(this.cacheDir,name))).mtimeMs})));rows.sort((a,b)=>b.modified-a.modified);for(const row of rows.slice(256))await fs.unlink(row.file).catch(()=>{});}
}
module.exports={AudioWaveforms};
