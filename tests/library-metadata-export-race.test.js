const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const generated=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8'),builder=fs.readFileSync(path.join(__dirname,'../tools/build-ui.js'),'utf8');
function productionFunction(name){
 const start=generated.indexOf('  async function '+name+'(');assert(start>=0,name+' is generated');const end=generated.indexOf('\n  }',start);assert(end>=0);return generated.slice(start,end+4);
}
function metadataCallback(){const match=/onClips:(list=>\{[^\r\n]+?\}),refresh:/u.exec(builder);assert(match,'native metadata response callback is implemented');return match[1];}
function harness(){
 let finishAudio,dialogs=0;const audioReady=new Promise(resolve=>finishAudio=resolve),elements=new Map(),prepared=[];
 const source={id:'clip-a',file:'C:\\Türkçe Klipler\\maç 1.mp4',fileName:'maç 1.mp4',videoUrl:'klipmedia://local/original',name:'Original',displayName:'',favorite:false,tags:[],mtime:1700000000000,size:12345,seconds:30,resolution:'1920x1080',fps:60,game:'Quake Live'};
 const h={clips:[source],openedClip:{...source},selectedId:source.id,activeMediaId:source.id,page:'editor',trimStart:3,trimEnd:17,video:{pause(){}},editorAudio:{enhancements:{ready:()=>audioReady}},selected:()=>h.clips.find(clip=>clip.id===h.selectedId),precise:value=>String(value),folderPath:()=> 'C:\\Türkçe Klipler',renderExportAudio(){},notify(message){throw Error(message);},exportUI:{prepare:(clip,range)=>prepared.push({clip,range})},$:id=>{if(!elements.has(id))elements.set(id,{showModal:()=>dialogs++});return elements.get(id);}};
 vm.createContext(h);vm.runInContext(productionFunction('prepareExport'),h);const applyMetadata=vm.runInContext('('+metadataCallback()+')',h);
 return{h,source,finishAudio,applyMetadata,prepared,dialogCount:()=>dialogs};
}

test('a pending metadata reply preserves an export waiting for editor audio and keeps its original media source',async()=>{
 const f=harness(),opened=f.h.openedClip,pending=f.h.prepareExport();assert.equal(f.dialogCount(),0,'export waits for editor audio');
 f.applyMetadata([{...f.source,name:'İyi Vuruş 🎯',displayName:'İyi Vuruş 🎯',favorite:true,tags:['Turnuva']}]);f.finishAudio();await pending;
 assert.equal(f.dialogCount(),1,'metadata completion must not silently cancel export preparation');assert.equal(f.prepared.length,1);assert.equal(f.prepared[0].clip,opened);assert.equal(f.prepared[0].clip.name,'İyi Vuruş 🎯');assert.equal(f.prepared[0].clip.favorite,true);assert.deepEqual(f.prepared[0].clip.tags,['Turnuva']);assert.equal(f.h.$('sk-export-name').value,'İyi Vuruş 🎯-kesit.mp4');assert.equal(f.prepared[0].range.start,3);assert.equal(f.prepared[0].range.end,17);
 assert.equal(opened.file,'C:\\Türkçe Klipler\\maç 1.mp4');assert.equal(opened.fileName,'maç 1.mp4');assert.equal(opened.videoUrl,'klipmedia://local/original');assert.equal(opened.mtime,1700000000000);assert.equal(opened.size,12345);
});

test('leaving the editor while audio is loading still cancels the pending export',async()=>{
 const f=harness(),pending=f.h.prepareExport();f.h.page='clips';f.applyMetadata([{...f.source,favorite:true}]);f.finishAudio();await pending;assert.equal(f.dialogCount(),0);assert.equal(f.prepared.length,0);
});

test('opening a different clip while audio is loading still cancels the pending export',async()=>{
 const f=harness(),pending=f.h.prepareExport();f.h.activeMediaId='clip-b';f.h.selectedId='clip-b';f.h.openedClip={...f.source,id:'clip-b',file:'C:\\Clips\\second.mp4'};f.applyMetadata([{...f.source,favorite:true},f.h.openedClip]);f.finishAudio();await pending;assert.equal(f.dialogCount(),0);assert.equal(f.prepared.length,0);
});

test('reopening a replaced source at the same clip path still cancels the previous export request',async()=>{
 const f=harness(),pending=f.h.prepareExport();f.h.openedClip={...f.source,mtime:1700000001000,size:54321,videoUrl:'klipmedia://local/replacement'};f.applyMetadata([{...f.h.openedClip,favorite:true}]);f.finishAudio();await pending;assert.equal(f.dialogCount(),0);assert.equal(f.prepared.length,0);
});
