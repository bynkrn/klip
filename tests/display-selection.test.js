const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeDisplays,selectDisplay,reconcileDisplays}=require('../src/display-selection');
const primary={id:'\\\\?\\DISPLAY#PRIMARY',name:'Main',width:1920,height:1080,x:0,y:0,primary:true,available:true};
const second={id:'\\\\?\\DISPLAY#SECOND',name:'Side',width:1280,height:1024,x:-1280,y:0,primary:false,available:true};

test('a saved monitor uses its exact stable identity after display order changes',()=>{
 const selected=selectDisplay({monitorId:second.id},[second,primary]);
 assert.equal(selected.activeMonitorId,second.id);assert.equal(selected.fallback,false);
 assert.equal(selectDisplay({},[second,primary]).activeMonitorId,primary.id);
});
test('an unplugged saved monitor visibly falls back to primary without erasing the preference',()=>{
 const selected=selectDisplay({monitorId:second.id},[primary]);
 assert.equal(selected.requestedMonitorId,second.id);assert.equal(selected.activeMonitorId,primary.id);
 assert.equal(selected.fallback,true);assert.equal(selected.reason,'selected-monitor-unavailable');
 assert.equal(selectDisplay({monitorId:second.id},[primary,second]).activeMonitorId,second.id);
});
test('game following overrides the manual choice only when enabled and a game monitor is known',()=>{
 assert.equal(selectDisplay({monitorId:primary.id,followGameMonitor:true},[primary,second],second.id).activeMonitorId,second.id);
 assert.equal(selectDisplay({monitorId:primary.id,followGameMonitor:false},[primary,second],second.id).activeMonitorId,primary.id);
 assert.equal(selectDisplay({monitorId:second.id,followGameMonitor:true},[primary,second]).activeMonitorId,second.id);
 const removed=selectDisplay({followGameMonitor:true},[primary],second.id);
 assert.equal(removed.activeMonitorId,primary.id);assert.equal(removed.reason,'game-monitor-unavailable');assert.equal(removed.fallback,true);
});
test('disabled, dummy and malformed displays never become capture candidates',()=>{
 assert.deepEqual(normalizeDisplays([primary,{...second,available:false},{...second,id:'DUMMY'},{...second,id:'zero',width:0},primary]),[primary]);
 assert.throws(()=>normalizeDisplays({}),/display/i);
});
test('OBS availability is matched by exact device identity and disabled entries are excluded',()=>{
 const properties=[{itemName:'wrong: 1920x1080 @ 0,0',itemValue:second.id,itemEnabled:true},{itemName:'Primary',itemValue:primary.id,itemEnabled:false},{itemName:'Unknown',itemValue:'DUMMY',itemEnabled:true}];
 assert.deepEqual(reconcileDisplays([primary,second],properties),[second]);
 const selected=selectDisplay({},[second]);assert.equal(selected.activeMonitorId,'');assert.equal(selected.reason,'no-primary-display');
});
test('an empty enumeration never invents a monitor index',()=>{
 const selected=selectDisplay({monitorId:second.id},[]);assert.equal(selected.activeMonitorId,'');assert.equal(selected.reason,'no-displays');
});
