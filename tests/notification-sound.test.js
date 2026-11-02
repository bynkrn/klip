const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
let NotificationSound;try{({NotificationSound}=require('../src/notification-sound'));}catch{}
function wav(){const b=Buffer.alloc(48);b.write('RIFF');b.writeUInt32LE(40,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(4,40);return b;}
async function fixture(t){assert.equal(typeof NotificationSound,'function');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ember-sound-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const assets=[];const sounds=new NotificationSound({directory:path.join(dir,'sounds'),asset:resolve=>{assets.push(resolve);return 'klipmedia://local/owned-'+assets.length;}});return{dir,sounds,assets};}
test('new installations retain Spark and an existing local Medal cue is adopted only once',async t=>{
 const f=await fixture(t),initial={notificationSound:'ember',notificationVolume:75};assert.equal((await f.sounds.initialize(initial)).notificationSound,'ember');
 await fs.mkdir(path.join(f.dir,'sounds'));await fs.writeFile(path.join(f.dir,'sounds','medal.wav'),wav());
 const migrated=await f.sounds.initialize({...initial,notificationSound:'glass'});assert.equal(migrated.notificationSound,'custom');assert.equal(migrated.notificationCustomFile,'medal.wav');assert.equal(migrated.notificationMedalMigrated,true);
 const publicSettings=await f.sounds.settings(migrated);assert.deepEqual(publicSettings.notificationCustom,{available:true,name:'Medal',url:'klipmedia://local/owned-1'});assert(!('notificationCustomFile'in publicSettings));assert(!('notificationMedalMigrated'in publicSettings));
 assert.equal((await f.sounds.initialize({...migrated,notificationSound:'soft'})).notificationSound,'soft');assert.equal(await f.assets[0](),path.join(f.dir,'sounds','medal.wav'));
});
test('file import copies supported audio into owned storage without changing the original',async t=>{
 const f=await fixture(t);for(const [extension,bytes]of [['wav',wav()],['mp3',Buffer.from('ID3owned mp3')],['ogg',Buffer.from('OggSowned ogg')],['m4a',Buffer.from([0,0,0,16,...Buffer.from('ftypM4A owned')])]]){
  const source=path.join(f.dir,'original.'+extension);await fs.writeFile(source,bytes);const imported=await f.sounds.importFile(source);assert.equal(imported.notificationSound,'custom');assert.equal(imported.notificationMedalMigrated,true);assert.notEqual(imported.notificationCustomFile,path.basename(source));
  assert.deepEqual(await fs.readFile(source),bytes);assert.deepEqual(await fs.readFile(path.join(f.dir,'sounds',imported.notificationCustomFile)),bytes);const view=await f.sounds.settings(imported);assert.equal(view.notificationCustom.name,path.basename(source));assert.match(view.notificationCustom.url,/^klipmedia:\/\/local\//);await f.sounds.validate({...imported,notificationVolume:75});
 }
});
test('unsupported, empty, oversized and disguised imports never create a playable custom sound',async t=>{
 const f=await fixture(t);for(const [name,bytes]of [['bad.exe',wav()],['empty.wav',Buffer.alloc(0)],['huge.wav',Buffer.alloc(10*1024*1024+1)],['disguised.wav',Buffer.from('<html>not audio</html>')]]){const file=path.join(f.dir,name);await fs.writeFile(file,bytes);await assert.rejects(f.sounds.importFile(file),/ses|10 MB|biçim/i);assert.deepEqual(await fs.readFile(file),bytes);}
 assert.equal((await fs.readdir(path.join(f.dir,'sounds')).catch(()=>[])).length,0);
});
test('custom metadata and validation reject escaped or missing files and recheck asset access',async t=>{
 const f=await fixture(t),outside=path.join(f.dir,'private.wav');await fs.writeFile(outside,wav());for(const file of ['../private.wav',outside,'missing.wav']){const state={notificationSound:'custom',notificationVolume:75,notificationCustomFile:file};assert.equal((await f.sounds.settings(state)).notificationCustom.available,false);await assert.rejects(f.sounds.validate(state),/ses/);}
 const imported=await f.sounds.importFile(outside);await f.sounds.settings(imported);await fs.unlink(path.join(f.dir,'sounds',imported.notificationCustomFile));await assert.rejects(f.assets[0](),/ses/);assert.equal((await f.sounds.initialize(imported)).notificationSound,'ember');
});
test('imported audio assets provide their audio media type through the real range protocol',async t=>{const f=await fixture(t),source=path.join(f.dir,'chosen.mp3');await fs.writeFile(source,'ID3controlled audio');const imported=await f.sounds.importFile(source),file=await f.sounds.resolve(imported.notificationCustomFile),response=await require('../src/media').fileResponse(file,new Request('klipmedia://local/owned'));assert.equal(response.headers.get('content-type'),'audio/mpeg');assert.equal(await response.text(),'ID3controlled audio');});
