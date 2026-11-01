const fs=require('node:fs/promises'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {OBS}=require('../src/obs'),{scan}=require('../src/files');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const settings=JSON.parse(await fs.readFile(path.join(process.env.APPDATA,'Klip/settings.json'),'utf8'));
 if(settings.hotkey!=='F8')throw new Error('Update helper expects registered F8; preserve manually with configured shortcut.');
 const engine=path.resolve(__dirname,'../dist/Klip-win32-x64/resources/app/engine/obs');
 const websocket=JSON.parse(await fs.readFile(path.join(engine,'config/obs-studio/plugin_config/obs-websocket/config.json'),'utf8'));
 const observer=new OBS(engine);observer.port=websocket.server_port;observer.password=websocket.server_password;
 try{
  await observer.connect();const state=await observer.call('GetReplayBufferStatus');if(!state.outputActive)throw new Error('Replay buffer is not active.');
  const before=new Set((await scan(settings.folder)).map(c=>c.file));
  execFileSync('powershell.exe',['-NoProfile','-Command',"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{F8}')"],{windowsHide:true});
  let clip;for(let i=0;i<160;i++){clip=(await scan(settings.folder)).find(c=>!before.has(c.file));if(clip)break;await wait(200);}
  if(!clip)throw new Error('No completed MP4 appeared; application was not stopped.');
  const probe=JSON.parse(execFileSync(path.resolve(__dirname,'../tools/ffprobe.exe'),['-v','error','-show_streams','-show_format','-of','json',clip.file],{encoding:'utf8',windowsHide:true}));
  if(!probe.streams.some(s=>s.codec_type==='video'))throw new Error('Saved clip could not be verified.');
  await observer.call('StopReplayBuffer');
  await fs.writeFile(path.join(__dirname,'update-preserved.json'),JSON.stringify({file:clip.file,duration:probe.format.duration,settings},null,2));
  console.log(JSON.stringify({preserved:true,file:clip.file,seconds:probe.format.duration}));
 }finally{if(observer.socket){observer.socket.onclose=()=>{};observer.socket.close();}}
})().catch(error=>{console.error(error);process.exitCode=1;});
