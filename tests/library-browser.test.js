const test=require('node:test'),assert=require('node:assert/strict');
const {filterClips,dateKey,dateLabel}=require('../src/library-browser-ui');
const now=new Date(2026,10,7,14,30).getTime();
const clips=[
 {id:'one',name:'İyi Vuruş',fileName:'original-01.mp4',game:'Quake Live',tags:['Anı','Turnuva'],favorite:true,seconds:60,mtime:now},
 {id:'two',name:'Eski Maç',fileName:'original-02.mp4',game:'Valorant',tags:['anı'],favorite:false,seconds:180,mtime:new Date(2026,10,6,23,59).getTime()},
 {id:'old',name:'Arşiv',fileName:'original-03.mp4',game:'Quake Live',tags:[],favorite:true,seconds:300,mtime:new Date(2026,8,3,12).getTime()}
];
test('search covers Turkish display names, original filenames, game names and tags without changing paths',()=>{
 for(const [query,ids] of [['iyi',['one']],['ORIGINAL-02',['two']],['quake',['one','old']],['TURNUVA',['one']],['arşiv',['old']]])assert.deepEqual(filterClips(clips,{query}).map(c=>c.id),ids);
 assert.equal(filterClips(clips,{query:'iyi'})[0],clips[0]);
});
test('favorite, tag, inclusive local dates and duration filters compose in both views',()=>{
 assert.deepEqual(filterClips(clips,{favorite:true,tag:'anı',from:'2026-11-07',to:'2026-11-07',min:60,max:60}).map(c=>c.id),['one']);
 assert.deepEqual(filterClips(clips,{to:'2026-11-06',min:180,max:300}).map(c=>c.id),['two','old']);
 assert.deepEqual(filterClips(clips,{from:'2026-11-08'}),[]);
 assert.deepEqual(filterClips(clips,{min:181}).map(c=>c.id),['old']);
});
test('old clips remain visible and use their actual local date',()=>{
 assert.equal(filterClips(clips,{}).length,3);assert.equal(dateKey(clips[2],now),'2026-09-03');
 assert.equal(dateLabel(clips[0],'tr',now),'Bugün');assert.equal(dateLabel(clips[1],'en',now),'Yesterday');
 assert.match(dateLabel(clips[2],'tr',now),/2026/);assert.notEqual(dateLabel(clips[2],'tr',now),'Dün');
});
test('missing and malformed optional metadata is harmless and invalid timestamp does not match date range',()=>{
 const clip={id:'none',name:'Default',seconds:0};assert.deepEqual(filterClips([clip],{}),[clip]);assert.deepEqual(filterClips([clip],{from:'2026-11-01'}),[]);
 assert.equal(dateKey({day:'today'},now),'2026-11-07');assert.equal(dateKey({mtime:NaN},now),'unknown');
});
