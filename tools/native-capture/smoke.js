// Explicit integration check: launches only our controlled target + native service.
const {spawn,execFile}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path');
const {promisify}=require('node:util'),assert=require('node:assert/strict');
const {OBS}=require('../../src/obs');
const run=promisify(execFile),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const project=path.resolve(__dirname,'../..'),out=path.join(__dirname,'smoke-buffer');await fs.mkdir(out,{recursive:true});
 const targetFile=path.join(__dirname,'KlipHeadlessSmoke.exe');await fs.copyFile(path.join(project,'tests/KlipCaptureTest.exe'),targetFile);
 const target=spawn(targetFile,['--tone'],{stdio:'ignore'}),engine=new OBS(path.join(project,'engine/obs'));
 let file;try{
  const fps=Number(process.env.SMOKE_FPS)||60,windowMode=process.env.SMOKE_SOURCE==='window';
  await wait(1000);await engine.launch({resolution:'1920x1080',fps:fps===60?'60':'custom',customFps:fps,duration:120},out);
  await engine.call('CreateScene',{sceneName:'Klip'});await engine.call('SetCurrentProgramScene',{sceneName:'Klip'});
  const inputName='Headless Game';let created=await engine.call('CreateInput',{sceneName:'Klip',inputName,inputKind:windowMode?'window_capture':'game_capture',inputSettings:{capture_mode:'window',capture_cursor:false,cursor:false,limit_framerate:true,capture_audio:false,method:2,client_area:true},sceneItemEnabled:false});
  // Visibility setters are idempotent: libobs returns false when unchanged.
  await engine.call('SetSceneItemEnabled',{sceneName:'Klip',sceneItemId:created.sceneItemId,sceneItemEnabled:false});
  const windows=await engine.call('GetInputPropertiesListPropertyItems',{inputName,propertyName:'window'}),selected=windows.propertyItems.find(w=>String(w.itemValue).toLowerCase().endsWith('klipheadlesssmoke.exe'));if(!selected)console.error(JSON.stringify(windows));assert(selected,'Synthetic game window enumerated');
  await engine.call('SetInputSettings',{inputName,inputSettings:{capture_mode:'window',window:selected.itemValue,priority:2},overlay:true});
  await engine.call('SetSceneItemTransform',{sceneName:'Klip',sceneItemId:created.sceneItemId,sceneItemTransform:{positionX:0,positionY:0,boundsType:'OBS_BOUNDS_STRETCH',boundsWidth:1920,boundsHeight:1080,boundsAlignment:5}});
  await engine.call('SetSceneItemEnabled',{sceneName:'Klip',sceneItemId:created.sceneItemId,sceneItemEnabled:true});
  await engine.call('SetSceneItemEnabled',{sceneName:'Klip',sceneItemId:created.sceneItemId,sceneItemEnabled:true});
  let transform;for(let i=0;i<40;i++){transform=(await engine.call('GetSceneItemTransform',{sceneName:'Klip',sceneItemId:created.sceneItemId})).sceneItemTransform;if(transform.sourceWidth>0)break;await wait(200);}assert.equal(transform.sourceWidth,800);assert.equal(transform.sourceHeight,600);
  await engine.call('CreateInput',{sceneName:'Klip',inputName:'Headless Tone',inputKind:'wasapi_process_output_capture',inputSettings:{window:selected.itemValue,priority:2},sceneItemEnabled:true});
  await engine.call('SetInputAudioTracks',{inputName:'Headless Tone',inputAudioTracks:{1:true,2:true,3:false,4:false,5:false,6:false}});
  await engine.call('StartReplayBuffer');await wait(3500);
  const saved=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Replay save timed out')),20000);engine.once('ReplayBufferSaved',data=>{clearTimeout(timer);resolve(data.savedReplayPath);});});
  await engine.call('SaveReplayBuffer');file=await saved;
  const {stdout}=await run(path.join(project,'tools/ffprobe.exe'),['-v','error','-show_streams','-show_format','-of','json',file],{windowsHide:true});const metadata=JSON.parse(stdout),video=metadata.streams.find(s=>s.codec_type==='video');
  assert.equal(video.width,1920);assert.equal(video.height,1080);assert.equal(metadata.streams.filter(s=>s.codec_type==='audio').length,6);assert.equal(video.codec_name,'h264');const [num,den]=video.avg_frame_rate.split('/').map(Number);assert.equal(num/den,fps);
  const decoded=path.join(out,'headless-frame.jpg');await run(path.join(project,'tools/ffmpeg.exe'),['-v','error','-y','-ss','1','-i',file,'-frames:v','1',decoded],{windowsHide:true});
  const audioMean={};for(const index of [1,2]){const measured=await run(path.join(project,'tools/ffmpeg.exe'),['-hide_banner','-i',file,'-map','0:a:'+index,'-af','volumedetect','-f','null','-'],{windowsHide:true});audioMean[index+1]=Number(measured.stderr.match(/mean_volume: (-?[\d.]+)/)?.[1]);}assert(audioMean[2]>-60,'Isolated application tone recorded');assert(audioMean[3]<=-80,'Unused application track silent');
  const moving=await run(path.join(project,'tools/ffmpeg.exe'),['-v','error','-i',file,'-an','-vf','fps=1','-frames:v','3','-f','framemd5','-'],{windowsHide:true});const hashes=moving.stdout.split(/\r?\n/).filter(s=>s&&!s.startsWith('#')).map(s=>s.split(',').at(-1).trim());assert.equal(hashes.length,3);assert.equal(new Set(hashes).size,3,'Captured frames change throughout replay');
  await engine.call('StopReplayBuffer');assert.equal((await engine.call('GetReplayBufferStatus')).outputActive,false);
  const result={file,decoded,method:windowMode?'window':'game',video:{width:video.width,height:video.height,fps:video.avg_frame_rate},audioTracks:6,audioMeanDb:audioMean,frameHashes:hashes,source:transform,seconds:Number(metadata.format.duration)};await fs.writeFile(path.join(out,'verification-'+result.method+'-'+fps+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }catch(error){console.error(engine.session?.stderr);throw error;}finally{await engine.close();target.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
