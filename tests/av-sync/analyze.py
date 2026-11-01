"""Measure recorded visual/tone events; never infer sync from stream duration."""
import array,bisect,datetime,json,math,pathlib,statistics,subprocess,sys
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parent.parent
FFMPEG=ROOT/'tools/ffmpeg.exe'
FFPROBE=ROOT/'tools/ffprobe.exe'
def run(command):
    result=subprocess.run([str(x) for x in command],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode: raise RuntimeError(result.stderr.decode('utf8','replace'))
    return result.stdout
def probe(file,selector,entries):
    return json.loads(run([FFPROBE,'-v','error','-select_streams',selector,'-show_frames','-show_entries',entries,'-of','json',file]))['frames']
def groups(indices,max_gap=1):
    result=[]
    for i in indices:
        if not result or i-result[-1][-1]>max_gap: result.append([i])
        else: result[-1].append(i)
    return result
def summarize(values):
    return {'mean':statistics.mean(values),'median':statistics.median(values),'min':min(values),'max':max(values),'standardDeviation':statistics.pstdev(values)}
def main():
    folder=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path((HERE/'latest-run.txt').read_text().strip())
    recording=json.loads((folder/'recording.json').read_text());file=pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else pathlib.Path(recording['file']);marker=recording.get('intrinsicMarker',recording['probe']['marker']) if file.name.startswith('intrinsic-') else recording['probe']['marker'];audio_index=int(sys.argv[3]) if len(sys.argv)>3 else 1
    video_frames=probe(file,'v:0','frame=best_effort_timestamp_time')
    video_times=[float(frame['best_effort_timestamp_time']) for frame in video_frames]
    raw=run([FFMPEG,'-v','error','-i',file,'-map','0:v:0','-vf',f"crop=12:12:{marker['x']+2}:{marker['y']+2},format=gray",'-fps_mode','passthrough','-f','rawvideo','-'])
    pixels=144;assert len(raw)==pixels*len(video_times),(len(raw),len(video_times))
    brightness=[sum(raw[i:i+pixels])/pixels for i in range(0,len(raw),pixels)]
    video_groups=[g for g in groups([i for i,y in enumerate(brightness) if y>80]) if len(g)>=2]
    video_events=[video_times[g[0]] for g in video_groups]
    audio_frames=probe(file,f'a:{audio_index}','frame=best_effort_timestamp_time,nb_samples')
    audio=array.array('f',run([FFMPEG,'-v','error','-i',file,'-map',f'0:a:{audio_index}','-ac','1','-ar','48000','-f','f32le','-']))
    if sys.byteorder!='little': audio.byteswap()
    offsets=[0]
    for frame in audio_frames: offsets.append(offsets[-1]+int(frame['nb_samples']))
    assert offsets[-1]==len(audio),(offsets[-1],len(audio))
    def audio_time(sample):
        frame=min(len(audio_frames)-1,bisect.bisect_right(offsets,sample)-1)
        return float(audio_frames[frame]['best_effort_timestamp_time'])+(sample-offsets[frame])/48000
    # One cycle of 1000 Hz per 1 ms block: quadrature (Goertzel-equivalent) amplitude.
    size=48;cosine=[math.cos(2*math.pi*1000*i/48000) for i in range(size)];sine=[math.sin(2*math.pi*1000*i/48000) for i in range(size)]
    amplitudes=[]
    for start in range(0,len(audio)-size+1,size):
        real=sum(audio[start+i]*cosine[i] for i in range(size));imag=sum(audio[start+i]*sine[i] for i in range(size))
        amplitudes.append(2*math.hypot(real,imag)/size)
    threshold=0.0002 if recording.get('sourceVolume')==0.1 and not file.name.startswith('intrinsic-') else 0.002
    audio_groups=[g for g in groups([i for i,a in enumerate(amplitudes) if a>threshold],max_gap=20 if recording.get('sourceChirp') else 3) if len(g)>=20]
    audio_events=[audio_time(g[0]*size) for g in audio_groups]
    excluded_edges={'video':[],'audio':[]}
    if recording.get('baseline'):
        # Capture can begin halfway through the file source's t=0 pulse.
        excluded_edges={'video':[t for t in video_events if t<0.5],'audio':[t for t in audio_events if t<0.5]}
        video_events=[t for t in video_events if t>=0.5];audio_events=[t for t in audio_events if t>=0.5]
        if video_events and audio_events:
            # A paused player can already show the t=0 orange frame before audio starts.
            edge_audio=[t for t in audio_events if t<video_events[0]-0.5 or t>video_events[-1]+0.5]
            excluded_edges['audio'].extend(edge_audio);audio_events=[t for t in audio_events if t not in edge_audio]
    assert video_events and audio_events,'No complete marker/tone event found'
    logs=[json.loads(line) for line in (folder/'probe.jsonl').read_text().splitlines() if line.strip()]
    paints={event['index']:event for event in logs if event['event']=='paint'}
    run_start=datetime.datetime.strptime(folder.name,'%Y-%m-%dT%H-%M-%S-%fZ').replace(tzinfo=datetime.timezone.utc)
    capture_start=datetime.datetime.fromisoformat(recording['started'].replace('Z','+00:00'))
    start_delay=(capture_start-run_start).total_seconds()
    pairs=[]
    for visual in video_events:
        candidates=[(abs(sound-visual),sound) for sound in audio_events if abs(sound-visual)<0.5]
        if not candidates: continue
        _,sound=min(candidates);index=round((start_delay+sound-recording['probe'].get('firstPulseSeconds',4))/recording['probe'].get('periodSeconds',5));paint=paints.get(index)
        offset=(sound-visual)*1000
        pairs.append({'index':index,'videoSeconds':visual,'audioSeconds':sound,'audioMinusVideoMs':offset,'probePaintLatenessMs':paint['paintLatenessMs'] if paint else None,'paintSchedulingCorrectedMs':offset+paint['paintLatenessMs'] if paint else None})
    assert len(pairs)==len(video_events)==len(audio_events),f'Unpaired/missing A/V marker events: video={video_events}, audio={audio_events}'
    offsets_ms=[pair['audioMinusVideoMs'] for pair in pairs]
    times=[pair['videoSeconds'] for pair in pairs];mean_t=statistics.mean(times);mean_o=statistics.mean(offsets_ms)
    denominator=sum((t-mean_t)**2 for t in times);slope=sum((t-mean_t)*(offset-mean_o) for t,offset in zip(times,offsets_ms))/denominator if denominator else 0
    residuals=[offset-(mean_o+slope*(t-mean_t)) for t,offset in zip(times,offsets_ms)]
    paint_lateness=[p['probePaintLatenessMs'] for p in pairs if p['probePaintLatenessMs'] is not None]
    report={'recording':str(file),'recordedWallSeconds':recording['durationSeconds'],'decodedVideoSpanSeconds':video_times[-1]-video_times[0]+1/60,'eventCount':len(pairs),'eventCoverageSeconds':times[-1]-times[0],'first':pairs[0],'last':pairs[-1],'offsetMs':summarize(offsets_ms),'endMinusBeginningMs':offsets_ms[-1]-offsets_ms[0],'lastThreeMinusFirstThreeMedianMs':statistics.median(offsets_ms[-3:])-statistics.median(offsets_ms[:3]),'fittedDriftMsPerMinute':slope*60,'fittedDriftOverEventSpanMs':slope*(times[-1]-times[0]),'fittedClockDriftPpm':slope*1000,'maximumResidualJitterMs':max(abs(x) for x in residuals),'probePaintLatenessMs':summarize(paint_lateness) if paint_lateness else None,'videoMarkerYRange':[min(brightness),max(brightness)],'audioTonePeakAmplitude':max(amplitudes),'audioEventThreshold':0.002,'audioResolutionMs':1,'videoFrameIntervalMs':1000/60,'pairs':pairs,'limitations':['Negative audio-minus-video means audio leads the visible marker.','The marker follows IAudioClock device position; queued audio is not treated as if already played. Paint lateness is logged against correlated QPC.','Video detection is quantized to 16.67 ms and audio detection to 1 ms, with possible AAC onset smear.','Absolute offset includes DWM presentation/desktop capture and the difference between process-loopback timestamps and endpoint playback; those fixed offsets are not independently calibrated.','This tests the screen/probe-process audio path on the present machine; it does not establish every device, game, microphone or longer-run result.']}
    streams=json.loads(run([FFPROBE,'-v','error','-show_streams','-of','json',file]))['streams'];report['timestampEvidence']={'videoFirstDecodedPts':video_times[0],'audioFirstDecodedPts':float(audio_frames[0]['best_effort_timestamp_time']),'audioDecodedSampleCount':len(audio),'audioFrameSampleCount':offsets[-1],'streams':[{k:s[k] for k in ['index','codec_name','codec_type','start_time','time_base','initial_padding','has_b_frames'] if k in s} for s in streams]};report['audioTrack']=audio_index+1
    report['excludedPartialClipEdgeEvents']=excluded_edges
    report['audioEventThreshold']=threshold
    if recording.get('baseline'):report['timingSource']=recording['baseline'];report['limitations']=['Known media video and audio intrinsic PTS are measured separately.','Partial first-clip events and unmatched audio before the first observed marker transition are excluded explicitly; later complete events are retained.','This is actual desktop plus WASAPI capture of a separate media player.' if recording.get('sourceWindow') else 'This isolates media-source decoding, GPU composition, NVENC/AAC and replay output; it does not test screen capture or WASAPI/device timing.','Video event timing is quantized to 16.67 ms; audio to 1 ms plus AAC onset smear.']
    (folder/f'sync-report-{file.suffix[1:]}-track{audio_index+1}.json').write_text(json.dumps(report,indent=2),encoding='utf8');summary={k:v for k,v in report.items() if k not in ['pairs','timestampEvidence']};print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
