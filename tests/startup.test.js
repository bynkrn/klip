const {test}=require('node:test'),assert=require('node:assert/strict');
const {loginSettings,shouldStartHidden,reconcileStartup}=require('../src/startup');
test('Login registration identifies automatic launches explicitly',()=>{const s=loginSettings({launch:true},'C:/Klip/Klip.exe');assert.equal(s.openAtLogin,true);assert.equal(s.path,'C:/Klip/Klip.exe');assert.deepEqual(s.args,['--startup']);});
test('Only enabled automatic login launch is hidden',()=>{assert.equal(shouldStartHidden({launch:true,launchMinimized:true},['Klip.exe','--startup']),true);for(const settings of [{launch:false,launchMinimized:true},{launch:true,launchMinimized:false},{launch:false,launchMinimized:false}])assert.equal(shouldStartHidden(settings,['Klip.exe','--startup']),false);});
test('Manual launch stays visible even when startup tray preference is enabled',()=>{assert.equal(shouldStartHidden({launch:true,launchMinimized:true},['Klip.exe']),false);});

// Only Electron's external registry mutation is replaced; reconciliation reads
// back the resulting registry state, including removal and write failures.
function startupFixture(entries=[],{packaged=true,ignoreWrites=false}={}){
 const registry=new Map(entries.map(entry=>[entry.name,{...entry}])),writes=[];
 const app={isPackaged:packaged,setLoginItemSettings(value){
  writes.push(value);if(ignoreWrites)return;
  if(!value.openAtLogin){registry.delete(value.name);return;}
  registry.set(value.name,{name:value.name,command:`"${value.path}" ${value.args.join(' ')}`,approval:null});
 }};
 return{registry,writes,options:{app,settings:{launch:true},platform:'win32',executable:'C:\\Apps\\Ember\\Ember.exe',readState:async()=>[...registry.values()].map(entry=>({...entry}))}};
}
test('Saved enabled preference repairs a missing Windows login entry and is idempotent',async()=>{
 assert.equal(typeof reconcileStartup,'function');
 const fixture=startupFixture();
 assert.equal((await reconcileStartup(fixture.options)).status,'enabled');
 assert.equal(fixture.registry.get('Ember').command,'"C:\\Apps\\Ember\\Ember.exe" --startup');
 assert.equal((await reconcileStartup(fixture.options)).status,'enabled');
 assert.equal(fixture.writes.length,1);
});
test('Moving the packaged executable updates login launch to the current stable path',async()=>{
 const fixture=startupFixture([{name:'Ember',command:'"C:\\Old\\Ember.exe" --startup',approval:null}]);
 assert.equal((await reconcileStartup(fixture.options)).status,'enabled');
 assert.equal(fixture.registry.get('Ember').command,'"C:\\Apps\\Ember\\Ember.exe" --startup');
});
test('Brand migration removes old login entries only after Ember registration succeeds',async()=>{
 const fixture=startupFixture([{name:'Klip.Local',command:'"C:\\Old\\Klip.exe"',approval:null},{name:'Unrelated',command:'other.exe',approval:null}]);
 assert.equal((await reconcileStartup(fixture.options)).status,'enabled');
 assert.equal(fixture.registry.has('Klip.Local'),false);assert.equal(fixture.registry.has('Unrelated'),true);
 assert.equal(fixture.writes[0].name,'Ember');
 const denied=startupFixture([{name:'Klip.Local',command:'old.exe',approval:null}],{ignoreWrites:true});
 assert.equal((await reconcileStartup(denied.options)).status,'error');assert.equal(denied.registry.has('Klip.Local'),true);
});
test('Disabled app preference removes its current and legacy launch registrations',async()=>{
 const fixture=startupFixture([{name:'Ember',command:'new.exe',approval:null},{name:'Klip.Local',command:'old.exe',approval:null}]);
 fixture.options.settings.launch=false;
 assert.equal((await reconcileStartup(fixture.options)).status,'disabled');assert.equal(fixture.registry.size,0);
 await reconcileStartup(fixture.options);assert.equal(fixture.writes.length,2);
});
test('Windows explicit startup disable survives reconciliation including orphaned legacy approval',async()=>{
 for(const entry of [{name:'Ember',command:'old.exe',approval:'AwAAAAAAAAAAAAAA'},{name:'Klip.Local',command:null,approval:'AwAAAAAAAAAAAAAA'}]){
  const fixture=startupFixture([entry]);const result=await reconcileStartup(fixture.options);
  assert.equal(result.status,'os-disabled');assert.deepEqual(result.names,[entry.name]);assert.equal(fixture.writes.length,0);
 }
});
test('Development Electron never registers itself as the login executable',async()=>{
 const fixture=startupFixture([],{packaged:false});assert.equal((await reconcileStartup(fixture.options)).status,'unpackaged');assert.equal(fixture.writes.length,0);
});
test('Unavailable registry state reports failure without changing login policy',async()=>{
 const fixture=startupFixture();fixture.options.readState=async()=>{throw new Error('Access denied');};
 const result=await reconcileStartup(fixture.options);assert.equal(result.status,'error');assert.match(result.message,/Access denied/);assert.equal(fixture.writes.length,0);
});
test('Existing enabled registration handles spaces, Unicode and Windows path casing without rewriting',async()=>{
 const fixture=startupFixture([{name:'Ember',command:'"c:\\users\\örnek kullanıcı\\Ember.exe" --startup',approval:'AgAAAAAAAAAAAAAA'}]);
 fixture.options.executable='C:\\Users\\Örnek Kullanıcı\\Ember.exe';
 assert.equal((await reconcileStartup(fixture.options)).status,'enabled');assert.equal(fixture.writes.length,0);
});
test('Missing startup marker is repaired so only a login launch can hide the window',async()=>{
 const fixture=startupFixture([{name:'Ember',command:'"C:\\Apps\\Ember\\Ember.exe"',approval:null}]);
 assert.equal((await reconcileStartup(fixture.options)).status,'enabled');assert.match(fixture.registry.get('Ember').command,/ --startup$/);
});
test('Failed legacy deletion is reported even when the replacement is registered',async()=>{
 const fixture=startupFixture([{name:'Klip.Local',command:'old.exe',approval:null}]);
 const write=fixture.options.app.setLoginItemSettings;fixture.options.app.setLoginItemSettings=value=>{if(value.openAtLogin)write(value);};
 assert.equal((await reconcileStartup(fixture.options)).status,'error');assert.equal(fixture.registry.has('Ember'),true);assert.equal(fixture.registry.has('Klip.Local'),true);
});
