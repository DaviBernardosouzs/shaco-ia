const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { createLiveClient } = require('./src/liveclient');
const { createLcu } = require('./src/lcu');
const { loadStaticData, loadChampionSpells } = require('./src/ddragon');
const { skillSequence, nextSkill } = require('./src/skills');
const { resolveChampions, positionLabel } = require('./src/draft');
const { loadAugments, poolFor, resolveAugments } = require('./src/augments');
const { buildSummary, describeSummary, loadHistory, saveHistory } = require('./src/summary');
const { openPlaylist } = require('./src/spotify');
const challenges = require('./src/challenges');
const { objectiveTimers } = require('./src/objectives');
const { chaosRoulette } = require('./src/roulette');
const { analyze, describeForCoach, resolveItem } = require('./src/advisor');
const { loadOverrides, buildForMode } = require('./src/riotbuilds');
const { championNode } = require('./src/graph');
const { classBuild } = require('./src/classbuilds');
// build mais usada por classe e tipo de dano (gerada por npm run cofre)
const CLASS_BUILDS = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'grafo', 'classes.json'), 'utf8')).classes;
  } catch {
    return null;
  }
})();
const { createCoach } = require('./src/coach');
const { loadConfig, saveConfig } = require('./src/config');
const { modeFor } = require('./src/modes');
const { toItemSet } = require('./src/build');
const { createTts } = require('./src/tts');
const { pickSpells } = require('./src/spells');
const { createEmoteTracker, createReadTracker, createPhaseTracker, createWardTracker } = require('./src/emotes');

// --mock simula uma partida e --mock-select a seleção; "=ARAM", "=CHERRY" (Arena) trocam o modo
function mockArg(flag) {
  const arg = process.argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!arg) return false;
  return arg.includes('=') ? arg.split('=')[1].toUpperCase() : 'CLASSIC';
}
const MOCK_GAME = mockArg('--mock');
const MOCK_SELECT = mockArg('--mock-select');
const POLL_MS = 2000;
// no Windows o .ico traz cada tamanho (16 a 256) e o sistema escolhe o certo para barra, bandeja e Alt+Tab
const ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

let config = null;
let coach = null;
let lcu = null;
let tts = null;

let overlay = null;
let launcher = null;
let tray = null;
let chatOpen = false;
let calibrating = false;
let paused = false;
let staticData = null;
let lastAnalysis = null;
let lastStatus = { status: 'waiting', detail: '' };
let game = null; // estado da partida atual (falas já ditas etc.)
let select = null; // estado da seleção de campeões
let skillPlan = null; // ordem de habilidades do campeão atual (vale da seleção até o fim da partida)
// runas e build são temporárias: true enquanto houver algo do Shaco IA para limpar no cliente
// (começa true para limpar sobras de uma sessão que fechou no meio)
let tempDirty = true;
const BUSY_PHASES = new Set(['ChampSelect', 'GameStart', 'InProgress', 'Reconnect']);

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showLauncher());

function send(channel, payload) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
}

function voiceSettings() {
  return { style: config.voiceStyle, pitch: config.voicePitch, rate: config.voiceRate, gemini: config.geminiVoice };
}

function say(text, { auto = true } = {}) {
  if (!paused) send('shaco:say', { text, speak: config.voice, voice: voiceSettings(), auto });
}

// o Google aposentou o modelo e indicou outro: guarda o novo para as próximas vezes
function rememberModel(model) {
  config = saveConfig(app.getPath('userData'), { ...config, geminiModel: model });
}

function applyConfig(next) {
  config = next;
  coach = createCoach(config, { onModelChange: rememberModel });
  lcu = createLcu({ leaguePath: config.leaguePath, mock: MOCK_SELECT, dataDir: app.getPath('userData') });
  tts = createTts(config);
  sendLayout();
}

// --- janelas ---
function createOverlay() {
  const { bounds } = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  // 'screen-saver' fica acima de janelas sem borda (o LoL precisa estar em modo "Sem bordas")
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  overlay.once('ready-to-show', () => overlay.showInactive());
}

