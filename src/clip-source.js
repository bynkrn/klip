const fs=require('node:fs/promises'),path=require('node:path');
const changed=()=>new Error('Klip dosyası değişti. Kütüphaneyi yenileyip klibi yeniden aç.');
function assertClipVersion(clip,stat,expected){
 if(!clip||!Number.isFinite(clip.mtime)||!Number.isFinite(clip.size)||clip.size<=0)throw new Error('Klip bulunamadı.');
 if(stat&&(!stat.isFile()||stat.mtimeMs!==clip.mtime||stat.size!==clip.size))throw changed();
 if(expected!==undefined&&(!expected||expected.mtime!==clip.mtime||expected.size!==clip.size))throw changed();
 return clip;
}
async function assertClipSource(clip,expected){
 if(!clip||typeof clip.file!=='string'||!path.isAbsolute(clip.file))throw new Error('Klip bulunamadı.');let stat;try{stat=await fs.stat(clip.file);}catch(error){if(error.code==='ENOENT')throw new Error('Klip dosyası bulunamadı.');throw error;}return assertClipVersion(clip,stat,expected);
}
module.exports={assertClipSource,assertClipVersion};
