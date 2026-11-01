const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
function audioSelection(clip,tracks){
 if(!Array.isArray(tracks)||tracks.some(t=>!Number.isInteger(t)||t<0||t>=clip.tracks))throw new Error('Geçersiz ses izi.');
 const indexes=[...new Set(tracks)].sort((a,b)=>a-b),combined=clip.audio?.find(t=>/birleşik|combined|mixed|\bmix\b/iu.test(t.name));
 if(combined&&indexes.includes(combined.index)&&indexes.length>1)throw new Error('Birleşik ses ve ayrı ses izleri birlikte seçilemez.');
 return indexes;
}
function audioOutput(clip,tracks,volumes={}){
 const indexes=audioSelection(clip,tracks),name=i=>clip.audio?.find(t=>t.index===i)?.name||'Ses '+(i+1);
 if(!volumes||typeof volumes!=='object'||Array.isArray(volumes)||Object.entries(volumes).some(([index,gain])=>!/^\d+$/.test(index)||Number(index)>=clip.tracks||typeof gain!=='number'||!Number.isFinite(gain)||gain<0||gain>1))throw new Error('Geçersiz ses seviyesi.');
 const gain=i=>volumes[i]??1;
 if(indexes.some(i=>gain(i)!==1)){
  if(indexes.length===1)return{args:['-filter_complex','[0:a:'+indexes[0]+']volume='+gain(indexes[0])+'[klipaudio]','-map','[klipaudio]'],names:indexes.map(name)};
  const stems=indexes.map(i=>'[0:a:'+i+']volume='+gain(i)+',asplit=2[klipmix'+i+'][klipstem'+i+']');
  const filter=stems.join(';')+';'+indexes.map(i=>'[klipmix'+i+']').join('')+'amix=inputs='+indexes.length+':duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.98:level=false:latency=true[klipmix]';
  return{args:['-filter_complex',filter,'-map','[klipmix]',...indexes.flatMap(i=>['-map','[klipstem'+i+']'])],names:['Birleşik ses (seçilenler)',...indexes.map(name)]};
 }
 if(indexes.length<2)return{args:indexes.flatMap(i=>['-map','0:a:'+i]),names:indexes.map(name)};
 // The first track is what normal players hear. Remaining tracks retain only
 // selected stems; muted applications are absent from every exported track.
 const filter=indexes.map(i=>'[0:a:'+i+']').join('')+'amix=inputs='+indexes.length+':duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.98:level=false:latency=true[klipmix]';
 return{args:['-filter_complex',filter,'-map','[klipmix]',...indexes.flatMap(i=>['-map','0:a:'+i])],names:['Birleşik ses (seçilenler)',...indexes.map(name)]};
}
class EditorAudio{
 constructor({cacheDir,resolve,asset,revoke,run}){Object.assign(this,{cacheDir,resolve,asset,revoke,run});this.cache=new Map();this.pending=new Map();this.active=0;this.waiters=[];}
 async acquire(){if(this.active<2){this.active++;return;}await new Promise(resolve=>this.waiters.push(resolve));}
 release(){if(this.waiters.length)this.waiters.shift()();else this.active--;}
 invalidate(id){for(const [key,row]of this.cache)if(row.id===id){this.revoke(row.url);this.cache.delete(key);}}
 async get({id,tracks}){
  const clip=this.resolve(id);if(!clip)throw new Error('Klip bulunamadı.');const indexes=audioSelection(clip,tracks);
  return Promise.all(indexes.map(index=>this.track(clip,index)));
 }
 async track(clip,index){
  const stat=await fs.stat(clip.file);if(!stat.isFile())throw new Error('Ses dosyası bulunamadı.');
  const key=clip.file+'|'+stat.mtimeMs+'|'+stat.size+'|audio|'+index;if(this.cache.has(key))return this.cache.get(key).result;if(this.pending.has(key))return this.pending.get(key);
  const job=(async()=>{await this.acquire();let temp;try{
   const hash=crypto.createHash('sha256').update(key).digest('hex'),target=path.join(this.cacheDir,hash+'.m4a');await fs.mkdir(this.cacheDir,{recursive:true});
   try{await fs.access(target);}catch{
    temp=path.join(this.cacheDir,crypto.randomUUID()+'.m4a');const stream=clip.audio.find(a=>a.index===index),encoding=stream?.codec==='aac'?['-c:a','copy']:['-c:a','aac','-b:a','256k'];
    await this.run('ffmpeg',['-v','error','-n','-i',clip.file,'-map','0:a:'+index,'-vn','-sn','-dn',...encoding,'-movflags','+faststart',temp]);
    await fs.link(temp,target).catch(error=>{if(error.code!=='EEXIST')throw error;});
   }
   if(!this.resolve(clip.id))throw new Error('Klip bulunamadı.');
   const url=this.asset(target),result={index,name:clip.audio.find(a=>a.index===index)?.name||'Ses '+(index+1),url};this.cache.set(key,{id:clip.id,url,result});return result;
  }finally{if(temp)await fs.unlink(temp).catch(()=>{});this.release();}})();
  this.pending.set(key,job);try{return await job;}finally{this.pending.delete(key);}
 }
}
module.exports={audioSelection,audioOutput,EditorAudio};
