const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const maximum=10*1024*1024,extensions=new Set(['.wav','.mp3','.ogg','.m4a']);
function audioHeader(bytes,extension){return extension==='.wav'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE':extension==='.ogg'?bytes.toString('ascii',0,4)==='OggS':extension==='.m4a'?bytes.toString('ascii',4,8)==='ftyp':bytes.toString('ascii',0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224;}
class NotificationSound{
 constructor({directory,asset}){this.directory=path.resolve(directory);this.asset=asset;this.urls=new Map();}
 async ownedDirectory(){const stat=await fs.lstat(this.directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Geçersiz bildirim sesi klasörü.');}
 async resolve(file){
  if(typeof file!=='string'||!/^(?:medal|custom-[a-f0-9-]{36})\.(?:wav|mp3|ogg|m4a)$/.test(file))throw new Error('Özel ses dosyası bulunamadı.');
  await this.ownedDirectory().catch(()=>{throw new Error('Özel ses dosyası bulunamadı.');});const target=path.join(this.directory,file),stat=await fs.lstat(target).catch(()=>null);
  if(!stat||!stat.isFile()||stat.isSymbolicLink()||stat.size<=0||stat.size>maximum)throw new Error('Özel ses dosyası bulunamadı.');return target;
 }
 async metadata(settings){
  const file=settings.notificationCustomFile;if(!await this.resolve(file).catch(()=>null))return{available:false,name:'',url:''};
  if(!this.urls.has(file))this.urls.set(file,this.asset(()=>this.resolve(file)));
  return{available:true,name:path.basename(settings.notificationCustomName||(file==='medal.wav'?'Medal':file)),url:this.urls.get(file)};
 }
 async settings(settings){const {notificationCustomFile,notificationCustomName,notificationMedalMigrated,notificationCustom,...visible}=settings;return{...visible,notificationCustom:await this.metadata(settings)};}
 async initialize(settings){
  const next={...settings};if(!next.notificationMedalMigrated&&await this.resolve('medal.wav').catch(()=>null)){
   next.notificationMedalMigrated=true;if(next.notificationSound!=='custom')Object.assign(next,{notificationSound:'custom',notificationCustomFile:'medal.wav',notificationCustomName:'Medal'});
  }
  if(next.notificationSound==='custom'&&!await this.resolve(next.notificationCustomFile).catch(()=>null))next.notificationSound='ember';return next;
 }
 async validate(settings){
  if(!Number.isInteger(settings.notificationVolume)||settings.notificationVolume<0||settings.notificationVolume>100||!['ember','soft','glass','arcade','medal','custom'].includes(settings.notificationSound))throw new Error('Geçersiz bildirim sesi ayarı.');
  if(settings.notificationSound==='custom'&&!await this.resolve(settings.notificationCustomFile).catch(()=>null))throw new Error('Önce özel ses dosyası seç.');
 }
 async importFile(file){
  const extension=typeof file==='string'?path.extname(file).toLowerCase():'';
  if(!path.isAbsolute(file||'')||!extensions.has(extension))throw new Error('WAV, MP3, OGG veya M4A ses dosyası seç.');
  const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<=0)throw new Error('Geçerli bir ses dosyası seç.');if(stat.size>maximum)throw new Error('Ses dosyası en fazla 10 MB olabilir.');
  const source=await fs.open(file,'r'),chunks=[];let size=0;try{const opened=await source.stat();if(!opened.isFile()||opened.size>maximum)throw new Error('Ses dosyası en fazla 10 MB olabilir.');for await(const chunk of source.createReadStream({end:maximum,autoClose:false})){size+=chunk.length;if(size>maximum)throw new Error('Ses dosyası en fazla 10 MB olabilir.');chunks.push(chunk);}}finally{await source.close();}
  const bytes=Buffer.concat(chunks,size);if(!bytes.length||!audioHeader(bytes,extension))throw new Error('Ses dosyası biçimi doğrulanamadı.');
  await fs.mkdir(this.directory,{recursive:true});await this.ownedDirectory();const name='custom-'+crypto.randomUUID()+extension;await fs.writeFile(path.join(this.directory,name),bytes,{flag:'wx'});
  return{notificationSound:'custom',notificationCustomFile:name,notificationCustomName:path.basename(file),notificationMedalMigrated:true};
 }
}
module.exports={NotificationSound};
