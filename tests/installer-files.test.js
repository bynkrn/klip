const test=require('node:test'),assert=require('node:assert/strict');
let manifest;try{manifest=require('../tools/installer/files');}catch{}
test('uninstall removes only packaged files and empty directories, preserving unrelated files',()=>{
 assert(manifest,'installer file manifest must be implemented');
 const script=manifest.uninstallScript(['Ember.exe','resources/app/src/main.js','tools/$file.txt','locales/tr.pak']);
 assert(script.includes('Delete "$INSTDIR\\Ember.exe"'));assert(script.includes('Delete "$INSTDIR\\tools\\$$file.txt"'));
 assert(!/RMDir\s+\/r/i.test(script));
 assert(script.indexOf('RMDir "$INSTDIR\\resources\\app\\src"')<script.indexOf('RMDir "$INSTDIR\\resources\\app"'));
 assert(!script.includes('settings.json'));assert(!script.includes('Videos'));assert(script.includes('Delete "$INSTDIR\\installation.ini"'));
});
test('uninstall manifest rejects absolute, traversal and line-injection paths',()=>{
 assert(manifest,'installer file manifest must be implemented');
 for(const bad of ['../secret','C:/Windows/system.ini','/root','a/../../b','a\nb.txt','a\\..\\b'])assert.throws(()=>manifest.uninstallScript([bad]));
});
