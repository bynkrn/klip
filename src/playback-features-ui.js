(function(global){
 'use strict';
 function attach({root,getConfig,setPreference,openSettings,notify=()=>{}}){
  const $=id=>root.querySelector('#'+id),doc=root.ownerDocument,player=$('sk-player'),viewer=$('sk-page-viewer'),video=$('sk-video');
  const make=(tag,cls,text)=>{const el=doc.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
  const style=doc.createElement('style');style.textContent=`
   #sk-player:fullscreen{box-sizing:border-box;display:flex;flex-direction:column;width:100vw;height:100vh;max-width:none;background:#100f13;color:#f5f1f8;padding:16px;gap:12px}
   #sk-player:fullscreen .sk-stage{flex:1;min-height:0;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#09080b}
   #sk-player:fullscreen video{width:100%;height:100%;object-fit:contain}#sk-player:fullscreen .sk-playback{flex:none}
   #sk-fullscreen{margin-left:8px;flex:none}#sk-fullscreen svg{width:17px;height:17px}
   #sk-recording-health{display:inline-flex;align-items:center;gap:7px;max-width:240px;min-width:0;margin:0 16px;padding:7px 10px;border:1px solid #4b4145;border-radius:7px;background:#262128;color:#d8d0dc;font-size:11px;-webkit-app-region:no-drag}
   #sk-recording-health[hidden],#sk-fullscreen[hidden]{display:none!important}#sk-recording-health:before{content:'';width:6px;height:6px;flex:none;border-radius:50%;background:#a097a6}
   #sk-recording-health[data-state=healthy]:before,#sk-recording-health[data-state=recording]:before{background:#7fd9b1}
   #sk-recording-health[data-state=stalled]:before,#sk-recording-health[data-state=recovery]:before{background:#ff866d}
   #sk-recording-health[data-state=dropped]:before,#sk-recording-health[data-state=renewing]:before{background:#ffb631}
   #sk-health-details{font-size:12px;line-height:1.65;color:#b6acbd;white-space:pre-line;margin:10px 0 0}
   @media(max-width:950px){#sk-recording-health{font-size:10px;max-width:175px;margin-right:8px}}
  `;doc.head.append(style);
  const full=make('button','sk-button sk-ghost');full.id='sk-fullscreen';full.type='button';full.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></svg>';
  player.querySelector('.sk-play-buttons').append(full);
  const chip=make('button');chip.id='sk-recording-health';chip.type='button';chip.hidden=true;const topbar=root.querySelector('.sk-topbar'),chrome=root.querySelector('.sk-chrome'),anchor=[...topbar.children].find(child=>child===chrome||child.contains(chrome));topbar.insertBefore(chip,anchor||null);
  const section=make('section','sk-setting-section');section.dataset.i18n='off';const heading=make('h2'),label=make('label','sk-check'),check=make('input'),labelText=make('span'),description=make('small'),details=make('p');check.type='checkbox';check.id='sk-health-enabled';details.id='sk-health-details';labelText.append(description);label.append(check,labelText);section.append(heading,label,details);root.querySelector('#sk-settings-capture .sk-settings-grid').append(section);
  const names={tr:{stopped:'Tampon Kapalı',warming:'Kayıt Başlıyor',healthy:'Kayıt Sağlıklı',recording:'Kayıt Sürüyor',renewing:'Yakalama Yenileniyor',dropped:'Kare Kaybı Var',stalled:'Görüntü Akışı Durdu',suspended:'Oyun Askıda',recovery:'Kurtarma Bekleniyor'},en:{stopped:'Buffer Off',warming:'Starting Recording',healthy:'Recording Healthy',recording:'Recording Active',renewing:'Refreshing Capture',dropped:'Dropped Frames',stalled:'Video Delivery Stalled',suspended:'Game Suspended',recovery:'Recovery Pending'}};
  let health={state:'stopped',verification:'limited'},pending=false;
  const english=()=>getConfig().language==='en',isViewer=()=>!viewer.hidden&&viewer.contains(player);
  function render(){
   const en=english(),config=getConfig(),dict=names[en?'en':'tr'];chip.hidden=!config.showCaptureHealth;chip.dataset.state=health.state||'stopped';chip.textContent=dict[health.state]||dict.recording;chip.title=en?'Recording Details':'Kayıt Ayrıntıları';check.checked=!!config.showCaptureHealth;
   heading.textContent=en?'Recording Health':'Kayıt Sağlığı';labelText.firstChild?.nodeType===3&&labelText.firstChild.remove();labelText.prepend(doc.createTextNode(en?'Show Recording Health':'Kayıt Sağlığını Göster'));description.textContent=en?'Show a compact status beside Ember. Details stay here.':'Ember yazısının yanında küçük bir durum göstergesi göster. Ayrıntılar burada kalır.';
   const lines=[dict[health.state]||dict.recording];
   if(health.state!=='stopped'){
    lines.push(health.verification==='delivery'?(en?'Source frame delivery is monitored.':'Kaynak karelerinin gelişi izleniyor.'):(en?'Limited verification: encoded delivery is monitored; source pixel freshness cannot be verified on this capture path.':'Doğrulama sınırlı: kodlanmış görüntünün gelişi izleniyor; bu yakalama yolunda kaynak görüntüsünün güncelliği doğrulanamıyor.'));
    if(Number.isFinite(health.fps))lines.push((en?'Encoded: ':'Kodlanan: ')+health.fps+' FPS');
    if(health.storage==='ram')lines.push(en?'RAM buffer cannot survive a power loss.':'RAM tamponu elektrik kesintisinde korunamaz.');
    else if(health.checkpointError)lines.push((health.crashRecoveryAvailable?(en?'The last safe checkpoint is retained. ':'Son güvenli kurtarma noktası korunuyor. '):(en?'No safe recovery point is available yet. ':'Henüz güvenli kurtarma noktası yok. '))+(en?'New checkpoint failed: ':'Yeni kurtarma noktası yazılamadı: ')+health.checkpointError);
    else if(health.crashRecoveryAvailable)lines.push((en?'Safe recovery point: ':'Güvenli kurtarma noktası: ')+(Number.isFinite(health.checkpointAgeMs)?Math.round(health.checkpointAgeMs/1000)+(en?' s ago':' sn önce'):(en?'Ready':'Hazır')));
   }
   details.textContent=lines.join('\n');full.hidden=!isViewer();const active=doc.fullscreenElement===player;full.setAttribute('aria-pressed',String(active));full.setAttribute('aria-label',active?(en?'Exit Fullscreen':'Tam Ekrandan Çık'):(en?'Fullscreen':'Tam Ekran'));full.title=full.getAttribute('aria-label')+' · F';
  }
  async function toggleFullscreen(){
   if(pending)return;pending=true;try{if(doc.fullscreenElement===player)await doc.exitFullscreen();else if(isViewer())await player.requestFullscreen({navigationUI:'hide'});}catch(error){notify(english()?'Fullscreen could not open.':'Tam ekran açılamadı.');}finally{pending=false;render();}
  }
  full.addEventListener('click',toggleFullscreen);video.addEventListener('dblclick',()=>{if(isViewer())toggleFullscreen();});doc.addEventListener('fullscreenchange',render);
  doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&doc.fullscreenElement===player){event.preventDefault();doc.exitFullscreen().catch(()=>{});return;}if(event.key.toLowerCase()==='f'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)&&!event.target.isContentEditable&&!doc.querySelector('dialog[open]')&&isViewer()){event.preventDefault();toggleFullscreen();}});
  chip.addEventListener('click',openSettings);check.addEventListener('change',async()=>{check.disabled=true;try{await setPreference('showCaptureHealth',check.checked);}catch(error){notify(error.message);}finally{check.disabled=false;render();}});
  const observer=new MutationObserver(records=>{if(!records.some(record=>record.target===viewer||record.type==='childList'&&[...record.addedNodes,...record.removedNodes].includes(player)))return;if(!isViewer()&&doc.fullscreenElement===player)doc.exitFullscreen().catch(()=>{});render();});observer.observe(root,{attributes:true,attributeFilter:['hidden'],childList:true,subtree:true});
  render();return{render,toggleFullscreen,receive(value){if(value)health=value;render();}};
 }
 global.EmberPlaybackFeatures={attach};
})(window);
