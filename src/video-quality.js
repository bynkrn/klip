// Persist Mbps in app settings; conversion to kbps belongs at the encoder boundary.
function normalizeVideoQuality(config){
 const qualityMode=config?.qualityMode==='bitrate'?'bitrate':'quality';
 const selected=config?.videoBitrate;
 const videoBitrate=Number.isInteger(selected)&&selected>=5&&selected<=250?selected:60;
 return{qualityMode,videoBitrate};
}

module.exports={normalizeVideoQuality};
