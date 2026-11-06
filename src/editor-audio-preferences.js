const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const queues=new Map(),MAX_BYTES=2*1024*1024;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const empty=()=>({version:1,defaults:{},overrides:{},presets:[]});
function text(value){return String(value||'').normalize('NFKC').replace(/\s+/gu,' ').trim();}
function combined(name){return /birle[şs]ik|(^|[\s_-])mix(?:ed)?([\s_-]|$)|combined/iu.test(name);}
function trackKey(track){
 const name=text(track.name);if(combined(name))return '@combined';
 let key=text(track.application||track.exe||name).split(/[\\/]/u).at(-1).replace(/^(?:oyun|game)\s*[·:–-]\s*/iu,'').replace(/\.exe$/iu,'').toLocaleLowerCase('en-US').replace(/\u0307/gu,'');
 if(/^(?:mikrofon|microphone)$/u.test(key))key='@microphone';if(!key||key.length>256||/[\x00-\x1f\x7f]/u.test(key))throw new Error('Geçersiz ses izi adı.');return key;
}
function tracksFor(clip){
 if(!clip||typeof clip.id!=='string'||!clip.id)throw new Error('Klip bulunamadı.');
 const tracks=Array.isArray(clip.audio)?clip.audio:Array.from({length:Math.max(0,Math.min(512,Number(clip.tracks)||0))},(_,index)=>({index,name:'Ses '+(index+1)}));
 if(tracks.length>512||tracks.some(track=>!object(track)||!Number.isSafeInteger(track.index)||track.index<0))throw new Error('Geçersiz ses izleri.');
 return [...new Map(tracks.map(track=>[track.index,{index:track.index,key:trackKey(track)}])).values()].sort((a,b)=>a.index-b.index);
}
function validateRecords(value){return object(value)&&Object.keys(value).length<=512&&Object.entries(value).every(([key,row])=>key.length>0&&key.length<=256&&!/[\x00-\x1f\x7f]/u.test(key)&&object(row)&&typeof row.enabled==='boolean'&&typeof row.gain==='number'&&Number.isFinite(row.gain)&&row.gain>=0&&row.gain<=1);}
function presetName(value){if(typeof value!=='string'||/[\x00-\x1f\x7f]/u.test(value))throw new Error('Geçersiz karışım adı.');const name=text(value);if(!name||name.length>80)throw new Error('Karışım adı 1–80 karakter olmalı.');return name;}
function validData(data){return object(data)&&data.version===1&&validateRecords(data.defaults)&&object(data.overrides)&&Object.keys(data.overrides).length<=500&&Object.entries(data.overrides).every(([key,rows])=>/^[a-f0-9]{64}$/u.test(key)&&validateRecords(rows))&&Array.isArray(data.presets)&&data.presets.length<=50&&data.presets.every(p=>object(p)&&typeof p.id==='string'&&/^[a-f0-9-]{36}$/u.test(p.id)&&typeof p.name==='string'&&presetName(p.name)===p.name&&validateRecords(p.tracks))&&new Set(data.presets.map(p=>p.id)).size===data.presets.length&&new Set(data.presets.map(p=>p.name.toLocaleLowerCase('tr-TR'))).size===data.presets.length;}
class EditorAudioPreferences{
 constructor({file}){this.file=path.resolve(file);}
 async read(){
  try{const stat=await fs.stat(this.file);if(!stat.isFile()||stat.size>MAX_BYTES)throw new Error('size');const data=JSON.parse(await fs.readFile(this.file,'utf8'));if(!validData(data))throw new Error('schema');return data;}
  catch(error){if(error.code==='ENOENT')return empty();throw new Error('Ses karışımı ayarları okunamadı; mevcut dosya korundu.');}
 }
 async write(data){
  const body=JSON.stringify(data);if(!validData(data)||Buffer.byteLength(body)>MAX_BYTES)throw new Error('Ses karışımı ayarları dolu.');await fs.mkdir(path.dirname(this.file),{recursive:true});const temp=this.file+'.'+crypto.randomUUID()+'.tmp';let handle;
  try{handle=await fs.open(temp,'wx',0o600);await handle.writeFile(body,'utf8');await handle.sync();await handle.close();handle=null;await fs.rename(temp,this.file);}finally{if(handle)await handle.close().catch(()=>{});await fs.unlink(temp).catch(()=>{});}
 }
 handle(payload,clip){
  const previous=queues.get(this.file)||Promise.resolve(),pending=previous.catch(()=>{}).then(()=>this.perform(payload,clip));queues.set(this.file,pending);const done=()=>{if(queues.get(this.file)===pending)queues.delete(this.file);};pending.then(done,done);return pending;
 }
 async perform(payload,clip){
  if(!object(payload))throw new Error('Geçersiz ses karışımı isteği.');const tracks=tracksFor(clip),id=crypto.createHash('sha256').update(clip.id).digest('hex'),data=await this.read(),scope=()=>Object.hasOwn(data.overrides,id)?'clip':'default';
  const records=()=>({...data.defaults,...data.overrides[id]});
  const result=()=>{const rows=records(),states=tracks.map(track=>({...track,...(Object.hasOwn(rows,track.key)?rows[track.key]:{enabled:tracks.length===1||track.key!=='@combined',gain:1})}));if(states.some(track=>track.key==='@combined'&&track.enabled))for(const track of states)if(track.key!=='@combined')track.enabled=false;return{scope:scope(),mix:{tracks:states.filter(track=>track.enabled).map(track=>track.index),volumes:Object.fromEntries(states.map(track=>[track.index,track.gain]))},presets:data.presets.map(({id,name})=>({id,name}))};};
  const capture=mix=>{
   const valid=new Set(tracks.map(track=>track.index));if(!object(mix)||!Array.isArray(mix.tracks)||mix.tracks.some(index=>!Number.isInteger(index)||!valid.has(index))||!object(mix.volumes)||Object.entries(mix.volumes).some(([index,gain])=>!/^\d+$/u.test(index)||!valid.has(Number(index))||typeof gain!=='number'||!Number.isFinite(gain)||gain<0||gain>1))throw new Error('Geçersiz ses karışımı.');
   const selected=new Set(mix.tracks);if(tracks.some(track=>track.key==='@combined'&&selected.has(track.index))&&selected.size>1)throw new Error('Birleşik ses ve ayrı ses izleri birlikte seçilemez.');
   const current=records();return Object.fromEntries(tracks.map(track=>[track.key,{enabled:selected.has(track.index),gain:mix.volumes[track.index]??(Object.hasOwn(current,track.key)?current[track.key].gain:1)}]));
  };
  const saveRows=rows=>{if(payload.scope==='clip'){if(!Object.hasOwn(data.overrides,id)&&Object.keys(data.overrides).length>=500)throw new Error('Klibe özel ses ayarları dolu.');data.overrides[id]=rows;}else if(payload.scope==='default'){data.defaults={...data.defaults,...rows};delete data.overrides[id];}else throw new Error('Geçersiz ses karışımı kapsamı.');};
  switch(payload.action){
   case'resolve':return result();
   case'save':saveRows(capture(payload.mix));break;
   case'scope':if(payload.scope==='default')delete data.overrides[id];else if(payload.scope==='clip')saveRows(capture(result().mix));else throw new Error('Geçersiz ses karışımı kapsamı.');break;
   case'save-preset':{const name=presetName(payload.name);if(data.presets.some(p=>p.name.toLocaleLowerCase('tr-TR')===name.toLocaleLowerCase('tr-TR')))throw new Error('Bu karışım adı zaten kullanılıyor.');if(data.presets.length>=50)throw new Error('En fazla 50 karışım kaydedilebilir.');data.presets.push({id:crypto.randomUUID(),name,tracks:capture(payload.mix)});break;}
   case'apply-preset':{const preset=data.presets.find(p=>p.id===payload.presetId);if(!preset)throw new Error('Ses karışımı bulunamadı.');saveRows({...records(),...preset.tracks});break;}
   case'delete-preset':{const index=data.presets.findIndex(p=>p.id===payload.presetId);if(index<0)throw new Error('Ses karışımı bulunamadı.');data.presets.splice(index,1);break;}
   default:throw new Error('Geçersiz ses karışımı işlemi.');
  }
  await this.write(data);return result();
 }
}
module.exports={EditorAudioPreferences,trackKey};
