const $ = (id) => document.getElementById(id);
const POS_KEY = 'shaco-panel-pos';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function img(src, className) {
  const node = document.createElement('img');
  node.src = src;
  if (className) node.className = className;
  node.alt = '';
  return node;
}

function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

// --- voz e balão de fala ---
function showSpeech(text, { speak = false, thinking = false, voice = {}, auto = false } = {}) {
  const box = $('speech');
  box.classList.remove('hidden', 'pop');
  void box.offsetWidth; // reinicia o "pop" a cada fala nova
  box.classList.add('pop');
  box.classList.toggle('thinking', thinking);
  $('speechText').textContent = text;
  if (speak && !thinking) {
    const mascot = $('speechMascot');
    window.shacoVoice.speak(text, voice || {}, {
      auto,
      onStart: () => mascot.classList.add('talking'),
      onEnd: () => mascot.classList.remove('talking'),
    });
  }
}

// --- chat ---
window.shaco.onChat(({ open }) => {
  $('chat').classList.toggle('hidden', !open);
  if (open) {
    $('chatInput').value = '';
    $('chatInput').focus();
  }
});

$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.shaco.closeChat();
});

$('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const question = $('chatInput').value.trim();
  if (!question) return;
  $('chatInput').value = '';
  window.shaco.closeChat();
  showSpeech('Hmm… deixa eu pensar…', { thinking: true });
  const res = await window.shaco.ask(question);
  showSpeech(res.ok ? res.text : res.error, { speak: res.ok && res.speak, voice: res.voice });
});

window.shaco.onSay(({ text, speak, voice, auto }) => showSpeech(text, { speak, voice, auto }));

// --- emotes: o painel apaga e a reação do Shaco aparece por cima, uma de cada vez ---
const EMOTES = {
  // legendas com os termos que se usa no LoL
  death: { text: 'Slain…', ms: 4000 },
  kill: { text: 'Kill!', ms: 4000 },
  assist: { text: 'Assist!', ms: 3500 },
  tower: { text: 'Turret down!', ms: 4000 },
  steal: { text: 'Steal!', ms: 5000 },
  firstblood: { text: 'First Blood!', ms: 6000, now: true },
  // multiabates cortam o anterior: Kill! → Double Kill! → Triple Kill! → ...
  double: { text: 'Double Kill!', ms: 4500, now: true },
  triple: { text: 'Triple Kill!', ms: 5000, now: true },
  quadra: { text: 'Quadra Kill!', ms: 6000, now: true },
  penta: { text: 'PENTAKILL!', ms: 8000, now: true },
  win: { text: 'Victory!', ms: 9000, now: true },
  lose: { text: 'Defeat…', ms: 9000, now: true },
  // leitura do jogo: a legenda vem pronta do processo principal ("3v5!", "Top down · 24s")
  outnumbered: { text: 'Outnumbered!', ms: 4500 },
  opening: { text: 'Enemy down!', ms: 4500 },
  sixseven: { text: '6/7!', ms: 5000 },
  dance: { text: 'Dance!', ms: 4000 },
  ward: { text: 'Control Ward!', ms: 5000 },
  grubs: { text: 'Voidgrubs!', ms: 4500 },
  dragon: { text: 'Dragon!', ms: 5000 },
  elder: { text: 'Elder Dragon!', ms: 6000, now: true },
  soul: { text: 'Dragon Soul!', ms: 6000, now: true },
  baron: { text: 'Baron Nashor!', ms: 6000, now: true },
  // fim da fase de rotas: a imagem é a da função de quem joga
  'rotate-bot': { text: 'Lane phase over', ms: 6000 },
  'rotate-mid': { text: 'Lane phase over', ms: 6000 },
  'rotate-top': { text: 'Lane phase over', ms: 6000 },
};
const emoteQueue = [];
let emoteTimer = null;

