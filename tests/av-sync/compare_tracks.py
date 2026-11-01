"""Compare mixed system audio against the isolated pulse via local matched filtering."""
import array,json,math,pathlib,statistics,sys
import analyze as a
folder=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path((a.HERE/'latest-run.txt').read_text().strip())
metadata=json.loads((folder/'recording.json').read_text());file=pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else pathlib.Path(metadata['file']);report=json.loads((folder/f'sync-report-{file.suffix[1:]}-track2.json').read_text())
def decode(index):
    frames=a.probe(file,f'a:{index}','frame=best_effort_timestamp_time,nb_samples');first=float(frames[0]['best_effort_timestamp_time'])
    band=['-af','highpass=f=1400,lowpass=f=3100'] if metadata.get('sourceChirp') else []
    pcm=array.array('f',a.run([a.FFMPEG,'-v','error','-i',file,'-map',f'0:a:{index}',*band,'-ac','1','-ar','12000','-f','f32le','-']))
    if sys.byteorder!='little':pcm.byteswap()
    return first,pcm
system_start,system=decode(0);process_start,process=decode(1);rate=12000;results=[];energy_prefix=[0.0]
for sample in system:energy_prefix.append(energy_prefix[-1]+sample*sample)
for event in report['pairs']:
    center=event['audioSeconds'];reference_time=center-0.010;reference_begin=round((reference_time-process_start)*rate);reference=process[reference_begin:reference_begin+1080];reference_energy=sum(x*x for x in reference)
    scores=[]
    # Integer-millisecond steps alias a 1 kHz carrier and can miss a chirp's
    # fractional-delay correlation peak. Search every decoded PCM sample.
    for lag_samples in range(-3600,3601):
        begin=round((reference_time-system_start)*rate)+lag_samples
        if begin<0 or begin+len(reference)>len(system):continue
        segment=system[begin:begin+len(reference)];energy=energy_prefix[begin+len(reference)]-energy_prefix[begin];dot=sum(x*y for x,y in zip(reference,segment));score=abs(dot)/math.sqrt(reference_energy*energy) if energy else 0;scores.append((score,lag_samples*1000/rate))
    score,lag=max(scores);system_event=center+lag/1000;results.append({'index':event['index'],'visualSeconds':event['videoSeconds'],'processSeconds':center,'systemSeconds':system_event,'systemMinusProcessMs':lag,'systemMinusVideoMs':(system_event-event['videoSeconds'])*1000,'normalizedCorrelation':score,'localSearchMs':[-300,300]})
result={'recording':str(file),'method':'90ms isolated-pulse PCM reference, 12kHz signed matched filter over +-300ms at one PCM sample (0.0833ms) lag steps; absolute correlation permits endpoint phase inversion','comparisonFilter':'Identical 1400 Hz high-pass and 3100 Hz low-pass on both decoded tracks' if metadata.get('sourceChirp') else None,'events':results,'medianSystemMinusProcessMs':statistics.median(e['systemMinusProcessMs'] for e in results),'medianSystemMinusVideoMs':statistics.median(e['systemMinusVideoMs'] for e in results),'minimumCorrelation':min(e['normalizedCorrelation'] for e in results),'limitation':'Mixed track includes unrelated desktop audio; low normalized correlation makes this comparison inconclusive.'}
(folder/('track-comparison-'+file.suffix[1:]+'.json' if len(sys.argv)>2 else 'track-comparison.json')).write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
