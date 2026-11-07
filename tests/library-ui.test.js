const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/ui-template.html'),'utf8');
function production(name){const match=new RegExp('  (?:async )?function '+name+'\\(').exec(source);assert.ok(match,`Missing library behavior: ${name}`);const next=source.indexOf('\n  function ',match.index+match[0].length),asyncNext=source.indexOf('\n  async function ',match.index+match[0].length);return source.slice(match.index,Math.min(...[next,asyncNext].filter(n=>n>=0)));}
function control(){return {dataset:{},attributes:{},listeners:{},children:[],style:{},setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name]??this[name]??null;},removeAttribute(name){delete this.attributes[name];if(name==='src'||name==='poster')delete this[name];},addEventListener(name,listener){this.listeners[name]=listener;},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},querySelector(){return null;},showModal(){this.open=true;},close(){this.open=false;},pause(){this.paused=true;},load(){this.loads=(this.loads||0)+1;},play(){this.plays=(this.plays||0)+1;return Promise.resolve();}};}
function harness(extra={}){
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',style:{},setAttribute(){},hidePopover(){},showPopover(){},matches(){return false;},getBoundingClientRect:()=>({width:282,height:220}),querySelector:()=>({focus(){}})});return elements.get(id);};
  const context={clips:[{id:'a',day:'today',game:'A'},{id:'b',day:'today',game:'A'},{id:'c',day:'yesterday',game:'A'},{id:'d',day:'yesterday',game:'B'}],view:'grid',gameFolder:'all',selectedIds:new Set(),selectionAnchor:'',deleting:false,activeMediaId:'',selectedId:'',page:'clips',waitingKey:false,menuClip:null,innerWidth:1024,innerHeight:600,window:{},editorAudio:{clipId:''},editorTimeline:{clipId:''},renderPlayer(){},gameFor:c=>c.game,$:element,make:()=>control(),icon:()=>({}),root:{querySelectorAll:()=>[],querySelector:()=>null},notify:message=>context.message=message,persist(){},renderClips(){context.rendered=true;},video:{pause(){context.paused=true;},removeAttribute(){context.released=true;},load(){}},showPage:p=>context.page=p,openClip:(clip,destination)=>{context.opened=clip.id;context.destination=destination;},...extra};
  context.libraryBrowser=null;vm.createContext(context);for(const name of ['libraryClips','selectClip','syncLibrarySelection','deleteSelection','openMenu','handleLibraryKey'])vm.runInContext(production(name),context);return context;
}
test('single context selection replaces a group while checkbox selection toggles additively',()=>{
  const h=harness();h.selectClip(h.clips[0]);assert.deepEqual([...h.selectedIds],['a']);h.selectClip(h.clips[2],true);assert.deepEqual([...h.selectedIds],['a','c']);h.selectClip(h.clips[1]);assert.deepEqual([...h.selectedIds],['b']);assert.equal(h.selectedId,'');h.selectClip(h.clips[1],true);assert.deepEqual([...h.selectedIds],[]);
});
test('selection cannot include clips outside the active folder',()=>{
  const h=harness({gameFolder:'A'});h.selectClip(h.clips[0],true);h.selectClip(h.clips[3],true);assert.deepEqual([...h.selectedIds],['a']);
});
test('filtering a selected clip out clears its hidden selection before batch actions',()=>{
  const h=harness({selectedIds:new Set(['a','b'])});h.libraryBrowser={filter:items=>items.filter(c=>c.id==='b'),render(){}};h.syncLibrarySelection();assert.deepEqual([...h.selectedIds],['b']);
});
test('partial native trash result retains failed selection and releases deleted media',async()=>{
  const h=harness({selectedIds:new Set(['a','b']),activeMediaId:'a',selectedId:'a',page:'viewer'});h.window.klip={call:async(action,payload)=>{assert.equal(action,'delete');assert.deepEqual(Array.from(payload.ids),['a','b']);return {clips:h.clips.filter(c=>c.id!=='a'),deleted:['a'],failed:[{id:'b',error:'busy'}]};}};await h.deleteSelection();assert.deepEqual([...h.selectedIds],['b']);assert.equal(h.clips.some(c=>c.id==='a'),false);assert.equal(h.paused,true);assert.equal(h.released,true);assert.equal(h.page,'clips');assert.equal(h.deleting,false);assert.match(h.message,/1.*silinemedi/);
});
test('pending trash prevents duplicate requests and preserves selection on IPC error',async()=>{
  let reject,calls=0;const h=harness({selectedIds:new Set(['a'])});h.window.klip={call:()=>{calls++;return new Promise((_,r)=>reject=r);}};const pending=h.deleteSelection();await h.deleteSelection();assert.equal(calls,1);reject(new Error('permission denied'));await pending;assert.deepEqual([...h.selectedIds],['a']);assert.equal(h.deleting,false);assert.match(h.message,/permission denied/);
});
test('prototype deletion is explicitly local and does not call native files',async()=>{const h=harness({selectedIds:new Set(['b'])});await h.deleteSelection();assert.deepEqual(Array.from(h.clips,c=>c.id),['a','c','d']);assert.match(h.message,/Örnek/);});
test('failed imported trash remains visible and selected when native library scan omits it',async()=>{
  const imported={id:'outside',day:'today',game:'İçe aktarılanlar',name:'Imported'};
  const h=harness({clips:[{id:'local',day:'today',game:'A'},imported],selectedIds:new Set(['outside'])});
  h.window.klip={call:async()=>({clips:[h.clips[0]],deleted:[],failed:[{id:'outside',error:'busy'}]})};
  await h.deleteSelection();assert.equal(h.clips.find(c=>c.id==='outside'),imported);assert.deepEqual([...h.selectedIds],['outside']);assert.equal(h.$('sk-selection-count').textContent,'1 seçili');
});
test('deleting a local clip preserves unrelated import and prefers returned metadata without duplicates',async()=>{
  const imported={id:'outside',day:'today',game:'İçe aktarılanlar',name:'Imported'},updated={...imported,name:'Updated'};
  const h=harness({clips:[{id:'local',day:'today',game:'A'},imported,{id:'other-import',day:'today',game:'İçe aktarılanlar'}],selectedIds:new Set(['local'])});
  h.window.klip={call:async()=>({clips:[updated],deleted:['local'],failed:[]})};
  await h.deleteSelection();assert.deepEqual(Array.from(h.clips,c=>c.id),['outside','other-import']);assert.equal(h.clips[0],updated);assert.equal(h.selectedIds.size,0);
});
test('failed local clip omitted from returned scan also stays selected',async()=>{
  const h=harness({selectedIds:new Set(['a','b'])}),failed=h.clips[1];h.window.klip={call:async()=>({clips:[],deleted:['a'],failed:[{id:'b',error:'busy'}]})};
  await h.deleteSelection();assert.equal(h.clips.find(c=>c.id==='b'),failed);assert.deepEqual([...h.selectedIds],['b']);
});
test('context menu preserves existing multiple selection and stays within viewport',()=>{
  const h=harness({selectedIds:new Set(['a','b'])}),trigger={getBoundingClientRect:()=>({right:1000,bottom:590})};h.openMenu(h.clips[1],trigger,{clientX:1000,clientY:590});assert.deepEqual([...h.selectedIds],['a','b']);assert.equal(h.$('sk-menu-watch').disabled,true);assert.equal(h.$('sk-menu-edit').disabled,true);assert.equal(h.$('sk-clip-menu').style.left,'734px');assert.equal(h.$('sk-clip-menu').style.top,'372px');h.openMenu(h.clips[2],trigger,{clientX:20,clientY:20});assert.deepEqual([...h.selectedIds],['c']);assert.equal(h.$('sk-menu-watch').disabled,false);assert.equal(h.$('sk-selection-count').textContent,'1 seçili');
});
test('Ctrl+A never selects clips, while Escape and Enter respect current checkbox selection',()=>{
  const h=harness({gameFolder:'A'}),event=(key,extra={})=>({key,target:{closest:()=>null},preventDefault(){this.prevented=true;},stopImmediatePropagation(){},...extra});const selectAll=event('a',{ctrlKey:true});h.handleLibraryKey(selectAll);assert.equal(h.selectedIds.size,0);assert.equal(selectAll.prevented,undefined);h.selectClip(h.clips[0],true);h.selectClip(h.clips[1],true);h.handleLibraryKey(event('Enter'));assert.equal(h.opened,undefined);h.handleLibraryKey(event('Escape',{target:{closest:()=>({})}}));assert.equal(h.selectedIds.size,2);h.page='settings';h.handleLibraryKey(event('Escape'));assert.equal(h.selectedIds.size,2);h.page='clips';h.handleLibraryKey(event('Escape'));assert.equal(h.selectedIds.size,0);h.selectClip(h.clips[1],true);h.handleLibraryKey(event('Enter'));assert.equal(h.opened,'b');
});
test('checkbox clicks add and remove individual clips without Ctrl or opening the viewer',()=>{
  const h=harness();vm.runInContext(production('selectionCheckbox'),h);const first=h.selectionCheckbox(h.clips[0]),second=h.selectionCheckbox(h.clips[1]);
  h.root.querySelectorAll=()=>[{dataset:{clipId:'a'},querySelector:()=>first},{dataset:{clipId:'b'},querySelector:()=>second}];
  const click=button=>{const event={stopPropagation(){this.stopped=true;}};button.listeners.click(event);assert.equal(event.stopped,true);};
  click(first);click(second);assert.deepEqual([...h.selectedIds],['a','b']);assert.equal(first.attributes['aria-checked'],'true');assert.equal(second.attributes['aria-checked'],'true');click(first);assert.deepEqual([...h.selectedIds],['b']);assert.equal(h.opened,undefined);assert.equal(first.type,'button');assert.equal(first.attributes.role,'checkbox');assert.equal(first.attributes['aria-checked'],'false');assert.equal(second.attributes['aria-checked'],'true');
});
test('card or row body always opens viewer with one click, including Ctrl and Shift clicks',()=>{
  const h=harness();vm.runInContext(production('bindClipSelection'),h);const card=control(),button=control();h.bindClipSelection(card,button,h.clips[1]);
  const event={target:{closest:()=>null}};card.listeners.click(event);assert.equal(h.opened,'b');assert.equal(h.destination,'viewer');assert.equal(h.selectedIds.size,0);
  for(const modifier of ['ctrlKey','shiftKey','metaKey']){h.opened=undefined;card.listeners.click({...event,[modifier]:true});assert.equal(h.opened,'b');assert.equal(h.destination,'viewer');assert.equal(h.selectedIds.size,0);}
});
test('checkbox events reaching a card do not open video, and Enter on a focused clip uses its own click',()=>{
  const h=harness({selectedIds:new Set(['a'])});vm.runInContext(production('bindClipSelection'),h);const row=control(),button=control();h.bindClipSelection(row,button,h.clips[1]);row.listeners.click({target:{closest:selector=>selector.includes('sk-select-check')?{}:null}});assert.equal(h.opened,undefined);
  h.handleLibraryKey({key:'Enter',target:{closest:selector=>selector==='button'||selector.includes('sk-card-open')?{}:null},preventDefault(){},stopImmediatePropagation(){}});assert.equal(h.opened,undefined);
});
function trashHarness(extra={}){
  const h=harness({trashEntries:[],trashSelectedIds:new Set(),trashLoading:false,trashRestoring:false,trashError:'',trashPreviewId:'',trashPreviewGeneration:0,games:['A'],decorate(){},...extra}),elements=new Map();
  h.$=id=>{if(!elements.has(id))elements.set(id,control());return elements.get(id);};
  h.make=(tag,cls,text)=>Object.assign(control(),{tagName:tag.toUpperCase(),className:cls,textContent:text});
  for(const name of ['syncTrashSelection','toggleTrashSelection','refreshTrash','restoreTrash','formatTrashSize','formatTrashDate','renderTrash','renderStartupOption'])vm.runInContext(production(name),h);
  return h;
}
test('trash refresh exposes loading, empty and error states and prevents repeat requests',async()=>{
  const h=trashHarness();let resolve,calls=0;h.window.klip={call:action=>{assert.equal(action,'trash-list');calls++;return new Promise(r=>resolve=r);}};const pending=h.refreshTrash();assert.equal(h.trashLoading,true);assert.match(h.$('sk-trash-status').textContent,/yükleniyor/);await h.refreshTrash();assert.equal(calls,1);resolve([]);await pending;assert.equal(h.trashLoading,false);assert.match(h.$('sk-trash-status').textContent,/klip yok/);h.window.klip.call=async()=>{throw new Error('Denied');};await h.refreshTrash();assert.match(h.$('sk-trash-status').textContent,/Denied/);assert.equal(h.$('sk-trash-status').attributes.role,'alert');
});
test('trash checkboxes toggle independently and partial restore retains failures and imported references',async()=>{
  const imported={id:'outside',game:'İçe aktarılanlar'},a={id:'bin-a',fileName:'a.mp4'},b={id:'bin-b',fileName:'b.mp4'};
  const h=trashHarness({clips:[imported],trashEntries:[a,b]});h.toggleTrashSelection('bin-a');h.toggleTrashSelection('bin-b');assert.deepEqual([...h.trashSelectedIds],['bin-a','bin-b']);h.toggleTrashSelection('bin-a');assert.deepEqual([...h.trashSelectedIds],['bin-b']);h.toggleTrashSelection('bin-a');
  h.window.klip={call:async(action,payload)=>{assert.equal(action,'trash-restore');assert.deepEqual(Array.from(payload.ids),['bin-b','bin-a']);return {restored:[{id:'bin-a',file:'restored-a'}],failed:[{id:'bin-b',error:'same name'}],entries:[b],clips:[{id:'restored-a',game:'A'}]};}};
  await h.restoreTrash();assert.deepEqual([...h.trashSelectedIds],['bin-b']);assert.equal(h.clips.find(c=>c.id==='outside'),imported);assert.equal(h.clips.some(c=>c.id==='restored-a'),true);assert.match(h.message,/1.*yüklenemedi.*same name/);assert.equal(h.trashRestoring,false);
});
test('per-item restore sends only that entry and pending/error requests preserve other selections',async()=>{
  let reject,calls=0;const h=trashHarness({trashEntries:[{id:'bin-a'},{id:'bin-b'}],trashSelectedIds:new Set(['bin-b'])});h.window.klip={call:(action,payload)=>{calls++;assert.deepEqual(Array.from(payload.ids),['bin-a']);return new Promise((_,r)=>reject=r);}};const pending=h.restoreTrash(['bin-a']);await h.restoreTrash(['bin-a']);assert.equal(calls,1);reject(new Error('busy'));await pending;assert.deepEqual([...h.trashSelectedIds],['bin-b']);assert.equal(h.trashRestoring,false);assert.match(h.message,/busy/);
});
test('confirmed restore stays successful when post-restore refresh fails and existing library survives',async()=>{
  const local={id:'local',game:'A'},imported={id:'outside',game:'İçe aktarılanlar'},remaining={id:'bin-b',fileName:'b.mp4'};
  const h=trashHarness({clips:[local,imported],trashEntries:[{id:'bin-a'},remaining],trashSelectedIds:new Set(['bin-a','bin-b'])});
  h.window.klip={call:async()=>({restored:[{id:'bin-a',file:'restored-a'}],failed:[{id:'bin-b',error:'same name'}],entries:[remaining],clips:null,refreshError:'Bin refresh failed',libraryError:'Library refresh failed'})};
  await h.restoreTrash();assert.equal(h.clips.length,2);assert.equal(h.clips[0],local);assert.equal(h.clips[1],imported);assert.deepEqual([...h.trashSelectedIds],['bin-b']);assert.equal(h.trashEntries[0],remaining);assert.match(h.message,/1 klip geri yüklendi; 1 klip geri yüklenemedi/);assert.match(h.message,/Bin refresh failed/);assert.match(h.message,/Library refresh failed/);assert.doesNotMatch(h.message,/^Klipler geri yüklenemedi/);
});
test('trash list shows filename, game, size, deleted date and original location tooltip',()=>{
  const h=trashHarness({trashEntries:[{id:'bin-a',fileName:'clip.mp4',game:'Quake Live',size:1048576,deletedAt:'2026-11-01T10:30:00Z',originalPath:'C:\\Videos\\Klip\\clip.mp4'}]});h.renderTrash();const row=h.$('sk-trash-list').children[0];assert.equal(row.dataset.trashId,'bin-a');assert.equal(row.children[1].attributes.title,'C:\\Videos\\Klip\\clip.mp4');assert.equal(row.children[1].children[1].children[0].textContent,'clip.mp4');assert.equal(row.children[1].children[1].children[1].textContent,'Quake Live');assert.match(row.children[2].textContent,/1.*MB/);assert.notEqual(row.children[3].textContent,'—');assert.equal(row.children[0].attributes.role,'checkbox');
});
function previewHarness(extra={}){const h=trashHarness({page:'trash',...extra});for(const name of ['closeTrashPreview','openTrashPreview','restoreTrashPreview'])vm.runInContext(production(name),h);return h;}
test('trash thumbnail is lazy and watching never changes checkbox selection',async()=>{
  const h=trashHarness({trashEntries:[{id:'bin-a',fileName:'clip.mp4',thumbnail:'klipmedia://thumb'}]});let watched='';h.openTrashPreview=async id=>watched=id;h.renderTrash();const watch=h.$('sk-trash-list').children[0].children[1],image=watch.children[0].children.find(child=>child.tagName==='IMG');assert.equal(image.loading,'lazy');assert.equal(image.src,'klipmedia://thumb');assert.equal(watched,'');image.listeners.error();assert.equal(image.hidden,true);await watch.listeners.click();assert.equal(watched,'bin-a');assert.equal(h.trashSelectedIds.size,0);
});
test('closing preview releases media and ignores a late native preview result',async()=>{
  const h=previewHarness({trashEntries:[{id:'bin-a',fileName:'a.mp4'}]});let resolve;h.window.klip={call:()=>new Promise(r=>resolve=r)};const pending=h.openTrashPreview('bin-a');h.closeTrashPreview();resolve({id:'bin-a',videoUrl:'klipmedia://a',thumbnail:'klipmedia://thumb'});await pending;const media=h.$('sk-trash-preview-video');assert.equal(media.src,undefined);assert.equal(media.poster,undefined);assert.equal(media.paused,true);assert.equal(media.plays,undefined);assert.equal(h.$('sk-trash-preview-dialog').open,false);assert.equal(h.trashPreviewId,'');
});
test('switching preview clips ignores the first result and navigation releases the active media',async()=>{
  const h=previewHarness({trashEntries:[{id:'a'},{id:'b'}]});const pending={};h.window.klip={call:(_action,{id})=>new Promise(r=>pending[id]=r)};const a=h.openTrashPreview('a'),b=h.openTrashPreview('b');pending.a({id:'a',videoUrl:'klipmedia://a'});await a;assert.equal(h.$('sk-trash-preview-video').src,undefined);pending.b({id:'b',videoUrl:'klipmedia://b'});await b;assert.equal(h.$('sk-trash-preview-video').src,'klipmedia://b');assert.equal(h.$('sk-trash-preview-video').plays,1);vm.runInContext(production('showPage'),h);h.showPage('clips');assert.equal(h.$('sk-trash-preview-video').src,undefined);assert.equal(h.$('sk-trash-preview-dialog').open,false);
});
test('preview failure leaves the clip restorable and restore releases it before native mutation',async()=>{
  const h=previewHarness({trashEntries:[{id:'a',fileName:'a.mp4'}]});h.window.klip={call:async action=>{if(action==='trash-preview')throw new Error('Cannot decode');assert.equal(action,'trash-restore');assert.equal(h.trashPreviewId,'');assert.equal(h.$('sk-trash-preview-dialog').open,false);assert.equal(h.$('sk-trash-preview-video').src,undefined);return {restored:[{id:'a',file:'restored'}],failed:[],entries:[],clips:null};}};await h.openTrashPreview('a');assert.match(h.$('sk-trash-preview-status').textContent,/Cannot decode/);assert.equal(h.$('sk-trash-preview-restore').disabled,false);await h.restoreTrashPreview();assert.match(h.message,/1 klip geri yüklendi/);assert.equal(h.trashEntries.length,0);
});
test('restoring a playing preview releases its source and poster before calling native restore',async()=>{
  const h=previewHarness({trashEntries:[{id:'a'}]});h.window.klip={call:async(action,payload)=>{if(action==='trash-preview')return {id:'a',videoUrl:'klipmedia://a',thumbnail:'klipmedia://poster'};assert.deepEqual(Array.from(payload.ids),['a']);const media=h.$('sk-trash-preview-video');assert.equal(media.src,undefined);assert.equal(media.poster,undefined);assert.equal(media.paused,true);return {restored:[{id:'a',file:'restored'}],failed:[],entries:[],clips:null};}};await h.openTrashPreview('a');assert.equal(h.$('sk-trash-preview-video').src,'klipmedia://a');await h.restoreTrashPreview();assert.match(h.message,/1 klip geri yüklendi/);
});
test('restoring while preview is pending invalidates the eventual result without reopening video',async()=>{
  const h=previewHarness({trashEntries:[{id:'a'}]});let resolve;h.window.klip={call:async(action)=>action==='trash-preview'?new Promise(r=>resolve=r):{restored:[{id:'a',file:'restored'}],failed:[],entries:[],clips:null}};const pending=h.openTrashPreview('a');await h.restoreTrashPreview();resolve({id:'a',videoUrl:'klipmedia://a'});await pending;assert.equal(h.$('sk-trash-preview-dialog').open,false);assert.equal(h.$('sk-trash-preview-video').src,undefined);assert.equal(h.$('sk-trash-preview-video').plays,undefined);
});
test('startup tray option disables with Windows startup off while preserving the remembered value',()=>{
  const h=trashHarness({config:{launch:false,launchMinimized:true}});h.renderStartupOption();assert.equal(h.$('sk-launch-minimized').disabled,true);assert.equal(h.$('sk-launch-minimized').checked,true);h.config.launch=true;h.renderStartupOption();assert.equal(h.$('sk-launch-minimized').disabled,false);assert.equal(h.config.launchMinimized,true);
});
