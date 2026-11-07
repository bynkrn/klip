const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

test('monitor settings render and persist through the real offscreen capture settings UI', async t => {
  const root = path.join(__dirname, '..');
  const moduleFile = path.join(root, 'src/display-settings-ui.js');
  assert.equal(await fs.access(moduleFile).then(() => true, () => false), true, 'The display settings renderer is implemented');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ember-displays-ui-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const primary = { id: '\\\\?\\DISPLAY#PRIMARY#{exact-device-id}', name: 'Ana Ekran', width: 2560, height: 1440, x: 0, y: 0, primary: true, available: true };
  const secondary = { id: '\\\\?\\DISPLAY#SECONDARY#{second-exact-id}', name: 'Uzun İsimli İkinci Oyun Ekranı '.repeat(5), width: 1920, height: 1080, x: -1920, y: 0, primary: false, available: true };
  const template = await fs.readFile(path.join(root, 'src/ui-template.html'), 'utf8');
  const styles = template.match(/<style>[\s\S]*?<\/style>/g).join('\n');
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8">${styles}
    <style>html,body{margin:0}#sunset-klip-organized{height:100vh;display:block;box-sizing:border-box;border:0;border-radius:0;padding:24px;overflow:auto}</style>
    </head><body><main id="sunset-klip-organized"><section id="sk-settings-capture" class="sk-settings-capture"><div class="sk-settings-layout"><div class="sk-settings-grid"><section class="sk-setting-section" id="fixture-existing"><h2>Görüntü Kalitesi</h2></section></div></div></section></main>
    <script>${await fs.readFile(moduleFile, 'utf8')}</script>
    <script>
      window.primary=${JSON.stringify(primary)};window.secondary=${JSON.stringify(secondary)};
      window.config={monitorId:'',followGameMonitor:false,language:'tr',mode:'auto'};
      window.calls=[];window.writes=[];window.notices=[];window.deferEnumeration=true;
      window.ui=EmberDisplaySettings.attach({root:document.querySelector('#sunset-klip-organized'),getConfig:()=>config,
        call:async(name)=>{calls.push(name);if(name!=='capture-displays')throw Error('Unexpected action: '+name);if(window.deferEnumeration){window.deferEnumeration=false;return new Promise((resolve,reject)=>{window.finishEnumeration=resolve;window.failEnumeration=reject;});}return{displays:[primary,secondary],selection:{requestedMonitorId:config.monitorId,activeMonitorId:config.monitorId||primary.id,followGameMonitor:config.followGameMonitor,gameMonitorId:'',fallback:false,reason:config.monitorId?'selected-monitor':'primary'}};},
        setPreference:async(key,value)=>{writes.push({key,value});if(window.deferSave){window.deferSave=false;await new Promise((resolve,reject)=>{window.finishSave=resolve;window.failSave=reject;});}config={...config,[key]:value};ui.render();},notify:message=>notices.push(message)});
    </script></body></html>`;
  const htmlFile = path.join(dir, 'index.html');
  const resultFile = path.join(dir, 'result.json');
  const scriptFile = path.join(dir, 'fixture.js');
  await fs.writeFile(htmlFile, html);
  const inspect = `(async()=>{
    const $=s=>document.querySelector(s),wait=()=>new Promise(r=>setTimeout(r,20));
    const change=(selector,value)=>{const el=$(selector);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));};
    const monitor=()=>$('#sk-display-monitor'),follow=()=>$('#sk-display-follow-game'),refresh=()=>$('#sk-display-refresh');
    const options=()=>[...monitor().options].map(o=>({value:o.value,text:o.textContent,disabled:o.disabled}));
    const section=()=>$('#sk-display-settings');
    const out={initial:{title:section().querySelector('h2').textContent,loading:refresh().disabled,busy:refresh().getAttribute('aria-busy'),follow:follow().checked,protected:section().dataset.i18n,existing:!!$('#fixture-existing'),calls:[...calls]}};
    finishEnumeration({displays:[primary,secondary],selection:{requestedMonitorId:'',activeMonitorId:primary.id,followGameMonitor:false,gameMonitorId:'',fallback:false,reason:'primary'}});await wait();
    out.enumerated={options:options(),selected:monitor().value,follow:follow().checked,refreshDisabled:refresh().disabled};
    window.deferSave=true;change('#sk-display-monitor',secondary.id);await wait();
    out.pending={monitorDisabled:monitor().disabled,followDisabled:follow().disabled,value:monitor().value,text:section().textContent};
    change('#sk-display-follow-game',true);change('#sk-display-monitor',primary.id);await wait();out.pending.writes=writes.length;
    finishSave();await wait();out.selected={value:monitor().value,config:{...config},writes:[...writes],refreshes:calls.length};
    change('#sk-display-follow-game',true);await wait();out.following={checked:follow().checked,config:config.followGameMonitor,writes:writes.at(-1),refreshes:calls.length};
    const beforeConcurrent=calls.length;window.deferEnumeration=true;refresh().click();await wait();change('#sk-display-follow-game',false);await wait();
    finishEnumeration({displays:[primary,secondary],selection:{requestedMonitorId:secondary.id,activeMonitorId:primary.id,followGameMonitor:true,gameMonitorId:primary.id,fallback:false,reason:'game-monitor'}});await wait();
    out.concurrent={calls:calls.length-beforeConcurrent,checked:follow().checked,status:$('#sk-display-status').textContent};
    change('#sk-display-follow-game',true);await wait();
    ui.receive({running:true});await wait();const beforeRunning=writes.length;change('#sk-display-monitor',primary.id);change('#sk-display-follow-game',false);await wait();
    out.running={monitorDisabled:monitor().disabled,followDisabled:follow().disabled,refreshDisabled:refresh().disabled,extraWrites:writes.length-beforeRunning,text:section().textContent};
    ui.receive({running:false});config={...config,monitorId:secondary.id,followGameMonitor:false};ui.receive({displays:[primary],displaySelection:{requestedMonitorId:secondary.id,activeMonitorId:primary.id,followGameMonitor:false,gameMonitorId:'',fallback:true,reason:'selected-monitor-unavailable'}});await wait();
    out.disconnected={value:monitor().value,options:options(),status:$('#sk-display-status').textContent,saved:config.monitorId};
    config={...config,monitorId:'unknown-saved-id'};ui.render();out.unknown={value:monitor().value,options:options(),status:$('#sk-display-status').textContent};
    config={...config,monitorId:secondary.id,followGameMonitor:true};ui.receive({displays:[primary,secondary],displaySelection:{requestedMonitorId:secondary.id,activeMonitorId:primary.id,followGameMonitor:true,gameMonitorId:primary.id,fallback:false,reason:'game-monitor'}});await wait();
    out.native={selected:monitor().value,checked:follow().checked,status:$('#sk-display-status').textContent};
    const beforeRetry=calls.length;window.deferEnumeration=true;refresh().click();refresh().click();await wait();out.enumerationPending={calls:calls.length-beforeRetry,disabled:refresh().disabled};failEnumeration(Error('Display enumeration failed'));await wait();
    out.failed={options:options(),value:monitor().value,error:$('#sk-display-error').textContent,hidden:$('#sk-display-error').hidden,retry:refresh().getAttribute('aria-label'),disabled:monitor().disabled};
    refresh().click();await wait();out.retried={calls:calls.length-beforeRetry,hidden:$('#sk-display-error').hidden,value:monitor().value};
    window.deferSave=true;change('#sk-display-follow-game',false);await wait();failSave(Error('Preference save denied'));await wait();
    out.rollback={checked:follow().checked,saved:config.followGameMonitor,disabled:follow().disabled,error:$('#sk-display-error').textContent,notices:[...notices]};
    config={...config,language:'en',mode:'game'};document.documentElement.lang='en';ui.render();await wait();
    out.english={title:section().querySelector('h2').textContent,label:monitor().getAttribute('aria-label'),follow:$('#sk-display-follow-label').textContent,options:options(),note:$('#sk-display-note').textContent,error:$('#sk-display-error').textContent,value:monitor().value};
    config={...config,language:'tr'};document.documentElement.lang='tr';ui.render();await wait();out.turkish={title:section().querySelector('h2').textContent,value:monitor().value,follow:$('#sk-display-follow-label').textContent};
    ui.receive({displays:[],displaySelection:{requestedMonitorId:secondary.id,activeMonitorId:'',followGameMonitor:true,gameMonitorId:primary.id,fallback:true,reason:'no-displays'}});await wait();out.empty={value:monitor().value,status:$('#sk-display-status').textContent};
    ui.receive({displays:[primary,secondary]});await wait();out.reconnected={value:monitor().value,unavailable:monitor().selectedOptions[0].disabled};
    out.fit={page:document.documentElement.scrollWidth,width:innerWidth,section:section().getBoundingClientRect().width,select:monitor().getBoundingClientRect().width};return out;
  })()`;
  await fs.writeFile(scriptFile, `const {app,BrowserWindow}=require('electron'),fs=require('node:fs');app.setPath('userData',${JSON.stringify(path.join(dir, 'profile'))});app.disableHardwareAcceleration();app.whenReady().then(async()=>{let w;try{w=new BrowserWindow({show:false,width:850,height:850,webPreferences:{sandbox:true,contextIsolation:true,offscreen:true}});await w.loadFile(${JSON.stringify(htmlFile)});const out=await w.webContents.executeJavaScript(${JSON.stringify(inspect)});fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify(out));}catch(error){fs.writeFileSync(${JSON.stringify(resultFile)},JSON.stringify({error:error.stack}));}finally{w?.destroy();app.quit();}});`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = require('electron');
  const child = spawnSync(electron, [scriptFile], { env, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 0, [child.error?.message, child.stdout, child.stderr].filter(Boolean).join('\n'));
  const out = JSON.parse(await fs.readFile(resultFile, 'utf8'));
  assert(!out.error, out.error);

  await t.test('enumerates exact device IDs with primary defaults and protects its translated labels', () => {
    assert.deepEqual(out.initial, { title: 'Masaüstü Ekranı', loading: true, busy: 'true', follow: false, protected: 'off', existing: true, calls: ['capture-displays'] });
    assert.equal(out.enumerated.selected, '');
    assert.equal(out.enumerated.follow, false);
    assert.equal(out.enumerated.refreshDisabled, false);
    assert.deepEqual(out.enumerated.options.map(o => o.value), ['', primary.id, secondary.id]);
    assert.match(out.enumerated.options[0].text, /Birincil Ekran/);
    assert.match(out.enumerated.options[1].text, /Ana Ekran.*2560 × 1440.*Birincil/);
    assert.match(out.enumerated.options[2].text, /Uzun İsimli.*1920 × 1080/);
  });
  await t.test('serializes preference saves and does not claim a pending monitor change was applied', () => {
    assert.equal(out.pending.monitorDisabled, true);
    assert.equal(out.pending.followDisabled, true);
    assert.equal(out.pending.value, '');
    assert.match(out.pending.text, /Kaydediliyor/);
    assert.equal(out.pending.writes, 1);
    assert.equal(out.selected.value, secondary.id);
    assert.equal(out.selected.refreshes, 2);
    assert.deepEqual(out.selected.writes, [{ key: 'monitorId', value: secondary.id }]);
    assert.equal(out.following.checked, true);
    assert.equal(out.following.config, true);
    assert.equal(out.following.refreshes, 3);
    assert.deepEqual(out.following.writes, { key: 'followGameMonitor', value: true });
    assert.equal(out.concurrent.calls, 2);
    assert.equal(out.concurrent.checked, false);
    assert.match(out.concurrent.status, /Masaüstü Kaynağı.*Uzun İsimli/);
  });
  await t.test('running buffers block changes while keeping display refresh available', () => {
    assert.equal(out.running.monitorDisabled, true);
    assert.equal(out.running.followDisabled, true);
    assert.equal(out.running.refreshDisabled, false);
    assert.equal(out.running.extraWrites, 0);
    assert.match(out.running.text, /tamponu durdur/i);
  });
  await t.test('disconnected and unknown saved monitors remain selected while primary fallback is explained', () => {
    assert.equal(out.disconnected.value, secondary.id);
    assert.equal(out.disconnected.saved, secondary.id);
    assert.equal(out.disconnected.options.find(o => o.value === secondary.id).disabled, true);
    assert.match(out.disconnected.status, /kullanılamıyor/i);
    assert.match(out.disconnected.status, /birincil.*Ana Ekran/i);
    assert.equal(out.unknown.value, 'unknown-saved-id');
    assert.equal(out.unknown.options.find(o => o.value === 'unknown-saved-id').disabled, true);
    assert.match(out.unknown.status, /birincil.*Ana Ekran/i);
    assert.equal(out.native.selected, secondary.id);
    assert.equal(out.native.checked, true);
    assert.match(out.native.status, /Ana Ekran/);
    assert.match(out.empty.status, /ekran bulunamadı/i);
    assert.equal(out.empty.value, secondary.id);
    assert.deepEqual(out.reconnected, { value: secondary.id, unavailable: false });
  });
  await t.test('failed enumeration retains choices and offers a nonduplicating retry', () => {
    assert.deepEqual(out.enumerationPending, { calls: 1, disabled: true });
    assert.equal(out.failed.options.length, 3);
    assert.equal(out.failed.value, secondary.id);
    assert.equal(out.failed.hidden, false);
    assert.match(out.failed.error, /Ekranlar.*yeniden dene/i);
    assert.match(out.failed.retry, /Yeniden Dene/);
    assert.equal(out.failed.disabled, false);
    assert.deepEqual(out.retried, { calls: 2, hidden: true, value: secondary.id });
  });
  await t.test('rejected persistence rolls the control back and translates errors and game mode guidance', () => {
    assert.equal(out.rollback.checked, true);
    assert.equal(out.rollback.saved, true);
    assert.equal(out.rollback.disabled, false);
    assert.match(out.rollback.error, /kaydedilemedi/i);
    assert(out.rollback.notices.length > 0);
    assert.equal(out.english.title, 'Desktop Display');
    assert.equal(out.english.label, 'Desktop Display');
    assert.equal(out.english.follow, "Follow The Game's Display");
    assert.match(out.english.options[0].text, /System Primary Display/);
    assert.match(out.english.options[1].text, /Ana Ekran.*Primary/);
    assert.match(out.english.note, /desktop capture/i);
    assert.match(out.english.note, /Game Only/);
    assert.match(out.english.error, /could not be saved/i);
    assert.equal(out.english.value, secondary.id);
    assert.deepEqual(out.turkish, { title: 'Masaüstü Ekranı', value: secondary.id, follow: 'Oyunun Ekranını Takip Et' });
    assert(out.fit.section > 250);
    assert(out.fit.select > 200);
    assert(out.fit.select <= out.fit.section);
    assert(out.fit.page <= out.fit.width, `Settings overflow at ${out.fit.width}px: ${out.fit.page}px`);
  });
});
