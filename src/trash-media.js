const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');

// Deleted clips are deliberately kept outside the editable library registry.
class TrashMedia{
 constructor({trash,cacheDir,run,probe,asset,revoke}){Object.assign(this,{trash,cacheDir,run,probe,asset,revoke});this.links=new Map();this.pending=new Map();this.jobs=new Map();this.blocked=new Set();this.active=0;this.waiters=[];}
 urls(id){if(!this.links.has(id))this.links.set(id,{thumbnail:this.asset(()=>this.thumbnail(id))});return this.links.get(id);}
 entries(rows){const ids=new Set(rows.map(row=>row.id));for(const id of this.links.keys())if(!ids.has(id))this.invalidate(id);return rows.map(row=>({...row,thumbnail:this.urls(row.id).thumbnail}));}
 invalidate(id){const entry=this.links.get(id);if(entry){this.revoke(entry.thumbnail);if(entry.videoUrl)this.revoke(entry.videoUrl);this.links.delete(id);}}
 async acquire(){if(this.active<2){this.active++;return;}await new Promise(resolve=>this.waiters.push(resolve));}
 release(){if(this.waiters.length)this.waiters.shift()();else this.active--;}
 queue(kind,id,fn){
  if(this.blocked.has(id))return Promise.reject(new Error('Klip geri yükleniyor.'));
  const key=kind+':'+id;if(this.pending.has(key))return this.pending.get(key);
  const previous=this.jobs.get(id)||Promise.resolve();
  const job=previous.catch(()=>{}).then(async()=>{await this.acquire();try{if(this.blocked.has(id))throw new Error('Klip geri yükleniyor.');const row=await this.trash.resolve(id),stat=await fs.stat(row.physicalPath);if(!stat.isFile())throw new Error('Video dosyası bulunamadı.');return await fn(row,stat);}finally{this.release();}});
  this.pending.set(key,job);this.jobs.set(id,job);
  const done=()=>{if(this.pending.get(key)===job)this.pending.delete(key);if(this.jobs.get(id)===job)this.jobs.delete(id);};job.then(done,done);return job;
 }
 signature(row,stat){return row.originalPath+'|'+stat.mtimeMs+'|'+stat.size;}
 async generated(target,args){
  try{await fs.access(target);return target;}catch{}
  await fs.mkdir(this.cacheDir,{recursive:true});const temp=path.join(this.cacheDir,crypto.randomUUID()+path.extname(target));
  try{await this.run('ffmpeg',[...args,temp]);await fs.link(temp,target).catch(error=>{if(error.code!=='EEXIST')throw error;});return target;}finally{await fs.unlink(temp).catch(()=>{});}
 }
 async thumbnailFile(row,stat){
  const hash=crypto.createHash('sha256').update(this.signature(row,stat)).digest('hex'),target=path.join(this.cacheDir,hash+'.jpg');
  const args=seek=>['-v','error','-n','-ss',String(seek),'-i',row.physicalPath,'-frames:v','1','-vf','scale=320:-2','-q:v','4'];
  try{return await this.generated(target,args(1));}catch{return this.generated(target,args(0));}
 }
 thumbnail(id){return this.queue('thumbnail',id,(row,stat)=>this.thumbnailFile(row,stat));}
 preview(id){return this.queue('preview',id,async(row,stat)=>{
  const urls=this.urls(id),key=this.signature(row,stat);if(urls.metadata&&urls.key===key)return urls.metadata;
  const m=await this.probe(row.physicalPath),v=m.streams.find(s=>s.codec_type==='video');if(!v)throw new Error('Bu klipte okunabilir video akışı bulunamadı.');
  const [n,d]=(v.avg_frame_rate||'30/1').split('/').map(Number);let source=row.physicalPath;
  if(path.extname(row.originalPath).toLowerCase()!=='.mp4'){
   const hash=crypto.createHash('sha256').update('trash-preview|'+key).digest('hex');source=await this.generated(path.join(this.cacheDir,hash+'.mp4'),['-v','error','-n','-i',row.physicalPath,'-map','0:v:0','-map','0:a:0?','-c','copy','-movflags','+faststart']);
  }
  if(urls.videoUrl)this.revoke(urls.videoUrl);urls.videoUrl=this.asset(source);urls.key=key;
  return urls.metadata={id,videoUrl:urls.videoUrl,thumbnail:urls.thumbnail,seconds:Number(m.format.duration)||0,resolution:v.width+'x'+v.height,fps:n/d||30,tracks:m.streams.filter(s=>s.codec_type==='audio').length};
 });}
 async restore(ids){
  if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'))throw new Error('Geri yüklenecek klip seçilmedi.');
  for(const id of ids)this.blocked.add(id);
  try{await Promise.allSettled(ids.map(id=>this.jobs.get(id)));const result=await this.trash.restore(ids);for(const entry of result.restored)this.invalidate(entry.id);return result;}
  finally{for(const id of ids)this.blocked.delete(id);}
 }
}
module.exports={TrashMedia};
