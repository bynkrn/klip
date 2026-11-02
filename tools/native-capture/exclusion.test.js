const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {OBS}=require('../../src/obs');
const root=path.resolve(__dirname,'../../engine/obs'),available=process.platform==='win32'&&fs.existsSync(path.join(root,'bin/64bit/Ember.Capture.exe'));
test('native exclusion source confirms readiness, stages calibration, and rejects invalid roots',{skip:!available},async()=>{
 const obs=new OBS(root);
 try{
  await obs.launch({resolution:'320x180',fps:'30',duration:10,qualityMode:'bitrate',videoBitrate:5},path.resolve(__dirname,'../../tests/capture-results/exclusion-source-smoke'));
  await obs.call('CreateScene',{sceneName:'Klip'});
  const create=(name,pid)=>obs.call('CreateInput',{sceneName:'Klip',inputName:name,inputKind:'ember_system_audio_capture',inputSettings:{target_process_id:pid},inputAudioSyncOffset:-110});
  await assert.rejects(create('Invalid root',0),/root process ID is required/);
  assert(!(await obs.call('GetInputList')).inputs.some(x=>x.inputName==='Invalid root'));
  await create('Ready exclusion',process.pid);
  assert.equal((await obs.call('GetInputAudioSyncOffset',{inputName:'Ready exclusion'})).inputAudioSyncOffset,-110);
  const settings=(await obs.call('GetInputSettings',{inputName:'Ready exclusion'})).inputSettings;
  assert.equal(settings.target_process_id,process.pid);assert.equal(settings.__ember_initial_sync_offset_ns,-110000000);
 }finally{await obs.close();}
});
