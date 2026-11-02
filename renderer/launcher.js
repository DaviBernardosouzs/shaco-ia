const $ = (id) => document.getElementById(id);
const api = window.launcher;
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

const STATUS = {
  waiting: ['Aguardando partida', 'Abra o LoL e entre numa partida.'],
  champselect: ['Seleção de campeões', ''],
  ingame: ['Em partida', ''],
  error: ['Erro', ''],
  paused: ['Overlay pausado', 'O Shaco fica quieto até você ativar de novo.'],
};

let config = null;
let paused = false;
let savedTimer = null;
let lastStatusKey = null;

// --- o bobo da corte: piadas, espiadas e confete ---
const JOKES = [
  'Psiu... tem alguém atrás de você. Brincadeira. Ou não.',
  'Eu não sumi. Só estou estrategicamente invisível.',
  'Confia em mim. Sou um palhaço profissional.',
  'Que caixinha? Não tem caixinha nenhuma aqui.',
  'Bobo da corte, sim. Bobo, nunca.',
  'Já olhou o placar hoje? Eu já. Hehehe.',
  'Se ninguém te viu, você não estava lá.',
  'O caos é só uma estratégia mal compreendida.',
  'Minha lupa diz: o inimigo vai errar. Eu sei porque eu vou empurrar.',
  'Cuidado com o mato. O mato é meu amigo.',
];
const STATUS_LINES = {
  waiting: 'Abre o LoL aí, tô entediado.',
  champselect: 'Escolheu? Então vamos montar a pegadinha.',
  ingame: 'Cortinas abertas. Hora do show!',
  paused: 'Tô quieto... por enquanto. Zzz.',
  error: 'Ops. Até eu tropeço às vezes.',
};
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let bubbleTimer = null;
let lastJoke = -1;

function buildWordmark() {
  const text = 'SHACO';
  const parts = [...text].map((ch, i) => `<span class="ch" style="--i:${i}">${ch}</span>`);
  parts.push(`<span class="ch space" style="--i:5"></span><span class="ch ia" style="--i:6">IA</span>`);
  $('wordmark').innerHTML = parts.join('');
}

function say(text, ms = 4200) {
  const bubble = $('bubble');
  clearTimeout(bubbleTimer);
  bubble.classList.remove('out');
  bubble.hidden = false;
  $('bubbleText').textContent = text;
  bubble.style.animation = 'none';
  void bubble.offsetWidth; // reinicia a animação de pop
  bubble.style.animation = '';
  bubbleTimer = setTimeout(() => {
    bubble.classList.add('out');
    setTimeout(() => (bubble.hidden = true), 250);
  }, ms);
}

function hideBubble() {
  clearTimeout(bubbleTimer);
  $('bubble').hidden = true;
}

function randomJoke() {
  let i;
  do i = Math.floor(Math.random() * JOKES.length);
  while (i === lastJoke && JOKES.length > 1);
  lastJoke = i;
  return JOKES[i];
}

