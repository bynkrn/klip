const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),template=fs.readFileSync(path.join(root,'src/ui-template.html'),'utf8');
let s=template;
const replace=(a,b,text)=>{const start=s.indexOf(a),end=s.indexOf(b,start+a.length);if(start<0||end<0)throw new Error('UI bölümü bulunamadı: '+a);s=s.slice(0,start)+text+'\n  '+s.slice(end);};
s=s.replace('__SUNSET_ASSETS__',JSON.stringify({thumbs:[],video:'',poster:''})).replace('(() => {','(async () => {\n  const initial=await window.klip.call("init");\n  let lastNativeSettings=JSON.stringify(initial.settings),lastGood={...initial.settings};');
s=s.replace('let config={...defaults};','let config={...defaults,...initial.settings};');
s=s.replace('let config={...defaults,...initial.settings};','let config={...defaults,...initial.settings};let nativeAudio=[],nativeCaptureHealth=null,nativeSaveWarnings=[];');
s=s.replace(/  let clips=names\.map\([^\n]+/,'  let clips=initial.clips;');
s=s.replace("const gameFor=clip=>games.includes(clip?.game)?clip.game:(Number(clip?.thumb)||0)<12?games[0]:(Number(clip?.thumb)||0)<20?games[1]:games[2];","const gameFor=clip=>clip?.game||'Masaüstü';");
s=s.replace("const games=['Counter-Strike 2','Valorant','Quake Live'];","const games=[...new Set(['Masaüstü','Counter-Strike 2','Valorant','Quake Live',...initial.clips.map(c=>c.game)])];");
s=s.replace("selectedId=clips[2].id","selectedId=clips[0]?.id||''");
s=s.replaceAll("assets.thumbs[clip.thumb%assets.thumbs.length]","clip.thumbnail||''");
s=s.replaceAll("selected().name","selected()?.name||'Klip izleme'");
s=s.replace('&&combo===config.hotkey','&&false&&combo===config.hotkey');
s=s.replace(/  setInterval\(\(\)=>\{if\(running&&root\.isConnected\)[^\n]+\n/,'');
s=s.replaceAll('max="1000"','max="360"');

s=s.replace(/<label class="sk-check"><input type="checkbox" data-setting="holdFrame">[\s\S]*?<\/label>/,'');
s=s.replace('<option value="h265">HEVC / H.265</option>','').replace('<option value="av1">AV1</option>','');
s=s.replace('<h2>Kaynak ve tampon</h2>','<h2>Kaynak ve tampon</h2><label class="sk-field"><span>Oyun dosyası adı (boşsa otomatik)</span><input type="text" data-setting="targetExe" aria-label="Hedef oyun" placeholder="ornek-oyun.exe"></label>');
s=s.replace('Arayüz prototipi · Örnek klipler','Yerel kayıt · NVIDIA NVENC');
s=s.replace('Arayüz prototipi:','').replace('Yeni kopya oluşturulur; orijinal klip korunur. Prototip yalnızca örnek kesiti kütüphaneye ekler, diske dosya yazmaz.','Yeni dosya oluşturulur. Orijinal klibin üzerine yazılmaz.');
s=s.replace('Bu ekrandaki uygulamalar örnektir. Prototip, çalışan uygulamaları veya seslerini taramaz.','Klipte ses üreten uygulamalar otomatik olarak ayrı izlere eklenir.');
replace('function persist(){','function notify(',`async function persist(){
    localStorage.setItem('klip-ui',JSON.stringify({view,gameFolder,settingsTab}));
    const next=JSON.stringify(config);if(next===lastNativeSettings)return;
    try{config=await window.klip.call('settings',config);lastGood={...config};lastNativeSettings=JSON.stringify(config);}
    catch(e){config={...lastGood};renderConfig();notify(e.message);}
  }`);
replace('function showExplorer(','function libraryClips(',`function showExplorer(clip=selected()){if(clip)window.klip.call('explorer',clip.id).catch(e=>notify(e.message));}`);
replace('function renderAudio(){','function openClip(',`function renderAudio(){const list=$('sk-audio-list');list.replaceChildren();const applications=[...new Map(nativeAudio.map(track=>[track.track,track])).values()];for(const track of [{track:1,name:'Birleşik ses'},...applications,{track:6,name:'Mikrofon'}]){const row=make('label','sk-audio-row'),input=make('input');input.type='checkbox';input.checked=config.audioEnabled?.[track.track]!==false;input.addEventListener('change',async()=>{const enabled=input.checked;input.disabled=true;try{config.audioEnabled=await window.klip.call('audio',{track:track.track,enabled});lastGood={...config};lastNativeSettings=JSON.stringify(config);}catch(e){input.checked=!enabled;notify(e.message);}finally{input.disabled=false;}});row.append(make('span','sk-audio-name',track.name),make('small','',track.track===1?'Tüm sesler':track.track===6?'Mikrofon':track.exe||'Uygulama'),input);list.append(row);}list.append(make('p','sk-setting-note','Yalnızca klip aralığında ses veren ve seçili uygulamalar ayrı ses izi olarak eklenir.'));if(!applications.length)list.append(make('p','sk-setting-note','Ses veren uygulamalar tampon başladığında burada görünür.'));}`);
replace('function openClip(','function renderPlayer(',`function openClip(clip,destination,remember=true){
    if(!clip)return;video.pause();releaseEditorAudio();releaseEditorTimeline();selectedId=clip.id;activeMediaId=clip.id;localFileName='';pendingTrim=null;mediaBounds={start:0,end:null};playStart=0;playEnd=clip.seconds;trimStart=0;trimEnd=clip.seconds;video.src=clip.videoUrl;video.removeAttribute('poster');video.load();
    $('sk-viewer-title').textContent=clip.name;$('sk-editor-name').textContent=clip.name;$('sk-media-label').textContent=clip.fileName;$('sk-media-error').hidden=true;renderClips();showPage(destination,remember);
  }`);
replace('function prepareExport(){','function exportClip(){',`function prepareExport(){
    const original=selected();if(!original)return;video.pause();$('sk-export-range').textContent=precise(trimStart)+' – '+precise(trimEnd)+' · '+(trimEnd-trimStart).toFixed(1)+' sn';$('sk-export-format').textContent=original.resolution.replace('x',' × ')+' · '+original.fps+' FPS';$('sk-export-name').value=original.name+'-kesit.mp4';$('sk-export-folder').textContent=folderPath(original.game);
    renderExportAudio(original);$('sk-export-dialog').showModal();
  }`);
replace('function exportClip(){','function chime(',`async function exportClip(){
    const clip=selected(),button=$('sk-export-confirm');button.disabled=true;
    try{const result=await window.klip.call('trim',{id:clip.id,start:trimStart,end:trimEnd,name:$('sk-export-name').value,tracks:selectedEditorAudioIndexes(clip),volumes:selectedEditorAudioVolumes(clip)});clips=result.clips;gameFolder=clip.game;selectedId=result.file;$('sk-export-dialog').close();renderClips();showPage('clips');notify('Kesit kaydedildi.');}catch(e){notify(e.message);}finally{button.disabled=false;}
  }`);
replace('function saveClip(){','function setSettingsTab(',`async function saveClip(){
    if(saving||(!running&&!captureRecoveryWaiting()))return;saving=true;renderBuffer();try{clips=await window.klip.call('save');renderClips();notify(nativeSaveWarnings.length?'Klip kaydedildi. Bazı uygulamaların ayrı ses izi kullanılamadı; birleşik ses korundu.':'Klip kaydedildi.');}catch(e){notify(e.message);}finally{saving=false;renderBuffer();}
  }`);
s=s.replace("$('sk-buffer-toggle').addEventListener('click',()=>{running=!running;if(!running)buffered=0;renderBuffer();});",`$('sk-buffer-toggle').addEventListener('click',async()=>{const button=$('sk-buffer-toggle');button.disabled=true;try{const result=await window.klip.call('toggle');running=result.running;if(!running)buffered=0;renderBuffer();}catch(e){notify(e.message);}finally{renderBuffer();}});`);
replace("$('sk-open-video').addEventListener('click',","$('sk-trim-start').addEventListener(",`$('sk-open-video').addEventListener('click',async()=>{try{const clip=await window.klip.call('import');if(!clip)return;if(!clips.some(c=>c.id===clip.id))clips.unshift(clip);if(!games.includes(clip.game))games.push(clip.game);openClip(clip,page==='editor'?'editor':'viewer');}catch(e){notify(e.message);}});`);
s=s.replace('renderStartupOption();renderQualityControls();','renderStartupOption();renderQualityControls();renderStorageHealth();');
s=s.replace("$('sk-save-label').textContent=saving?'Kaydediliyor…':'Klip al';","$('sk-save-label').textContent=saving?'Kaydediliyor…':'Klip al';renderCaptureRecoveryState();");
s=s.replace("$('sk-recovery-retry').textContent=busy?'Kurtarılıyor…':'Kurtar';","$('sk-recovery-retry').textContent=busy?'Kurtarılıyor…':'Kurtar';renderBuffer();");
const insertion=`
  try{const ui=JSON.parse(localStorage.getItem('klip-ui')||'{}');view=ui.view==='list'?'list':'grid';gameFolder=games.includes(ui.gameFolder)?ui.gameFolder:'all';renderClips();}catch{}
  function renderStorageHealth(){const el=$('sk-storage-health');if(!el)return;const h=nativeCaptureHealth;if(!h?.limitBytes){el.textContent=config.language==='en'?'Disk reduces RAM use. Memory keeps video packets in RAM.':'Disk RAM kullanımını azaltır. Bellek seçeneği video paketlerini RAM’de tutar.';return;}const size=n=>n>=1073741824?(n/1073741824).toFixed(2)+' GB':Math.round(n/1048576)+' MB';el.textContent=(h.storage==='disk'?'Disk':'RAM')+' · '+size(h.liveBytes||0)+' / '+size(h.limitBytes);el.style.color=h.liveBytes/h.limitBytes>.85?'var(--sk-amber)':'';}
  function captureRecoveryWaiting(){return replayRecovery.live===true||nativeCaptureHealth?.journalAcceptingPackets===false&&nativeCaptureHealth.outputActive===true;}
  function renderCaptureRecoveryState(){
    const held=captureRecoveryWaiting(),dot=$('sk-buffer-dot');dot.dataset.recovery=String(held);$('sk-save').setAttribute('aria-label',(held?'Tamponu kurtar':'Klip al')+' · '+config.hotkey);if(!held)return;
    dot.dataset.on='false';$('sk-buffer-status').textContent='Kurtarma bekleniyor';const buffer=root.querySelector('.sk-buffer');buffer.setAttribute('aria-label','Kurtarma bekleniyor');buffer.dataset.tooltip='Kurtarma bekleniyor';$('sk-buffer-toggle').disabled=true;
    const recovering=recoveringReplays||replayRecovery.recovering===true;$('sk-save').disabled=saving||recovering;$('sk-save').setAttribute('aria-busy',String(saving||recovering));$('sk-save-label').textContent=saving?'Kaydediliyor…':recovering?'Kurtarılıyor…':'Tamponu kurtar';
  }
  const chrome=root.querySelector('.sk-chrome');chrome.removeAttribute('aria-hidden');chrome.replaceChildren();for(const [action,glyph,label]of [['minimize','minus','Küçült'],['maximize','square','Büyüt'],['close','x','Pencereyi kapat']]){const b=make('button','sk-icon-button');b.setAttribute('aria-label',label);b.append(icon(glyph));b.addEventListener('click',()=>window.klip.call('window',action));chrome.append(b);}decorate();
  window.klip.onState(s=>{if(s.saveRequested)nativeSaveWarnings=[];if(Array.isArray(s.warnings))nativeSaveWarnings=s.warnings;if(s.captureHealth){nativeCaptureHealth=s.captureHealth;renderStorageHealth();}if(typeof s.saving==='boolean')saving=s.saving;if(typeof s.running==='boolean')running=s.running;if(typeof s.buffered==='number')buffered=s.buffered;if(s.clips){clips=s.clips;for(const c of clips)if(!games.includes(c.game))games.push(c.game);renderClips();}if(s.audio){nativeAudio=s.audio;renderAudio();}if(s.recovery)receiveRecoveryState(s.recovery);if(s.update)receiveUpdateState(s.update);if(s.message)notify(s.message);if(s.saveRequested&&config.sound)chime();renderBuffer();});
  window.klip.call('update-state').then(state=>receiveUpdateState(state)).catch(()=>{});
  if(initial.recovery)receiveRecoveryState(initial.recovery);window.klip.call('recovery-state').then(receiveRecoveryState).catch(()=>{});
  document.documentElement.dataset.nativeReady='true';
  window.klip.call('library').then(list=>{clips=list;for(const c of clips)if(!games.includes(c.game))games.push(c.game);renderClips();}).catch(e=>notify(e.message));
`;
s=s.replace('if(window.openai?.widgetState)restore(window.openai.widgetState);',insertion);
s=s.replaceAll('Prototip gerçek dosya oluşturmaz.','').replace('Bu oyun klasöründe henüz klip yok.','Bu klasörde henüz klip yok. Tamponu başlatıp F8 ile ilk klibini al.');
s=s.replace('Örnek oynatma · 15 sn','Video önizlemesi');
s=s.replaceAll("clip.fps+' FPS'","Number(clip.fps.toFixed(2))+' FPS'").replace("original.fps+' FPS'","Number(original.fps.toFixed(2))+' FPS'").replaceAll(' · Örnek klip','');
const head=`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob: klipmedia:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none';"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ember</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#19171d}#sunset-klip-organized{max-width:none!important;height:100vh!important;border:0!important;border-radius:0!important}.sk-export-audio{max-height:180px;overflow:auto}.sk-topbar{-webkit-app-region:drag}.sk-chrome{-webkit-app-region:no-drag;gap:0!important;display:flex!important}.sk-chrome button{width:44px;height:40px}</style><script src="i18n.js"></script><script src="lucide.js"></script></head><body>`;
fs.writeFileSync(path.join(root,'src/index.html'),head+s+'</body></html>');
