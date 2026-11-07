// Explicit main/preload/renderer smoke: node tests/update-startup-package-smoke.js [resources/app]
// Uses only its own temporary profile. Capture and update transport are fixtures;
// the application startup, IPC bridge, renderer, acknowledgement, and shutdown are real.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');

async function electronFixture(config) {
  const {app, BrowserWindow, session} = require('electron');
  const fs = require('node:fs');
  const path = require('node:path');
  const assert = require('node:assert/strict');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const ackFile = path.join(config.profile, 'updates', 'health-' + config.nonce + '.json');
  const progressFile = ackFile.replace(/\.json$/, '.progress.json');
  const result = {scenario: config.scenario, version: config.version};
  const shows = [], focuses = [];
  let capture, release, startCalls = 0, stopCalls = 0, checkCalls = 0, actualShows = 0;
  let startNativeReady = false, quitting = false;
  const gate = new Promise(resolve => { release = resolve; });

  async function until(callback, message, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = await callback();
      if (value) return value;
      await wait(30);
    }
    throw new Error(message);
  }

  app.disableHardwareAcceleration();
  app.setPath('appData', config.appData);
  app.setPath('userData', config.profile);
  app.setPath('videos', config.videos);
  app.getVersion = () => config.version;
  // The generic Electron runner must never reconcile a real startup registration.
  assert.equal(app.isPackaged, false);
  app.setLoginItemSettings = () => { throw new Error('Unexpected startup registry write'); };
  app.on('ready', () => {
    session.defaultSession.webRequest.onBeforeRequest(
      {urls: ['http://*/*', 'https://*/*']}, (_request, done) => done({cancel: true})
    );
  });
  app.on('browser-window-created', (_event, window) => {
    window.on('show', () => { actualShows++; });
  });
  // Record the app's intended reopen without presenting or focusing a desktop window.
  BrowserWindow.prototype.show = function () {
    shows.push({ackExists: fs.existsSync(ackFile), running: !!capture?.running,
      completed: fs.existsSync(ackFile) && read(ackFile).completed === true});
  };
  BrowserWindow.prototype.focus = function () {
    focuses.push({ackExists: fs.existsSync(ackFile), running: !!capture?.running});
  };
  const {Capture} = require(path.join(config.appRoot, 'src', 'capture.js'));
  Capture.prototype.listDisplays = async function () {
    await this.acceptDisplays([{id: 'isolated-primary', name: 'Smoke display',
      width: 1920, height: 1080, x: 0, y: 0, primary: true}]);
    return this.displays;
  };
  Capture.prototype.start = async function (settings, bufferDir) {
    capture = this;
    startCalls++;
    assert.equal(settings.autoBuffer, false);
    assert.equal(settings.folder, config.videos);
    assert.equal(bufferDir, path.join(config.profile, 'buffer'));
    const window = BrowserWindow.getAllWindows()[0];
    startNativeReady = await window.webContents.executeJavaScript(
      "document.documentElement.dataset.nativeReady === 'true'"
    );
    await gate;
    if (config.scenario === 'capture-failure') throw new Error('Isolated capture startup failure');
    this.config = settings;
    this.bufferDir = bufferDir;
    this.started = Date.now();
    this.running = true;
  };
  Capture.prototype.stop = async function () { stopCalls++; this.running = false; };
  const {Updates} = require(path.join(config.appRoot, 'src', 'updates.js'));
  Updates.prototype.check = async function () {
    checkCalls++;
    return this.update({status: 'current', latestVersion: this.currentVersion, offer: false});
  };
  process.argv.push('--update-health=' + config.nonce, '--update-version=' + config.version);
  require(path.join(config.appRoot, 'src', 'main.js'));

  const watchdog = setTimeout(() => {
    result.error ||= 'Electron startup smoke exceeded its deadline';
    fs.writeFileSync(config.out, JSON.stringify(result));
    app.exit(1);
  }, 23000);
  app.on('will-quit', () => {
    result.shutdownStopCalls = stopCalls;
    result.gracefulQuit = true;
    fs.writeFileSync(config.out, JSON.stringify(result));
    clearTimeout(watchdog);
  });
  try {
    await app.whenReady();
    const window = await until(() => BrowserWindow.getAllWindows()[0], 'No main window');
    await until(() => startNativeReady && startCalls === 1, 'UI never forced replay startup');
    assert.equal(app.getPath('appData'), config.appData);
    assert.equal(app.getPath('userData'), config.profile);
    assert.equal(app.getPath('videos'), config.videos);
    assert.equal(window.isVisible(), false, 'Update window opened before replay startup');
    assert.equal(shows.length, 0, 'Reopen was requested before replay startup');
    assert.equal(focuses.length, 0);
    assert.equal(fs.existsSync(ackFile), false, 'Premature final health acknowledgement');
    const progress = read(progressFile);
    assert.equal(progress.phase, 'starting-buffer');
    assert.equal(progress.nonce, config.nonce);
    assert.equal(progress.version, config.version);
    assert.equal(progress.pid, process.pid);
    await wait(500);
    assert.equal(fs.existsSync(ackFile), false, 'Health acknowledgement ignored pending replay startup');
    assert.equal(window.isVisible(), false);
    assert.equal(actualShows, 0);
    assert.equal(shows.length, 0);
    assert.equal(capture.running, false);
    const before = await window.webContents.executeJavaScript("window.klip.call('init')");
    assert.equal(before.settings.autoBuffer, false);
    assert.equal(before.settings.launch, false);
    release();

    await until(() => fs.existsSync(ackFile) && shows.length > 0, 'No completed health acknowledgement/reopen');
    const ack = read(ackFile), running = config.scenario === 'capture-success';
    assert.equal(ack.nonce, config.nonce);
    assert.equal(ack.version, config.version);
    assert.equal(ack.pid, process.pid);
    assert.equal(ack.completed, true);
    assert.equal(ack.bufferRunning, running);
    if (running) assert.equal(ack.bufferError, undefined);
    else assert.match(ack.bufferError, /Isolated capture startup failure/);
    assert.equal(startCalls, 1);
    assert(shows.length >= 1);
    assert(focuses.length >= 1);
    assert(shows.every(show => show.ackExists && show.completed && show.running === running));
    assert(focuses.every(focus => focus.ackExists && focus.running === running));

    const update = await until(async () => {
      const state = await window.webContents.executeJavaScript("window.klip.call('update-state')");
      return state.installation?.status === 'installed' ? state : false;
    }, 'Completed startup did not reach actual update-state IPC');
    assert.equal(update.currentVersion, config.version);
    assert.equal(update.installation.version, config.version);
    assert.equal(update.installation.phase, 'completed');
    assert.equal(update.installation.bufferRunning, running);
    if (!running) assert.match(update.installation.bufferError, /Isolated capture startup failure/);
    const ui = await until(async () => {
      const value = await window.webContents.executeJavaScript(`(() => {
        const result = document.getElementById('sk-update-result');
        return {text: result?.textContent || '', hidden: result?.hidden,
          status: result?.dataset.status, running: document.getElementById('sk-buffer-dot')?.dataset.on};
      })()`);
      return value.status === 'installed' ? value : false;
    }, 'Renderer never displayed completed installation');
    assert.equal(ui.hidden, false);
    assert.match(ui.text, /Update Completed/);
    if (running) assert.match(ui.text, /Replay Buffer Ready/);
    else {
      assert.match(ui.text, /Replay Buffer Could Not Start: Isolated capture startup failure/);
      assert.doesNotMatch(ui.text, /Replay Buffer Ready/);
    }
    assert.equal(ui.running, String(running));
    const initial = await window.webContents.executeJavaScript("window.klip.call('init')");
    const settings = read(path.join(config.profile, 'settings.json'));
    assert.equal(initial.settings.autoBuffer, false);
    assert.equal(settings.autoBuffer, false);
    assert.equal(settings.launch, false);
    assert.equal(settings.folder, config.videos);
    assert.equal(window.isVisible(), false);
    assert.equal(actualShows, 0);
    assert(checkCalls >= 1, 'Startup update check was not exercised');
    Object.assign(result, {nativeReady: startNativeReady, pendingAckAbsentForMs: 500,
      progressPhase: progress.phase, ack, startCalls, intendedShows: shows.length,
      intendedFocuses: focuses.length, actualShows, autoBuffer: settings.autoBuffer,
      installation: update.installation, ui: ui.text});
  } catch (error) {
    result.error = error.stack || String(error);
  } finally {
    release();
    if (!quitting) { quitting = true; app.quit(); }
  }
}

