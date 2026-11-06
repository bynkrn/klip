const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{EventEmitter}=require('node:events');
let ProjectTransfer;try{({ProjectTransfer}=require('../src/project-transfer'));}catch{}
async function fixture(t){
 assert(ProjectTransfer,'project import sender must be implemented');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ember-aktar-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const editor=path.join(dir,'Video Editörü Şık.exe'),a=path.join(dir,'Arkadaşlarla maç 01.mp4'),b=path.join(dir,'İkinci klip.mp4');for(const file of [editor,a,b])await fs.writeFile(file,'owned unchanged fixture '+path.basename(file));
 const clips=new Map([['a',{id:'a',file:a}],['b',{id:'b',file:b}]]),launches=[];let selectedEditor=editor,now=1000;
 const launch=(exe,args,options)=>{const child=new EventEmitter();child.unref=()=>{};launches.push({exe,args,options,child});queueMicrotask(()=>child.emit('spawn'));return child;};
 const sender=new ProjectTransfer({directory:path.join(dir,'İstekler ve sonuçlar'),resolveClip:id=>clips.get(id),getEditor:()=>selectedEditor,probe:async()=>({streams:[{codec_type:'video',width:1920,height:1080},{codec_type:'audio'},{codec_type:'audio'}],format:{duration:'10'}}),spawn:launch,now:()=>now});t.after(()=>sender.close());await sender.initialize();
 return{dir,editor,a,b,clips,launches,sender,setEditor:value=>selectedEditor=value,advance:()=>now+=86400000,writeResult:async(job,result)=>fs.writeFile(job.resultPath,JSON.stringify({schema:'kurgu-project-import-result',version:1,requestId:job.requestId,...result}))};
}
test('single and multiple clips produce exact atomic V1 requests without changing original media',async t=>{
 const f=await fixture(t),hash=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'),before=await hash(f.a);
 const job=await f.sender.create({ids:['a','b','a'],projectName:'  Arkadaşlarla maç  ',copyMedia:false});
 const request=JSON.parse(await fs.readFile(job.requestPath,'utf8'));assert.deepEqual(request,{schema:'kurgu-project-import',version:1,requestId:job.requestId,projectName:'Arkadaşlarla maç',files:[f.a,f.b],copyMedia:false});
 assert.match(job.requestId,/^[0-9a-f-]{36}$/);assert.equal(job.resultPath,job.requestPath.replace(/\.json$/,'.result.json'));assert.equal(job.status,'waiting');
 assert.deepEqual(f.launches[0].args,['--import-project',job.requestPath]);assert.equal(f.launches[0].exe,f.editor);assert.equal(f.launches[0].options.shell,false);assert.equal(f.launches[0].options.cwd,path.dirname(f.editor));assert.equal(await hash(f.a),before);assert.equal((await fs.readdir(path.dirname(job.requestPath))).some(file=>file.endsWith('.tmp')),false);
 const single=await f.sender.create({ids:['a'],projectName:'Tek klip',copyMedia:true});assert.notEqual(single.requestId,job.requestId);assert.deepEqual(JSON.parse(await fs.readFile(single.requestPath)).files,[f.a]);
});
test('identical requests and explicit retries retain ID and immutable bytes; edited content gets another ID',async t=>{
 const f=await fixture(t),input={ids:['a'],projectName:'Bir proje',copyMedia:false};const [first,duplicate]=await Promise.all([f.sender.create(input),f.sender.create(input)]);assert.equal(first.requestId,duplicate.requestId);assert.equal(f.launches.length,1);
 const bytes=await fs.readFile(first.requestPath);await f.sender.retry(first.requestId);assert.equal(f.launches.length,2);assert.deepEqual(await fs.readFile(first.requestPath),bytes);
 const edited=await f.sender.create({...input,projectName:'Başka proje'});assert.notEqual(edited.requestId,first.requestId);
});
test('unknown, missing, empty and unfinished clips and missing editors are rejected before launch',async t=>{
 const f=await fixture(t),input={ids:['a'],projectName:'Proje',copyMedia:false};
 await assert.rejects(f.sender.create({...input,ids:['unknown']}));await fs.unlink(f.a);await assert.rejects(f.sender.create(input));await fs.writeFile(f.a,'');await assert.rejects(f.sender.create(input));await fs.writeFile(f.a,'restored');
 f.clips.get('a').pending=true;await assert.rejects(f.sender.create(input));delete f.clips.get('a').pending;
 f.setEditor('');await assert.rejects(f.sender.create(input));f.setEditor(path.join(f.dir,'missing.exe'));await assert.rejects(f.sender.create(input));assert.equal(f.launches.length,0);
});
test('launcher exit never completes a transfer and late results still complete after a long wait',async t=>{
 const f=await fixture(t),job=await f.sender.create({ids:['a'],projectName:'Uzun kopyalama',copyMedia:true});f.launches[0].child.emit('exit',0);f.advance();await f.sender.poll();assert.equal(f.sender.get(job.requestId).status,'waiting');
 await f.writeResult(job,{status:'completed',projectPath:path.join(f.dir,'Türkçe proje','proje.tuckproj')});await f.sender.poll();assert.equal(f.sender.get(job.requestId).status,'completed');
 const before=f.launches.length;await f.sender.retry(job.requestId);assert.equal(f.launches.length,before);
});
test('PROJECT_EXISTS and editor cancellation are explicit results without renaming requests',async t=>{
 const f=await fixture(t),input={ids:['a','b'],projectName:'Var olan proje',copyMedia:true},job=await f.sender.create(input);
 await f.writeResult(job,{status:'error',error:{code:'PROJECT_EXISTS',message:'Bu proje zaten var.'}});await f.sender.poll();assert.equal(f.sender.get(job.requestId).error.code,'PROJECT_EXISTS');assert.equal(f.sender.get(job.requestId).projectName,input.projectName);
 const changed=await f.sender.create({...input,projectName:'Yeni isim'});assert.notEqual(changed.requestId,job.requestId);await f.writeResult(changed,{status:'cancelled'});await f.sender.poll();assert.equal(f.sender.get(changed.requestId).status,'cancelled');
});
test('malformed and mismatched results never report success and can be replaced with a valid result',async t=>{
 const f=await fixture(t),job=await f.sender.create({ids:['a'],projectName:'Test',copyMedia:false});
 for(const invalid of ['{',JSON.stringify({schema:'kurgu-project-import-result',version:1,requestId:crypto.randomUUID(),status:'completed',projectPath:f.a}),JSON.stringify({schema:'kurgu-project-import-result',version:2,requestId:job.requestId,status:'cancelled'})]){await fs.writeFile(job.resultPath,invalid);await f.sender.poll();assert.equal(f.sender.get(job.requestId).status,'waiting');}
 await f.writeResult(job,{status:'cancelled'});await f.sender.poll();assert.equal(f.sender.get(job.requestId).status,'cancelled');
});
test('pending requests survive sender restart without launching another editor instance',async t=>{
 const f=await fixture(t),job=await f.sender.create({ids:['a'],projectName:'Yeniden açılış',copyMedia:false});f.sender.close();
 const restored=new ProjectTransfer({directory:path.dirname(job.requestPath),getEditor:()=>f.editor,resolveClip:id=>f.clips.get(id),probe:async()=>({streams:[{codec_type:'video',width:1,height:1}],format:{duration:1}})});t.after(()=>restored.close());await restored.initialize();assert.equal(restored.get(job.requestId).status,'waiting');
 await f.writeResult(job,{status:'completed',projectPath:path.join(f.dir,'saved.tuckproj')});await restored.poll();assert.equal(restored.get(job.requestId).status,'completed');
});
test('a result arriving during retry validation stays completed instead of reverting to waiting',async t=>{
 const f=await fixture(t),job=await f.sender.create({ids:['a'],projectName:'Yarış',copyMedia:false});let entered,release;const probing=new Promise(resolve=>entered=resolve),blocked=new Promise(resolve=>release=resolve),probe=f.sender.probe;
 f.sender.probe=async file=>{entered();await blocked;return probe(file);};const retry=f.sender.retry(job.requestId);await probing;
 await f.writeResult(job,{status:'completed',projectPath:path.join(f.dir,'done.tuckproj')});await f.sender.poll();release();const result=await retry;assert.equal(result.status,'completed');assert.equal(f.sender.get(job.requestId).status,'completed');assert.equal(f.launches.length,1);
});
test('restored waiting requests publish their state even before any receiver result exists',async t=>{
 const f=await fixture(t),job=await f.sender.create({ids:['a'],projectName:'Bekleyen',copyMedia:false});f.sender.close();const states=[];
 const restored=new ProjectTransfer({directory:path.dirname(job.requestPath),getEditor:()=>f.editor});t.after(()=>restored.close());restored.on('change',state=>states.push(state));await restored.initialize();assert(states.some(state=>state.some(item=>item.requestId===job.requestId&&item.status==='waiting')));
});
test('resending an acknowledged receiver error uses the same request and waits for a new acknowledgement',async t=>{
 const f=await fixture(t),job=await f.sender.create({ids:['a'],projectName:'Tekrar',copyMedia:false});await f.writeResult(job,{status:'error',error:{code:'IO_ERROR',message:'Geçici hata'}});await f.sender.poll();
 const retry=await f.sender.retry(job.requestId);assert.equal(retry.requestId,job.requestId);assert.equal(f.launches.length,2);await f.sender.poll();assert.equal(f.sender.get(job.requestId).status,'waiting');
 await new Promise(resolve=>setTimeout(resolve,15));await f.writeResult(job,{status:'completed',projectPath:path.join(f.dir,'retried.tuckproj')});await f.sender.poll();assert.equal(f.sender.get(job.requestId).status,'completed');
});
test('launcher failure is actionable and can be retried without rewriting the request',async t=>{
 const f=await fixture(t),launch=f.sender.spawn;f.sender.spawn=()=>{throw Object.assign(new Error('ENOENT'),{code:'ENOENT'});};const job=await f.sender.create({ids:['a'],projectName:'Başlatma',copyMedia:false});assert.equal(job.status,'error');assert.equal(job.error.code,'EDITOR_START_FAILED');const bytes=await fs.readFile(job.requestPath);
 f.sender.spawn=launch;const retry=await f.sender.retry(job.requestId);assert.equal(retry.status,'waiting');assert.equal(retry.requestId,job.requestId);assert.deepEqual(await fs.readFile(job.requestPath),bytes);
});
