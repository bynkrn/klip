const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),template=fs.readFileSync(path.join(root,'src/ui-template.html'),'utf8');
let s=template;
const replace=(a,b,text)=>{const start=s.indexOf(a),end=s.indexOf(b,start+a.length);if(start<0||end<0)throw new Error('UI bölümü bulunamadı: '+a);s=s.slice(0,start)+text+'\n  '+s.slice(end);};
s=s.replace('__SUNSET_ASSETS__',JSON.stringify({thumbs:[],video:'',poster:''})).replace('(() => {','(async () => {\n  const initial=await window.klip.call("init");\n  let lastNativeSettings=JSON.stringify(initial.settings),lastGood={...initial.settings};');
s=s.replace('let config={...defaults};','let config={...defaults,...initial.settings};');
s=s.replace('let config={...defaults,...initial.settings};','let config={...defaults,...initial.settings};let nativeAudio=[];');
s=s.replace(/  let clips=names\.map\([^\n]+/,'  let clips=initial.clips;');
s=s.replace("const gameFor=clip=>games.includes(clip?.game)?clip.game:(Number(clip?.thumb)||0)<12?games[0]:(Number(clip?.thumb)||0)<20?games[1]:games[2];","const gameFor=clip=>clip?.game||'Masaüstü';");
s=s.replace("const games=['Counter-Strike 2','Valorant','Quake Live'];","const games=[...new Set(['Masaüstü','Counter-Strike 2','Valorant','Quake Live',...initial.clips.map(c=>c.game)])];");
s=s.replace("selectedId=clips[2].id","selectedId=clips[0]?.id||''");
s=s.replaceAll("assets.thumbs[clip.thumb%assets.thumbs.length]","clip.thumbnail||''");
s=s.replaceAll("selected().name","selected()?.name||'Klip izleme'");
s=s.replace('&&combo===config.hotkey','&&false&&combo===config.hotkey');
s=s.replace(/  setInterval\(\(\)=>\{if\(running&&root\.isConnected\)[^\n]+\n/,'');
s=s.replaceAll('max="1000"','max="360"');
s=s.replace('<option value="disk">Disk tamponu</option>','');
s=s.replace(/<label class="sk-check"><input type="checkbox" data-setting="holdFrame">[\s\S]*?<\/label>/,'');
s=s.replace('<option value="h265">HEVC / H.265</option>','').replace('<option value="av1">AV1</option>','');
s=s.replace('<h2>Kaynak ve tampon</h2>','<h2>Kaynak ve tampon</h2><label class="sk-field"><span>Oyun dosyası adı (boşsa otomatik)</span><input type="text" data-setting="targetExe" aria-label="Hedef oyun" placeholder="ornek-oyun.exe"></label>');
s=s.replace('Arayüz prototipi · Örnek klipler','Yerel kayıt · NVIDIA NVENC');
s=s.replace('Arayüz prototipi:','').replace('Yeni kopya oluşturulur; orijinal klip korunur. Prototip yalnızca örnek kesiti kütüphaneye ekler, diske dosya yazmaz.','Yeni dosya oluşturulur. Orijinal klibin üzerine yazılmaz.');
s=s.replace('Bu ekrandaki uygulamalar örnektir. Prototip, çalışan uygulamaları veya seslerini taramaz.','Ses kapasitesi: birleşik ses + dört uygulama + mikrofon. Algılanan uygulamalar kayıt başladıktan sonra bildirilir.');
replace('function persist(){','function notify(',`async function persist(){
    localStorage.setItem('klip-ui',JSON.stringify({view,gameFolder,settingsTab}));
    const next=JSON.stringify(config);if(next===lastNativeSettings)return;
    try{config=await window.klip.call('settings',config);lastGood={...config};lastNativeSettings=JSON.stringify(config);}
    catch(e){config={...lastGood};renderConfig();notify(e.message);}
  }`);
replace('function showExplorer(','function libraryClips(',`function showExplorer(clip=selected()){if(clip)window.klip.call('explorer',clip.id).catch(e=>notify(e.message));}`);
replace('function renderAudio(){','function openClip(',`function renderAudio(){const list=$('sk-audio-list');list.replaceChildren();for(const track of [{track:1,name:'Birleşik ses'},...nativeAudio,{track:6,name:'Mikrofon'}]){const row=make('label','sk-audio-row'),input=make('input');input.type='checkbox';input.checked=config.audioEnabled?.[track.track]!==false;input.addEventListener('change',async()=>{try{config.audioEnabled=await window.klip.call('audio',{track:track.track,enabled:input.checked});lastGood={...config};lastNativeSettings=JSON.stringify(config);}catch(e){input.checked=!input.checked;notify(e.message);}});row.append(make('span','sk-audio-name',track.name),make('small','', 'İz '+track.track),input);list.append(row);}if(!nativeAudio.length)list.append(make('p','sk-setting-note','Uygulama izleri tampon başladığında burada görünür.'));}`);
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
    if(saving||!running)return;saving=true;renderBuffer();try{clips=await window.klip.call('save');renderClips();notify('Klip kaydedildi.');}catch(e){notify(e.message);}finally{saving=false;renderBuffer();}
  }`);
s=s.replace("$('sk-buffer-toggle').addEventListener('click',()=>{running=!running;if(!running)buffered=0;renderBuffer();});",`$('sk-buffer-toggle').addEventListener('click',async()=>{const button=$('sk-buffer-toggle');button.disabled=true;try{const result=await window.klip.call('toggle');running=result.running;if(!running)buffered=0;renderBuffer();}catch(e){notify(e.message);}finally{button.disabled=false;}});`);
replace("$('sk-open-video').addEventListener('click',","$('sk-trim-start').addEventListener(",`$('sk-open-video').addEventListener('click',async()=>{try{const clip=await window.klip.call('import');if(!clip)return;if(!clips.some(c=>c.id===clip.id))clips.unshift(clip);if(!games.includes(clip.game))games.push(clip.game);openClip(clip,page==='editor'?'editor':'viewer');}catch(e){notify(e.message);}});`);
const insertion=`
  try{const ui=JSON.parse(localStorage.getItem('klip-ui')||'{}');view=ui.view==='list'?'list':'grid';gameFolder=games.includes(ui.gameFolder)?ui.gameFolder:'all';renderClips();}catch{}
  const chrome=root.querySelector('.sk-chrome');chrome.removeAttribute('aria-hidden');chrome.replaceChildren();for(const [action,glyph,label]of [['minimize','minus','Küçült'],['maximize','square','Büyüt'],['close','x','Pencereyi kapat']]){const b=make('button','sk-icon-button');b.setAttribute('aria-label',label);b.append(icon(glyph));b.addEventListener('click',()=>window.klip.call('window',action));chrome.append(b);}decorate();
  window.klip.onState(s=>{if(typeof s.saving==='boolean')saving=s.saving;if(typeof s.running==='boolean')running=s.running;if(typeof s.buffered==='number')buffered=s.buffered;if(s.clips){clips=s.clips;for(const c of clips)if(!games.includes(c.game))games.push(c.game);renderClips();}if(s.audio){nativeAudio=s.audio;renderAudio();}if(s.update)receiveUpdateState(s.update);if(s.message)notify(s.message);if(s.saveRequested&&config.sound)chime();renderBuffer();});
  window.klip.call('update-state').then(state=>receiveUpdateState(state)).catch(()=>{});
  document.documentElement.dataset.nativeReady='true';
  window.klip.call('library').then(list=>{clips=list;for(const c of clips)if(!games.includes(c.game))games.push(c.game);renderClips();}).catch(e=>notify(e.message));
`;
s=s.replace('if(window.openai?.widgetState)restore(window.openai.widgetState);',insertion);
s=s.replaceAll('Prototip gerçek dosya oluşturmaz.','').replace('Bu oyun klasöründe henüz klip yok.','Bu klasörde henüz klip yok. Tamponu başlatıp F8 ile ilk klibini al.');
s=s.replace('Örnek oynatma · 15 sn','Video önizlemesi');
s=s.replaceAll("clip.fps+' FPS'","Number(clip.fps.toFixed(2))+' FPS'").replace("original.fps+' FPS'","Number(original.fps.toFixed(2))+' FPS'").replaceAll(' · Örnek klip','');
const head=`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob: klipmedia:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none';"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ember</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#19171d}#sunset-klip-organized{max-width:none!important;height:100vh!important;border:0!important;border-radius:0!important}.sk-export-audio{max-height:180px;overflow:auto}.sk-topbar{-webkit-app-region:drag}.sk-chrome{-webkit-app-region:no-drag;gap:0!important;display:flex!important}.sk-chrome button{width:44px;height:40px}</style><script src="i18n.js"></script><script src="lucide.js"></script></head><body>`;
fs.writeFileSync(path.join(root,'src/index.html'),head+s+'</body></html>');
