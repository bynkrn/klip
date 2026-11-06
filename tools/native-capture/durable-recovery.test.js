const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn,execFile}=require('node:child_process');
const exe=path.resolve(__dirname,'../build-deps/durable-recovery/durable-recovery-test.exe');
test('durable completed GOP and app PCM checkpoint survives a real subprocess kill and another failed recovery',{skip:process.platform!=='win32',timeout:25000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ember-power-loss-unit-'));await fs.mkdir(path.join(root,'application-audio'));const child=spawn(exe,['produce',root],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',data=>stderr+=data);
 try{await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('fixture readiness timeout: '+stderr)),8000);child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('READY')){clearTimeout(timer);resolve();}});child.once('error',reject);child.once('exit',code=>{if(code)reject(Error('fixture exited '+code+': '+stderr));});});const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;
 const output=await new Promise((resolve,reject)=>execFile(exe,['verify',root],{windowsHide:true,timeout:10000},(error,stdout,stderr)=>error?reject(Error(error.message+' '+stderr)):resolve(stdout)));assert.match(output,/passed/);await fs.access(path.join(root,'Ember-Recovery-1-2-3.json'));
 }finally{child.kill();await fs.rm(root,{recursive:true,force:true});}
});