function animate(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

function confetti(count = 26) {
  if (reduceMotion) return;
  const box = $('confetti');
  const suits = [['♠', '#d9cfe8'], ['♥', '#e2455b'], ['♦', '#f0b84a'], ['♣', '#9a6ad1']];
  for (let n = 0; n < count; n++) {
    const [ch, color] = suits[n % suits.length];
    const s = document.createElement('span');
    const angle = Math.random() * Math.PI * 2;
    const dist = 70 + Math.random() * 90;
    s.textContent = ch;
    s.style.color = color;
    s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    s.style.setProperty('--dy', `${Math.sin(angle) * dist - 30}px`);
    s.style.setProperty('--rot', `${(Math.random() - 0.5) * 720}deg`);
    s.style.animationDelay = `${Math.random() * 120}ms`;
    box.append(s);
    s.addEventListener('animationend', () => s.remove());
  }
}

// --- a cabeça do Shaco: 0 = sorriso de canto ... 5 = gargalhada ---
// sequências como [quadro, ms]; o tocador passa de um quadro ao outro suavemente
const SMIRK = [[1, 320], [1, 700], [0, 380]];
const RISE = [[1, 160], [2, 150], [3, 140], [4, 130], [5, 130]];
const CACKLE = [[4, 120], [5, 120]];
const CALM = [[3, 220], [2, 220], [1, 260], [0, 320]];
const CHATTER = [[3, 140], [4, 120], [2, 140], [4, 130]];
let sprite = null;
let busy = false; // uma sequência não dispara por cima da outra

function setIdle(on) {
  $('mascot').classList.toggle('idle', on);
}

async function laugh(cackles) {
  await sprite.play(RISE);
  await sprite.play(CACKLE, { loops: cackles });
  await sprite.play(CALM);
}

// O show: gargalhada longa com confete no pico.
async function showtime() {
  if (!sprite || busy || reduceMotion) return;
  busy = true;
  setIdle(false);
  await sprite.play(RISE);
  confetti();
  await sprite.play(CACKLE, { loops: 6 });
  await sprite.play(CALM);
  busy = false;
  setIdle(true);
}

// sorrisinho de canto, sem falar nada
async function smirk() {
  if (!sprite || busy || reduceMotion) return;
  busy = true;
  setIdle(false);
  await sprite.play(SMIRK);
  busy = false;
  setIdle(true);
}

async function giggle(text) {
  say(text);
  if (!sprite || busy || reduceMotion) return;
  busy = true;
  setIdle(false);
  await laugh(3);
  busy = false;
  setIdle(true);
}

// ri enquanto a voz fala
function mascotTalks() {
  return {
    onStart: () => {
      if (!sprite || busy || reduceMotion) return;
      setIdle(false);
      sprite.play(CHATTER, { loops: Infinity });
    },
    onEnd: () => {
      if (busy || !sprite) return;
      sprite.play(CALM).then((done) => done && setIdle(true));
    },
  };
}

// de vez em quando ele ri de uma piada sozinho ou só dá um sorrisinho
function idleLoop() {
  setTimeout(() => {
    if (!paused && document.visibilityState === 'visible' && !busy) {
      if (Math.random() < 0.5) giggle(randomJoke());
      else smirk();
    }
    idleLoop();
  }, 9000 + Math.random() * 8000);
}

// janela escondida na bandeja: para tudo
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && sprite) {
    sprite.hold(0);
    busy = false;
    setIdle(true);
  }
});

// falas do Shaco (assets/voices): uma por clique, sorteada, sem repetir a anterior
const VOICE_LINES = [
  { file: 'truque.mp3', text: 'Que tal um truque de mágica?' },
  { file: 'piada.mp3', text: 'Você é a piada aqui.' },
  { file: 'morte.mp3', text: null },
];
let voiceAudio = null;
let lastLine = -1;

// toca uma fala com o Shaco mexendo a boca; clicar de novo corta a fala atual e já passa para a próxima
function playVoiceLine() {
  if (voiceAudio) {
    const old = voiceAudio;
    voiceAudio = null; // a fala cortada não chama o "terminou" (a animação continua na próxima)
    old.pause();
  }
  let i;
  do i = Math.floor(Math.random() * VOICE_LINES.length);
  while (i === lastLine && VOICE_LINES.length > 1);
  lastLine = i;
  const line = VOICE_LINES[i];
  const audio = new Audio(`../assets/voices/${line.file}`);
  voiceAudio = audio;
  if (line.text) say(line.text, 3200);
  else hideBubble(); // fala sem texto: não deixa o balão da anterior na tela
  if (sprite && !busy && !reduceMotion) {
    setIdle(false);
    sprite.play(CHATTER, { loops: Infinity });
  }
  const done = () => {
    if (voiceAudio !== audio) return;
    voiceAudio = null;
    if (sprite && !busy) sprite.play(CALM).then((ok) => ok && setIdle(true));
  };
  audio.addEventListener('ended', done);
  audio.addEventListener('error', done);
  audio.play().catch(done);
  return true;
}

// cutucar o Shaco: confete e uma fala dele (cada clique troca para a próxima)
$('mascot').addEventListener('click', () => {
  confetti();
  playVoiceLine();
});

async function loadSprite() {
  try {
    const manifest = await api.animManifest();
    sprite = new window.HeadPlayer($('sprite'), manifest.head);
    await sprite.preload();
  } catch (err) {
    // sem os quadros: mostra a logo parada
    sprite = null;
    const logo = new Image();
    logo.src = '../assets/logo-512.png';
    await logo.decode().catch(() => {});
    const canvas = $('sprite');
    canvas.width = canvas.height = 300;
    canvas.getContext('2d').drawImage(logo, 0, 0, 300, 300);
    canvas.classList.add('fallback');
  }
}

