const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
const {OBS}=require('../../src/obs');
function mock(){
 const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.pid=12345;child.exitCode=null;const received=[];
 child.stdin=new Writable({write(chunk,encoding,done){const request=JSON.parse(chunk.toString());received.push(request);queueMicrotask(()=>{if(request.type==='Initialize')respond(request,{});if(request.type==='Close'){respond(request,{});child.exitCode=0;child.emit('exit',0,null);}});done();}});
 child.kill=()=>{child.exitCode=1;child.emit('exit',1,null);};
 function respond(request,data,error){child.stdout.write(JSON.stringify({id:request.id,data,error})+'\n');}
 const obs=new OBS('C:/engine',{spawn:()=>{queueMicrotask(()=>child.stdout.write('{"event":"bridge-ready"}\n'));return child;}});
 return{obs,child,received,respond};
}
test('stdio requests correlate out-of-order replies and surface errors',async()=>{const {obs,received,respond}=mock();try{await obs.launch({},'C:/buffer');const first=obs.call('First'),second=obs.call('Second');respond(received.at(-1),{value:2});respond(received.at(-2),{value:1});assert.deepEqual(await first,{value:1});assert.deepEqual(await second,{value:2});const rejected=obs.call('Bad');respond(received.at(-1),null,'unsupported');await assert.rejects(rejected,/unsupported/);}finally{await obs.close();}});
test('intentional close does not notify engine loss',async()=>{const {obs}=mock();let stopped=0;obs.on('engine-stopped',()=>stopped++);await obs.launch({},'C:/buffer');assert(obs.ready);await obs.close();assert.equal(stopped,0);assert.equal(obs.ready,false);assert.equal(obs.pending.size,0);});
test('unexpected exit rejects pending calls and clears ready state',async()=>{const {obs,child}=mock();let stopped=0;obs.on('engine-stopped',()=>stopped++);await obs.launch({},'C:/buffer');const pending=obs.call('Pending');child.emit('exit',7,null);await assert.rejects(pending,/kapandı/);assert.equal(stopped,1);assert.equal(obs.ready,false);assert.equal(obs.pending.size,0);await obs.close();});
test('split UTF-8 event chunks keep Turkish text intact',async()=>{const {obs,child}=mock();try{await obs.launch({},'C:/buffer');const got=new Promise(resolve=>obs.once('TestEvent',resolve)),bytes=Buffer.from(JSON.stringify({event:'TestEvent',data:{name:'çağdaş'}})+'\n');const split=bytes.indexOf(Buffer.from('ğ'))+1;child.stdout.write(bytes.subarray(0,split));child.stdout.write(bytes.subarray(split));assert.equal((await got).name,'çağdaş');}finally{await obs.close();}});
test('request timeout releases the pending entry',async()=>{const {obs}=mock();try{await obs.launch({},'C:/buffer');await assert.rejects(obs.call('NoReply',{},20),/zaman aşımı/);assert.equal(obs.pending.size,0);}finally{await obs.close();}});
