const {spawn,spawnSync}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {Capture}=require('../src/capture'),wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const root=path.join(__dirname,'..'),target=spawn(path.join(__dirname,'KlipWindowTest.exe'),[],{stdio:'ignore'});
 const capture=new Capture(path.join(root,'engine/obs')),changes=[];let tracing;const trace=[];capture.on('capture-source',s=>changes.push(s));capture.on('warning',s=>console.error(s));
 try{
  await wait(1000);const buffer=path.join(__dirname,'capture-results');await fs.mkdir(buffer,{recursive:true});
  await capture.start({mode:'game',targetExe:'KlipWindowTest.exe',duration:120,resolution:'1920x1080',fps:'60',stretch:true,cursor:false,autoAudio:true},buffer);
  assert.equal(capture.video.method,'window');
  const transform=(await capture.obs.call('GetSceneItemTransform',{sceneName:'Klip',sceneItemId:capture.video.windowId})).sceneItemTransform;
  assert.equal(transform.sourceWidth,800);assert.equal(transform.sourceHeight,600);assert.equal(transform.boundsType,'OBS_BOUNDS_STRETCH');assert.equal(capture.video.enabled.get(capture.displayId),false);assert.equal(capture.video.enabled.get(capture.gameId),false);
  tracing=setInterval(async()=>{try{const t=(await capture.obs.call('GetSceneItemTransform',{sceneName:'Klip',sceneItemId:capture.video.windowId})).sceneItemTransform;trace.push({ms:Date.now()-capture.started,width:t.sourceWidth,height:t.sourceHeight,enabled:capture.video.enabled.get(capture.video.windowId),target:capture.video.target});}catch{}},150);
  await wait(1800);await capture.onFocus({exe:'explorer.exe',hwnd:'desktop-test',title:'Desktop',class:'Desktop'});await wait(1800);
  assert.equal(capture.video.enabled.get(capture.displayId),false);assert.equal(capture.video.enabled.get(capture.video.windowId),true);
  const file=await capture.save();clearInterval(tracing);await fs.writeFile(path.join(__dirname,'window-fallback-trace.json'),JSON.stringify({file,trace},null,2));const probe=spawnSync(path.join(root,'tools/ffprobe.exe'),['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8',windowsHide:true});assert.equal(probe.status,0,probe.stderr);const media=JSON.parse(probe.stdout),video=media.streams.find(s=>s.codec_type==='video');assert.equal(video.width,1920);assert.equal(video.height,1080);assert.equal(video.r_frame_rate,'60/1');assert.equal(media.streams.filter(s=>s.codec_type==='audio').length,6);
  const decode=spawnSync(path.join(root,'tools/ffmpeg.exe'),['-v','info','-i',file,'-vf','crop=100:1080:0:0,blackdetect=d=0.2:pix_th=0.05','-an','-f','null','-'],{encoding:'utf8',windowsHide:true});assert.equal(decode.status,0,decode.stderr);assert(!decode.stderr.includes('black_start:'),'4:3 WGC image must fill the left output edge');
  const report={file,method:capture.video.method,source:transform.sourceWidth+'x'+transform.sourceHeight,output:video.width+'x'+video.height,fps:video.r_frame_rate,audioTracks:6,changes};
  await capture.stop();await capture.start({mode:'auto',targetExe:'KlipWindowTest.exe',duration:120,resolution:'1920x1080',fps:'60',stretch:true,cursor:false,autoAudio:true},buffer);await wait(800);
  const decodeWindow=s=>s.replaceAll('#3A',':').replaceAll('#22','#'),[title,cls,exe]=capture.video.target.split(':').map(decodeWindow),game={hwnd:'wgc-game',title,class:cls,exe};
  await capture.onFocus(game);
  // Controlled failure of our OBS input only; never changes a game's protection/settings.
  await capture.obs.call('SetInputSettings',{inputName:'Klip Oyun',inputSettings:{capture_mode:'window',window:'Missing:Missing:KlipBlockedCapture.exe'},overlay:true});
  for(let i=0;i<45&&capture.video.method!=='window';i++)await wait(200);assert.equal(capture.video.method,'window');
  const states=[];for(const focus of [game,{exe:'explorer.exe',hwnd:'wgc-desktop',title:'Desktop',class:'Desktop'},game]){await capture.onFocus(focus);await wait(1200);states.push({screen:capture.video.enabled.get(capture.displayId),game:capture.video.enabled.get(capture.gameId),window:capture.video.enabled.get(capture.video.windowId)});}
  assert.deepEqual(states,[{screen:true,game:false,window:true},{screen:true,game:false,window:false},{screen:true,game:false,window:true}]);
  report.autoFile=await capture.save();report.autoStates=states;await fs.writeFile(path.join(__dirname,'window-fallback-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{clearInterval(tracing);await capture.stop();target.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
