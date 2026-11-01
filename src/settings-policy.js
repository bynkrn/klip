const {isDeepStrictEqual}=require('node:util');
const livePreferences=new Set(['language','launch','launchMinimized','autoBuffer','sound','hotkey','audioEnabled']);
function captureSettingsChanged(before,after){return Object.keys({...before,...after}).some(key=>!livePreferences.has(key)&&!isDeepStrictEqual(before[key],after[key]));}
module.exports={captureSettingsChanged};