// item: a chave do emote ou { key, text } quando a legenda muda a cada vez
function showEmote(item) {
  const { key, text } = typeof item === 'string' ? { key: item } : item;
  if (!EMOTES[key]) return;
  // pentakill e fim de jogo cortam o que estiver na tela; o resto não acumula mais que três
  if (EMOTES[key].now) {
    emoteQueue.length = 0;
    clearTimeout(emoteTimer);
    emoteTimer = null;
  } else if (emoteQueue.length >= 3) return;
  emoteQueue.push({ key, text: text || EMOTES[key].text });
  if (!emoteTimer) nextEmote();
}

function nextEmote() {
  const item = emoteQueue.shift();
  const box = $('emote');
  if (!item) {
    emoteTimer = null;
    box.classList.add('hidden');
    $('panel').classList.remove('emoting');
    return;
  }
  const { key, text } = item;
  $('emoteImg').src = `../assets/emotes/${key}.webp`;
  $('emoteText').textContent = text;
  box.className = `emote ${key}${text.length > 12 ? ' long' : ''}`;
  void box.offsetWidth; // reinicia a animação de entrada
  box.classList.add('pop');
  $('panel').classList.add('emoting');
  emoteTimer = setTimeout(nextEmote, EMOTES[key].ms);
}

window.shaco.onEmote(showEmote);

// --- habilidades: ordem no painel e moldura na barra do jogo ---
function skillChip(skills, k) {
  const icon = skills.spells?.[k]?.icon;
  const box = el('span', icon ? 'skill' : 'skill no-icon', icon ? null : k);
  if (icon) {
    const im = img(icon);
    im.title = skills.spells[k].name;
    box.append(im, el('kbd', null, k));
  }
  return box;
}

function renderSkills(section, skills) {
  section.classList.toggle('hidden', !skills);
  if (!skills) return;
  const box = section.querySelector('.skill-box');
  if (skills.status === 'loading') return box.replaceChildren(el('div', 'muted', 'Pensando na ordem das habilidades…'));
  if (skills.status === 'error') return box.replaceChildren(el('div', 'muted', skills.error));

  const parts = [];
  if (skills.next) {
    const now = el('div', 'skill-now');
    const text = el('div');
    text.append(document.createTextNode('Suba '), el('b', null, skills.next), document.createTextNode(` agora${skills.spells ? ` · ${skills.spells[skills.next].name}` : ''}`));
    now.append(skillChip(skills, skills.next), text);
    parts.push(now);
  }
  const order = el('div', 'skill-order');
  skills.max.forEach((k, i) => {
    if (i) order.append(el('span', 'skill-sep', '›'));
    order.append(skillChip(skills, k));
  });
  order.append(el('span', 'muted', ' R no 6, 11 e 16'));
  parts.push(order);
  const meta = el('div', 'skill-meta');
  if (skills.start?.length) meta.append(document.createTextNode('Começo: '), el('b', null, skills.start.join(' ')), document.createTextNode(skills.explain ? ` · ${skills.explain}` : ''));
  else if (skills.explain) meta.textContent = skills.explain;
  if (meta.textContent) parts.push(meta);
  box.replaceChildren(...parts);
}

const HUD_KEY = 'shaco-hud-pos';
let hudPos = null;
let calibrating = false;
let hudNext = null;

// chute para HUD no tamanho padrão; cada pessoa ajusta uma vez pelo launcher
function defaultHud() {
  const H = window.innerHeight;
  const size = Math.round(H * 0.043);
  const gap = Math.round(size * 0.2);
  const total = 4 * size + 3 * gap;
  return { left: Math.round(window.innerWidth / 2 - total / 2 - H * 0.03), top: Math.round(H - H * 0.075 - size), size, gap };
}

function applyHud() {
  const hud = $('hud');
  hud.style.left = `${hudPos.left}px`;
  hud.style.top = `${hudPos.top}px`;
  hud.style.setProperty('--size', `${hudPos.size}px`);
  hud.style.setProperty('--gap', `${hudPos.gap}px`);
}

function renderHud(next) {
  hudNext = next || null;
  if (calibrating) return;
  $('hud').classList.toggle('hidden', !hudNext);
  document.querySelectorAll('.hud-slot').forEach((s) => s.classList.toggle('on', s.dataset.k === hudNext));
}

