const fs=require('node:fs'),path=require('node:path');
function userDataDirectory(appData){
 const current=path.join(appData,'Ember'),legacy=path.join(appData,'Klip');
 if(fs.existsSync(legacy)&&!fs.existsSync(current))fs.renameSync(legacy,current);
 else if(fs.existsSync(path.join(legacy,'settings.json'))){
  fs.mkdirSync(current,{recursive:true});
  for(const file of ['settings.json','audio-sync.json','trash-history.json']){const source=path.join(legacy,file),target=path.join(current,file);if(fs.existsSync(source)&&!fs.existsSync(target))fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);}
 }
 return current;
}
function migrateDefaultClipFolder(settings,videos){
 const legacy=path.join(videos,'Klip'),current=path.join(videos,'Ember');
 if(typeof settings.folder!=='string'||path.resolve(settings.folder).toLowerCase()!==path.resolve(legacy).toLowerCase())return settings;
 if(fs.existsSync(legacy)){if(fs.existsSync(current))return settings;fs.renameSync(legacy,current);}
 return{...settings,folder:current};
}
async function relocateRestoredClip(file,videos,currentLibrary){
 const current=path.join(videos,'Ember'),legacy=path.join(videos,'Klip'),relative=path.relative(legacy,file);
 if(path.resolve(currentLibrary).toLowerCase()!==path.resolve(current).toLowerCase()||!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))return file;
 const destination=path.join(current,relative);await fs.promises.mkdir(path.dirname(destination),{recursive:true});
 for(let attempt=0;attempt<100;attempt++){
  const target=await require('./files').unique(destination);
  try{await fs.promises.link(file,target);}catch(error){if(error.code==='EEXIST')continue;throw error;}
  await fs.promises.unlink(file).catch(()=>{});return target;
 }
 throw new Error('Geri yüklenen klip için boş dosya adı bulunamadı.');
}
module.exports={userDataDirectory,migrateDefaultClipFolder,relocateRestoredClip};
