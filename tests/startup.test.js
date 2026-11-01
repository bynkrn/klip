const {test}=require('node:test'),assert=require('node:assert/strict');
const {loginSettings,shouldStartHidden}=require('../src/startup');
test('Login registration identifies automatic launches explicitly',()=>{const s=loginSettings({launch:true},'C:/Klip/Klip.exe');assert.equal(s.openAtLogin,true);assert.equal(s.path,'C:/Klip/Klip.exe');assert.deepEqual(s.args,['--startup']);});
test('Only enabled automatic login launch is hidden',()=>{assert.equal(shouldStartHidden({launch:true,launchMinimized:true},['Klip.exe','--startup']),true);for(const settings of [{launch:false,launchMinimized:true},{launch:true,launchMinimized:false},{launch:false,launchMinimized:false}])assert.equal(shouldStartHidden(settings,['Klip.exe','--startup']),false);});
test('Manual launch stays visible even when startup tray preference is enabled',()=>{assert.equal(shouldStartHidden({launch:true,launchMinimized:true},['Klip.exe']),false);});
