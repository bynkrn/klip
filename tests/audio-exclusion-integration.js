// Opt-in: plays quiet tones for about twelve seconds. Does not touch the live app.
// Run only when coordinated: EMBER_AUDIO_EXCLUSION_TEST=1 node tests/audio-exclusion-integration.js
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {Capture}=require('../src/capture');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const root=path.resolve(__dirname,'..'),rate=48000,externalHz=733,excludedHz=1499;
function wav(hz){const count=rate,bytes=Buffer.alloc(44+count*4);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*4,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(count*4,40);for(let i=0;i<count;i++){const value=Math.round(Math.sin(2*Math.PI*hz*i/rate)*.02*32767);bytes.writeInt16LE(value,44+i*4);bytes.writeInt16LE(value,46+i*4);}return bytes;}
async function worker(run){
 const capture=new Capture(path.join(root,'engine/obs'));let tone;capture.config={resolution:'320x180',fps:'30',duration:20,qualityMode:'bitrate',videoBitrate:5,autoAudio:true,targetExe:'ExternalAudioTest.exe',audioEnabled:{1:true,2:true,3:false,4:false,5:false,6:false}};
 try{
  await capture.obs.launch(capture.config,run);await capture.obs.call('CreateScene',{sceneName:'Klip'});await capture.obs.call('SetCurrentProgramScene',{sceneName:'Klip'});
  // This child represents an Electron renderer/audio utility. It is visible to
  // WASAPI enumeration but production routing must never assign it to a stem.
  tone=spawn(path.join(run,'Ember.exe'),[path.join(run,'excluded.wav')],{windowsHide:true,stdio:'ignore'});await wait(900);
  await capture.refreshAudio();assert(capture.audio.some(x=>x.exe==='ExternalAudioTest.exe'&&x.track===2));assert(!capture.audio.some(x=>/^ember\.exe$/i.test(x.exe)));
  assert.equal((await capture.obs.call('GetInputSettings',{inputName:'Klip Sistem Sesi'})).inputSettings.target_process_id,process.pid);
  await capture.obs.call('StartReplayBuffer');capture.running=true;await wait(3500);tone.kill();tone=null;await wait(3500);
  const file=await capture.save();
  // Separate positive-control replay: prove the excluded child really renders
  // the second frequency. This source is never part of application routing.
  await capture.obs.call('CreateInput',{sceneName:'Klip',inputName:'Test-only unfiltered control',inputKind:'wasapi_output_capture',inputSettings:{device_id:'default'}});
  await capture.obs.call('SetInputAudioTracks',{inputName:'Test-only unfiltered control',inputAudioTracks:{1:false,2:false,3:false,4:false,5:false,6:true}});
  tone=spawn(path.join(run,'Ember.exe'),[path.join(run,'excluded.wav')],{windowsHide:true,stdio:'ignore'});await wait(3000);
  const controlFile=await capture.save();await fs.writeFile(path.join(run,'recording.json'),JSON.stringify({file,controlFile,excludedRootPid:process.pid,audio:capture.audio},null,2));
 }finally{tone?.kill();await fs.writeFile(path.join(run,'engine-log.txt'),capture.obs.session?.stderr||'');await capture.stop();}
}
function amplitude(samples,hz,start,length){let real=0,imaginary=0;for(let i=0;i<length;i++){const v=samples.readFloatLE((start+i)*4),phase=2*Math.PI*hz*i/rate;real+=v*Math.cos(phase);imaginary+=v*Math.sin(phase);}return 2*Math.hypot(real,imaginary)/length;}
async function main(){
 const existing=process.env.EMBER_AUDIO_EXCLUSION_EXISTING_RUN;
 if(!existing&&process.env.EMBER_AUDIO_EXCLUSION_TEST!=='1')throw new Error('This test plays quiet tones. Set EMBER_AUDIO_EXCLUSION_TEST=1 only after coordinating audio playback.');
 const run=existing?path.resolve(existing):path.join(__dirname,'capture-results','audio-exclusion-'+Date.now());await fs.mkdir(run,{recursive:true});let external;
 if(!existing){
 const compiler=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 for(const name of ['Ember','ExternalAudioTest']){const build=spawnSync(compiler,['/nologo','/target:winexe','/reference:System.Windows.Forms.dll','/out:'+path.join(run,name+'.exe'),path.join(__dirname,'AudioExclusionTarget.cs')],{encoding:'utf8',windowsHide:true});assert.equal(build.status,0,build.stdout+build.stderr);}
 await fs.writeFile(path.join(run,'external.wav'),wav(externalHz));await fs.writeFile(path.join(run,'excluded.wav'),wav(excludedHz));
 external=spawn(path.join(run,'ExternalAudioTest.exe'),[path.join(run,'external.wav')],{windowsHide:true,stdio:'ignore'});
 }
 try{
  if(!existing){
  await wait(900);const test=spawn(process.execPath,[__filename,'--worker',run],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';test.stdout.on('data',b=>output+=b);test.stderr.on('data',b=>output+=b);
  const code=await new Promise((resolve,reject)=>{test.on('exit',resolve);test.on('error',reject);});assert.equal(code,0,output);
  }
  const recording=JSON.parse(await fs.readFile(path.join(run,'recording.json'),'utf8')),tracks=[];
  for(let track=0;track<6;track++){
   const decoded=spawnSync(path.join(root,'tools/ffmpeg.exe'),['-v','error','-i',recording.file,'-map','0:a:'+track,'-ac','1','-ar',String(rate),'-f','f32le','pipe:1'],{windowsHide:true,maxBuffer:16*1024*1024});assert.equal(decoded.status,0,decoded.stderr.toString());
   const samples=decoded.stdout,frames=samples.length/4,windows=[];for(let start=rate;start+rate/2<frames-rate/2;start+=rate/2)windows.push({external:amplitude(samples,externalHz,start,rate/2),excluded:amplitude(samples,excludedHz,start,rate/2),adjacent:[-6,-4,-2,2,4,6].map(delta=>amplitude(samples,excludedHz+delta,start,rate/2))});
   assert(windows.length>=6,'Enough steady-state analysis windows');const mean=values=>values.reduce((sum,n)=>sum+n,0)/values.length;
   const result={track:track+1,minExternal:Math.min(...windows.map(x=>x.external)),maxExcluded:Math.max(...windows.map(x=>x.excluded)),meanExcluded:mean(windows.map(x=>x.excluded)),meanAdjacent:mean(windows.flatMap(x=>x.adjacent)),windows};
   // Other real playback may have broad-spectrum energy at the test frequency.
   // A leaked coherent tone must stand above its neighboring frequency bins.
   assert(result.meanExcluded-2*result.meanAdjacent<.0001,'Excluded child notification spectral line leaked into track '+(track+1));
   if(track<2)assert(result.minExternal>.004,'External playback dropped or ducked on track '+(track+1));
   tracks.push(result);
  }
  const control=spawnSync(path.join(root,'tools/ffmpeg.exe'),['-v','error','-i',recording.controlFile,'-map','0:a:5','-ac','1','-ar',String(rate),'-f','f32le','pipe:1'],{windowsHide:true,maxBuffer:16*1024*1024});assert.equal(control.status,0,control.stderr.toString());
  const controlAmplitudes=[];for(let start=rate;start+rate/2<control.stdout.length/4-rate/2;start+=rate/2)controlAmplitudes.push(amplitude(control.stdout,excludedHz,start,rate/2));
  const positiveControlExcludedAmplitude=Math.max(...controlAmplitudes);assert(positiveControlExcludedAmplitude>.004,'Positive control must prove excluded child tone was rendered');
  for(const track of tracks)assert(track.maxExcluded<positiveControlExcludedAmplitude*.1,'Notification-frequency energy is too high relative to positive control on track '+track.track);
  const report={run,...recording,externalHz,excludedHz,positiveControlExcludedAmplitude,tracks};await fs.writeFile(path.join(run,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{external?.kill();}
}
(process.argv[2]==='--worker'?worker(process.argv[3]):main()).catch(error=>{console.error(error);process.exitCode=1;});
