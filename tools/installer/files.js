const fs=require('node:fs/promises'),path=require('node:path');
function uninstallScript(files){
 const dirs=new Set(),lines=[];
 for(const file of files){
  const normalized=file.replaceAll('\\','/');
  if(/^[\/]|[\r\n\x00:]/.test(normalized)||normalized.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Invalid installer manifest path');
  const escaped=normalized.replaceAll('$',()=>'$$').replaceAll('"','$\\"').replaceAll('/','\\');lines.push(`Delete "$INSTDIR\\${escaped}"`);
  const parts=normalized.split('/');parts.pop();while(parts.length){dirs.add(parts.join('/'));parts.pop();}
 }
 lines.push('Delete "$INSTDIR\\installation.ini"','Delete "$INSTDIR\\Uninstall.exe"');
 for(const dir of [...dirs].sort((a,b)=>b.split('/').length-a.split('/').length))lines.push(`RMDir "$INSTDIR\\${dir.replaceAll('$',()=>'$$').replaceAll('"','$\\"').replaceAll('/','\\')}"`);
 lines.push('RMDir "$INSTDIR"');return lines.join('\r\n')+'\r\n';
}
async function runtimeFiles(directory,prefix=''){
 const files=[];for(const item of await fs.readdir(path.join(directory,prefix),{withFileTypes:true})){const name=path.posix.join(prefix,item.name);if(item.isSymbolicLink())throw new Error('Runtime cannot contain links');if(item.isDirectory())files.push(...await runtimeFiles(directory,name));else files.push(name);}return files.sort();
}
async function assertSafeRuntime(runtime,files){
 for(const file of files){
  if(!/\.(pem|key|mp4|mkv|m4a|pcm|f32|wav)$/i.test(file)||file.startsWith('resources/app/src/sounds/'))continue;
  if(file==='resources/app/engine/obs/data/obs-studio/OBSPublicRSAKey.pem'){
   const content=await fs.readFile(path.join(runtime,file),'utf8');
   if(/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(content))continue;
  }
  throw new Error('Private media or key in runtime: '+file);
 }
}
if(require.main===module)(async()=>{const [runtime,output]=process.argv.slice(2);if(!runtime||!output)throw new Error('Expected runtime and manifest paths');const files=await runtimeFiles(runtime);if(!files.includes('Ember.exe'))throw new Error('Ember runtime missing');await assertSafeRuntime(runtime,files);await fs.writeFile(output,uninstallScript(files),'utf8');console.log(`Installer manifest: ${files.length} files`);})().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={uninstallScript,runtimeFiles};