try {
  hudPos = JSON.parse(localStorage.getItem(HUD_KEY));
} catch {}
hudPos = hudPos || defaultHud();
applyHud();

let hudDrag = null;
$('hud').addEventListener('mousedown', (e) => {
  if (!calibrating || e.target.closest('.hud-help')) return;
  hudDrag = { dx: e.clientX - hudPos.left, dy: e.clientY - hudPos.top };
});
window.addEventListener('mousemove', (e) => {
  if (!hudDrag) return;
  hudPos.left = e.clientX - hudDrag.dx;
  hudPos.top = e.clientY - hudDrag.dy;
  applyHud();
});
window.addEventListener('mouseup', () => (hudDrag = null));
window.addEventListener('wheel', (e) => {
  if (!calibrating) return;
  const step = e.deltaY < 0 ? 1 : -1;
  if (e.shiftKey) hudPos.gap = Math.max(0, hudPos.gap + step);
  else hudPos.size = Math.max(20, hudPos.size + step * 2);
  applyHud();
});

function endCalibration(save) {
  if (!calibrating) return;
  calibrating = false;
  document.body.classList.remove('calibrating');
  if (save) {
    try {
      localStorage.setItem(HUD_KEY, JSON.stringify(hudPos));
    } catch {}
  } else {
    try {
      hudPos = JSON.parse(localStorage.getItem(HUD_KEY)) || defaultHud();
    } catch {
      hudPos = defaultHud();
    }
    applyHud();
  }
  renderHud(hudNext);
  window.shaco.calibrateDone();
}

window.shaco.onCalibrate(() => {
  calibrating = true;
  document.body.classList.add('calibrating');
  $('hud').classList.remove('hidden');
  window.focus();
});
$('hudSave').addEventListener('click', () => endCalibration(true));
$('hudReset').addEventListener('click', () => {
  hudPos = defaultHud();
  applyHud();
});
window.addEventListener('keydown', (e) => {
  if (!calibrating) return;
  if (e.key === 'Enter') endCalibration(true);
  if (e.key === 'Escape') endCalibration(false);
});

// --- partida ---
function renderRecs(data) {
  const buy = $('buyNow');
  buy.replaceChildren();
  buy.className = 'buy-now' + (data.buyNow?.ready ? ' ready' : '');
  if (data.buyNow?.partIcon) buy.append(img(data.buyNow.partIcon));
  buy.append(el('span', null, data.buyNow ? data.buyNow.text : 'Sem ameaça específica: siga sua build principal.'));

  $('recs').replaceChildren(
    ...data.recs.map((r) => {
      const li = el('li');
      const text = el('div');
      text.append(el('div', 'name', r.name), el('div', 'reason', r.reason));
      li.append(img(r.icon), text, el('span', 'price', r.price));
      return li;
    })
  );
}

function renderThreats(t) {
  const ad = Math.round(t.adPct * 100);
  $('adBar').style.width = `${ad}%`;
  $('apBar').style.width = `${100 - ad}%`;
  const extra = [];
  if (t.tanks) extra.push(`${t.tanks} tanque${t.tanks > 1 ? 's' : ''}`);
  if (t.healers.length) extra.push(`cura: ${t.healers.join(', ')}`);
  $('dmgLabel').textContent = `Físico ${ad}% · Mágico ${100 - ad}%` + (extra.length ? ` · ${extra.join(' · ')}` : '');
}