function voiceSettingsFromConfig() {
  return { style: config.voiceStyle, pitch: config.voicePitch, rate: config.voiceRate, gemini: config.geminiVoice };
}

function flashSaved() {
  $('saved').classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $('saved').classList.remove('show'), 1400);
}

async function save(patch) {
  config = await api.saveConfig({ ...config, ...patch });
  flashSaved();
  renderReady(await api.getState());
}

// --- palco ---
function setReady(id, state, text) {
  $(id).className = state;
  $(id).querySelector('.ready-state').textContent = text;
}

function renderReady(s) {
  setReady('readyKey', s.keySet ? 'ok' : 'pending', s.keySet ? 'salva' : 'pendente');
  setReady('readyLeague', s.leagueFound ? 'ok' : 'bad', s.leagueFound ? 'encontrada' : 'não encontrada');
  setReady('readyPatch', s.patch ? 'ok' : 'pending', s.patch ? `patch ${s.patch}` : 'baixando');
  $('leagueHint').textContent = s.leagueFound
    ? 'Usada para ler a seleção de campeões e aplicar runas.'
    : 'Não achei o LoL nessa pasta. Clique em Procurar e escolha a pasta onde ele está instalado.';
}

function renderStatus(s) {
  const key = paused ? 'paused' : s.status;
  const [title, detail] = STATUS[key] || STATUS.waiting;
  document.body.classList.toggle('paused', paused);
  if (lastStatusKey && key !== lastStatusKey) {
    animate($('statusPill'), 'flash');
    if (key === 'ingame' || key === 'champselect') {
      if (busy || reduceMotion) confetti();
      else showtime();
    }
    if (STATUS_LINES[key]) say(STATUS_LINES[key]);
  }
  lastStatusKey = key;
  $('statusPill').className = `pill ${key}`;
  $('statusText').textContent = title;
  $('statusDetail').textContent = paused ? detail : s.detail || detail;
  $('version').textContent = s.patch ? `v${s.appVersion} · patch ${s.patch}` : `v${s.appVersion}`;
  renderReady(s);
}

function renderPaused() {
  $('overlayLabel').textContent = paused ? 'Ativar overlay' : 'Pausar overlay';
  $('btnOverlay').classList.toggle('paused', paused);
}

// --- resultado do teste da chave ---
function showResult(text, cls) {
  $('keyResult').hidden = false;
  $('keyResult').className = `result ${cls}`;
  $('keyResultText').textContent = text;
}

// --- roleta do caos ---
let spinning = false;
$('btnRoulette').addEventListener('click', async () => {
  if (spinning) return;
  const r = await api.roulette();
  if (!r) return say('Ainda baixando os dados do patch. Tenta já já!');
  spinning = true;
  $('btnRoulette').disabled = true;
  $('rouletteBuild').hidden = true;
  $('rouletteQ').hidden = true;
  $('rouletteName').textContent = 'Girando…';
  $('rouletteTitle').textContent = '';
  // os rostos passam rápido e vão freando até parar no sorteado
  const face = $('rouletteFace');
  let delay = 55;
  for (const src of r.spin) {
    face.src = src;
    window.shacoSfx.tick?.();
    await new Promise((ok) => setTimeout(ok, delay));
    delay *= 1.14;
  }
  face.src = r.champion.icon;
  animate(face.parentElement, 'landed');
  $('rouletteName').textContent = r.champion.name;
  $('rouletteTitle').textContent = r.champion.title;
  $('rouletteItems').replaceChildren(
    ...[r.boots, ...r.items].map((it) => {
      const box = node('span', 'roulette-item');
      const im = node('img');
      im.src = it.icon;
      im.alt = '';
      box.title = it.name;
      box.append(im, node('span', null, it.name));
      return box;
    })
  );
  $('rouletteExtra').textContent = `Maximize o ${r.max} primeiro. Boa sorte (você vai precisar).`;
  $('rouletteBuild').hidden = false;
  window.shacoSfx.confetti();
  confetti(28);
  say(`${r.champion.name} com essa build? Hehehe, vai ser um show!`, 4500);
  $('btnRoulette').disabled = false;
  spinning = false;
});

