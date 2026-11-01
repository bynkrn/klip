const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
const file=process.argv[2],tools=path.join(__dirname,'../tools');
function run(exe,args){const r=spawnSync(path.join(tools,exe+'.exe'),args,{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout+r.stderr;}
const media=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));
const video=media.streams.find(s=>s.codec_type==='video'),audio=media.streams.filter(s=>s.codec_type==='audio');
assert.equal(video.width,1920);assert.equal(video.height,1080);assert.equal(audio.length,6);
const [n,d]=video.avg_frame_rate.split('/').map(Number),fps=n/d;
assert(Math.abs(fps-90)<.1||Math.abs(fps-60)<.1);
function volume(track){const log=run('ffmpeg',['-v','info','-i',file,'-map','0:a:'+track,'-af','volumedetect','-f','null','-']);return Number(log.match(/mean_volume: ([\-\d.]+) dB/)[1]);}
const mix=volume(0),game=volume(1),unusedMusic=volume(4);
assert(game>-50,'Test tone must exist on isolated game track');assert(unusedMusic<-80,'Unused music track must stay silent');
const check=run('ffmpeg',['-v','info','-i',file,'-vf','crop=100:1080:0:0,blackdetect=d=0.2:pix_th=0.05','-an','-f','null','-']);
assert(!check.includes('black_start:'),'Stretched 4:3 game must fill the left edge');
const result={file,width:video.width,height:video.height,fps,audioTracks:audio.length,mixDb:mix,isolatedGameDb:game,unusedMusicDb:unusedMusic,blackBars:false};
fs.writeFileSync(path.join(__dirname,'capture-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