function createLauncher() {
  launcher = new BrowserWindow({
    width: 900,
    height: 620,
    minWidth: 820,
    minHeight: 540,
    frame: false,
    show: false,
    backgroundColor: '#110c1a',
    title: 'Shaco IA',
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload-launcher.js') },
  });
  launcher.loadFile(path.join(__dirname, 'renderer', 'launcher.html'));
  launcher.once('ready-to-show', () => launcher.show());
  const sendMax = () => launcher.webContents.send('launcher:maximized', launcher.isMaximized());
  launcher.on('maximize', sendMax);
  launcher.on('unmaximize', sendMax);
  // fechar só esconde: o Shaco continua na bandeja
  launcher.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      launcher.hide();
    }
  });
}

function showLauncher() {
  if (!launcher) return;
  launcher.show();
  launcher.focus();
}

function setPaused(value) {
  paused = value;
  if (paused) overlay.hide();
  else overlay.showInactive();
  updateTray();
  return paused;
}

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Shaco IA', click: showLauncher },
      { label: paused ? 'Ativar overlay' : 'Pausar overlay', click: () => setPaused(!paused) },
      { type: 'separator' },
      { label: 'Sair', click: () => app.quit() },
    ])
  );
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON);
  tray = new Tray(process.platform === 'win32' ? icon : icon.resize({ width: 16, height: 16, quality: 'best' }));
  tray.setToolTip('Shaco IA');
  tray.on('click', showLauncher);
  updateTray();
}

function setChat(open) {
  chatOpen = open;
  overlay.setIgnoreMouseEvents(!open, { forward: true });
  overlay.setFocusable(open);
  if (open) overlay.focus();
  else overlay.blur();
  send('shaco:chat', { open });
}

// Dança do campeão (Ctrl+3 no LoL): a API da partida não avisa, então o app só escuta o teclado.
// A escuta é passiva (como o apertar-para-falar do Discord): a tecla continua chegando no jogo normalmente.
const DANCE_GAP_MS = 5000;
let lastDance = 0;
let keyHook = null;

function onDance() {
  if (!game || paused || Date.now() - lastDance < DANCE_GAP_MS) return;
  lastDance = Date.now();
  send('shaco:emote', 'dance');
}

function listenDance() {
  try {
    const { uIOhook, UiohookKey } = require('uiohook-napi');
    uIOhook.on('keydown', (e) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.keycode === UiohookKey['3']) onDance();
    });
    uIOhook.start();
    keyHook = uIOhook;
  } catch (err) {
    console.error('Sem escuta do teclado (emote de dança desligado):', err.message);
  }
}

// Atualização automática pelas Releases do GitHub (só na versão instalada: a portátil e o modo dev não atualizam).
// Baixa em segundo plano e instala quando o app fechar.
function checkUpdates() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.on('update-downloaded', (info) => {
      say(`Versão nova do Shaco IA (${info.version}) baixada! Ela entra quando você fechar o app.`);
      if (launcher && !launcher.isDestroyed()) launcher.webContents.send('launcher:update', info.version);
    });
    autoUpdater.on('error', (err) => console.error('Atualização:', err.message));
    autoUpdater.checkForUpdates().catch(() => {});
  } catch (err) {
    console.error('Atualização indisponível:', err.message);
  }
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (paused) return;
    if (overlay.isVisible()) overlay.hide();
    else overlay.showInactive();
  });
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    if (!paused) setChat(!chatOpen);
  });
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    config = saveConfig(app.getPath('userData'), { ...config, voice: !config.voice });
    send('shaco:say', { text: config.voice ? 'Voz ligada.' : 'Voz desligada.', speak: config.voice, voice: voiceSettings() });
  });
}

