// Uses packet delivery rather than pixel changes: a still menu is a valid recording.
class RecordingHealth {
 constructor(){this.session=null;this.previous=null;this.droppedUntil=0;}
 read(capture,now=Date.now()){
  const session=capture?.started;
  if(session!==this.session){this.session=session;this.previous=null;this.droppedUntil=0;this.healthSample=null;this.sourceSample=null;}
  const h=capture?.health||{},video=capture?.video;
  const sourceId=video?.method==='window'?video.windowId:video?.gameId;
  const source=video?.wanted?video.health?.get(sourceId):null;
  if(!this.healthSample||this.healthSample.value!==h)this.healthSample={value:h,time:now};
  if(!this.sourceSample||this.sourceSample.value!==source)this.sourceSample={value:source,time:now};
  const sampleAge=Math.max(0,now-(capture?.healthObservedAt>0?capture.healthObservedAt:this.healthSample.time));
  const sourceSampleAge=Math.max(0,now-(Number.isFinite(source?.observedAt)?source.observedAt:this.sourceSample.time));
  const age=(value,elapsed)=>Number.isFinite(value)&&value>=0?value+elapsed:null;
  let fps=null;const count=Number(h.encodedVideoFrames),skipped=Number(h.skippedFrames??h.rendererLaggedFrames);
  if(capture?.running&&Number.isFinite(count)){
   if(this.previous&&now-this.previous.time>=250){const elapsed=(now-this.previous.time)/1000,delta=count-this.previous.count;if(delta>=0)fps=Math.round(delta/elapsed*10)/10;if(Number.isFinite(skipped)&&skipped>this.previous.skipped)this.droppedUntil=now+4000;}
   if(!this.previous||now-this.previous.time>=250)this.previous={time:now,count,skipped:Number.isFinite(skipped)?skipped:0};
  }
  const verification=source?.transportObserved===true?'delivery':'limited';
  const result={state:'stopped',verification,fps,videoPacketAgeMs:age(h.lastVideoPacketAgeMs,sampleAge),sourceFrameAgeMs:age(source?.lastFrameAgeMs,sourceSampleAge),method:video?.wanted?(video.method||'game'):'display',checkpointAgeMs:age(h.lastCheckpointAgeMs,sampleAge),crashRecoveryAvailable:h.crashRecoveryAvailable===true,checkpointError:typeof h.checkpointError==='string'?h.checkpointError:'',storage:capture?.config?.storage||h.storage||'disk'};
  if(capture?.recoveryRequired?.keepAlive||capture?.running&&h.journalAcceptingPackets===false){result.state='recovery';return result;}
  if(!capture?.running)return result;
  if(source?.suspended){result.state='suspended';return result;}
  const elapsed=now-Number(capture.started||now),warming=elapsed<5000&&!count;
  if(warming){result.state='warming';return result;}
  if(h.outputActive===false||!count||result.videoPacketAgeMs===null||result.videoPacketAgeMs>3000||sampleAge>3000||source?.transportObserved===true&&(result.sourceFrameAgeMs===null||result.sourceFrameAgeMs>3000||!(Number(source.frameSequence)>0))){result.state='stalled';return result;}
  if(video?.probing||video?.pendingTarget||video?.wanted&&(video.resumeFrameAfter!=null||!source||sourceSampleAge>3000||!(source.sourceWidth>0&&source.sourceHeight>0)||source.hookStatusAvailable&&!source.hooked)){result.state='renewing';return result;}
  if(now<this.droppedUntil){result.state='dropped';return result;}
  result.state=verification==='delivery'?'healthy':'recording';return result;
 }
}
module.exports={RecordingHealth};
