// Coupled file-source baseline: no screen/window/audio-device input timing.
const {execFile}=require('node:child_process'),{promisify}=require('node:util'),fs=require('node:fs/promises'),path=require('node:path');
const {OBS}=require('../../src/obs'),run=promisify(execFile),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const project=path.resolve(__dirname,'../..'),folder=path.join(__dirname,'artifacts',new Date().toISOString().replace(/[:.]/g,'-'));await fs.mkdir(folder,{recursive:true});
 const fixture=path.join(folder,'intrinsic-sync.mp4');
 await run(path.join(project,'tools/ffmpeg.exe'),['-v','error','-n','-f','lavfi','-i',"color=c=0x202020:s=1920x1080:r=60:d=16,drawbox=x=24:y=24:w=16:h=16:color=0xdc8020:t=fill:enable='lt(mod(t,2),0.09)'",'-f','lavfi','-i',"aevalsrc=exprs='if(lt(mod(t,2),0.06),0.0125*sin(2*PI*1000*t),0)':s=48000:d=16",'-c:v','libx264','-preset','veryfast','-crf','12','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-shortest',fixture],{windowsHide:true});
 const engine=new OBS(path.join(project,'engine/obs'));try{
  await engine.launch({resolution:'1920x1080',fps:'60',duration:120},folder);await engine.call('CreateScene',{sceneName:'Klip'});await engine.call('SetCurrentProgramScene',{sceneName:'Klip'});
  await engine.call('CreateInput',{sceneName:'Klip',inputName:'Known Sync Source',inputKind:'ffmpeg_source',inputSettings:{local_file:fixture,is_local_file:true,looping:true,restart_on_activate:true,close_when_inactive:false,clear_on_media_end:false,hw_decode:false,speed_percent:100},sceneItemEnabled:true});
  await engine.call('SetInputAudioTracks',{inputName:'Known Sync Source',inputAudioTracks:{1:true,2:false,3:false,4:false,5:false,6:false}});
  await engine.call('StartReplayBuffer');const started=Date.now();await wait(11000);const saved=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Baseline replay save timeout')),20000);engine.once('ReplayBufferSaved',event=>{clearTimeout(timer);resolve(event.savedReplayPath);});});await engine.call('SaveReplayBuffer');const file=await saved;
  await fs.writeFile(path.join(folder,'recording.json'),JSON.stringify({file,fixture,durationSeconds:(Date.now()-started)/1000,started:new Date(started).toISOString(),probe:{marker:{x:24,y:24,width:16,height:16},firstPulseSeconds:0,periodSeconds:2},baseline:'intrinsic media file video+audio share PTS'},null,2));await fs.writeFile(path.join(folder,'probe.jsonl'),'');await fs.writeFile(path.join(folder,'engine-log.txt'),engine.session?.stderr||'');await fs.writeFile(path.join(__dirname,'latest-baseline.txt'),folder);console.log('BASELINE',folder,file);
 }finally{await engine.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
