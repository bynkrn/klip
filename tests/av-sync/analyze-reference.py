import json,pathlib,statistics,sys
HERE=pathlib.Path(__file__).resolve().parent
folder=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path((HERE/'latest-run.txt').read_text().strip())
logs=[json.loads(line) for line in (folder/'probe.jsonl').read_text().splitlines() if line.strip()];paints=[x for x in logs if x['event']=='paint']
packets=[json.loads(line) for line in (folder/'reference-packets.jsonl').read_text().splitlines() if line.strip()];rows=[]
for packet in packets:
 if packet.get('event')!='packet':continue
 for i,amplitude in enumerate(packet['toneAmplitudes']):rows.append((packet['qpc100ns']/1e7+i*.001,amplitude,(packet['readQpc100ns']-packet['qpc100ns'])/10000,packet['flags']))
groups=[]
for row in rows:
 if row[1]<=.002:continue
 if not groups or row[0]-groups[-1][-1][0]>.003:groups.append([row])
 else:groups[-1].append(row)
events=[g for g in groups if len(g)>=20];results=[]
for paint in paints:
 expected=paint['expectedAudioQpc100ns']/1e7;nearest=min(events,key=lambda g:abs(g[0][0]-expected))
 if abs(nearest[0][0]-expected)>.5:continue
 results.append({'index':paint['index'],'packetToneQpcSeconds':nearest[0][0],'expectedRenderToneQpcSeconds':expected,'paintQpcSeconds':paint['paintQpc100ns']/1e7,'packetToneMinusRenderClockMs':(nearest[0][0]-expected)*1000,'packetToneMinusPaintMs':(nearest[0][0]-paint['paintQpc100ns']/1e7)*1000,'packetDeliveryLagMs':nearest[0][2],'flags':nearest[0][3],'toneDurationMs':len(nearest)})
assert results,'No directly captured tone events matched probe clock'
report={'method':'Independent Windows ActivateAudioInterfaceAsync process-loopback -> IAudioCaptureClient.GetBuffer QPC + PCM tone onset; no libobs code','packetCount':sum(p.get('event')=='packet' for p in packets),'events':results,'medianPacketToneMinusPaintMs':statistics.median(x['packetToneMinusPaintMs'] for x in results),'medianPacketToneMinusRenderClockMs':statistics.median(x['packetToneMinusRenderClockMs'] for x in results),'readerMetadata':[p for p in packets if p.get('event')!='packet']}
(folder/'raw-packet-clock-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
