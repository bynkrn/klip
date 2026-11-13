(function(global){
 'use strict';
 function attach({root,call,getLanguage}){
  const $=id=>root.querySelector('#'+id),doc=root.ownerDocument,dialog=$('sk-export-dialog'),confirm=$('sk-export-confirm'),cancel=$('sk-export-cancel'),name=$('sk-export-name');
  const field=doc.createElement('label');field.className='sk-field';field.dataset.i18n='off';const title=doc.createElement('span'),mode=doc.createElement('select');mode.id='sk-export-mode';for(const value of ['fast','precise']){const option=doc.createElement('option');option.value=value;mode.append(option);}field.append(title,mode);dialog.insertBefore(field,dialog.querySelector('.sk-export-summary'));
  const status=doc.createElement('p');status.id='sk-export-plan-status';status.dataset.i18n='off';status.setAttribute('role','status');status.style.cssText='font-size:12px;line-height:1.55;color:var(--sk-muted,#b6acbd);margin:10px 0';dialog.querySelector('.sk-export-summary').after(status);
  let request=null,plan=null,generation=0,working=false,error='';const en=()=>getLanguage()==='en';
  const time=value=>{const milliseconds=Math.round(value*1000),seconds=Math.floor(milliseconds/1000);return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')+'.'+String(milliseconds%1000).padStart(3,'0');};
  function render(){
   title.textContent=en()?'Export Method':'Dışa Aktarma Yöntemi';mode.options[0].textContent=en()?'Fast · Original Video':'Hızlı · Özgün Görüntü';mode.options[1].textContent=en()?'Precise · Frame Accurate':'Hassas · Kareye Göre Kes';mode.setAttribute('aria-label',title.textContent);mode.disabled=working;name.disabled=working;cancel.disabled=working;for(const input of root.querySelectorAll('#sk-export-audio-controls input'))input.disabled=working;confirm.disabled=working||!plan;confirm.setAttribute('aria-busy',String(working||!!request&&!plan&&!error));
   if(error){status.textContent=global.KlipI18n?.translate(error,getLanguage())||error;status.style.color='var(--sk-amber,#ffb631)';return;}status.style.color='var(--sk-muted,#b6acbd)';
   if(!plan){status.textContent=en()?'Preparing the export range…':'Kaydedilecek aralık hazırlanıyor…';return;}
   $('sk-export-range').textContent=time(plan.range.start)+' – '+time(plan.range.end)+' · '+plan.range.duration.toFixed(3)+(en()?' s':' sn');
   const notes=[];if(plan.videoCopied)notes.push(en()?'Video is copied without re-encoding.':'Görüntü yeniden kodlanmaz.');else notes.push(en()?'Frame-accurate cut with high quality video encoding.':'Kare hassasiyetinde kesim, yüksek kalitede yeniden kodlama kullanır.');
   if(plan.mode==='fast'&&!plan.fullLength)notes.push((en()?'Keyframe-aligned range is shown above. Requested: ':'Anahtar karelere göre kaydedilecek aralık yukarıda. İstenen: ')+time(request.start)+' – '+time(request.end));
   notes.push(en()?'Selected audio levels and muted tracks are preserved.':'Seçili ses düzeyleri ve kapalı izler çıktıda korunur.');status.textContent=notes.join(' ');
  }
  async function preparePlan(){
   if(!request)return;const token=++generation,current={...request,mode:mode.value};plan=null;error='';render();
   try{const next=await call('export-plan',current);if(token!==generation)return;plan=next;}
   catch(cause){if(token!==generation)return;error=cause.message;}
   if(token===generation)render();
  }
  mode.addEventListener('change',preparePlan);dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();});dialog.addEventListener('close',()=>{generation++;plan=null;request=null;});
  return{render,prepare(clip,range){request={id:clip.id,start:range.start,end:range.end,...Number.isFinite(clip.mtime)&&Number.isFinite(clip.size)?{sourceVersion:{mtime:clip.mtime,size:clip.size}}:{}};working=false;preparePlan();},selection(){if(!request||!plan||working)throw Error(en()?'Wait for the export range to be ready.':'Kaydedilecek aralığın hazırlanmasını bekle.');return{...request,mode:mode.value,planToken:plan.token};},setWorking(value){working=value;if(value)error='';render();},showError(message){error=message;render();}};
 }
 global.EmberExportUI={attach};
})(window);
