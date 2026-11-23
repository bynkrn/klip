const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {PlaybackMedia,needsAudioPreview}=require('../src/playback-media');
const media={streams:[{codec_type:'video'},...['Game','Discord','Mic'].map(handler_name=>({codec_type:'audio',tags:{handler_name}}))],format:{tags:{ember_audio_layout:'separate'}}};
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ember-playback-')),file=path.join(dir,'Maç klibi.mp4');t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.writeFile(file,'source with independent stems');return{dir,file};}
test('only independent multitrack clips need a mixed playback copy',()=>{assert(needsAudioPreview(media));assert(!needsAudioPreview({...media,format:{}}));assert(!needsAudioPreview({...media,streams:media.streams.slice(0,2)}));});
test('playback lazily mixes all stems in a cache without changing the editing source, deduplicates and reuses the verified copy',async t=>{
 const {dir,file}=await fixture(t),calls=[];let release;const gate=new Promise(resolve=>release=resolve),playback=new PlaybackMedia({cacheDir:path.join(dir,'cache'),run:async(_tool,args)=>{calls.push(args);await gate;await fs.writeFile(args.at(-1),'playback mix');},probe:async()=>({streams:[{codec_type:'video'},{codec_type:'audio'}],format:{duration:1}})});
 assert.equal(calls.length,0);const one=playback.get(file,media),two=playback.get(file,media);release();const [a,b]=await Promise.all([one,two]);assert.equal(a,b);assert.equal(calls.length,1);const args=calls[0];assert.equal(args[args.indexOf('-c:v')+1],'copy');for(let i=0;i<3;i++)assert(args[args.indexOf('-filter_complex')+1].includes('[0:a:'+i+']'));assert.equal(await fs.readFile(file,'utf8'),'source with independent stems');assert.equal(await playback.get(file,media),a);assert.equal(calls.length,1);
});
test('mixed or single-track clips use the original and do not start background processing',async t=>{
 const {dir,file}=await fixture(t);const playback=new PlaybackMedia({cacheDir:path.join(dir,'cache'),run:async()=>assert.fail('unexpected mix')});assert.equal(await playback.get(file,{...media,format:{}}),file);assert.equal(await playback.get(file,{...media,streams:media.streams.slice(0,2)}),file);
});
test('a failed playback generation can retry and leaves all original source audio intact',async t=>{
 const {dir,file}=await fixture(t);let attempts=0;const playback=new PlaybackMedia({cacheDir:path.join(dir,'cache'),run:async(_tool,args)=>{await fs.writeFile(args.at(-1),'partial');if(++attempts===1)throw Error('disk full');},probe:async()=>({streams:[{codec_type:'video'},{codec_type:'audio'}],format:{duration:1}})});
 await assert.rejects(playback.get(file,media),/disk full/);assert.equal(await fs.readFile(file,'utf8'),'source with independent stems');assert.deepEqual(await fs.readdir(path.join(dir,'cache')),[]);assert(await playback.get(file,media));assert.equal(attempts,2);
});
