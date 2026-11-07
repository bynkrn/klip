// Explicit release verification with an existing client's updater. Checks/downloads only; never installs.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
 const client=path.resolve(process.argv[2]||''),expected=process.argv[3];if(!process.argv[2]||!/^\d+\.\d+\.\d+$/.test(expected||''))throw Error('Usage: node tests/verify-published-update.js <old resources/app> <expected version> [--download]');
 const clientPackage=require(path.join(client,'package.json')),config=require(path.join(client,'src/update-config.json')),{Updates}=require(path.join(client,'src/updates.js'));
 assert.notEqual(clientPackage.version,expected,'Use an older client to verify the update path');assert.equal(config.mode,'public');
 const cacheDir=path.join(__dirname,'capture-results','release-'+expected),updater=new Updates({...config,currentVersion:clientPackage.version,cacheDir,appRoot:path.resolve(client,'../..'),packaged:true});let last=-1;
 updater.on('state',state=>{if(state.status==='downloading'){const percent=Math.floor(state.progress*10)*10;if(percent!==last){last=percent;console.log('Verified Download Progress '+percent+'%');}}});
 const state=await updater.check({source:'startup'});assert.equal(state.status,'available',JSON.stringify(state));assert.equal(state.latestVersion,expected);assert.equal(state.offer,true);assert.equal(updater.release.manifest.version,expected);
 const result={clientVersion:clientPackage.version,latestVersion:expected,signatureAccepted:true,manifest:updater.release.manifest};console.log(JSON.stringify(result));
 if(process.argv.includes('--download')){const downloaded=await updater.download();assert.equal(downloaded.status,'ready',JSON.stringify(downloaded));assert.equal(downloaded.progress,1);assert.equal((await fs.stat(updater.archivePath)).size,result.manifest.size);result.archive=updater.archivePath;result.status='ready';result.sizeAndSha256Verified=true;console.log(JSON.stringify({status:'ready',sizeAndSha256Verified:true,archive:updater.archivePath}));}
 await fs.mkdir(cacheDir,{recursive:true});await fs.writeFile(path.join(cacheDir,'verification.json'),JSON.stringify(result,null,2)+'\n');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
