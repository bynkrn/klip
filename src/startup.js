const STARTUP_ARG='--startup';
function loginSettings(settings,executable){return{openAtLogin:settings.launch,path:executable,args:[STARTUP_ARG]};}
function shouldStartHidden(settings,argv){return !!(settings.launch&&settings.launchMinimized&&argv.includes(STARTUP_ARG));}
module.exports={STARTUP_ARG,loginSettings,shouldStartHidden};
