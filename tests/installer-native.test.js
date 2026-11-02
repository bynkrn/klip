const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process'),{runtimeFiles,uninstallScript}=require('../tools/installer/files');
const root=path.join(__dirname,'..'),compiler=process.env.NSIS_PATH||path.join(root,'tools/build-deps/nsis/nsis-3.12/makensis.exe');
test('compiled setup exports a matching-version uninstaller for atomic update archives',{skip:process.platform!=='win32'||!sync.existsSync(compiler)},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ember-installer-compile-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const runtime=path.join(dir,'runtime');await fs.mkdir(path.join(runtime,'new-version'),{recursive:true});
 await fs.writeFile(path.join(runtime,'Ember.exe'),'compile fixture, never executed');await fs.writeFile(path.join(runtime,'new-version','added.txt'),'new file that a previous version uninstaller would not know');
 const manifest=path.join(dir,'uninstall.nsh');await fs.writeFile(manifest,uninstallScript(await runtimeFiles(runtime)));
 const output=path.join(dir,'setup.exe'),version=require('../package.json').version;
 const result=spawnSync(compiler,['/V2','/INPUTCHARSET','UTF8','/DVERSION='+version,'/DRUNTIME='+runtime,'/DOUTPUT='+output,'/DUNINSTALL_MANIFEST='+manifest,'/DNODE='+process.execPath,'/DUNINSTALL_EXPORT='+path.join(root,'tools/installer/export-uninstaller.js'),path.join(root,'tools/installer/ember.nsi')],{windowsHide:true,timeout:30000,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);assert((await fs.stat(output)).size>1024);assert.equal((await fs.readFile(path.join(runtime,'Uninstall.exe'))).subarray(0,2).toString(),'MZ');
});
