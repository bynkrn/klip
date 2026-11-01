const {spawn}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {Capture}=require('../src/capture'),wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const root=path.join(__dirname,'..'),exe=path.join(__dirname,'quakelive.exe');await fs.copyFile(path.join(__dirname,'KlipCaptureTest.exe'),exe);
 const target=spawn(exe,[],{stdio:'ignore'}),c=new Capture(process.env.ENGINE_ROOT||path.join(root,'engine/obs'));
 const settings={resolution:'1920x1080',fps:'60',duration:120,mode:'game',stretch:true,cursor:false,autoAudio:true,targetExe:''};
 const buffer=path.join(__dirname,'capture-results');await fs.mkdir(buffer,{recursive:true});
 try{
  await wait(1200);await c.start(settings,buffer);
  const transform=(await c.obs.call('GetSceneItemTransform',{sceneName:'Klip',sceneItemId:c.gameId})).sceneItemTransform;
  assert.equal(transform.sourceWidth,800,'Windowed known game must be detected without manual exe');
  await c.stop();settings.mode='auto';await c.start(settings,buffer);await wait(800);
  const selection=(await c.obs.call('GetInputSettings',{inputName:'Klip Oyun'})).inputSettings.window;
  const decode=s=>s.replaceAll('#3A',':').replaceAll('#22','#');const [title,cls,exeName]=selection.split(':').map(decode);
  const game={hwnd:'controlled-game',title,class:cls,exe:exeName},desktop={hwnd:'controlled-desktop',title:'Desktop',class:'Desktop',exe:'explorer.exe'};
  const states=[];
  for(const focus of [game,desktop,game]){await c.onFocus(focus);await wait(1800);const items=(await c.obs.call('GetSceneItemList',{sceneName:'Klip'})).sceneItems;states.push({screen:items.find(i=>i.sceneItemId===c.displayId).sceneItemEnabled,game:items.find(i=>i.sceneItemId===c.gameId).sceneItemEnabled});}
  assert.deepEqual(states,[{screen:true,game:true},{screen:true,game:false},{screen:true,game:true}]);
  const file=await c.save();await fs.writeFile(path.join(__dirname,'transitions-verification.json'),JSON.stringify({file,states},null,2));console.log(JSON.stringify({file,states},null,2));
 }finally{await c.stop();target.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
