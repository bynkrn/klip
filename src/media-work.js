const os=require('node:os');

// Only offline media helpers are lowered. Capture and its real-time encoder
// keep their normal scheduling priority.
function lowerMediaPriority(child,setPriority=os.setPriority){child.once('spawn',()=>{try{setPriority(child.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch(error){console.warn('[media-priority]',error.message);}});}
function mediaArguments(name,args){return name==='ffmpeg'?['-threads','2','-filter_threads','1','-filter_complex_threads','1',...args]:args;}
class PreviewQueue{
 constructor(ready){this.ready=ready;this.jobs=[];this.active=false;this.closed=false;}
 run(work){return new Promise((resolve,reject)=>{if(this.closed){reject(new Error('Önizleme kuyruğu kapandı.'));return;}this.jobs.push({work,resolve,reject});this.wake();});}
 wake(){if(this.closed||this.active||!this.jobs.length||!this.ready())return;const job=this.jobs.shift();this.active=true;Promise.resolve().then(job.work).then(job.resolve,job.reject).finally(()=>{this.active=false;this.wake();});}
 close(){this.closed=true;for(const job of this.jobs.splice(0))job.reject(new Error('Önizleme kuyruğu kapandı.'));}
}
module.exports={PreviewQueue,mediaArguments,lowerMediaPriority};
