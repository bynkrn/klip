// NSIS calls this after compiling the version-specific uninstaller. Include it
// in the update ZIP so atomic app replacement retains Windows uninstall support.
const fs=require('node:fs');
const [source,destination]=process.argv.slice(2);
if(!source||!destination)throw new Error('Expected compiled uninstaller and runtime destination');
fs.copyFileSync(source,destination);
