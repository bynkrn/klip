const test=require('node:test'),assert=require('node:assert/strict');let RecordingHealth;try{({RecordingHealth}=require('../src/recording-health'));}catch{}
function model(){assert(RecordingHealth,'recording health must be implemented');return new RecordingHealth();}
const capture=()=>({running:true,started:1000,config:{mode:'auto',fps:'60'},health:{outputActive:true,journalAcceptingPackets:true,lastVideoPacketAgeMs:30,encodedVideoFrames:120,retainedDurationSeconds:2},video:{wanted:false,health:new Map()}});
test('health distinguishes inactive, recovery, warming and a stale encoded video stream',()=>{
 const h=model(),c=capture();assert.equal(h.read(null,1100).state,'stopped');assert.equal(h.read(c,2000).state,'recording');c.health.lastVideoPacketAgeMs=4000;assert.equal(h.read(c,6000).state,'stalled');c.health.journalAcceptingPackets=false;assert.equal(h.read(c,6000).state,'recovery');c.running=false;c.recoveryRequired={keepAlive:true};assert.equal(h.read(c,6000).state,'recovery');
});
test('real transport delivery is distinguished from lifecycle-only window capture and static menus',()=>{
 const h=model(),c=capture();c.video={wanted:true,method:'game',gameId:1,health:new Map([[1,{transportObserved:true,frameSequence:'300',lastFrameAgeMs:20,sourceWidth:800,sourceHeight:600,hooked:true,hookStatusAvailable:true}]])};assert.equal(h.read(c,2000).state,'healthy');assert.equal(h.read(c,2000).verification,'delivery');
 c.video.health.get(1).lastFrameAgeMs=4000;assert.equal(h.read(c,6000).state,'stalled');c.health={...c.health};c.video.method='window';c.video.windowId=2;c.video.health.set(2,{sourceWidth:800,sourceHeight:600,freshnessCapability:'hook-lifecycle-only'});assert.equal(h.read(c,6000).state,'recording');assert.equal(h.read(c,6000).verification,'limited');
 c.video.health.get(2).suspended=true;assert.equal(h.read(c,6000).state,'suspended');
});
test('frame-rate estimates and new skipped-frame warnings reset for a new capture session',()=>{
 const h=model(),c=capture();c.health.skippedFrames=0;h.read(c,2000);c.health.encodedVideoFrames=180;c.health.skippedFrames=2;const sample=h.read(c,3000);assert.equal(sample.fps,60);assert.equal(sample.state,'dropped');
 c.started=4000;c.health.encodedVideoFrames=1;assert.equal(h.read(c,4100).fps,null);
});
test('native renderer lag increments warn without guessing from a low encoded FPS',()=>{const h=model(),c=capture();c.health.rendererLaggedFrames=4;h.read(c,2000);c.health.encodedVideoFrames=130;assert.equal(h.read(c,3000).state,'recording');c.health.rendererLaggedFrames=5;assert.equal(h.read(c,4000).state,'dropped');});
test('no video after startup grace and cached telemetry never become a false healthy status',()=>{
 const h=model(),c=capture();c.health.encodedVideoFrames=0;c.health.lastVideoPacketAgeMs=null;assert.equal(h.read(c,2000).state,'warming');assert.equal(h.read(c,7000).state,'stalled');
 c.started=8000;c.health={...c.health,encodedVideoFrames:60,lastVideoPacketAgeMs:10};c.healthObservedAt=9000;assert.equal(h.read(c,9000).state,'recording');assert.equal(h.read(c,14000).state,'stalled');
 c.healthObservedAt=15000;c.video={wanted:true,method:'game',gameId:1,health:new Map([[1,{transportObserved:true,frameSequence:'2',lastFrameAgeMs:10,observedAt:9000,sourceWidth:640,sourceHeight:480}]])};assert.equal(h.read(c,15000).state,'stalled');
});
test('target recreation without a source health entry is reported as renewing',()=>{const c=capture();c.video={wanted:true,gameId:1,method:'game',health:new Map()};assert.equal(model().read(c,2000).state,'renewing');});
