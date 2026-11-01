const {app,shell}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {WindowsTrash}=require('../src/windows-trash');
app.setName('Klip Recycle Test');
app.setPath('userData',path.join(os.tmpdir(),'klip-recycle-runtime-'+process.pid));
app.whenReady().then(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'klip-recycle-roundtrip-')),file=path.join(root,'Geri yükleme denemesi.mp4'),original=Buffer.from('Owned Klip restore test '+Date.now());
 const service=new WindowsTrash({historyFile:path.join(root,'history.json'),root:()=>root,helper:path.resolve(__dirname,'../tools/recycle-bin.exe')});
 try{
  await service.addRoot(root);await fs.writeFile(file,original);await shell.trashItem(file);
  const rows=await service.list();assert.equal(rows.length,1);assert.equal(rows[0].originalPath,file);assert(Math.abs(Date.now()-Date.parse(rows[0].deletedAt))<120000,'Deleted date must be accurate UTC');
  await fs.writeFile(file,'occupied');const collision=await service.restore([rows[0].id]);assert.equal(collision.restored.length,0);assert.equal(collision.failed.length,1);assert.equal(await fs.readFile(file,'utf8'),'occupied');
  await fs.unlink(file);const restored=await service.restore([rows[0].id]);assert.equal(restored.restored.length,1,JSON.stringify(restored));assert((await fs.readFile(file)).equals(original));assert.equal((await service.list()).length,0);
  console.log(JSON.stringify({recycleRoundTrip:true,collisionProtected:true,bytesUnchanged:true,deletedDateUtc:true}));
 }catch(error){console.error(error);process.exitCode=1;}finally{assert(path.resolve(root).startsWith(path.join(os.tmpdir(),'klip-recycle-roundtrip-')));await fs.rm(root,{recursive:true,force:true}).catch(()=>{});app.quit();}
}).catch(error=>{console.error(error);app.exit(1);});