// --- desafio do dia ---
function renderChallenge(c) {
  $('challenge').hidden = !c;
  if (!c) return;
  $('challenge').classList.toggle('done', c.done);
  $('challengeText').textContent = c.text;
  $('challengeState').textContent = c.done ? '✓ Cumprido hoje' : 'Vale hoje';
  $('challengeStreak').textContent = c.streak ? `🔥 ${c.streak} ${c.streak === 1 ? 'dia' : 'dias'}` : c.best ? `melhor: ${c.best}` : '';
  $('challengeStreak').title = c.best ? `Melhor sequência: ${c.best} ${c.best === 1 ? 'dia' : 'dias'}` : '';
  $('btnSwapChallenge').hidden = c.done || c.swapped;
}

$('btnSwapChallenge').addEventListener('click', async () => renderChallenge(await api.swapChallenge()));
api.onChallenge((c) => {
  renderChallenge(c);
  if (c.celebrate) {
    window.shacoSfx.success();
    confetti(36);
    say(c.streak > 1 ? `Desafio cumprido! ${c.streak} dias seguidos, hehehe.` : 'Desafio do dia cumprido! Hehehe.', 5000);
  }
});

// --- tutorial da primeira abertura ---
const TOUR = [
  { tab: 'ai', target: '#apiKey', title: 'Sua chave do Gemini', text: 'O Shaco usa o Gemini do Google, que é grátis. Clique em "Pegar uma chave grátis", cole a chave aqui e aperte Salvar. O certinho verde mostra que deu certo.' },
  { tab: 'game', target: '#leaguePath', title: 'Pasta do League of Legends', text: 'Com ela o Shaco lê a seleção de campeões, cria a página de runas e manda a build para a loja. Se o LoL estiver em outro lugar, use Procurar.' },
  { tab: 'panel', target: '#pane-panel .note', title: 'Modo de vídeo Sem bordas', text: 'Nas configurações de vídeo do LoL, escolha "Sem bordas". Em tela cheia o painel do Shaco não aparece por cima do jogo.' },
  { tab: 'panel', target: '#btnCalibrateHud', title: 'Moldura das habilidades', text: 'Na primeira partida, abra o jogo e clique aqui. Arraste a moldura até ficar em cima do Q, W, E e R: é ela que pisca na habilidade que você deve subir.' },
  { tab: 'games', target: '#pane-games', title: 'Suas partidas', text: 'Quando uma partida acaba, o resumo com o que foi bem e 3 pontos para melhorar aparece no painel do jogo e fica guardado aqui.' },
  { tab: 'keys', target: '.keys', title: 'Atalhos no jogo', text: 'Ctrl+Shift+A abre o chat com o Shaco, Ctrl+Shift+M liga ou desliga a voz e Ctrl+Shift+S esconde o painel.' },
  { tab: null, target: '#mascot', title: 'Pronto!', text: 'É só abrir o LoL e entrar numa partida. Se quiser ver isso de novo, tem um botão na aba Atalhos. Hehehe.' },
];
let tourAt = -1;

function showTourStep(i) {
  tourAt = i;
  const step = TOUR[i];
  if (step.tab) document.querySelector(`.tab[data-tab="${step.tab}"]`).click();
  $('tourStep').textContent = `Passo ${i + 1} de ${TOUR.length}`;
  $('tourTitle').textContent = step.title;
  $('tourText').textContent = step.text;
  $('tourBack').hidden = i === 0;
  $('tourNext').textContent = i === TOUR.length - 1 ? 'Começar' : 'Próximo';
  requestAnimationFrame(placeTour);
}

