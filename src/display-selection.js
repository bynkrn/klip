const path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile);

function normalizeDisplays(displays){
 if(!Array.isArray(displays))throw new Error('Invalid display enumeration.');
 const seen=new Set(),result=[];
 for(const display of displays){
  if(!display||typeof display.id!=='string'||!display.id||display.id==='DUMMY'||display.available===false||seen.has(display.id))continue;
  if(![display.width,display.height].every(n=>Number.isInteger(n)&&n>0)||![display.x,display.y].every(Number.isInteger))continue;
  seen.add(display.id);result.push({id:display.id,name:typeof display.name==='string'&&display.name.trim()?display.name:display.id,width:display.width,height:display.height,x:display.x,y:display.y,primary:display.primary===true,available:true});
 }
 return result;
}
function reconcileDisplays(displays,properties){
 const ids=new Set((properties||[]).filter(item=>item.itemEnabled!==false&&typeof item.itemValue==='string'&&item.itemValue!=='DUMMY').map(item=>item.itemValue));
 return normalizeDisplays(displays).filter(display=>ids.has(display.id));
}
function selectDisplay(config={},displays=[],gameMonitorId=''){
 const requestedMonitorId=config.monitorId||'',followGameMonitor=config.followGameMonitor===true;
 const desired=followGameMonitor&&gameMonitorId?gameMonitorId:requestedMonitorId;
 const selected=desired&&displays.find(display=>display.id===desired),primary=displays.find(display=>display.primary);
 const active=selected||primary;
 const reason=!displays.length?'no-displays':!active?'no-primary-display':selected?(followGameMonitor&&gameMonitorId?'game-monitor':'selected-monitor'):desired?(followGameMonitor&&gameMonitorId?'game-monitor-unavailable':'selected-monitor-unavailable'):'primary';
 return{requestedMonitorId,activeMonitorId:active?.id||'',followGameMonitor,gameMonitorId:gameMonitorId||'',fallback:!active||!!desired&&!selected,reason};
}
async function enumerateDisplays(){
 const {stdout}=await run(path.join(__dirname,'../tools/window-watcher.exe'),['--list-displays'],{windowsHide:true,timeout:5000,maxBuffer:1024*1024,encoding:'utf8'});
 return normalizeDisplays(JSON.parse(stdout.replace(/^\uFEFF/,'')));
}
module.exports={normalizeDisplays,reconcileDisplays,selectDisplay,enumerateDisplays};
