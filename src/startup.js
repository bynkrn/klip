const STARTUP_ARG='--startup';
const STARTUP_NAME='Ember',STARTUP_NAMES=[STARTUP_NAME,'Ember.Local','Klip','Klip.Local'];
function loginSettings(settings,executable){return{openAtLogin:settings.launch,path:executable,args:[STARTUP_ARG],name:STARTUP_NAME};}
function shouldStartHidden(settings,argv){return !!(settings.launch&&settings.launchMinimized&&argv.includes(STARTUP_ARG));}

// Electron's lookup only returns entries matching the current executable. Read
// our named entries directly so moved installs and orphaned Windows disable
// decisions survive reconciliation. This script only reads HKCU registry keys.
const READ_STARTUP_SCRIPT=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$root=[Microsoft.Win32.Registry]::CurrentUser
$run=$root.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run')
$approved=$root.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run')
try {
 $items=@(foreach($name in @('Ember','Ember.Local','Klip','Klip.Local')) {
  $command=if($run){$run.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)}else{$null}
  $value=$null
  if($approved){$value=$approved.GetValue($name)}
  if($null -ne $command -or $null -ne $value) {
   if($null -ne $value -and $value -isnot [byte[]]){throw "Invalid startup approval value: $name"}
   [pscustomobject]@{name=$name;command=$command;approval=$(if($null -ne $value){[Convert]::ToBase64String($value)}else{$null})}
  }
 })
 ConvertTo-Json -InputObject $items -Compress
} finally {if($run){$run.Dispose()};if($approved){$approved.Dispose()}}
`;
async function readWindowsStartup(){
 const {promisify}=require('node:util'),{execFile}=require('node:child_process'),path=require('node:path');
 const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const {stdout}=await promisify(execFile)(powershell,['-NoLogo','-NoProfile','-NonInteractive','-Command',READ_STARTUP_SCRIPT],{windowsHide:true,timeout:10000,maxBuffer:65536,encoding:'utf8'});
 const entries=JSON.parse(stdout.replace(/^\uFEFF/,''));
 if(!Array.isArray(entries))throw new Error('Invalid Windows startup registry response');
 return entries;
}
function managedEntries(entries){return entries.filter(entry=>STARTUP_NAMES.some(name=>name.toLowerCase()===entry.name.toLowerCase()));}
function approvalDisabled(entry){
 if(entry.approval==null)return false;
 const bytes=Buffer.from(entry.approval,'base64');
 // Match Electron's accepted StartupApproved states; unknown values remain
 // blocked, never silently converted into permission to start at login.
 return bytes.length<4||![0,2].includes(bytes.readUInt32LE(0));
}
function matchesCommand(command,executable){
 const match=/^(?:"([^"]+)"|(\S+))\s+--startup\s*$/.exec(command||'');
 const normalize=value=>require('node:path').win32.normalize(value).toLowerCase();
 return !!match&&normalize(match[1]||match[2])===normalize(executable);
}

/** Reconcile on ready after settings load, and on launch preference changes.
 * The packaged executable is the updater's stable in-place app path. Never
 * register development Electron or a helper/temporary update executable.
 * Returns enabled/disabled/os-disabled/unpackaged/unsupported/error; failures
 * are reported for the UI without preventing the app itself from opening.
 */
async function reconcileStartup({app,settings,executable=process.execPath,platform=process.platform,readState=readWindowsStartup}){
 if(platform!=='win32')return{status:'unsupported'};
 if(!app.isPackaged)return{status:'unpackaged'};
 try{
  let entries=managedEntries(await readState());
  if(!settings.launch){
   for(const entry of entries)app.setLoginItemSettings({...loginSettings(settings,executable),openAtLogin:false,name:entry.name});
   if(managedEntries(await readState()).length)throw new Error('Windows startup registration could not be removed');
   return{status:'disabled'};
  }
  const blocked=entries.filter(approvalDisabled);
  if(blocked.length)return{status:'os-disabled',names:blocked.map(entry=>entry.name)};
  const current=entries.find(entry=>entry.name.toLowerCase()===STARTUP_NAME.toLowerCase());
  if(!current||!matchesCommand(current.command,executable)){
   app.setLoginItemSettings(loginSettings(settings,executable));
   entries=managedEntries(await readState());
   const registered=entries.find(entry=>entry.name.toLowerCase()===STARTUP_NAME.toLowerCase());
   if(!registered||!matchesCommand(registered.command,executable)||approvalDisabled(registered))throw new Error('Windows startup registration could not be verified');
  }
  // Register and verify the replacement before removing old brand names.
  for(const entry of entries)if(entry.name.toLowerCase()!==STARTUP_NAME.toLowerCase())app.setLoginItemSettings({...loginSettings(settings,executable),openAtLogin:false,name:entry.name});
  const remaining=managedEntries(await readState());
  if(remaining.length!==1||!matchesCommand(remaining[0].command,executable)||approvalDisabled(remaining[0]))throw new Error('Windows startup migration could not be verified');
  return{status:'enabled'};
 }catch(error){return{status:'error',message:error.message};}
}
module.exports={STARTUP_ARG,STARTUP_NAME,loginSettings,shouldStartHidden,readWindowsStartup,reconcileStartup};