// spotlight em volta do alvo e o cartão embaixo dele (ou em cima, se não couber)
function placeTour() {
  if (tourAt < 0) return;
  const target = document.querySelector(TOUR[tourAt].target);
  const r = target.getBoundingClientRect();
  const pad = 6;
  Object.assign($('tourSpot').style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  const card = $('tourCard');
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const below = r.bottom + pad + 12;
  const top = below + ch < innerHeight - 8 ? below : Math.max(8, r.top - pad - 12 - ch);
  const left = Math.min(Math.max(8, r.left + r.width / 2 - cw / 2), innerWidth - cw - 8);
  Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
}

function startTour() {
  $('tour').hidden = false;
  showTourStep(0);
}

function endTour() {
  tourAt = -1;
  $('tour').hidden = true;
  document.querySelector('.tab[data-tab="ai"]').click();
  if (!config.tutorialDone) save({ tutorialDone: true });
}

$('tourNext').addEventListener('click', () => {
  if (tourAt < 0) return;
  if (tourAt === TOUR.length - 1) endTour();
  else showTourStep(tourAt + 1);
});
$('tourBack').addEventListener('click', () => tourAt > 0 && showTourStep(tourAt - 1));
$('tourSkip').addEventListener('click', endTour);
$('btnTour').addEventListener('click', startTour);
window.addEventListener('resize', placeTour);
window.addEventListener('keydown', (e) => {
  if (tourAt < 0) return;
  if (e.key === 'Escape') endTour();
  if (e.key === 'ArrowRight' || e.key === 'Enter') $('tourNext').click();
  if (e.key === 'ArrowLeft' && tourAt > 0) $('tourBack').click();
});

// --- partidas: histórico com o resumo pós-partida ---
const openGames = new Set();
function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function renderHistory(list) {
  const box = $('games');
  if (!list.length) return box.replaceChildren(node('li', 'games-empty', 'Nenhuma partida ainda. Jogue uma e o resumo aparece aqui.'));
  box.replaceChildren(
    ...list.map((s) => {
      const li = node('li', `game ${s.result || ''}${openGames.has(s.id) ? ' open' : ''}`);
      const head = node('button', 'game-head');
      head.type = 'button';
      const icon = node('img', 'game-icon');
      icon.alt = '';
      if (s.icon) icon.src = s.icon;
      const title = node('span', 'game-title');
      title.append(node('b', null, s.result === 'win' ? 'Vitória' : s.result === 'lose' ? 'Derrota' : 'Encerrada'), node('span', null, `${s.champion} · ${s.mode} · ${s.duration}`));
      const stats = node('span', 'game-stats', `${s.kills}/${s.deaths}/${s.assists} · ${s.csPerMin} CS/min${s.lanes ? ` · visão ${s.vision}` : ''}`);
      const when = node('span', 'game-date', new Date(s.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
      head.append(icon, title, stats, when);
      head.addEventListener('click', () => {
        openGames.has(s.id) ? openGames.delete(s.id) : openGames.add(s.id);
        li.classList.toggle('open');
      });
      const body = node('div', 'game-body');
      const r = s.review;
      if (!r || r.status === 'off') body.append(node('p', 'hint', 'Sem análise: a chave do Gemini não estava salva.'));
      else if (r.status === 'loading') body.append(node('p', 'hint', 'O Shaco está analisando…'));
      else if (r.status === 'error') body.append(node('p', 'hint', r.error));
      else {
        if (r.good) body.append(node('p', 'game-good', r.good));
        const ol = node('ol', 'game-points');
        r.points.forEach((p) => ol.append(node('li', null, p)));
        body.append(ol);
      }
      if (s.deathTimes?.length) body.append(node('p', 'hint', `Mortes: ${s.deathTimes.join(', ')}`));
      li.append(head, body);
      return li;
    })
  );
}
api.onHistory(renderHistory);

// --- abas ---
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      $(`pane-${t.dataset.tab}`).hidden = !on;
    });
  });
});

async function init() {
  config = await api.getConfig();
  $('apiKey').value = config.geminiApiKey;
  $('model').value = config.geminiModel;
  $('leaguePath').value = config.leaguePath;
  $('voice').setAttribute('aria-checked', String(config.voice));
  renderVoice();
  renderPanel();
  ['autoAccept', 'autoBuild', 'autoSpells', 'overlayCompact', 'spotifyPlaylist'].forEach(bindSwitch);
  renderFlash();

  renderHistory(await api.getHistory());
  renderChallenge(await api.getChallenge());
  const state = await api.getState();
  paused = state.paused;
  renderPaused();
  renderStatus(state);
}

// janela
$('btnMin').addEventListener('click', () => api.minimize());
$('btnClose').addEventListener('click', () => api.hide());
$('btnMax').addEventListener('click', () => api.toggleMaximize());
api.onMaximized((on) => {
  document.body.classList.toggle('maximized', on);
  $('btnMax').setAttribute('aria-label', on ? 'Restaurar' : 'Expandir');
  $('btnMax').title = on ? 'Restaurar' : 'Expandir';
});
window.addEventListener('blur', () => document.body.classList.add('blurred'));
window.addEventListener('focus', () => document.body.classList.remove('blurred'));

