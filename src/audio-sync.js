function resolveAudioSync(profile,device){
 const none={matched:false,systemOffsetMs:0,processOffsetMs:0};
 if(!profile||profile.schema!==1||!device||typeof profile.endpointId!=='string'||typeof device.endpointId!=='string'||profile.endpointId.toLowerCase()!==device.endpointId.toLowerCase()||profile.sampleRate!==device.sampleRate||profile.channels!==device.channels)return none;
 for(const key of ['systemOffsetMs','processOffsetMs'])if(typeof profile[key]!=='number'||!Number.isFinite(profile[key])||Math.abs(profile[key])>2000)return none;
 return{matched:true,systemOffsetMs:profile.systemOffsetMs,processOffsetMs:profile.processOffsetMs};
}
function inputSyncOffset(kind,offsets){return kind==='wasapi_output_capture'?offsets.systemOffsetMs:kind==='wasapi_process_output_capture'?offsets.processOffsetMs:0;}
module.exports={resolveAudioSync,inputSyncOffset};