function registerIpc() {
  // overlay: o painel recebe cliques só com o mouse em cima dele; o resto da tela continua no jogo
  ipcMain.on('shaco:hover', (_e, over) => {
    if (!chatOpen && !calibrating) overlay.setIgnoreMouseEvents(!over, { forward: true });
  });
  // ajuste da moldura das habilidades: a tela inteira do overlay recebe mouse e teclado até salvar
  ipcMain.on('launcher:calibrateHud', () => {
    calibrating = true;
    overlay.setIgnoreMouseEvents(false);
    overlay.setFocusable(true);
    overlay.show();
    overlay.focus();
    send('shaco:calibrate');
  });
  ipcMain.on('shaco:calibrateDone', () => {
    calibrating = false;
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.setFocusable(false);
    overlay.blur();
    if (paused) overlay.hide();
    showLauncher();
  });
  ipcMain.on('shaco:closeChat', () => setChat(false));
  ipcMain.on('shaco:dismissSummary', () => (showSummary = false));
  ipcMain.handle('launcher:getHistory', () => history);
  ipcMain.handle('launcher:getChallenge', () => challengeView());
  ipcMain.handle('launcher:roulette', () => (staticData ? chaosRoulette(staticData) : null));
  ipcMain.handle('launcher:swapChallenge', () => {
    challenges.today(challengeState);
    if (challenges.swap(challengeState)) challenges.save(app.getPath('userData'), challengeState);
    return challengeView();
  });
  // voz do Gemini: as duas telas pedem o áudio aqui (a chave fica só no processo principal)
  ipcMain.handle('shaco:tts', (_e, text) => tts.synth(String(text).slice(0, 600)));

  ipcMain.handle('shaco:ask', async (_e, question) => {
    try {
      const context = lastAnalysis ? describeForCoach(lastAnalysis) : 'Fora de partida.';
      return { ok: true, text: await coach.ask(question, context), speak: config.voice, voice: voiceSettings() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('shaco:applyRunes', async () => {
    if (!select?.runes) return { ok: false, error: 'Nenhuma sugestão de runas ainda' };
    try {
      await lcu.applyRunes(select.champion, select.runes);
      tempDirty = true;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // janela principal
  ipcMain.handle('launcher:getConfig', () => config);
  ipcMain.handle('launcher:saveConfig', (_e, next) => {
    const before = config;
    applyConfig(saveConfig(app.getPath('userData'), next));
    // chave, modelo ou pasta novos: refaz runas e build da seleção atual
    if (['geminiApiKey', 'geminiModel', 'leaguePath'].some((k) => before[k] !== config[k])) select = null;
    return config;
  });
  ipcMain.handle('launcher:getState', () => statusForLauncher());
  ipcMain.handle('launcher:setPaused', (_e, value) => setPaused(value));
  ipcMain.handle('launcher:testKey', async () => {
    try {
      return { ok: true, text: await coach.ask('Diga oi em no máximo 6 palavras.', 'Fora de partida.'), model: coach.model };
    } catch (err) {
      return { ok: false, error: err.message, model: coach.model };
    } finally {
      coach.resetChat();
    }
  });
  ipcMain.handle('launcher:pickFolder', async () => {
    const res = await dialog.showOpenDialog(launcher, {
      title: 'Pasta do League of Legends',
      defaultPath: config.leaguePath,
      properties: ['openDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.on('launcher:previewOverlay', previewOverlay);
  ipcMain.handle('launcher:animManifest', () =>
    JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'anim', 'manifest.json'), 'utf8'))
  );
  ipcMain.on('launcher:openKeyPage', () => shell.openExternal('https://aistudio.google.com/apikey'));
  ipcMain.on('launcher:minimize', () => launcher.minimize());
  ipcMain.on('launcher:toggleMaximize', () => (launcher.isMaximized() ? launcher.unmaximize() : launcher.maximize()));
  ipcMain.on('launcher:hide', () => launcher.hide());
}

function statusForLauncher() {
  return {
    ...lastStatus,
    paused,
    patch: staticData?.version,
    appVersion: app.getVersion(),
    keySet: coach.enabled,
    leagueFound: fs.existsSync(path.join(config.leaguePath, 'LeagueClient.exe')),
  };
}

// Exemplo do painel pedido pela janela: segura as atualizações reais por alguns segundos.
let previewUntil = 0;

function previewOverlay() {
  if (!staticData) return;
  createLiveClient({ mock: 'CLASSIC' })
    .getAllGameData()
    .then((raw) => {
      previewUntil = Date.now() + 10000;
      send('shaco:update', { status: 'ingame', ...analyze(raw, staticData) });
      if (!overlay.isVisible()) overlay.showInactive();
    });
}

function sendLayout() {
  send('shaco:layout', { scale: config.overlayScale, opacity: config.overlayOpacity, compact: config.overlayCompact });
}

function publish(payload, detail = '') {
  if (Date.now() >= previewUntil) send('shaco:update', payload);
  lastStatus = { status: payload.status, detail: payload.status === 'error' ? payload.message : detail };
  if (launcher && !launcher.isDestroyed()) launcher.webContents.send('launcher:status', statusForLauncher());
}

// --- falas automáticas: só sobre itens e plano inicial, nunca ordens de gank/objetivo ---
const WHEN_TO_BUY = {
  ARAM: 'No ARAM você só compra quando morrer.',
  CHERRY: 'Compre na próxima fase de compras.',
};
const ON_DEATH = {
  ARAM: (top) => `Morreu? Hora de comprar! Prioridade: ${top.name}. ${top.reason}.`,
  CHERRY: (top) => `Na fase de compras, pense em ${top.name}. ${top.reason}.`,
};

function callouts(a) {
  // a primeira leitura pode vir antes do fim da tela de carregamento: o plano sai uma vez no começo
  if (!game.planDone && a.gameTime < 180) {
    game.planDone = true;
    if (coach.enabled) {
      coach.startPlan(describeForCoach(a), a.me.position, a.mode).then((t) => say(t)).catch((err) => console.error(err.message));
    } else {
      say('Coloque sua chave do Gemini na janela do Shaco IA pra eu conversar com você.');
    }
  }

  const top = a.recs[0];
  if (top && a.buyNow?.ready && !game.announced.has(top.id)) {
    game.announced.add(top.id);
    say(`Você já tem ouro para ${top.name}. ${WHEN_TO_BUY[a.mode.key] || 'Compre quando voltar pra base.'}`);
  }

  if (a.me.dead && !game.wasDead && top) {
    const line = ON_DEATH[a.mode.key] || ((t) => `Enquanto espera: o item mais útil agora é ${t.name}. ${t.reason}.`);
    say(line(top));
  }
  game.wasDead = a.me.dead;
}

function champById(id) {
  return Object.values(staticData.champions).find((c) => c.key === String(id)) || null;
}

// Monta a build com o Gemini e grava como conjunto de itens na loja do jogo.
function sendBuild(current, champ, mode, enemies) {
  current.build = { status: 'loading' };
  loadNode(champ, mode)
    .then((node) => coach.suggestBuild({ champion: champ.name, enemies, mode, node }, staticData))
    .then(async (build) => {
      await lcu.saveItemSet(toItemSet(build, champ, mode, `Shaco IA: ${champ.name}`));
      tempDirty = true;
      current.build = { status: 'sent', ...build };
    })
    .catch((err) => (current.build = { status: 'error', error: err.message }));
}

const emoteFiles = new Map();
function hasEmote(key) {
  if (!emoteFiles.has(key)) emoteFiles.set(key, fs.existsSync(path.join(__dirname, 'assets', 'emotes', `${key}.webp`)));
  return emoteFiles.get(key);
}

// Playlist do campeão no Spotify (opção do launcher): uma vez por campeão travado.
function championPlaylist(champion) {
  const hasApp = !!app.getApplicationNameForProtocol('spotify:');
  openPlaylist(champion, { shell, hasApp })
    .then((where) => say(`Abri ${where === 'app' ? 'o Spotify' : 'o Spotify Web'} com playlists de ${champion}. Escolhe a trilha do show!`))
    .catch((err) => console.error('Spotify:', err.message));
}

// --- resumo pós-partida ---
let history = [];
let showSummary = false;

function sendHistory() {
  if (launcher && !launcher.isDestroyed()) launcher.webContents.send('launcher:history', history);
}

// --- desafio do dia ---
let challengeState = null;

// o desafio de hoje (troca sozinho na virada do dia); com s, inclui o progresso da partida atual
function challengeView(s = null) {
  if (!challengeState) return null;
  challenges.today(challengeState);
  return challenges.view(challengeState, s);
}

function sendChallenge(celebrate = false) {
  if (launcher && !launcher.isDestroyed()) launcher.webContents.send('launcher:challenge', { ...challengeView(), celebrate });
}

// A partida acabou (a Live Client API sumiu): monta o resumo, guarda e pede a avaliação ao Gemini.
// Partidas com menos de 5 minutos (remake) ficam de fora.
function finishGame({ raw, a }) {
  if (a.gameTime < 300) return;
  const summary = buildSummary(raw, a);
  // desafio do dia: confere com esta partida
  if (challengeState) {
    challenges.today(challengeState);
    const won = challenges.complete(challengeState, summary);
    challenges.save(app.getPath('userData'), challengeState);
    summary.challenge = { ...challengeView(), won };
    if (won) {
      sendChallenge(true);
      say(`Desafio do dia cumprido! ${challengeState.streak > 1 ? `${challengeState.streak} dias seguidos. ` : ''}Hehehe.`);
    }
  }
  summary.review = coach.enabled ? { status: 'loading' } : { status: 'off' };
  history = saveHistory(app.getPath('userData'), [summary, ...history]);
  showSummary = true;
  sendHistory();
  if (!coach.enabled) return;
  coach
    .reviewGame(describeSummary(summary))
    .then((r) => (summary.review = { status: 'ready', ...r }))
    .catch((err) => (summary.review = { status: 'error', error: err.message }))
    .finally(() => {
      history = saveHistory(app.getPath('userData'), history);
      sendHistory();
    });
}

// Ordem de habilidades do campeão: pedida ao travar (ou no começo da partida, se o app abriu depois).
function planSkills(champ, mode, position, enemies = []) {
  const plan = { champion: champ.name, status: 'loading' };
  skillPlan = plan;
  loadChampionSpells(staticData, champ.id)
    .catch(() => null)
    .then(async (spells) => {
      const skills = await coach.suggestSkills({ champion: champ.name, position, enemies, mode, spells });
      Object.assign(plan, { status: 'ready', ...skills, sequence: skillSequence(skills), spells });
    })
    .catch((err) => Object.assign(plan, { status: 'error', error: err.message }));
}

// O que as telas mostram da ordem de habilidades; com abilities/level diz qual subir agora.
function skillView(champion, abilities, level) {
  if (!skillPlan || skillPlan.champion !== champion) return null;
  const p = skillPlan;
  return {
    status: p.status,
    error: p.error,
    max: p.max,
    start: p.start,
    explain: p.explain,
    spells: p.spells,
    next: p.sequence && abilities ? nextSkill(p.sequence, abilities, level) : null,
  };
}

// Grafo do campeão (build da Riot daquele modo), um por campeão e modo.
// loadNode espera baixar; nodeFor devolve o que já tem e começa a baixar se ainda não tiver.
const nodes = new Map();
function loadNode(champ, mode) {
  if (!champ) return Promise.resolve(null);
  const key = `${champ.id}:${mode.key}`;
  if (!nodes.has(key)) {
    const buyable = (id) => resolveItem(id, mode.map, staticData);
    const job = loadOverrides(champ.id, app.getPath('userData'), staticData.version)
      .catch((err) => {
        console.error('Build da Riot:', err.message);
        setTimeout(() => nodes.delete(key), 60000); // tenta de novo depois
        return null;
      })
      .then((overrides) => {
        // build própria da Riot; sem ela, no Summoner's Rift, a build da classe (campeões parecidos)
        const build = (overrides && buildForMode(overrides, mode, buyable)) || (mode.map === 11 ? classBuild(CLASS_BUILDS, champ, buyable) : null);
        return build ? championNode(champ, build, staticData) : null;
      });
    nodes.set(key, { job, node: null });
    job.then((node) => (nodes.get(key).node = node));
  }
  return nodes.get(key).job;
}
function nodeFor(champ, mode) {
  if (!champ) return null;
  loadNode(champ, mode);
  return nodes.get(`${champ.id}:${mode.key}`)?.node || null;
}

// Flash na tecla escolhida + segundo feitiço pela posição e pelo modo.
function applySpells(current, champ, mode, position) {
  const spells = pickSpells({ mode, position, champ, flashKey: config.flashKey }, staticData.summoners);
  if (!spells) return;
  const img = (file) => `${staticData.imgBase}/spell/${file}`;
  current.spells = { status: 'loading', d: { ...spells.d, icon: img(spells.d.icon) }, f: { ...spells.f, icon: img(spells.f.icon) } };
  lcu
    .setSpells(spells.spell1Id, spells.spell2Id)
    .then(() => (current.spells.status = 'sent'))
    .catch((err) => Object.assign(current.spells, { status: 'error', error: err.message }));
}

// Pedidos da seleção guardados por chave (campeão, rota, modo): o Gemini responde uma vez só.
// Se der erro, libera nova tentativa depois de 30s.
const draftCache = new Map();
function draftList(cacheKey, ask) {
  let entry = draftCache.get(cacheKey);
  if (!entry) {
    entry = { status: 'loading' };
    draftCache.set(cacheKey, entry);
    ask()
      .then((r) => Object.assign(entry, { status: 'ready', ...r }))
      .catch((err) => {
        Object.assign(entry, { status: 'error', error: err.message });
        setTimeout(() => draftCache.delete(cacheKey), 30000);
      });
  }
  return entry;
}

// Melhores Aumentos do campeão nos modos que têm (Arena, ARAM: Desordem): na seleção e na partida.
function augmentHelp(champ, mode) {
  if (!coach.enabled || !champ || !(mode.key === 'CHERRY' || mode.key.startsWith('KIWI'))) return null;
  const entry = draftList(`aug:${mode.key}:${champ.id}`, async () => {
    const pool = poolFor(await loadAugments(app.getPath('userData')), mode.key);
    if (!pool?.length) throw new Error('Não achei a lista de Aumentos deste modo.');
    const picks = await coach.suggestAugments({ champion: champ.name, mode, pool });
    return { tiers: ['prismatic', 'gold', 'silver'].map((tier) => ({ tier, augments: resolveAugments(picks[tier], pool, tier) })), explain: picks.explain };
  });
  if (entry.status !== 'ready') return { status: entry.status, error: entry.error, champion: champ.name };
  return { status: 'ready', tiers: entry.tiers.filter((t) => t.augments.length), explain: entry.explain, champion: champ.name };
}

// Antes de travar: counters do campeão escolhido na fase de banimento e o meta da rota.
// De atirador: os supports que mais combinam com o campeão (também depois de travar).
function draftHelp(cs, champ, mode) {
  if (!coach.enabled) return {};
  const names = Object.values(staticData.champions).map((c) => c.name);
  const lane = mode.lanes ? positionLabel(cs.position) : '';
  const where = lane ? `na rota ${lane}` : `no modo ${mode.label}`;
  const view = (entry, exclude) =>
    entry.status === 'ready'
      ? { status: 'ready', champions: resolveChampions(entry.names, staticData, { exclude, max: 6 }), explain: entry.explain }
      : { status: entry.status, error: entry.error };
  const out = {};
  if (champ && mode.lanes && String(cs.position).toLowerCase() === 'bottom') {
    const entry = draftList(`duo:${champ.id}:${mode.key}`, () =>
      coach.suggestChampions({
        mode,
        names,
        count: 6,
        question: `Quais supports fazem a melhor dupla de rota inferior com ${champ.name} (atirador)? Pense em sinergia de abates, proteção e controle.`,
      })
    );
    // banidos e escolhas do time inimigo não podem ser o seu support
    out.duo = { ...view(entry, [champ.key, ...cs.bannedIds, ...cs.enemyChampionIds]), champion: champ.name };
  }
  if (cs.locked) return out;
  if (champ && cs.banPending) {
    const entry = draftList(`counter:${champ.id}:${cs.position}:${mode.key}`, () =>
      coach.suggestChampions({
        mode,
        names,
        count: 6,
        question: `Quais campeões mais dão counter em ${champ.name} ${where}? São sugestões de banimento para quem vai jogar de ${champ.name}.`,
      })
    );
    out.counters = { ...view(entry, [champ.key, ...cs.bannedIds]), champion: champ.name };
  }
  // no ARAM (e no ARAM: Desordem) o campeão é sorteado: não tem meta para escolher
  if (mode.map !== 12) {
    const entry = draftList(`meta:${staticData.version}:${cs.position}:${mode.key}`, () =>
      coach.suggestChampions({ mode, names, count: 6, question: `Quais são os campeões mais fortes (meta) ${where} no patch ${staticData.version}?` })
    );
    out.meta = { ...view(entry, cs.bannedIds), lane: lane || mode.label };
  }
  return out;
}

function handleChampSelect(cs) {
  const champ = champById(cs.championId);
  const mode = modeFor(cs.gameMode, cs.mapId);
  const draft = draftHelp(cs, champ, mode);
  if (!champ) {
    // ainda sem campeão: só a ajuda da seleção (meta da rota)
    select = null;
    const lane = mode.lanes ? positionLabel(cs.position) : '';
    return publish(
      { status: 'champselect', champion: null, icon: null, mode: { key: mode.key, label: mode.label, runes: mode.runes }, lane, locked: false, draft },
      `${mode.label} · escolhendo campeão${lane ? ` (${lane})` : ''}.`
    );
  }

  const changed = !select || select.championId !== cs.championId || select.mode.key !== mode.key || select.locked !== cs.locked;
  if (changed && !cs.locked) {
    // passando o mouse pelos campeões: espera travar para não gastar pedidos do Gemini
    select = { championId: cs.championId, champion: champ.name, mode, locked: false, runes: null, tip: null, build: null, loading: false, error: null };
  } else if (changed) {
    select = { championId: cs.championId, champion: champ.name, mode, locked: true, runes: null, tip: null, build: null, loading: coach.enabled, error: null };
    const current = select;
    const enemies = cs.enemyChampionIds.map((id) => champById(id)?.name).filter(Boolean);
    if (coach.enabled && config.autoBuild && mode.items) sendBuild(current, champ, mode, enemies);
    if (coach.enabled) planSkills(champ, mode, cs.position, enemies);
    if (config.autoSpells) applySpells(current, champ, mode, cs.position);
    if (config.spotifyPlaylist) championPlaylist(champ.name);
    if (!coach.enabled) {
      select.error = 'Coloque sua chave do Gemini na janela do Shaco IA para receber dicas.';
    } else if (!mode.runes) {
      // Arena e outros modos sem runas: dica do que priorizar no lugar das runas
      coach
        .selectTip(mode, champ.name)
        .then((tip) => {
          current.tip = tip;
          say(tip);
        })
        .catch((err) => (current.error = err.message))
        .finally(() => (current.loading = false));
    } else {
      coach
        .suggestRunes({ champion: champ.name, position: cs.position, enemies, mode }, staticData.runes)
        .then(async (runes) => {
          current.runes = runes;
          // página temporária criada na hora; sai no fim da partida
          try {
            await lcu.applyRunes(champ.name, runes);
            tempDirty = true;
            current.runesApplied = true;
            say(`Runas de ${champ.name} já estão no cliente: ${runes.primary[0].name}. ${runes.explain}`);
          } catch (err) {
            current.runesError = err.message;
            say(`Runas para ${champ.name}: ${runes.primary[0].name}. ${runes.explain}`);
          }
        })
        .catch((err) => (current.error = err.message))
        .finally(() => (current.loading = false));
    }
  }

  publish(
    {
      status: 'champselect',
      champion: champ.name,
      icon: `${staticData.imgBase}/champion/${champ.image.full}`,
      mode: { key: mode.key, label: mode.label, runes: mode.runes },
      locked: select.locked,
      runes: select.runes,
      runesApplied: !!select.runesApplied,
      runesError: select.runesError || null,
      spells: select.spells || null,
      skills: select.locked ? skillView(champ.name) : null,
      draft,
      augments: augmentHelp(champ, mode),
      tip: select.tip,
      build: select.build,
      loading: select.loading,
      error: select.error,
    },
    `${mode.label} · você escolheu ${champ.name}.`
  );
}

async function startPolling() {
  const client = createLiveClient({ mock: MOCK_GAME });

  while (!staticData) {
    try {
      staticData = await loadStaticData(app.getPath('userData'));
    } catch (err) {
      console.error('Falha ao baixar dados do Data Dragon:', err.message);
      publish({ status: 'error', message: 'Sem internet para baixar itens/campeões. Tentando de novo…' });
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  const tick = async () => {
    let raw = null;
    try {
      raw = await client.getAllGameData();
    } catch {}

    if (raw) {
      try {
        // primeiro sem o grafo (para saber o campeão); com a build da Riot dele, refaz as recomendações
        let a = analyze(raw, staticData);
        const node = nodeFor(Object.values(staticData.champions).find((c) => c.name === a.me.champion), modeFor(raw.gameData?.gameMode, raw.gameData?.mapNumber));
        if (node) a = analyze(raw, staticData, { node });
        if (!game) {
          game = { planDone: false, announced: new Set(), wasDead: false, emotes: createEmoteTracker(), reads: createReadTracker(), phase: createPhaseTracker(), wards: createWardTracker() };
          coach.resetChat();
          select = null;
          // app aberto já na partida (ou sem ordem da seleção): pede a ordem de habilidades agora
          const champ = Object.values(staticData.champions).find((c) => c.name === a.me.champion);
          if (coach.enabled && champ && skillPlan?.champion !== a.me.champion) planSkills(champ, a.mode, a.me.position);
        }
        lastAnalysis = a;
        game.final = { raw, a }; // última leitura: vira o resumo quando a partida acabar
        const skills = skillView(a.me.champion, raw.activePlayer?.abilities, raw.activePlayer?.level);
        const myChamp = Object.values(staticData.champions).find((c) => c.name === a.me.champion);
        const augments = augmentHelp(myChamp, modeFor(raw.gameData?.gameMode, raw.gameData?.mapNumber));
        const challenge = challengeView(buildSummary(raw, a));
        const objectives = a.mode.lanes && raw.gameData?.mapNumber === 11 ? objectiveTimers(raw) : null;
        publish({ status: 'ingame', ...a, skills, augments, challenge, objectives }, `${a.mode.label} · ${a.me.champion} · ${a.clock} · ${a.me.gold} de ouro`);
        // só manda emote que tem imagem; Alma e Ancião sem imagem própria usam a do dragão com a legenda deles
        const FALLBACK = { soul: 'Dragon Soul!', elder: 'Elder Dragon!' };
        // lembrete de sentinela: a mensagem sai sempre; a reação só se tiver a imagem
        const wards = game.wards(raw, a);
        if (wards.length && !paused) say('Leva uma Sentinela de Controle! São só 75 de ouro e ela salva a sua vida no rio.');
        const emotes = [...game.emotes(raw), ...game.reads(a), ...game.phase(raw, a), ...wards]
          .map((e) => (FALLBACK[e] && !hasEmote(e) ? { key: 'dragon', text: FALLBACK[e] } : e))
          .filter((e) => hasEmote(typeof e === 'string' ? e : e.key));
        if (!paused) {
          callouts(a);
          emotes.forEach((key) => send('shaco:emote', key));
        }
      } catch (err) {
        console.error('Erro na análise:', err);
        publish({ status: 'error', message: err.message });
      }
      return;
    }

    if (game?.final) finishGame(game.final);
    game = null;
    lastAnalysis = null;
    if (config.autoAccept) {
      const accepted = await lcu.acceptReadyCheck().catch(() => false);
      if (accepted) say('Partida encontrada e aceita. Hora do show!');
    }
    const cs = await lcu.getChampSelect().catch(() => null);
    if (cs) {
      showSummary = false; // próxima seleção: o resumo sai da tela (continua na aba Partidas)
      return handleChampSelect(cs);
    }
    select = null;
    // fora da seleção e da partida: tira a página de runas e o conjunto de itens temporários
    if (tempDirty) {
      const phase = await lcu.getPhase().catch(() => null);
      if (phase && !BUSY_PHASES.has(phase)) tempDirty = !(await lcu.cleanup().catch(() => false));
    }
    publish({ status: 'waiting', summary: showSummary ? history[0] : null });
  };

  await tick();
  setInterval(tick, POLL_MS);
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.shaco.ia');
  applyConfig(loadConfig(app.getPath('userData')));
  history = loadHistory(app.getPath('userData'));
  challengeState = challenges.save(app.getPath('userData'), challenges.today(challenges.load(app.getPath('userData'))));
  registerIpc();
  createOverlay();
  createLauncher();
  createTray();
  registerShortcuts();
  listenDance();
  checkUpdates();
  overlay.webContents.once('did-finish-load', () => {
    sendLayout();
    startPolling();
  });
});

app.on('before-quit', () => (app.isQuitting = true));
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try {
    keyHook?.stop();
  } catch {}
});
// com a janela escondida o app continua rodando na bandeja
app.on('window-all-closed', (e) => e.preventDefault());