// overlay
$('btnOverlay').addEventListener('click', async () => {
  paused = await api.setPaused(!paused);
  renderPaused();
  renderStatus(await api.getState());
});
api.onStatus(renderStatus);
api.onUpdate((version) => {
  $('version').textContent += ` · v${version} pronta: feche o app para atualizar`;
  say(`Tem versão nova (${version})! Ela entra quando você fechar o app.`, 6000);
});

// chave e modelo
$('apiKey').addEventListener('change', () => save({ geminiApiKey: $('apiKey').value.trim() }));
$('btnShowKey').addEventListener('click', () => {
  const show = $('apiKey').type === 'password';
  $('apiKey').type = show ? 'text' : 'password';
  $('btnShowKey').classList.toggle('on', show);
  $('btnShowKey').setAttribute('aria-label', show ? 'Esconder chave' : 'Mostrar chave');
});
// certinho (deu certo) ou X com a tela tremendo (deu errado), com som
let verdictTimer = null;
function verdict(ok, text) {
  const box = $('verdict');
  clearTimeout(verdictTimer);
  box.hidden = false;
  box.className = `verdict ${ok ? 'ok' : 'bad'}`;
  $('verdictText').textContent = text;
  void box.offsetWidth; // reinicia as animações
  box.classList.add('show');
  if (ok) window.shacoSfx.success();
  else {
    window.shacoSfx.error();
    // tira a classe por tempo: o animationend das animações de dentro também sobe até o body
    document.body.classList.remove('shake');
    void document.body.offsetWidth;
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 550);
  }
  verdictTimer = setTimeout(() => {
    box.classList.remove('show');
    verdictTimer = setTimeout(() => (box.hidden = true), 250);
  }, ok ? 1600 : 2000);
}

// Salvar: guarda a chave e o modelo e confere de verdade com o Gemini
$('btnSaveKey').addEventListener('click', async () => {
  const btn = $('btnSaveKey');
  const key = $('apiKey').value.trim();
  const model = $('model').value.trim();
  if (!key || !model) {
    const msg = !key ? 'Cole a chave do Gemini antes de salvar.' : 'Escolha um modelo antes de salvar.';
    showResult(msg, 'bad');
    return verdict(false, !key ? 'Falta a chave' : 'Falta o modelo');
  }
  btn.disabled = true;
  btn.textContent = 'Salvando';
  showResult('Conferindo a chave com o Gemini…', 'busy');
  try {
    await save({ geminiApiKey: key, geminiModel: model });
    const res = await api.testKey();
    if (res.model && res.model !== model) {
      // o modelo digitado não respondeu e o Shaco trocou por um que funciona
      $('model').value = res.model;
      config.geminiModel = res.model;
    }
    if (!res.ok) {
      showResult(res.error, 'bad');
      verdict(false, 'Chave ou modelo errado');
    } else if (res.model !== model) {
      showResult(`O modelo "${model}" não funcionou. Troquei para ${res.model}, que respondeu: “${res.text}”`, 'bad');
      verdict(false, 'Modelo errado');
    } else {
      showResult(`Funcionando com ${res.model}. O Shaco diz: “${res.text}”`, 'ok');
      verdict(true, 'Chave salva!');
    }
  } catch (err) {
    showResult(`Não deu para conferir: ${err.message}`, 'bad');
    verdict(false, 'Não deu para conferir');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
});
$('linkKey').addEventListener('click', () => api.openKeyPage());
$('model').addEventListener('change', () => save({ geminiModel: $('model').value.trim() || DEFAULT_MODEL }));

// voz
const SAMPLE = 'Quer saber um segredo? Aquela Jinx está cinco a zero. Compre Dança da Morte antes que ela te ache.';

function renderVoice() {
  const style = config.voiceStyle || 'shaco';
  $('styleGemini').setAttribute('aria-checked', String(style === 'gemini'));
  $('styleShaco').setAttribute('aria-checked', String(style === 'shaco'));
  $('styleNatural').setAttribute('aria-checked', String(style === 'natural'));
  $('geminiVoices').hidden = style !== 'gemini';
  $('geminiHint').hidden = style !== 'gemini';
  document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.voice === config.geminiVoice)));
  $('voiceSliders').hidden = style !== 'shaco';
  $('voicePitch').value = config.voicePitch;
  $('voiceRate').value = config.voiceRate;
  $('pitchOut').textContent = Number(config.voicePitch).toFixed(2);
  $('rateOut').textContent = `${Number(config.voiceRate).toFixed(2)}×`;
}