function renderLanes(lanes) {
  $('lanes').replaceChildren(
    ...lanes.map((l) => {
      const li = el('li', `${l.state}${l.mine ? ' mine' : ''}`);
      // ícone do campeão aliado × ícone do inimigo, com o KDA de cada um
      const face = (p, dead) => {
        const box = el('span', `lane-champ${dead ? ' dead-champ' : ''}`);
        if (p.icon) box.append(img(p.icon));
        box.title = p.name;
        return box;
      };
      const vs = el('div', 'vs');
      const row = el('div', 'vs-row');
      row.append(face(l.ally), el('span', 'kda', l.ally.kda), el('span', 'x', '×'), el('span', 'kda', l.enemy.kda), face(l.enemy, l.enemy.dead));
      vs.append(row);
      if (l.enemy.dead) vs.append(el('div', 'dead', `${l.enemy.name} morto (${l.enemy.respawn}s)`));
      const diffClass = l.state === 'ahead' ? 'ahead-t' : l.state === 'behind' ? 'behind-t' : '';
      const diff = el('div', `diff ${diffClass}`, `${signed(l.goldDiff)}g`);
      diff.title = `Nível ${signed(l.levelDiff)}`;
      li.append(el('div', 'lane', l.label), vs, diff);
      return li;
    })
  );
}

function renderTeam(t) {
  const goldDiff = t.allyGold - t.enemyGold;
  const state = goldDiff > 1000 ? 'ahead-t' : goldDiff < -1000 ? 'behind-t' : '';
  $('team').replaceChildren(
    el('div', null, `Abates ${t.allyKills} × ${t.enemyKills}`),
    el('div', `diff ${state}`, `Itens ${signed(goldDiff)}g`)
  );
}

// tempo até os objetivos (Dragão, Vastilarvas, Arauto, Barão)
function renderObjectives(list) {
  $('objSection').classList.toggle('hidden', !list?.length);
  if (!list?.length) return;
  $('objectives').replaceChildren(
    ...list.map((o) => {
      const li = el('li', `obj ${o.id} ${o.state}`);
      li.append(el('span', 'obj-dot'), el('span', 'obj-name', o.label), el('span', 'obj-time', o.text));
      return li;
    })
  );
}

// desafio do dia durante a partida: o texto e como você está indo
function renderChallenge(c) {
  $('challengeGame').classList.toggle('hidden', !c);
  if (!c) return;
  const box = $('challengeBox');
  box.className = `challenge-box${c.done ? ' done' : ''}`;
  const head = el('div', 'challenge-line');
  head.append(el('b', null, c.text));
  if (c.streak) head.append(el('span', 'challenge-streak', `🔥 ${c.streak}`));
  const status = c.done ? '✓ já cumprido hoje' : c.note || c.progress || '';
  box.replaceChildren(head, el('div', 'challenge-progress', status));
}

// aumentos (Arena, ARAM: Desordem): os melhores do campeão, por raridade
const TIER_LABEL = { prismatic: 'Prismático', gold: 'Ouro', silver: 'Prata' };
function renderAugments(section, aug) {
  section.classList.toggle('hidden', !aug);
  if (!aug) return;
  section.querySelector('h2').textContent = `Melhores aumentos · ${aug.champion}`;
  const box = section.querySelector('.aug-box');
  if (aug.status === 'loading') return box.replaceChildren(el('div', 'muted', 'Escolhendo os aumentos…'));
  if (aug.status === 'error') return box.replaceChildren(el('div', 'muted', aug.error));
  const rows = aug.tiers.map((t) => {
    const row = el('div', `aug-row ${t.tier}`);
    row.append(el('span', 'aug-tier', TIER_LABEL[t.tier]));
    t.augments.forEach((a) => {
      const item = el('span', 'aug');
      item.title = a.name;
      item.append(img(a.icon), el('span', null, a.name));
      row.append(item);
    });
    return row;
  });
  if (aug.explain) rows.push(el('div', 'champ-why', aug.explain));
  box.replaceChildren(...rows);
}

