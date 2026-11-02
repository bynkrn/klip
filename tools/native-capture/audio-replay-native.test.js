const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {OBS}=require('../../src/obs');
test('native audio session inventory and independent silent app journal use no OBS mix tracks',{skip:process.platform!=='win32'||process.env.EMBER_NATIVE_AUDIO_TEST!=='1',timeout:30000},async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'ember-native-app-audio-')),obs=new OBS(path.resolve(__dirname,'../../engine/obs'));
 try{
  await obs.launch({resolution:'320x240',fps:'60',storage:'disk',duration:30},folder);
  const inventory=await obs.call('ListAudioSessions',{excludedProcessId:process.pid});assert(Array.isArray(inventory.sessions));for(const session of inventory.sessions){assert(session.exePath);assert(session.name);assert(Array.isArray(session.roots));assert(session.roots.every(pid=>Number.isInteger(pid)&&pid>0&&pid!==process.pid));}
  await obs.call('CreateScene',{sceneName:'Silent journal test'});
  await obs.call('CreateInput',{sceneName:'Silent journal test',inputName:'Silent process',inputKind:'ember_process_audio_capture',inputSettings:{target_process_id:obs.process.pid},inputAudioSyncOffset:18});
  assert.equal((await obs.call('GetInputAudioSyncOffset',{inputName:'Silent process'})).inputAudioSyncOffset,18);
  assert(Object.values((await obs.call('GetInputAudioTracks',{inputName:'Silent process'})).inputAudioTracks).every(enabled=>!enabled));
  await obs.call('AttachAudioReplay',{inputName:'Silent process',id:'synthetic-silent-app',name:'Silent test app',processId:obs.process.pid,retentionSeconds:90,bufferDir:folder});
  const snapshot=await obs.call('SnapshotAudioReplay',{snapshotId:'silent-test',startNs:'1000000000',endNs:'2000000000',folder:path.join(folder,'snapshot')});assert.deepEqual(snapshot.tracks,[]);assert.deepEqual(snapshot.warnings,[]);
  await obs.call('DetachAudioReplay',{inputName:'Silent process'});await obs.call('ClearAudioReplay');
 }finally{await obs.close();await fs.rm(folder,{recursive:true,force:true});}
});
