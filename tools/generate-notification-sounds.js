// Original, deterministic notification sounds. No external audio samples.
const fs=require('node:fs'),path=require('node:path');
const rate=48000,dir=path.resolve(__dirname,'../src/sounds');fs.mkdirSync(dir,{recursive:true});
function render(id,seconds,voices){
 const samples=new Float64Array(Math.ceil(seconds*rate));
 for(const voice of voices){const {start=0,duration,frequency,amp=1,decay=.06,kind='warm'}=voice;for(let n=0;n<duration*rate;n++){const t=n/rate,k=Math.round(start*rate)+n;if(k>=samples.length)break;const phase=kind==='pop'?2*Math.PI*(420*t+(frequency-420)*.025*(1-Math.exp(-t/.025))):2*Math.PI*frequency*t;
  const wave=kind==='glass'?Math.sin(phase)+.24*Math.sin(phase*2.76)*Math.exp(-t/.07):kind==='arcade'?Math.sin(phase)-Math.sin(3*phase)/9+Math.sin(5*phase)/25:Math.sin(phase)+.10*Math.sin(2*phase);
  const envelope=Math.min(1,t/.005)*Math.exp(-t/decay)*Math.min(1,(duration-t)/.012);samples[k]+=amp*wave*envelope;
 }}
 let peak=0;for(const sample of samples)peak=Math.max(peak,Math.abs(sample));const wave=Buffer.alloc(44+samples.length*2);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(rate,24);wave.writeUInt32LE(rate*2,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(samples.length*2,40);for(let n=0;n<samples.length;n++)wave.writeInt16LE(Math.round(samples[n]/peak*.58*32767),44+n*2);fs.writeFileSync(path.join(dir,id+'.wav'),wave);
}
render('ember',.40,[{frequency:659.255,duration:.20,decay:.05},{frequency:880,start:.105,duration:.24,decay:.065,amp:.9}]);
render('soft',.22,[{frequency:1250,duration:.20,decay:.035,kind:'pop'}]);
render('glass',.50,[{frequency:1318.51,duration:.48,decay:.115,kind:'glass'}]);
render('arcade',.30,[{frequency:783.99,duration:.08,decay:.07,kind:'arcade'},{frequency:1046.5,start:.07,duration:.08,decay:.07,kind:'arcade'},{frequency:1318.51,start:.14,duration:.14,decay:.06,kind:'arcade'}]);
console.log('Rendered four original notification WAVs.');
