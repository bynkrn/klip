const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');

test('the Windows helper builds and enumerates stable display IDs without starting a watcher',{skip:process.platform!=='win32'},async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'ember-displays-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const executable=path.join(folder,'display-helper.exe'),compiler=path.join(process.env.WINDIR||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 const build=spawnSync(compiler,['/nologo','/target:exe','/reference:System.Web.Extensions.dll','/out:'+executable,path.join(__dirname,'../tools/windows.cs')],{windowsHide:true,encoding:'utf8',timeout:10000});
 assert.equal(build.status,0,build.stdout+build.stderr);
 const result=spawnSync(executable,['--list-displays'],{windowsHide:true,encoding:'utf8',timeout:5000});
 assert.equal(result.status,0,result.error?.message||result.stderr);const displays=JSON.parse(result.stdout);assert(Array.isArray(displays));
 const ids=new Set();for(const display of displays){
  assert.equal(typeof display.id,'string');assert.match(display.id,/^\\\\\?\\DISPLAY#/i);assert(!ids.has(display.id));ids.add(display.id);
  assert.equal(typeof display.name,'string');assert(display.name.length);assert(display.width>0&&Number.isInteger(display.width));assert(display.height>0&&Number.isInteger(display.height));assert(Number.isInteger(display.x));assert(Number.isInteger(display.y));assert.equal(typeof display.primary,'boolean');assert.equal(display.available,true);
 }
 if(displays.length)assert.equal(displays.filter(display=>display.primary).length,1);
 const invalid=spawnSync(executable,['--unsupported'],{windowsHide:true,encoding:'utf8',timeout:5000});assert.equal(invalid.status,2);assert.match(invalid.stderr,/unsupported/i);
});
