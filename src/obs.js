const {spawn}=require('node:child_process');
const path=require('node:path'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');

// Preserve Capture/VideoSources' request contract without websocket or OBS GUI.
class OBS extends EventEmitter {
 constructor(root,options={}){super();this.root=path.resolve(root);this.pending=new Map();this.ready=false;this.socket={readyState:0};this.spawn=options.spawn||spawn;}
 async launch(config,bufferDir){
  if(this.launching)return this.launching;
  if(this.ready)return;
  this.launching=this.start(config,bufferDir);
  try{await this.launching;}finally{this.launching=null;}
 }
 async start(config,bufferDir){
  if(this.closing)await this.closing;
  const bin=path.join(this.root,'bin','64bit');
  const child=this.spawn(path.join(bin,'Ember.Capture.exe'),[],{cwd:bin,windowsHide:true,env:{...process.env,PATH:bin+';'+(process.env.PATH||'')},stdio:['pipe','pipe','pipe']});
  const session={child,intentional:false,notified:false,stderr:'',tail:''};this.session=session;this.process=child;
  let bootResolve,bootReject;
  const boot=new Promise((resolve,reject)=>{bootResolve=resolve;bootReject=reject;});
  const bootTimer=setTimeout(()=>bootReject(new Error('Ember kayıt hizmeti başlatılamadı.')),15000);
  session.exited=new Promise(resolve=>{session.resolveExit=resolve;});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stderr.on('data',data=>{session.stderr=(session.stderr+data.toString()).slice(-12000);});
  child.stdin.on('error',error=>{if(!session.intentional)this.rejectPending(error);});
  child.stdout.on('data',data=>{
   if(this.session!==session)return;
   session.tail+=data.toString('utf8');
   if(session.tail.length>2*1024*1024){bootReject(new Error('Kayıt hizmetinden geçersiz yanıt.'));this.rejectPending(new Error('Kayıt hizmetinden çok büyük yanıt.'));child.kill();return;}
   let end;while((end=session.tail.indexOf('\n'))>=0){const line=session.tail.slice(0,end).trim();session.tail=session.tail.slice(end+1);if(!line)continue;
    let message;try{message=JSON.parse(line);}catch{bootReject(new Error('Kayıt hizmetinden geçersiz JSON yanıtı.'));child.kill();return;}
    if(message.event==='bridge-ready'){this.ready=true;this.socket.readyState=1;bootResolve();continue;}
    if(message.id){const request=this.pending.get(message.id);if(request){this.pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(message.error)):request.resolve(message.data||{});}continue;}
    if(message.event){
     this.emit(message.event,message.event==='engine-error'?(message.data?.message||'Kayıt hizmeti hatası'):message.data);
     if(message.event==='ReplayBufferStateChanged'&&!message.data?.outputActive&&message.data?.outputCode&&!session.intentional&&!session.notified){session.notified=true;this.emit('engine-stopped');}
    }
   }
  });
  child.on('error',error=>{bootReject(error);this.rejectPending(error);session.resolveExit();if(!session.intentional)this.emit('engine-error',error.message);});
  child.on('exit',(code,signal)=>{
   session.resolveExit();if(this.session!==session)return;
   this.process=null;this.ready=false;this.socket.readyState=3;
   const error=new Error('Ember kayıt hizmeti kapandı'+(code?' ('+code+')':'')+(session.stderr?'\n'+session.stderr.slice(-1800):''));
   bootReject(error);this.rejectPending(error);
   if(!session.intentional&&!session.notified){session.notified=true;this.emit('engine-stopped');}
  });
  try{await boot;clearTimeout(bootTimer);await this.call('Initialize',{root:this.root,config,bufferDir:path.resolve(bufferDir)},45000);}
  catch(error){clearTimeout(bootTimer);await this.close();throw error;}
 }
 rejectPending(error){for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(error);}this.pending.clear();}
 call(type,data={},timeoutMs=15000){return new Promise((resolve,reject)=>{
  const child=this.process;if(!this.ready||!child||child.stdin.destroyed)return reject(new Error('Ember kayıt hizmeti hazır değil'));
  const id=crypto.randomUUID(),timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Kayıt hizmeti zaman aşımı: '+type));},timeoutMs);
  this.pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,type,data})+'\n',error=>{if(error){const request=this.pending.get(id);if(request){clearTimeout(timer);this.pending.delete(id);reject(error);}}});
 });}
 async close(){
  if(this.closing)return this.closing;
  const session=this.session;if(!session)return;
  session.intentional=true;
  this.closing=(async()=>{
   const child=session.child;
   if(this.process===child&&this.ready){try{await this.call('Close',{},20000);}catch{} }
   if(!child.stdin.destroyed)child.stdin.end();
   let timer;await Promise.race([session.exited,new Promise(resolve=>{timer=setTimeout(()=>{child.kill();resolve();},5000);})]);clearTimeout(timer);
   if(this.session===session){this.ready=false;this.socket.readyState=3;this.process=null;this.session=null;this.rejectPending(new Error('Ember kayıt hizmeti kapandı'));}
  })();
  try{await this.closing;}finally{this.closing=null;}
 }
}
module.exports={OBS};
