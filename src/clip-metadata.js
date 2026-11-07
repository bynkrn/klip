const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {assertClipVersion}=require('./clip-source');
const queues=new Map(),MAX_BYTES=8*1024*1024,MAX_ENTRIES=20000;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value),empty=()=>({version:1,entries:{}});
function label(value,limit,allowEmpty=false){
 if(typeof value!=='string'||/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value))throw new Error('Geçersiz klip adı veya etiketi.');
 const result=value.trim();if(result.length>limit||!allowEmpty&&!result)throw new Error('Klip adı veya etiketi çok uzun ya da boş.');return result;
}
function normalizePatch(value){
 if(!object(value)||!Object.keys(value).length||Object.keys(value).some(key=>!['displayName','favorite','tags'].includes(key)))throw new Error('Geçersiz klip bilgisi.');
 const patch={};if(Object.hasOwn(value,'displayName'))patch.displayName=label(value.displayName,200,true);
 if(Object.hasOwn(value,'favorite')){if(typeof value.favorite!=='boolean')throw new Error('Geçersiz favori bilgisi.');patch.favorite=value.favorite;}
 if(Object.hasOwn(value,'tags')){
  if(!Array.isArray(value.tags)||value.tags.length>20)throw new Error('En fazla 20 etiket kullanılabilir.');
  const seen=new Set();patch.tags=value.tags.map(tag=>label(tag,40)).filter(tag=>{const key=tag.toLocaleLowerCase('en-US');if(seen.has(key))return false;seen.add(key);return true;});
 }return patch;
}
function keyFor(clip){return crypto.createHash('sha256').update(path.resolve(clip.file)).digest('hex');}
function matches(row,clip){return row&&row.mtime===clip.mtime&&row.size===clip.size;}
function validData(data){
 if(!object(data)||data.version!==1||!object(data.entries)||Object.keys(data.entries).length>MAX_ENTRIES)return false;
 try{return Object.entries(data.entries).every(([key,row])=>{
  if(!/^[a-f0-9]{64}$/u.test(key)||!object(row)||!Number.isFinite(row.mtime)||!Number.isSafeInteger(row.size)||row.size<=0||Object.keys(row).length!==5)return false;
  const normalized=normalizePatch({displayName:row.displayName,favorite:row.favorite,tags:row.tags});return normalized.displayName===row.displayName&&JSON.stringify(normalized.tags)===JSON.stringify(row.tags);
 });}catch{return false;}
}
class ClipMetadata{
 constructor({file,io=fs}){this.file=path.resolve(file);this.io=io;this.data=empty();this.initialized=null;}
 async read(){
  try{const stat=await this.io.stat(this.file);if(!stat.isFile()||stat.size>MAX_BYTES)throw new Error('size');const data=JSON.parse(await this.io.readFile(this.file,'utf8'));if(!validData(data))throw new Error('schema');return data;}
  catch(error){if(error.code==='ENOENT')return empty();throw new Error('Klip bilgileri okunamadı; mevcut dosya korundu.');}
 }
 initialize(){return this.initialized||=(async()=>{const data=await this.read();this.data=data;})();}
 decorate(clip){
  const stored=this.data.entries[keyFor(clip)],row=matches(stored,clip)?stored:{displayName:'',favorite:false,tags:[]};
  return{...clip,name:row.displayName||path.parse(clip.file).name,displayName:row.displayName,favorite:row.favorite,tags:[...row.tags]};
 }
 async write(data){
  const body=JSON.stringify(data);if(!validData(data)||Buffer.byteLength(body)>MAX_BYTES)throw new Error('Klip bilgileri için ayrılan alan dolu.');await this.io.mkdir(path.dirname(this.file),{recursive:true});
  const temp=this.file+'.'+crypto.randomUUID()+'.tmp';let handle;
  try{handle=await this.io.open(temp,'wx',0o600);await handle.writeFile(body,'utf8');await handle.sync();await handle.close();handle=null;await this.io.rename(temp,this.file);}
  finally{if(handle)await handle.close().catch(()=>{});await this.io.unlink(temp).catch(()=>{});}
 }
 patch(payload,known){
  let ids,patch;try{if(!object(payload)||!Array.isArray(payload.ids)||!payload.ids.length||payload.ids.length>1000||payload.ids.some(id=>typeof id!=='string'||!id))throw new Error('Klip seçilmedi.');ids=[...new Set(payload.ids)];patch=normalizePatch(payload.patch);if(Object.hasOwn(patch,'displayName')&&ids.length!==1)throw new Error('Ad değiştirmek için tek bir klip seç.');}catch(error){return Promise.reject(error);}
  const previous=queues.get(this.file)||Promise.resolve(),pending=previous.catch(()=>{}).then(()=>this.perform(ids,patch,known));queues.set(this.file,pending);const done=()=>{if(queues.get(this.file)===pending)queues.delete(this.file);};pending.then(done,done);return pending;
 }
 async perform(ids,patch,known){
  await this.initialize();const data=await this.read(),selected=[];
  for(const id of ids){const clip=known.get(id);if(!clip||typeof clip.file!=='string'||!path.isAbsolute(clip.file))throw new Error('Klip bulunamadı.');let stat;try{stat=await this.io.stat(clip.file);}catch(error){if(error.code==='ENOENT')throw new Error('Klip dosyası bulunamadı.');throw error;}assertClipVersion(clip,stat);selected.push(clip);}
  const next={version:1,entries:{...data.entries}};
  for(const clip of selected){const key=keyFor(clip),stored=data.entries[key],previous=matches(stored,clip)?stored:{displayName:'',favorite:false,tags:[]};next.entries[key]={mtime:clip.mtime,size:clip.size,displayName:previous.displayName,favorite:previous.favorite,tags:previous.tags,...patch};}
  await this.write(next);this.data=next;return selected.map(clip=>this.decorate(clip));
 }
}
module.exports={ClipMetadata};