(async () => {
  const appRoot = path.resolve(process.argv[2] || '.');
  const version = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8')).version;
  const electronDist = path.resolve(__dirname, '../tools/build-deps/npm-lock/node_modules/electron/dist');
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  if (!env.ELECTRON_OVERRIDE_DIST_PATH && await fs.stat(path.join(electronDist, 'electron.exe')).catch(() => null)) {
    env.ELECTRON_OVERRIDE_DIST_PATH = electronDist;
  }
  // Electron's JS package resolves the executable using this override at require time.
  if (env.ELECTRON_OVERRIDE_DIST_PATH) process.env.ELECTRON_OVERRIDE_DIST_PATH = env.ELECTRON_OVERRIDE_DIST_PATH;
  const electron = require('electron');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ember-update-startup-'));
  try {
    for (const scenario of ['capture-success', 'capture-failure']) {
      const own = path.join(directory, scenario), appData = path.join(own, 'AppData');
      const profile = path.join(appData, 'Ember'), videos = path.join(own, 'Videos');
      await fs.mkdir(profile, {recursive: true});
      await fs.mkdir(videos, {recursive: true});
      await fs.mkdir(path.join(own, 'LocalAppData'), {recursive: true});
      await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({launch: false,
        autoBuffer: false, hotkey: 'Ctrl+Alt+Shift+F9', folder: videos, language: 'en'}));
      const config = {scenario, appRoot, version, appData, profile, videos,
        nonce: crypto.randomBytes(32).toString('hex'), out: path.join(own, 'result.json')};
      const runner = path.join(own, 'fixture.js');
      await fs.writeFile(runner, `(${electronFixture.toString()})(${JSON.stringify(config)}).catch(error => { console.error(error); require('electron').app.exit(1); });`);
      const child = spawnSync(electron, [runner], {cwd: own, windowsHide: true, encoding: 'utf8',
        timeout: 28000, env: {...env, APPDATA: appData, LOCALAPPDATA: path.join(own, 'LocalAppData')}});
      const result = await fs.readFile(config.out, 'utf8').then(JSON.parse).catch(() => null);
      assert(!child.error, child.error?.stack);
      assert.equal(child.status, 0, JSON.stringify({result, stderr: child.stderr, stdout: child.stdout}));
      assert(result, 'Electron produced no test result: ' + child.stderr);
      assert(!result.error, result.error);
      assert.equal(result.gracefulQuit, true);
      assert(result.shutdownStopCalls >= 1, 'Real app quit did not stop capture');
      const persisted = JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'));
      assert.equal(persisted.autoBuffer, false);
      assert.equal(persisted.launch, false);
      console.log(JSON.stringify(result));
    }
  } finally {
    // Only remove the exact directory created by this invocation, never an input app root.
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith('ember-update-startup-'));
    const own = await fs.lstat(directory);
    assert(own.isDirectory() && !own.isSymbolicLink());
    await fs.rm(directory, {recursive: true, force: true, maxRetries: 4, retryDelay: 100});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
