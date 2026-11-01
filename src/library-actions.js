const fs=require('node:fs/promises');
async function trashClips(ids,{known,trashItem,inspect=file=>fs.lstat(file)}){
 if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'))throw new Error('Silinecek klip seçilmedi.');
 const selected=[...new Set(ids)].map(id=>{const clip=known.get(id);if(!clip)throw new Error('Klip bulunamadı: '+id);return{id,file:clip.file};});
 const deleted=[],failed=[];
 for(const clip of selected){
  try{if(!(await inspect(clip.file)).isFile())throw new Error('Seçilen öğe normal bir video dosyası değil.');await trashItem(clip.file);known.delete(clip.id);deleted.push(clip.id);}
  catch(error){failed.push({id:clip.id,error:error.message});}
 }
 return{deleted,failed};
}
module.exports={trashClips};
