const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/ui-template.html'),'utf8');
function fixture(config){const played=[];class Audio{constructor(src){this.src=src;this.paused=false;}play(){played.push(this);return Promise.resolve();}pause(){this.paused=true;}}const context={config,window:{Audio}};vm.createContext(context);const begin=source.indexOf('  function chime('),end=source.indexOf('  function saveClip(',begin);assert(begin>=0&&end>begin);vm.runInContext(source.slice(begin,end),context);return{context,played};}
test('notification playback uses the chosen sound and an independent volume',()=>{const {context,played}=fixture({notificationSound:'glass',notificationVolume:85});context.chime();assert.equal(played.length,1);assert.equal(played[0].src,'sounds/glass.wav');assert.equal(played[0].volume,.85);context.config.notificationSound='ember';context.config.notificationVolume=40;context.chime();assert(played[0].paused);assert.equal(played[1].src,'sounds/ember.wav');assert.equal(played[1].volume,.4);});
test('zero notification volume stays silent and invalid preferences have safe defaults',()=>{const {context,played}=fixture({notificationSound:'soft',notificationVolume:0});context.chime();assert.equal(played.length,0);context.config.notificationVolume=NaN;context.config.notificationSound='../untrusted';context.chime();assert.equal(played[0].src,'sounds/ember.wav');assert.equal(played[0].volume,.75);});
test('the Medal option plays the original bundled cue',()=>{
 const {context,played}=fixture({notificationSound:'medal',notificationVolume:60});
 context.chime();
 assert.equal(played[0].src,'sounds/medal.wav');
 assert.equal(played[0].volume,.6);
 const cue=fs.readFileSync(path.join(__dirname,'../src',played[0].src));
 assert.equal(require('node:crypto').createHash('sha256').update(cue).digest('hex'),'11f5c8579bdeb0047f9f3db0185f9a6b437d021862dd8471157624b40540691d');
});
test('custom cue uses only the native opaque audio URL and keeps the independent volume',()=>{const {context,played}=fixture({notificationSound:'custom',notificationVolume:35,notificationCustom:{available:true,name:'Medal',url:'klipmedia://local/owned-cue'}});context.chime();assert.equal(played[0].src,'klipmedia://local/owned-cue');assert.equal(played[0].volume,.35);for(const url of ['file:///private.wav','https://example.com/private.wav','klipmedia://other/private']){context.config.notificationCustom.url=url;context.chime();assert.equal(played.at(-1).src,'sounds/ember.wav');}});