// farm: CS por minuto (verde na meta, amarelo perto, vermelho longe) e diferença para o inimigo da rota
function renderFarm(farm) {
  $('farmSection').classList.toggle('hidden', !farm);
  if (!farm) return;
  const row = el('div', 'farm-row');
  const rate = el('b', `farm-rate ${farm.state || ''}`, farm.perMin != null ? farm.perMin.toFixed(1) : '—');
  const info = el('div', 'farm-info');
  info.append(rate, el('span', 'muted', '/min'), el('span', 'farm-cs', `${farm.cs} CS`));
  row.append(info);
  if (farm.vs) {
    const vs = el('span', `farm-vs ${farm.vs.diff > 0 ? 'up' : farm.vs.diff < 0 ? 'down' : ''}`);
    vs.title = `Seu CS menos o de ${farm.vs.name}`;
    vs.append(el('span', null, `${farm.vs.diff > 0 ? '+' : ''}${farm.vs.diff}`));
    if (farm.vs.icon) vs.append(img(farm.vs.icon));
    row.append(vs);
  }
  const parts = [row];
  if (farm.target) {
    const bar = el('div', 'farm-bar');
    const fill = el('span', farm.state || '');
    fill.style.width = `${Math.min(100, ((farm.perMin || 0) / farm.target) * 100)}%`;
    bar.append(fill);
    parts.push(bar, el('div', 'farm-meta', farm.perMin == null ? `Meta: ${farm.target}/min (conta a partir dos 3:00)` : `Meta da função: ${farm.target}/min`));
  }
  // placar de visão: mesmo esquema de cores, numa linha só
  const v = farm.vision;
  if (v) {
    const line = el('div', 'vision-row');
    line.append(el('span', 'muted', 'Visão'), el('b', `farm-rate small ${v.state || ''}`, String(v.score)));
    if (v.perMin != null) line.append(el('span', 'muted', `${v.perMin.toFixed(1)}/min${v.target ? ` · meta ${v.target}` : ''}`));
    else line.append(el('span', 'muted', 'por minuto a partir dos 5:00'));
    if (v.diff != null) line.append(el('span', `farm-vs ${v.diff > 0 ? 'up' : v.diff < 0 ? 'down' : ''}`, `${v.diff > 0 ? '+' : ''}${v.diff}`));
    parts.push(line);
  }
  $('farm').replaceChildren(...parts);
}

// leitura do jogo: quem está vivo dos dois lados e quanto falta para cada inimigo morto voltar
function renderRead(read) {
  $('readSection').classList.toggle('hidden', !read);
  if (!read) return;
  const diff = read.alliesAlive - read.enemiesAlive;
  const alive = el('div', 'read-alive');
  alive.append(
    el('span', 'muted', 'Vivos'),
    el('b', 'ally-n', String(read.alliesAlive)),
    el('span', 'muted', '×'),
    el('b', 'enemy-n', String(read.enemiesAlive))
  );
  if (diff) alive.append(el('span', `read-tag ${diff > 0 ? 'up' : 'down'}`, diff > 0 ? `${diff} a mais` : `${-diff} a menos`));
  const parts = [alive];
  if (read.deadEnemies.length) {
    const row = el('div', 'read-dead');
    read.deadEnemies.forEach((d) => {
      const face = el('span', 'read-face');
      face.title = `${d.name}${d.lane ? ` (${d.lane})` : ''} volta em ${d.respawn}s`;
      if (d.icon) face.append(img(d.icon));
      face.append(el('span', 'read-timer', `${d.respawn}s`));
      row.append(face);
    });
    parts.push(row);
  }
  $('read').replaceChildren(...parts);
}

function renderInGame(data) {
  const arena = data.mode.key === 'CHERRY';
  $('clock').textContent = data.clock;
  if (data.me.icon) $('champIcon').src = data.me.icon;
  $('sub').textContent = `${data.mode.label} · ${data.me.champion} · nv ${data.me.level} · ${data.me.gold}g`;
  renderRecs(data);
  renderSkills($('skillsGame'), data.skills);
  renderHud(data.skills?.next);
  renderRead(data.read);
  renderFarm(data.farm);
  renderAugments($('augGame'), data.augments);
  renderChallenge(data.challenge);
  renderObjectives(data.objectives);
  $('dmgTitle').textContent = arena ? 'Dano no lobby' : 'Dano inimigo';
  renderThreats(data.threats);
  $('lanesSection').classList.toggle('hidden', !data.lanes.length);
  renderLanes(data.lanes);
  $('teamSection').classList.toggle('hidden', !data.team);
  if (data.team) renderTeam(data.team);
  $('tips').replaceChildren(...data.tips.map((t) => el('li', null, t)));
}