document.querySelectorAll('.seg[data-style]').forEach((seg) => {
  seg.addEventListener('click', async () => {
    await save({ voiceStyle: seg.dataset.style });
    renderVoice();
  });
});
['voicePitch', 'voiceRate'].forEach((id) => {
  $(id).addEventListener('input', () => {
    config[id] = Number($(id).value);
    renderVoice();
  });
  $(id).addEventListener('change', () => save({ [id]: Number($(id).value) }));
});
document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', async () => {
    await save({ geminiVoice: chip.dataset.voice });
    renderVoice();
  });
});

$('btnPreview').addEventListener('click', async () => {
  const btn = $('btnPreview');
  btn.disabled = true;
  $('voiceName').textContent = config.voiceStyle === 'gemini' ? 'Gerando a voz…' : '';
  say(SAMPLE, 6000);
  const name = await window.shacoVoice.speak(SAMPLE, voiceSettingsFromConfig(), { auto: true, ...mascotTalks() });
  btn.disabled = false;
  $('voiceName').textContent = name || 'Nenhuma voz em português instalada no Windows.';
});

// interruptores simples: cada um guarda o campo de mesmo id na configuração
function bindSwitch(id) {
  $(id).setAttribute('aria-checked', String(!!config[id]));
  $(id).onclick = () => {
    const on = $(id).getAttribute('aria-checked') !== 'true';
    $(id).setAttribute('aria-checked', String(on));
    save({ [id]: on });
  };
}

// tecla do Flash
function renderFlash() {
  document.querySelectorAll('.seg[data-flash]').forEach((seg) =>
    seg.setAttribute('aria-checked', String(seg.dataset.flash === (config.flashKey || 'D')))
  );
  $('flashField').classList.toggle('dim', !config.autoSpells);
}
document.querySelectorAll('.seg[data-flash]').forEach((seg) => {
  seg.addEventListener('click', async () => {
    await save({ flashKey: seg.dataset.flash });
    renderFlash();
  });
});
$('autoSpells').addEventListener('click', () => setTimeout(renderFlash, 0));

// painel
function renderPanel() {
  $('overlayScale').value = config.overlayScale;
  $('overlayOpacity').value = config.overlayOpacity;
  $('scaleOut').textContent = `${Math.round(config.overlayScale * 100)}%`;
  $('opacityOut').textContent = `${Math.round(config.overlayOpacity * 100)}%`;
}
['overlayScale', 'overlayOpacity'].forEach((id) => {
  // salva enquanto arrasta, para o painel do jogo mudar na hora
  $(id).addEventListener('input', () => {
    config[id] = Number($(id).value);
    renderPanel();
    save({ [id]: config[id] });
  });
});
$('btnOverlayPreview').addEventListener('click', () => api.previewOverlay());
$('btnCalibrateHud').addEventListener('click', () => {
  api.hide(); // sai da frente para mostrar a barra do jogo; volta sozinha ao salvar
  api.calibrateHud();
});

// jogo
$('voice').addEventListener('click', () => {
  const on = $('voice').getAttribute('aria-checked') !== 'true';
  $('voice').setAttribute('aria-checked', String(on));
  save({ voice: on });
});
$('leaguePath').addEventListener('change', () => save({ leaguePath: $('leaguePath').value.trim() }));
$('btnBrowse').addEventListener('click', async () => {
  const dir = await api.pickFolder();
  if (dir) {
    $('leaguePath').value = dir;
    save({ leaguePath: dir });
  }
});

buildWordmark();
Promise.all([init(), loadSprite()]).then(() => {
  // primeira aparição: o show completo e um cumprimento
  setTimeout(() => say(paused ? STATUS_LINES.paused : 'Hehehe... chegou quem faltava.'), 400);
  if (!paused) showtime();
  // primeira vez que o app abre: tutorial
  if (!config.tutorialDone) setTimeout(startTour, 1200);
  idleLoop();
});
