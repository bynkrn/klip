const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
let preferences;try{preferences=require('../src/installation-preferences');}catch{}
const seed=(id='abc-123',language='en')=>`[Setup]\r\nid=${id}\r\nlanguage=${language}\r\nlaunch=0\r\nlaunchMinimized=1\r\nautoBuffer=0\r\n`;
test('installer choices apply before startup while preserving recording and library preferences',()=>{
 assert(preferences,'installation preferences must be implemented');
 const original={language:'tr',launch:true,launchMinimized:false,autoBuffer:true,videoBitrate:90,folder:'D:/My clips',audioEnabled:{discord:false}};
 const result=preferences.applyInstallationPreferences(original,seed());
 assert.equal(result.language,'en');assert.equal(result.launch,false);assert.equal(result.launchMinimized,true);assert.equal(result.autoBuffer,false);
 assert.equal(result.videoBitrate,90);assert.equal(result.folder,'D:/My clips');assert.deepEqual(result.audioEnabled,{discord:false});assert.equal(original.language,'tr');
});
test('a consumed installation never resets later in-app choices; a new install can change them',()=>{
 assert(preferences,'installation preferences must be implemented');
 const initial=preferences.applyInstallationPreferences({},seed());
 const edited={...initial,language:'tr',launch:true,autoBuffer:true};
 assert.deepEqual(preferences.applyInstallationPreferences(edited,seed()),edited);
 const reinstalled=preferences.applyInstallationPreferences(edited,seed('new-install','en'));
 assert.equal(reinstalled.language,'en');assert.equal(reinstalled.launch,false);
});
test('incomplete, duplicate or invalid seeds never partly apply; extra settings are ignored',()=>{
 assert(preferences,'installation preferences must be implemented');
 const settings={language:'tr',launch:true};
 for(const bad of ['',seed().replace('id=abc-123','id='),seed().replace('language=en','language=xx'),seed().replace('launch=0','launch=false'),seed().replace('autoBuffer=0',''),seed()+'language=tr\n','x'.repeat(5000)])assert.deepEqual(preferences.applyInstallationPreferences(settings,bad),settings);
 const result=preferences.applyInstallationPreferences(settings,seed()+'folder=C:/untrusted\nqualityMode=bad\n');assert.equal(result.folder,undefined);assert.equal(result.qualityMode,undefined);
});
test('loads Windows UTF16 and UTF8 seeds and treats missing seeds as ordinary updates',async t=>{
 assert(preferences,'installation preferences must be implemented');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ember-install-prefs-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'installation.ini');
 assert.deepEqual(await preferences.loadInstallationPreferences({language:'tr'},file),{language:'tr'});
 await fs.writeFile(file,Buffer.from('\ufeff'+seed(),'utf16le'));assert.equal((await preferences.loadInstallationPreferences({},file)).language,'en');
 await fs.writeFile(file,'\ufeff'+seed('utf8','tr'),'utf8');assert.equal((await preferences.loadInstallationPreferences({},file)).language,'tr');
});
