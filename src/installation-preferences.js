const fs=require('node:fs/promises');
const keys=new Set(['id','language','launch','launchMinimized','autoBuffer']);
function applyInstallationPreferences(settings,text){
 if(typeof text!=='string'||text.length>4096)return settings;
 const values=Object.create(null);let section='';
 for(const line of text.replace(/^\ufeff/,'').split(/\r?\n/)){
  const value=line.trim();if(!value||/^[;#]/.test(value))continue;
  if(value.startsWith('[')){section=value.toLowerCase();continue;}
  if(section!=='[setup]')continue;
  const equal=value.indexOf('=');if(equal<0)continue;const key=value.slice(0,equal).trim();
  if(!keys.has(key))continue;if(Object.hasOwn(values,key))return settings;values[key]=value.slice(equal+1).trim();
 }
 if(!/^[a-zA-Z0-9{}-]{3,80}$/.test(values.id||'')||!['tr','en'].includes(values.language)||!['launch','launchMinimized','autoBuffer'].every(key=>['0','1'].includes(values[key])))return settings;
 if(settings._installationId===values.id)return settings;
 return{...settings,language:values.language,launch:values.launch==='1',launchMinimized:values.launchMinimized==='1',autoBuffer:values.autoBuffer==='1',_installationId:values.id};
}
async function loadInstallationPreferences(settings,filename){
 try{
  if((await fs.stat(filename)).size>8192)return settings;
  const data=await fs.readFile(filename);if(data.length>8192)return settings;
  return applyInstallationPreferences(settings,data[0]===0xff&&data[1]===0xfe?data.subarray(2).toString('utf16le'):data.toString('utf8'));
 }catch(error){if(error.code==='ENOENT')return settings;throw error;}
}
module.exports={applyInstallationPreferences,loadInstallationPreferences};