// --- seleção de campeões ---
function runeRow(runes, keyFirst) {
  const row = el('div', 'rune-row');
  runes.forEach((r, i) => {
    const icon = img(r.icon, keyFirst && i === 0 ? 'key' : '');
    icon.title = r.name;
    row.append(icon);
  });
  return row;
}

function renderBuild(build) {
  $('buildSection').classList.toggle('hidden', !build);
  if (!build) return;
  const status = {
    loading: 'Montando a build e mandando para a loja…',
    sent: 'Na loja do jogo, aba de itens recomendados: "Shaco IA".',
    error: build.error,
  }[build.status];
  $('buildStatus').textContent = status;
  const row = (label, items) => {
    if (!items?.length) return null;
    const line = el('div', 'build-row');
    line.append(el('span', 'build-label', label));
    items.forEach((i) => {
      const icon = img(i.icon);
      icon.title = i.name;
      line.append(icon);
    });
    return line;
  };
  $('buildItems').replaceChildren(
    ...[row('Início', build.start), row('Botas', build.boots), row('Principal', build.core), row('Situacionais', build.situational)].filter(Boolean)
  );
}

function renderSpells(spells) {
  $('spellsSection').classList.toggle('hidden', !spells);
  if (!spells) return;
  const one = (key, s) => {
    const box = el('span', 'spell');
    const icon = img(s.icon);
    icon.title = s.name;
    box.append(el('kbd', null, key), icon, el('span', null, s.name));
    return box;
  };
  const status = { loading: 'aplicando…', sent: 'aplicados', error: spells.error }[spells.status];
  $('spellsRow').replaceChildren(one('D', spells.d), one('F', spells.f), el('span', 'muted', status));
}

// lista de campeões da seleção (counters para banir, meta da rota)
function renderChampList(section, list, title) {
  section.classList.toggle('hidden', !list);
  if (!list) return;
  section.querySelector('h2').textContent = title;
  const grid = section.querySelector('.champ-grid');
  if (list.status === 'loading') return grid.replaceChildren(el('div', 'muted', 'Consultando o Shaco…'));
  if (list.status === 'error') return grid.replaceChildren(el('div', 'muted', list.error));
  const cards = list.champions.map((c) => {
    const card = el('div', 'champ-card');
    card.title = c.name;
    card.append(img(c.icon), el('span', null, c.name));
    return card;
  });
  grid.replaceChildren(...cards);
  if (list.explain) grid.append(el('div', 'champ-why', list.explain));
}

