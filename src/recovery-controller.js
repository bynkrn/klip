class RecoveryController{
 constructor({getCapture,isSaving=()=>false,save,onChange=()=>{}}){Object.assign(this,{getCapture,isSaving,save,onChange});this.active=false;this.error='';}
 state(){
  const capture=this.getCapture(),detail=capture?.recoveryRequired,live=detail?.keepAlive===true,seen=new Set(),manifests=[];
  for(const item of capture?.recoveryManifests||[]){const key=typeof item==='string'?item:item?.manifest;if(!key||seen.has(key))continue;seen.add(key);const value=typeof item==='object'?item:{};manifests.push({snapshotId:/^[A-Za-z0-9-]{1,100}$/.test(String(value.snapshotId||''))?String(value.snapshotId):'',bytes:Number.isSafeInteger(value.bytes)&&value.bytes>=0?value.bytes:0,startNs:/^\d{1,30}$/.test(String(value.startNs))?String(value.startNs):'',endNs:/^\d{1,30}$/.test(String(value.endNs))?String(value.endNs):''});}
  if(detail&&!live&&(detail.recoveryManifest?!seen.has(detail.recoveryManifest):!manifests.length))manifests.push({snapshotId:'pending',bytes:0,startNs:'',endNs:''});
  const count=manifests.length+(live?1:0);return{count,live,pending:count>0,manifests,message:this.error||String(detail?.message||''),recovering:this.active};
 }
 recover(){
  if(this.work)return this.work;if(this.isSaving())return Promise.reject(new Error('Devam eden işlemin bitmesini bekle.'));
  this.work=this.perform().finally(()=>{this.work=null;});return this.work;
 }
 async perform(){
  this.active=true;this.error='';this.onChange(this.state());const capture=this.getCapture();
  try{
   const detail=capture?.recoveryRequired;if(detail?.keepAlive){if(typeof this.save!=='function')throw new Error('Kurtarma servisi henüz hazır değil.');await this.save();if(capture.recoveryRequired===detail)capture.recoveryRequired=null;}
   if(capture?.recoveryManifests?.length||capture?.recoveryRequired&&!capture.recoveryRequired.keepAlive){if(typeof capture.recoverReplays!=='function')throw new Error('Kurtarma servisi henüz hazır değil.');await capture.recoverReplays();}
  }catch(error){this.error=String(error.message||error);throw error;}
  finally{this.active=false;this.onChange(this.state());}
  return this.state();
 }
}
class RecoveryExitGuard{
 constructor({getCapture,waitForOperations,confirmDiscard}){Object.assign(this,{getCapture,waitForOperations,confirmDiscard});}
 request(){if(this.work)return this.work;this.work=this.check().finally(()=>{this.work=null;});return this.work;}
 async check(){
  await this.waitForOperations();const capture=this.getCapture(),detail=capture?.recoveryRequired;
  if(!detail?.keepAlive)return{allowed:true,discardRecovery:false};
  if(await this.confirmDiscard()!==true)return{allowed:false,discardRecovery:false};
  await this.waitForOperations();const current=this.getCapture()?.recoveryRequired;
  if(current?.keepAlive&&current!==detail)return{allowed:false,discardRecovery:false};
  return{allowed:true,discardRecovery:current?.keepAlive===true};
 }
}
module.exports={RecoveryController,RecoveryExitGuard};
