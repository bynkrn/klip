const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');

// All TimelinePreviews instances share two decoder slots. A superseded request
// leaves its running decoder alone but removes its queued work immediately.
let active=0;const waiters=[];
const stale=()=>new Error('Zaman çizelgesi isteği iptal edildi.');
function acquire(token){if(token.cancelled)return Promise.reject(stale());if(active<2){active++;return Promise.resolve();}return new Promise((resolve,reject)=>waiters.push({token,resolve,reject}));}
function release(){while(waiters.length){const waiter=waiters.shift();if(waiter.token.cancelled){waiter.reject(stale());continue;}waiter.resolve();return;}active--;}
function cancel(token){token.cancelled=true;for(let i=waiters.length-1;i>=0;i--)if(waiters[i].token===token){const [waiter]=waiters.splice(i,1);waiter.reject(stale());}}

class TimelinePreviews{
 constructor({cacheDir,resolve,run,asset,revoke}){Object.assign(this,{cacheDir,resolve,run,asset,revoke});this.pending=new Map();this.cache=new Map();this.latest=null;}
 clip(id){const clip=typeof id==='string'&&id?this.resolve(id):null;if(!clip||clip.id!==id||typeof clip.file!=='string'||!path.isAbsolute(clip.file))throw new Error('Klip bulunamadı.');if(typeof clip.seconds!=='number'||!Number.isFinite(clip.seconds)||clip.seconds<=0)throw new Error('Geçersiz klip süresi.');return clip;}
 current(token){if(token.cancelled||this.latest!==token)throw stale();const clip=this.clip(token.id);if(clip.file!==token.file)throw new Error('Klip kaynağı değişti.');return clip;}
 async snapshot(token){const clip=this.current(token),stat=await fs.stat(clip.file);this.current(token);if(!stat.isFile()||stat.size<=0)throw new Error('Video dosyası bulunamadı.');return{seconds:clip.seconds,key:[clip.file,stat.mtimeMs,stat.size,stat.dev,stat.ino,clip.seconds].join('|')};}
 revokeCache(id){const cached=this.cache.get(id);if(cached){for(const frame of cached.result.frames)this.revoke(frame.url);this.cache.delete(id);}}
 invalidate(id){this.revokeCache(id);const pending=this.pending.get(id);if(pending)cancel(pending.token);}
 get(payload){
  let clip;const id=typeof payload==='string'?payload:payload?.id;try{clip=this.clip(id);}catch(error){return Promise.reject(error);}
  const pending=this.pending.get(id);if(pending&&!pending.token.cancelled)return pending.promise;
  for(const entry of this.pending.values())if(entry.token.id!==id)cancel(entry.token);
  const token={id,file:clip.file,cancelled:false};this.latest=token;
  const promise=this.generate(token);const entry={token,promise};this.pending.set(id,entry);
  const done=()=>{if(this.pending.get(id)===entry)this.pending.delete(id);};promise.then(done,done);return promise;
 }
 async existing(file){try{const stat=await fs.stat(file);if(!stat.isFile()||stat.size<=0)throw new Error('Önizleme karesi okunamadı.');return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
 async frame(token,key,time,index){
  this.current(token);const hash=crypto.createHash('sha256').update('timeline-v1|'+key+'|'+index+'|'+time).digest('hex'),target=path.join(this.cacheDir,hash+'.jpg');
  if(await this.existing(target)){this.current(token);return target;}
  await acquire(token);let temp;
  try{
   this.current(token);if((await this.snapshot(token)).key!==key)throw new Error('Klip kaynağı değişti.');
   // A competing instance may have populated this exact immutable cache entry.
   if(await this.existing(target))return target;
   temp=path.join(this.cacheDir,crypto.randomUUID()+'.jpg');
   await this.run('ffmpeg',['-v','error','-n','-ss',String(time),'-i',token.file,'-map','0:v:0','-an','-sn','-dn','-frames:v','1','-vf','scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2','-q:v','5',temp]);
   this.current(token);if(!await this.existing(temp))throw new Error('Önizleme karesi oluşturulamadı.');
   if((await this.snapshot(token)).key!==key)throw new Error('Klip kaynağı değişti.');
   await fs.link(temp,target).catch(error=>{if(error.code!=='EEXIST')throw error;});
   if(!await this.existing(target))throw new Error('Önizleme karesi oluşturulamadı.');return target;
  }finally{if(temp)await fs.unlink(temp).catch(()=>{});release();}
 }
 async generate(token){
  const initial=await this.snapshot(token),cached=this.cache.get(token.id);
  if(cached?.key===initial.key){this.current(token);if((await this.snapshot(token)).key!==initial.key)throw new Error('Klip kaynağı değişti.');return this.copy(cached.result);}
  if(cached)this.revokeCache(token.id);await fs.mkdir(this.cacheDir,{recursive:true});this.current(token);
  const last=Math.max(0,initial.seconds-.05),frames=[];for(let index=0;index<12;index++){this.current(token);const time=index===11?last:last*index/11;frames.push({time,file:await this.frame(token,initial.key,time,index)});}
  if((await this.snapshot(token)).key!==initial.key)throw new Error('Klip kaynağı değişti.');
  const published=[];
  try{for(const frame of frames)published.push({time:frame.time,url:this.asset(frame.file)});this.current(token);const result={id:token.id,seconds:initial.seconds,frames:published};this.cache.set(token.id,{key:initial.key,result});return this.copy(result);}
  catch(error){for(const frame of published)this.revoke(frame.url);throw error;}
 }
 copy(result){return{id:result.id,seconds:result.seconds,frames:result.frames.map(frame=>({...frame}))};}
}
module.exports={TimelinePreviews};
