// Explicit native integration check. Starts only development capture processes;
// no game, desktop source, or packaged Klip application is opened or controlled.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {OBS}=require('../../src/obs');
const run=promisify(execFile),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function check(config,expected,index){
 const project=path.resolve(__dirname,'../..'),out=path.join(__dirname,'smoke-buffer','quality',String(index));
 await fs.mkdir(out,{recursive:true});
 const engine=new OBS(path.join(project,'engine/obs'));
 try{
  await engine.launch({resolution:'1920x1080',fps:'60',duration:15,...config},out);
  await engine.call('CreateScene',{sceneName:'Klip'});
  await engine.call('SetCurrentProgramScene',{sceneName:'Klip'});
  const encoding=await engine.call('GetReplayEncodingSettings');
  assert.equal(encoding.encoderId,'obs_nvenc_h264_tex');
  assert.equal(encoding.qualityMode,expected.mode);
  assert.equal(encoding.videoBitrate,expected.bitrate);
  assert.equal(encoding.encoderSettings.rate_control,expected.control);
  assert.equal(encoding.encoderSettings.preset,'p5');
  assert.equal(encoding.encoderSettings.profile,'high');
  assert.equal(encoding.encoderSettings.keyint_sec,1);
  if(expected.control==='CQP')assert.equal(encoding.encoderSettings.cqp,12);
  else assert.equal(encoding.encoderSettings.bitrate,expected.bitrate*1000);
  assert.equal(encoding.replayBufferLimitMiB,expected.limitMiB);
  assert.equal(encoding.outputScaleFilter,'lanczos');
  const source=await engine.call('CreateInput',{sceneName:'Klip',inputName:'Hidden display',inputKind:'monitor_capture',inputSettings:{},sceneItemEnabled:false});
  await engine.call('SetSceneItemTransform',{sceneName:'Klip',sceneItemId:source.sceneItemId,sceneItemTransform:{boundsType:'OBS_BOUNDS_STRETCH',boundsWidth:1920,boundsHeight:1080}});
  assert.equal((await engine.call('GetSceneItemTransform',{sceneName:'Klip',sceneItemId:source.sceneItemId})).sceneItemTransform.scaleFilter,'lanczos');
  // Encode a black scene: tests the real NVENC path without capturing user data.
  await engine.call('StartReplayBuffer');
  const active=await engine.call('GetReplayEncodingSettings');assert.equal(active.active,true);
  await wait(2100);
  const saved=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Quality replay save timed out')),15000);engine.once('ReplayBufferSaved',data=>{clearTimeout(timer);resolve(data.savedReplayPath);});});
  await engine.call('SaveReplayBuffer');const file=await saved;
  await engine.call('StopReplayBuffer');
  const {stdout}=await run(path.join(project,'tools/ffprobe.exe'),['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate','-of','json',file],{windowsHide:true});
  const video=JSON.parse(stdout).streams[0];
  assert.deepEqual(video,{codec_name:'h264',width:1920,height:1080,r_frame_rate:'60/1'});
  await run(path.join(project,'tools/ffmpeg.exe'),['-v','error','-xerror','-i',file,'-map','0:v:0','-f','null','-'],{windowsHide:true});
  const result={config,encoding:active,video,file};await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(result,null,2));return result;
 }catch(error){console.error(engine.session?.stderr);throw error;}finally{await engine.close();}
}

async function main(){
 const cases=[
  [{},{mode:'quality',bitrate:60,control:'CQP',limitMiB:4096}],
  [{qualityMode:'quality',videoBitrate:250},{mode:'quality',bitrate:250,control:'CQP',limitMiB:4096}],
  [{qualityMode:'bitrate',videoBitrate:5},{mode:'bitrate',bitrate:5,control:'CBR',limitMiB:14}],
  [{qualityMode:'bitrate',videoBitrate:60},{mode:'bitrate',bitrate:60,control:'CBR',limitMiB:127}],
  [{qualityMode:'bitrate',videoBitrate:250,duration:300},{mode:'bitrate',bitrate:250,control:'CBR',limitMiB:10345}],
  [{qualityMode:'bitrate',videoBitrate:'250'},{mode:'bitrate',bitrate:60,control:'CBR',limitMiB:127}],
  [{qualityMode:'wrong',videoBitrate:251},{mode:'quality',bitrate:60,control:'CQP',limitMiB:4096}],
 ];
 const results=[];for(let i=0;i<cases.length;i++)results.push(await check(...cases[i],i));
 console.log(JSON.stringify({checked:results.length,results},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
