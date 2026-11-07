(function (global) {
  'use strict';

  function attach({ root, getConfig, setPreference, call, notify = () => {} }) {
    const document = root.ownerDocument;
    const grid = root.querySelector('#sk-settings-capture .sk-settings-grid');
    if (!grid) throw new Error('Capture settings grid is missing.');
    const names = new Map();
    let displays = [], selection = null, gameMonitorId = '', running = false;
    let enumerated = false, loading = false, saving = false, enumerationError = false, saveError = false, refreshAfterSave = false, nativeRevision = 0;
    const en = () => getConfig().language === 'en';
    const text = (tr, english) => en() ? english : tr;
    const create = (tag, className, id) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (id) element.id = id;
      return element;
    };
    const style = create('style');
    style.textContent = `
      #sunset-klip-organized #sk-display-settings{min-width:0;max-width:100%}
      #sunset-klip-organized #sk-display-label{color:var(--sk-muted)}
      #sunset-klip-organized .sk-display-select-row{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%}
      #sunset-klip-organized #sk-display-monitor{flex:1;width:100%;min-width:0;text-overflow:ellipsis}
      #sunset-klip-organized #sk-display-refresh{display:grid;place-items:center;flex:0 0 38px;width:38px;min-height:38px;padding:8px}
      #sunset-klip-organized #sk-display-refresh svg{width:17px;height:17px}
      #sunset-klip-organized #sk-display-refresh[aria-busy=true] svg{animation:sk-display-refresh-spin 1s linear infinite}
      #sunset-klip-organized #sk-display-settings .sk-setting-note{overflow-wrap:anywhere;line-height:1.55}
      #sunset-klip-organized #sk-display-status{margin-top:10px}
      #sunset-klip-organized #sk-display-status[data-warning=true],#sunset-klip-organized #sk-display-error{color:var(--sk-amber)}
      #sunset-klip-organized #sk-display-error,#sunset-klip-organized #sk-display-operation,#sunset-klip-organized #sk-display-lock{margin-top:8px}
      @keyframes sk-display-refresh-spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){#sunset-klip-organized #sk-display-refresh[aria-busy=true] svg{animation:none}}
    `;
    root.append(style);
    const section = create('section', 'sk-setting-section', 'sk-display-settings');
    section.dataset.i18n = 'off';
    section.setAttribute('aria-labelledby', 'sk-display-title');
    section.innerHTML = '<h2 id="sk-display-title"></h2><div class="sk-field"><label id="sk-display-label" for="sk-display-monitor"></label><div class="sk-display-select-row"><select id="sk-display-monitor" aria-describedby="sk-display-status sk-display-lock sk-display-note"></select><button type="button" class="sk-button sk-ghost" id="sk-display-refresh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8 8 0 0 1 19.5 9M4.5 15a8 8 0 0 0 13.4 2.9"/></svg></button></div></div><label class="sk-check"><input type="checkbox" id="sk-display-follow-game" aria-describedby="sk-display-follow-help sk-display-lock"><span><span id="sk-display-follow-label"></span><small id="sk-display-follow-help"></small></span></label><p class="sk-setting-note" id="sk-display-note"></p><p class="sk-setting-note" id="sk-display-status" role="status" aria-live="polite"></p><p class="sk-setting-note" id="sk-display-operation" role="status" aria-live="polite" hidden></p><p class="sk-setting-note" id="sk-display-lock" hidden></p><p class="sk-setting-note" id="sk-display-error" role="alert" hidden></p>';
    grid.append(section);
    const $ = id => section.querySelector('#' + id);
    const monitor = $('sk-display-monitor'), follow = $('sk-display-follow-game'), refresh = $('sk-display-refresh');
    const requestedId = () => typeof getConfig().monitorId === 'string' ? getConfig().monitorId : '';
    const following = () => getConfig().followGameMonitor === true;
    const displayName = display => display ? display.name || display.id : '';

    function remember(list) {
      const seen = new Set();
      displays = list.filter(display => {
        if (!display || typeof display.id !== 'string' || !display.id || seen.has(display.id)) return false;
        seen.add(display.id);
        if (typeof display.name === 'string' && display.name) names.set(display.id, display.name);
        return display.available !== false;
      }).map(display => ({ ...display }));
      enumerated = true;
    }

    function currentSelection() {
      const requestedMonitorId = requestedId(), followGameMonitor = following();
      const matching = selection && selection.requestedMonitorId === requestedMonitorId && selection.followGameMonitor === followGameMonitor;
      if (matching && displays.some(display => display.id === selection.activeMonitorId)) return selection;
      const desired = followGameMonitor && gameMonitorId ? gameMonitorId : requestedMonitorId;
      const selected = desired && displays.find(display => display.id === desired);
      const active = selected || displays.find(display => display.primary);
      const reason = !displays.length ? 'no-displays' : !active ? 'no-primary-display' : selected ? (followGameMonitor && gameMonitorId ? 'game-monitor' : 'selected-monitor') : desired ? (followGameMonitor && gameMonitorId ? 'game-monitor-unavailable' : 'selected-monitor-unavailable') : 'primary';
      return { requestedMonitorId, followGameMonitor, activeMonitorId: active?.id || '', fallback: !active || Boolean(desired && !selected), reason };
    }

    function statusText() {
      const current = currentSelection(), active = displays.find(display => display.id === current.activeMonitorId);
      if (!enumerated) return text('Ekran listesi yükleniyor…', 'Loading the display list…');
      if (!displays.length) return text('Kaydedilecek ekran bulunamadı. Ekran bağlantılarını kontrol edip yeniden dene.', 'No display was found for capture. Check the display connections and retry.');
      if (!active) return text('Birincil ekran bulunamadı. Listeden kullanılabilir bir ekran seç.', 'The primary display was not found. Choose an available display from the list.');
      const name = displayName(active);
      if (current.reason === 'monitor-switch-failed') return text('Masaüstü kaynağı değiştirilemedi. Mevcut ekran: ', 'The desktop source could not be switched. Current display: ') + name;
      if (current.fallback) return text(current.reason === 'game-monitor-unavailable' ? 'Oyunun ekranı kullanılamıyor. Birincil ekran: ' : 'Seçili ekran kullanılamıyor. Birincil ekran: ', current.reason === 'game-monitor-unavailable' ? "The game's display is unavailable. Primary display: " : 'The selected display is unavailable. Primary display: ') + name + text('. Kayıtlı ekran seçimin korunur.', '. Your saved display choice is retained.');
      if (current.reason === 'game-monitor') return text('Oyunun Ekranı İzleniyor: ', 'Following The Game: ') + name;
      return (following() ? text('Oyun Bulunana Kadar: ', 'Until A Game Is Found: ') : text('Masaüstü Kaynağı: ', 'Desktop Source: ')) + name;
    }

    function errorText() {
      if (saveError) return text('Ekran ayarı kaydedilemedi. Önceki seçimin korunuyor; yeniden dene.', 'The display setting could not be saved. Your previous choice is retained; retry.');
      if (enumerationError) return text('Ekranlar yenilenemedi. Son ekran listesi korunuyor; yeniden dene.', 'Displays could not be refreshed. The last display list is retained; retry.');
      return '';
    }

    function render() {
      const value = requestedId(), current = currentSelection();
      const title = text('Masaüstü Ekranı', 'Desktop Display');
      $('sk-display-title').textContent = title;
      $('sk-display-label').textContent = title;
      monitor.setAttribute('aria-label', title);
      const options = [];
      const option = (id, label, disabled = false) => {
        const element = create('option');
        element.value = id;
        element.textContent = label;
        element.disabled = disabled;
        options.push(element);
      };
      option('', text('Sistem Birincil Ekranı', 'System Primary Display'));
      for (const display of displays) {
        const resolution = Number(display.width) > 0 && Number(display.height) > 0 ? ` · ${display.width} × ${display.height}` : '';
        option(display.id, displayName(display) + resolution + (display.primary ? text(' · Birincil', ' · Primary') : ''));
      }
      if (value && !displays.some(display => display.id === value)) option(value, (names.get(value) || text('Kayıtlı Ekran', 'Saved Display')) + text(' · Kullanılamıyor', ' · Unavailable'), true);
      monitor.replaceChildren(...options);
      monitor.value = value;
      follow.checked = following();
      monitor.disabled = follow.disabled = running || saving;
      $('sk-display-follow-label').textContent = text('Oyunun Ekranını Takip Et', "Follow The Game's Display");
      $('sk-display-follow-help').textContent = text('Oyun başka ekrana taşındığında masaüstü kaynağı da o ekranı izler.', 'The desktop source follows the detected game when it moves to another display.');
      $('sk-display-note').textContent = getConfig().mode === 'game' ? text('Bu seçim masaüstü yakalama içindir. Yalnız Oyun modunda oyun yakalamayı değiştirmez.', 'This setting is for desktop capture. It does not change game capture in Game Only mode.') : text('Bu seçim masaüstü yakalamayı etkiler; oyun yakalama kaynağını değiştirmez.', 'This setting controls desktop capture; it does not change the game capture source.');
      $('sk-display-status').textContent = statusText();
      $('sk-display-status').dataset.warning = String(enumerated && (current.fallback || current.reason === 'monitor-switch-failed'));
      $('sk-display-lock').hidden = !running;
      $('sk-display-lock').textContent = text('Ekran ayarlarını değiştirmek için önce tamponu durdur.', 'Stop the buffer before changing display settings.');
      const operation = $('sk-display-operation');
      operation.hidden = !loading && !saving;
      operation.textContent = saving ? text('Kaydediliyor…', 'Saving…') : text('Ekranlar Yenileniyor…', 'Refreshing Displays…');
      const error = $('sk-display-error');
      error.textContent = errorText();
      error.hidden = !error.textContent;
      const refreshLabel = loading ? text('Ekranlar Yenileniyor…', 'Refreshing Displays…') : enumerationError ? text('Ekranları Yeniden Dene', 'Retry Display List') : text('Ekranları Yenile', 'Refresh Displays');
      refresh.setAttribute('aria-label', refreshLabel);
      refresh.title = refreshLabel;
      refresh.setAttribute('aria-busy', String(loading));
      refresh.disabled = loading;
    }

    function receive(incoming) {
      if (!incoming || typeof incoming !== 'object') return;
      if (typeof incoming.running === 'boolean') running = incoming.running;
      if (Array.isArray(incoming.displays)) {
        nativeRevision++;
        if (incoming.displaySelection?.reason !== 'enumeration-failed') {
          remember(incoming.displays);
          enumerationError = false;
        }
        selection = null;
      }
      if (incoming.displaySelection && typeof incoming.displaySelection === 'object') {
        nativeRevision++;
        selection = { ...incoming.displaySelection };
        gameMonitorId = typeof selection.gameMonitorId === 'string' ? selection.gameMonitorId : '';
        if (selection.reason === 'enumeration-failed') enumerationError = true;
      }
      render();
    }

    async function refreshDisplays() {
      if (loading) return;
      loading = true;
      const revision = nativeRevision;
      render();
      try {
        const result = await call('capture-displays');
        if (!Array.isArray(result?.displays)) throw new Error('Invalid display list.');
        if (revision !== nativeRevision) return;
        receive({ displays: result.displays, displaySelection: result.selection });
      } catch (_) {
        if (revision !== nativeRevision) return;
        enumerationError = true;
        notify(text('Ekranlar yenilenemedi. Yeniden deneyebilirsin.', 'Displays could not be refreshed. You can retry.'));
      } finally {
        loading = false;
        render();
        if (refreshAfterSave) {
          refreshAfterSave = false;
          refreshDisplays();
        }
      }
    }

    async function save(key, value) {
      if (running || saving) { render(); return; }
      if (getConfig()[key] === value || key === 'followGameMonitor' && following() === value) { render(); return; }
      saving = true;
      saveError = false;
      render();
      let accepted = false;
      try {
        await setPreference(key, value);
        accepted = true;
      } catch (_) {
        saveError = true;
        notify(errorText());
      } finally {
        saving = false;
        render();
      }
      if (accepted) {
        if (loading) refreshAfterSave = true;
        else refreshDisplays();
      }
    }

    monitor.addEventListener('change', () => save('monitorId', monitor.value));
    follow.addEventListener('change', () => save('followGameMonitor', follow.checked));
    refresh.addEventListener('click', refreshDisplays);
    render();
    refreshDisplays();
    return { render, receive };
  }

  global.EmberDisplaySettings = { attach };
})(globalThis);