function renderSelect(data) {
  $('clock').textContent = '';
  const draft = data.draft || {};
  renderChampList($('countersSection'), draft.counters, draft.counters ? `Banir: counters de ${draft.counters.champion}` : '');
  renderChampList($('duoSection'), draft.duo, draft.duo ? `Melhores supports com ${draft.duo.champion}` : '');
  renderChampList($('metaSection'), draft.meta, draft.meta ? `Meta · ${draft.meta.lane}` : '');
  renderAugments($('augSelect'), data.augments);

  if (!data.champion) {
    // ainda escolhendo: só a ajuda da seleção
    $('champIcon').removeAttribute('src');
    $('sub').textContent = `${data.mode.label} · seleção${data.lane ? ` · ${data.lane}` : ''}`;
    $('runesSection').classList.add('hidden');
    ['skillsSelect', 'spellsSection', 'buildSection'].forEach((id) => $(id).classList.add('hidden'));
    return;
  }
  $('runesSection').classList.remove('hidden');
  $('champIcon').src = data.icon;
  $('sub').textContent = `${data.mode.label} · seleção: ${data.champion}`;

  const status = $('runesStatus');
  const box = $('runes');
  const btn = $('applyRunes');
  const noRunes = !data.mode.runes;
  box.replaceChildren();
  btn.classList.toggle('hidden', !data.runes);
  $('selectTitle').textContent = noRunes ? `${data.mode.label}: o que priorizar` : 'Runas sugeridas';
  $('selectTip').classList.toggle('hidden', !data.tip);
  $('selectTip').textContent = data.tip || '';

  renderBuild(data.build);
  renderSpells(data.spells);
  renderSkills($('skillsSelect'), data.skills);
  if (data.runesApplied) $('applyRunes').textContent = 'Runas aplicadas no cliente ✓';

  if (!data.locked) status.textContent = 'Trave o campeão para eu montar a build e as runas.';
  else if (data.loading) status.textContent = noRunes ? `${data.mode.label} não usa runas. Pensando no que priorizar…` : 'Montando suas runas…';
  else if (data.error) status.textContent = data.error;
  else if (data.runesError) status.textContent = data.runesError;
  else status.textContent = noRunes ? `${data.mode.label} não usa runas.` : data.runes?.explain || '';

  if (data.runes) {
    const r = data.runes;
    box.append(
      el('div', 'rune-tree', `${r.primaryName}: ${r.primary.map((x) => x.name).join(', ')}`),
      runeRow(r.primary, true),
      el('div', 'rune-tree', `${r.subName}: ${r.secondary.map((x) => x.name).join(', ')}`),
      runeRow(r.secondary, false),
      el('div', 'muted', `Fragmentos: ${r.shards.map((s) => s.name).join(' · ')}`)
    );
  }
}

$('applyRunes').addEventListener('click', async () => {
  const btn = $('applyRunes');
  btn.disabled = true;
  btn.textContent = 'Aplicando…';
  const res = await window.shaco.applyRunes();
  btn.textContent = res.ok ? 'Runas aplicadas!' : 'Aplicar runas no cliente';
  btn.disabled = false;
  if (!res.ok) showSpeech(res.error);
});

// --- resumo pós-partida ---
// os números da partida e a análise do Gemini (o que foi bem e 3 pontos para melhorar)
function renderReview(box, review) {
  if (!review || review.status === 'off') return box.replaceChildren(el('div', 'muted', 'Coloque a chave do Gemini para receber a análise da partida.'));
  if (review.status === 'loading') return box.replaceChildren(el('div', 'muted', 'O Shaco está analisando a partida…'));
  if (review.status === 'error') return box.replaceChildren(el('div', 'muted', review.error));
  const parts = [];
  if (review.good) parts.push(el('div', 'sum-good', review.good));
  const list = el('ol', 'sum-points');
  review.points.forEach((p) => list.append(el('li', null, p)));
  parts.push(list);
  box.replaceChildren(...parts);
}

function renderSummary(s) {
  const win = s.result === 'win';
  $('summary').className = `body ${s.result || ''}`;
  if (s.icon) $('sumIcon').src = s.icon;
  $('sumResult').textContent = s.result ? (win ? 'Victory' : 'Defeat') : 'Partida encerrada';
  $('sumSub').textContent = `${s.mode} · ${s.champion} · ${s.duration}`;
  const stat = (label, value, note) => {
    const box = el('div', 'sum-stat');
    box.append(el('b', null, value), el('span', null, label));
    if (note) box.append(el('small', null, note));
    return box;
  };
  const stats = [stat('KDA', `${s.kills}/${s.deaths}/${s.assists}`), stat('Farm', String(s.cs), `${s.csPerMin}/min`)];
  if (s.lanes) stats.push(stat('Visão', String(s.vision), `${s.visionPerMin}/min`));
  stats.push(stat('Nível', String(s.level)));
  $('sumStats').replaceChildren(...stats);
  $('sumDeaths').textContent = s.deathTimes.length
    ? `Mortes: ${s.deathTimes.join(', ')}${s.earlyDeaths ? ` · ${s.earlyDeaths} antes dos 10:00` : ''}`
    : 'Nenhuma morte na partida.';
  renderReview($('sumReview'), s.review);
  // desafio do dia: comemora se esta partida cumpriu
  const c = s.challenge;
  $('sumChallenge').classList.toggle('hidden', !c);
  if (c) {
    $('sumChallenge').className = `sum-challenge${c.won ? ' won' : c.done ? ' done' : ''}`;
    $('sumChallenge').textContent = c.won
      ? `🎉 Desafio do dia cumprido: ${c.text}${c.streak > 1 ? ` · 🔥 ${c.streak} dias seguidos` : ''}`
      : c.done
        ? `Desafio do dia já cumprido hoje (🔥 ${c.streak})`
        : `Desafio do dia: ${c.text} — ainda não`;
  }
}

