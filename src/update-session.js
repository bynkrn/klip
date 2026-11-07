const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {healthAckPath}=require('./updates');
function updateLaunchContext(argv,currentVersion){const nonce=argv.find(v=>v.startsWith('--update-health='))?.slice(16),version=argv.find(v=>v.startsWith('--update-version='))?.slice(17);return /^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(nonce||'')&&version===currentVersion?{nonce,version}:null;}
async function atomicJson(file,data){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';let handle;try{handle=await fs.open(temp,'wx',0o600);await handle.writeFile(JSON.stringify(data),'utf8');await handle.sync();await handle.close();handle=null;await fs.rename(temp,file);}finally{if(handle)await handle.close().catch(()=>{});await fs.unlink(temp).catch(()=>{});}}
async function completeUpdateStartup({context,cacheDir,waitForUI,startBuffer,getRunning,show,pid=process.pid}){
 if(!context)return null;const file=healthAckPath(cacheDir,context.nonce),base={nonce:context.nonce,version:context.version,pid};
 await waitForUI();await atomicJson(file.replace(/\.json$/,'.progress.json'),{...base,phase:'starting-buffer'});
 let bufferError='';try{await startBuffer();if(!getRunning())throw Error('Replay tamponu başlatılamadı.');}catch(error){bufferError=String(error.message||error).slice(0,1500);}
 const health={...base,completed:true,bufferRunning:!!getRunning(),...bufferError?{bufferError}:{}};await atomicJson(file,health);show();return health;
}
const identity=value=>typeof value==='string'?path.resolve(value).toLowerCase():'';
const stable=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value);
function compare(a,b){const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;}
async function smallJson(file){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('Invalid update record');return{data:JSON.parse(await fs.readFile(file,'utf8')),mtime:stat.mtimeMs};}
async function readInstallHistory({cacheDir,appRoot,currentVersion}){
 const entries=await fs.readdir(cacheDir,{withFileTypes:true}).catch(()=>[]),found=[];
 for(const entry of entries){if(!entry.isDirectory()||entry.isSymbolicLink()||!/^install-[a-f0-9]{32}$/.test(entry.name))continue;
  try{const directory=path.join(cacheDir,entry.name),jobFile=path.join(directory,'job.json'),job=await smallJson(jobFile),j=job.data;if(j.schema!==1||!stable(j.version)||!stable(currentVersion)||compare(j.version,currentVersion)<0||identity(j.appRoot)!==identity(appRoot)||identity(j.cacheDir)!==identity(cacheDir))continue;
   const result=await smallJson(path.join(directory,'result.json')).catch(()=>null),progress=await smallJson(path.join(directory,'progress.json')).catch(()=>null),record=result||progress;let value=record?.data;
   if(value&&(value.schema!==1||value.version!==j.version||identity(value.appRoot)!==identity(appRoot)))value=null;
   let status=value?.status||'incomplete';if(!['installed','rolled-back','rejected','recovery-required','installing','incomplete'].includes(status))status='incomplete';
   if(status==='installed'&&j.version!==currentVersion)status='incomplete';
   if(status==='installing'){let alive=false;try{if(Number.isInteger(value.helperPid)&&value.helperPid>0){process.kill(value.helperPid,0);alive=true;}}catch{}if(!alive)status='incomplete';}
   found.push({version:j.version,status,phase:typeof value?.phase==='string'?value.phase.slice(0,80):'failed',error:typeof value?.error==='string'?value.error.slice(0,2000):'',bufferRunning:value?.bufferRunning===true,bufferError:typeof value?.bufferError==='string'?value.bufferError.slice(0,1500):'',updatedAtUtc:value?.updatedAtUtc||new Date(record?.mtime||job.mtime).toISOString(),mtime:Math.max(record?.mtime||0,job.mtime),jobId:entry.name});
  }catch{}
 }
 found.sort((a,b)=>b.mtime-a.mtime||b.jobId.localeCompare(a.jobId));const latest=found[0];if(!latest)return null;const {mtime,...publicResult}=latest;return publicResult;
}
module.exports={updateLaunchContext,completeUpdateStartup,readInstallHistory};
