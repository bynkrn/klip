(function(scope){
  const fold=value=>String(value||'').normalize('NFC').toLocaleLowerCase('tr-TR').replace(/ı/g,'i');
  function dateKey(clip,now=Date.now()){
    let value=Number(clip.mtime);
    if(!Number.isFinite(value)){if(clip.day==='today')value=now;else if(clip.day==='yesterday'){const d=new Date(now);d.setDate(d.getDate()-1);value=d.getTime();}else return 'unknown';}
    const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function dateLabel(clip,language='tr',now=Date.now()){
    const key=dateKey(clip,now),today=dateKey({mtime:now}),yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);
    if(key===today)return language==='en'?'Today':'Bugün';if(key===dateKey({mtime:yesterday.getTime()}))return language==='en'?'Yesterday':'Dün';
    if(key==='unknown')return language==='en'?'Other Clips':'Diğer Klipler';
    return new Date(key+'T12:00:00').toLocaleDateString(language==='en'?'en-GB':'tr-TR',{day:'numeric',month:'long',year:'numeric'});
  }
  function filterClips(clips,filters={}){
    const terms=fold(filters.query).trim().split(/\s+/).filter(Boolean),tag=fold(filters.tag);
    return clips.filter(clip=>{
      const tags=Array.isArray(clip.tags)?clip.tags:[],text=fold([clip.name,clip.fileName,clip.game,...tags].join(' ')),date=dateKey(clip);
      return terms.every(term=>text.includes(term))&&(!filters.favorite||clip.favorite===true)&&(!tag||tags.some(value=>fold(value)===tag))&&
        (!filters.from||date!=='unknown'&&date>=filters.from)&&(!filters.to||date!=='unknown'&&date<=filters.to)&&
        (filters.min===''||filters.min==null||Number(clip.seconds)>=Number(filters.min))&&(filters.max===''||filters.max==null||Number(clip.seconds)<=Number(filters.max));
    });
  }
  function attach({root,call,getClips,getSelection,getLanguage,onClips,refresh,notify,decorate}){
    const doc=root.ownerDocument,$=id=>doc.getElementById(id),state={query:'',favorite:false,tag:'',from:'',to:'',min:'',max:''};let working=false,editing=null;
    const t=(tr,en)=>getLanguage()==='en'?en:tr;
    const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;n.dataset.i18n='off';return n;};
    const glyph=name=>{const n=doc.createElement('i');n.dataset.lucide=name;n.setAttribute('aria-hidden','true');return n;};
    const button=(id,label,icon,cls='sk-button')=>{const b=el('button',cls);b.id=id;b.type='button';if(icon)b.append(glyph(icon));if(!cls.split(' ').includes('sk-icon-button')||label)b.append(el('span','',label));return b;};
    const style=el('style');style.textContent=`
      #sunset-klip-organized .sk-library-tools{display:flex;align-items:center;gap:8px;flex-shrink:0;min-width:0}
      #sunset-klip-organized .sk-library-search{display:flex;align-items:center;gap:8px;flex:1;min-width:100px;background:var(--sk-panel);border:1px solid var(--sk-line);border-radius:7px;padding:0 11px;height:36px;color:var(--sk-muted)}
      #sunset-klip-organized .sk-library-search input{width:100%;min-width:0;background:none;border:0;padding:0;outline:none;color:var(--sk-text);font:inherit;font-size:13px}
      #sunset-klip-organized .sk-library-tools button{height:36px;white-space:nowrap}
      #sunset-klip-organized .sk-library-tools button[aria-pressed=true],#sunset-klip-organized .sk-clip-favorite[aria-pressed=true]{color:var(--sk-amber);border-color:var(--sk-amber)}
      #sunset-klip-organized .sk-library-filter-panel{position:fixed;inset:auto;margin:0;width:min(360px,calc(100vw - 28px));box-sizing:border-box;padding:18px;background:var(--sk-panel);color:var(--sk-text);border:1px solid var(--sk-line);border-radius:10px;box-shadow:0 18px 45px #0008;z-index:50}
      #sunset-klip-organized .sk-library-filter-panel h3{margin:0 0 14px;font-size:14px}
      #sunset-klip-organized .sk-library-filter-panel .sk-field-pair{gap:10px}
      #sunset-klip-organized .sk-library-filter-panel .sk-field{margin-bottom:12px;min-width:0}
      #sunset-klip-organized .sk-library-filter-panel input,#sunset-klip-organized .sk-library-filter-panel select{width:100%;min-width:0;box-sizing:border-box;color-scheme:dark}
      #sunset-klip-organized .sk-clip-favorite{position:absolute;right:7px;top:7px;width:27px;height:27px;padding:0;line-height:0;border:1px solid #ffffff24;border-radius:6px;background:#17141bc9;color:#e6dfe7;display:grid;place-items:center;opacity:0;cursor:pointer;z-index:2}
      #sunset-klip-organized .sk-clip-favorite svg{display:block}
      #sunset-klip-organized .sk-card:hover .sk-clip-favorite,#sunset-klip-organized .sk-clip-favorite:focus-visible,#sunset-klip-organized .sk-clip-favorite[aria-pressed=true]{opacity:1}
      #sunset-klip-organized .sk-clip-favorite[aria-pressed=true] svg{fill:currentColor}
      #sunset-klip-organized .sk-row-actions .sk-clip-favorite{position:static;opacity:1;border:0;background:none;width:25px}
      #sunset-klip-organized .sk-table th:last-child{width:122px}
      #sunset-klip-organized .sk-clip-tags{display:flex;gap:4px;margin-top:5px;overflow:hidden;max-width:100%;pointer-events:none}
      #sunset-klip-organized .sk-clip-tags span{font-size:10px;line-height:17px;padding:0 6px;max-width:85px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:4px;background:var(--sk-soft);color:var(--sk-muted)}
      #sunset-klip-organized .sk-library-empty{display:flex;align-items:center;justify-content:center;flex-direction:column;min-height:160px;gap:9px;color:var(--sk-muted);text-align:center;padding:20px}
      #sunset-klip-organized .sk-library-empty strong{color:var(--sk-text);font-size:16px}
      #sunset-klip-organized #sk-metadata-dialog{width:min(440px,calc(100vw - 42px))}
      #sunset-klip-organized .sk-metadata-source{overflow-wrap:anywhere;font-size:12px;color:var(--sk-muted);margin:4px 0 15px}
      #sunset-klip-organized .sk-metadata-error{color:#ffa779;min-height:1em;font-size:12px}
      @media(max-width:950px){#sunset-klip-organized .sk-library-tools{gap:6px}#sunset-klip-organized .sk-library-tools button{padding-inline:10px}#sunset-klip-organized .sk-library-tools #sk-library-favorites span{display:none}#sunset-klip-organized .sk-table th:last-child{width:112px}}
    `;root.append(style);
    const toolbar=el('div','sk-library-tools');toolbar.id='sk-library-tools';toolbar.setAttribute('role','search');
    const search=el('label','sk-library-search');search.append(glyph('search'));const query=el('input');query.id='sk-library-search';query.type='search';search.append(query);
    const favorites=button('sk-library-favorites','','star'),filters=button('sk-library-filters','','sliders-horizontal'),clear=button('sk-library-clear','','x','sk-icon-button');clear.hidden=true;
    toolbar.append(search,favorites,filters,clear);$('sk-game-folders').before(toolbar);
    const panel=el('div','sk-library-filter-panel');panel.id='sk-library-filter-panel';panel.setAttribute('popover','auto');panel.setAttribute('role','group');filters.setAttribute('aria-controls',panel.id);filters.setAttribute('aria-expanded','false');panel.addEventListener('toggle',event=>filters.setAttribute('aria-expanded',String(event.newState==='open')));const heading=el('h3');heading.id='sk-library-filter-heading';panel.setAttribute('aria-labelledby',heading.id);panel.append(heading);
    const fields={};
    const field=(key,type)=>{const label=el('label','sk-field'),title=el('span'),input=el(type==='select'?'select':'input');if(type!=='select')input.type=type;input.id='sk-library-'+key;label.append(title,input);fields[key]={title,input};input.addEventListener('input',()=>{state[key]=input.value;changed();});return label;};
    panel.append(field('tag','select'));const dates=el('div','sk-field-pair');dates.append(field('from','date'),field('to','date'));panel.append(dates);const durations=el('div','sk-field-pair');durations.append(field('min','number'),field('max','number'));panel.append(durations);
    for(const key of ['min','max']){fields[key].input.min='0';fields[key].input.step='1';}
    const note=el('p','sk-setting-note');panel.append(note);root.append(panel);
    const dialog=el('dialog','sk-dialog');dialog.id='sk-metadata-dialog';const form=el('form');form.method='dialog';const title=el('h2'),source=el('p','sk-metadata-source'),nameLabel=el('label','sk-field'),nameTitle=el('span'),name=el('input');name.id='sk-metadata-name';name.type='text';name.maxLength=200;nameLabel.append(nameTitle,name);
    const tagsLabel=el('label','sk-field'),tagsTitle=el('span'),tags=el('input');tags.id='sk-metadata-tags';tags.type='text';tagsLabel.append(tagsTitle,tags);const hint=el('p','sk-setting-note'),error=el('p','sk-metadata-error');error.setAttribute('role','alert');
    title.id='sk-metadata-title';dialog.setAttribute('aria-labelledby',title.id);const actions=el('div','sk-dialog-actions'),cancel=button('sk-metadata-cancel','','x'),save=button('sk-metadata-save','','check','sk-button sk-primary');save.type='submit';actions.append(cancel,save);form.append(title,source,nameLabel,tagsLabel,hint,error,actions);dialog.append(form);root.append(dialog);
    const menu=$('sk-clip-menu'),metadata=button('sk-menu-metadata','','pencil'),menuFavorite=button('sk-menu-favorite','','star');metadata.setAttribute('role','menuitem');menuFavorite.setAttribute('role','menuitem');menu.append(metadata,menuFavorite);
    const batchFavorite=button('sk-favorite-selected','','star','sk-icon-button');$('sk-delete-selected').before(batchFavorite);
    const active=()=>Object.entries(state).some(([,v])=>v!==''&&v!==false);
    function changed(){const count=Number(state.favorite)+['tag','from','to','min','max'].filter(key=>state[key]!=='').length;filters.dataset.count=String(count);clear.hidden=!active();refresh();}
    query.addEventListener('input',()=>{state.query=query.value;changed();});favorites.addEventListener('click',()=>{state.favorite=!state.favorite;changed();});
    clear.addEventListener('click',()=>{Object.assign(state,{query:'',favorite:false,tag:'',from:'',to:'',min:'',max:''});query.value='';for(const {input}of Object.values(fields))input.value='';changed();});
    filters.addEventListener('click',()=>{if(panel.matches(':popover-open'))panel.hidePopover();else{panel.showPopover();const r=filters.getBoundingClientRect(),box=panel.getBoundingClientRect();panel.style.left=Math.max(10,Math.min(innerWidth-box.width-10,r.right-box.width))+'px';panel.style.top=Math.max(8,Math.min(innerHeight-box.height-10,r.bottom+6))+'px';}});
    async function patch(ids,value){if(working)return;working=true;render();try{const result=await call('clip-metadata',{ids,patch:value});onClips(result.clips);refresh();return true;}catch(e){notify(e.message);return false;}finally{working=false;render();}}
    const selected=()=>getSelection();
    const flipFavorites=()=>{const items=selected();if(items.length)return patch(items.map(c=>c.id),{favorite:!items.every(c=>c.favorite)});};
    menuFavorite.addEventListener('click',()=>{menu.hidePopover();flipFavorites();});batchFavorite.addEventListener('click',flipFavorites);
    metadata.addEventListener('click',()=>{const items=selected();if(items.length!==1)return;editing=items[0];menu.hidePopover();name.value=editing.displayName||'';name.placeholder=editing.fileName||editing.name;tags.value=(editing.tags||[]).join(', ');source.textContent=editing.fileName||editing.name;error.textContent='';dialog.showModal();name.focus();});
    cancel.addEventListener('click',()=>dialog.close());dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();});
    form.addEventListener('submit',async event=>{event.preventDefault();if(!editing||working)return;save.disabled=cancel.disabled=true;error.textContent='';const ok=await patch([editing.id],{displayName:name.value,tags:tags.value.split(',').map(t=>t.trim()).filter(Boolean)});save.disabled=cancel.disabled=false;if(ok)dialog.close();else error.textContent=t('Değişiklikler Kaydedilemedi.','Changes Could Not Be Saved.');});
    function render(){
      query.placeholder=t('Klip, Oyun veya Etiket Ara…','Search Clips, Games or Tags…');query.setAttribute('aria-label',t('Klip Ara','Search Clips'));
      favorites.lastChild.textContent=t('Favoriler','Favorites');favorites.setAttribute('aria-label',t('Yalnız Favoriler','Favorites Only'));favorites.setAttribute('aria-pressed',String(state.favorite));
      const count=Number(filters.dataset.count)||0;filters.lastChild.textContent=t('Filtreler','Filters')+(count?' · '+count:'');filters.setAttribute('aria-label',t('Klip Filtreleri','Clip Filters'));clear.title=clear.ariaLabel=t('Filtreleri Temizle','Clear Filters');
      heading.textContent=t('Klip Filtreleri','Clip Filters');fields.tag.title.textContent=t('Etiket','Tag');fields.from.title.textContent=t('Başlangıç Tarihi','From Date');fields.to.title.textContent=t('Bitiş Tarihi','To Date');fields.min.title.textContent=t('En Az Süre (sn)','Min Duration (s)');fields.max.title.textContent=t('En Fazla Süre (sn)','Max Duration (s)');note.textContent=t('Filtreler Birlikte Uygulanır. Boş Alanlar Sınırsızdır.','Filters Work Together. Empty Fields Have No Limit.');
      const tagValues=[...new Set(getClips().flatMap(c=>c.tags||[]))].sort((a,b)=>a.localeCompare(b,getLanguage()));if(state.tag&&!tagValues.includes(state.tag))tagValues.push(state.tag);const tagSelect=fields.tag.input;if(JSON.stringify([getLanguage(),...tagValues])!==tagSelect.dataset.options){tagSelect.dataset.options=JSON.stringify([getLanguage(),...tagValues]);tagSelect.replaceChildren();for(const value of ['',...tagValues]){const option=el('option','',value||t('Tüm Etiketler','All Tags'));option.value=value;tagSelect.append(option);}tagSelect.value=state.tag;}
      title.textContent=t('Klip Bilgileri','Clip Details');nameTitle.textContent=t('Görünen Ad','Display Name');tagsTitle.textContent=t('Etiketler','Tags');hint.textContent=t('Etiketleri Virgülle Ayır. Görünen Adı Değiştirmek Dosyanın Adını veya Konumunu Değiştirmez.','Separate Tags With Commas. Changing The Display Name Keeps The File Name And Location.');cancel.lastChild.textContent=t('Vazgeç','Cancel');save.lastChild.textContent=t('Kaydet','Save');
      const items=selected(),remove=items.length&&items.every(c=>c.favorite),favoriteText=remove?t('Favorilerden Çıkar','Remove From Favorites'):t('Favorilere Ekle','Add To Favorites');metadata.lastChild.textContent=t('Ad ve Etiketleri Düzenle','Edit Name And Tags');metadata.disabled=working||items.length!==1;menuFavorite.lastChild.textContent=favoriteText;menuFavorite.disabled=working||!items.length;batchFavorite.title=batchFavorite.ariaLabel=favoriteText;batchFavorite.disabled=working||!items.length;
      const byId=new Map(getClips().map(c=>[c.id,c]));for(const card of root.querySelectorAll('#sk-library-body [data-clip-id]')){const clip=byId.get(card.dataset.clipId);if(!clip)continue;let star=card.querySelector('.sk-clip-favorite');if(!star){star=button('','','star','sk-clip-favorite');star.lastChild.remove();star.addEventListener('click',event=>{event.stopPropagation();const current=getClips().find(c=>c.id===clip.id);if(current)patch([current.id],{favorite:!current.favorite});});star.addEventListener('dblclick',event=>event.stopPropagation());const host=card.querySelector('.sk-row-actions')||card;host.prepend(star);}star.disabled=working;star.setAttribute('aria-pressed',String(clip.favorite===true));star.title=star.ariaLabel=clip.favorite?t('Favorilerden Çıkar','Remove From Favorites'):t('Favorilere Ekle','Add To Favorites');
        if(card.matches('.sk-card')&&!card.querySelector('.sk-clip-tags')&&clip.tags?.length){const badges=el('span','sk-clip-tags');for(const tag of clip.tags.slice(0,2))badges.append(el('span','',tag));if(clip.tags.length>2)badges.append(el('span','','+'+(clip.tags.length-2)));card.querySelector('.sk-card-open').append(badges);}
      }
      const body=$('sk-library-body');if(active()&&body.querySelector('.sk-empty')){const empty=el('div','sk-library-empty'),reset=button('sk-library-empty-reset',t('Filtreleri Temizle','Clear Filters'),'rotate-ccw');empty.append(el('strong','',t('Eşleşen Klip Bulunamadı','No Matching Clips')),el('span','',t('Başka Bir Arama veya Filtre Dene.','Try Another Search Or Filter.')),reset);reset.addEventListener('click',()=>clear.click());body.replaceChildren(empty);}
      decorate();
    }
    render();return {filter:clips=>filterClips(clips,state),render};
  }
  const api={filterClips,dateKey,dateLabel,attach};if(typeof module!=='undefined')module.exports=api;scope.EmberLibraryBrowser=api;
})(typeof window==='undefined'?globalThis:window);