$('sumClose').addEventListener('click', () => {
  $('summary').classList.add('hidden');
  window.shaco.dismissSummary();
});

function render(data) {
  $('ingame').classList.toggle('hidden', data.status !== 'ingame');
  $('select').classList.toggle('hidden', data.status !== 'champselect');
  const summary = data.status === 'waiting' && data.summary;
  $('summary').classList.toggle('hidden', !summary);
  if (summary) renderSummary(data.summary);
  if (data.status !== 'ingame') renderHud(null);

  if (data.status === 'ingame') return renderInGame(data);
  if (data.status === 'champselect') return renderSelect(data);

  $('clock').textContent = '';
  $('champIcon').removeAttribute('src');
  $('sub').textContent = data.status === 'error' ? data.message : 'aguardando partida…';
}

// --- mouse: o painel só pega cliques com o cursor em cima dele ---
const panel = $('panel');
panel.addEventListener('mouseenter', () => window.shaco.hover(true));
panel.addEventListener('mouseleave', () => {
  if (!drag) window.shaco.hover(false);
});

// altura máxima do painel: do topo dele até a borda de baixo da tela (em px antes da escala)
function fitHeight() {
  const scale = Number(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
  const room = Math.max(160, (window.innerHeight - panel.offsetTop - 12) / scale);
  panel.style.setProperty('--max-h', `${room}px`);
}
window.addEventListener('resize', fitHeight);

function restorePosition() {
  try {
    const pos = JSON.parse(localStorage.getItem(POS_KEY));
    if (pos) {
      panel.style.left = `${pos.left}px`;
      panel.style.top = `${pos.top}px`;
      panel.style.right = 'auto';
    }
  } catch {}
}

// minimizar/maximizar: minimizado, fica só o cabeçalho (mais a fala do Shaco e as reações)
const COLLAPSE_KEY = 'shaco-panel-collapsed';
function setCollapsed(on) {
  document.body.classList.toggle('collapsed', on);
  $('btnCollapse').setAttribute('aria-label', on ? 'Maximizar painel' : 'Minimizar painel');
  $('btnCollapse').title = on ? 'Maximizar painel' : 'Minimizar painel';
  try {
    localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0');
  } catch {}
}
$('btnCollapse').addEventListener('mousedown', (e) => e.stopPropagation()); // não começa a arrastar o painel
$('btnCollapse').addEventListener('click', () => setCollapsed(!document.body.classList.contains('collapsed')));
try {
  setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
} catch {}

let drag = null;
// posição pelo layout (offsetLeft/Top), que não muda com a escala do painel
$('handle').addEventListener('mousedown', (e) => {
  drag = { dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop };
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  panel.style.left = `${e.clientX - drag.dx}px`;
  panel.style.top = `${e.clientY - drag.dy}px`;
  panel.style.right = 'auto';
  fitHeight();
});
window.addEventListener('mouseup', (e) => {
  if (!drag) return;
  drag = null;
  const rect = panel.getBoundingClientRect();
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop }));
  } catch {}
  const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
  if (!inside) window.shaco.hover(false);
});

window.shaco.onLayout(({ scale, opacity, compact }) => {
  document.documentElement.style.setProperty('--scale', scale);
  document.documentElement.style.setProperty('--alpha', opacity);
  document.body.classList.toggle('compact', !!compact);
  fitHeight();
});

window.shaco.onUpdate(render);
restorePosition();
fitHeight();
