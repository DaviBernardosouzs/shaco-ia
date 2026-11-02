// Análise da partida: só usa informação que o jogador já vê no placar (Tab).
const { modeFor, modeTips } = require('./modes');
const { graphContext } = require('./graph');

const HEALERS = new Set([
  'Aatrox', 'Briar', 'DrMundo', 'Fiora', 'Gwen', 'Illaoi', 'Kayn', 'Maokai', 'Nami', 'Olaf',
  'Seraphine', 'Sona', 'Soraka', 'Swain', 'Sylas', 'Vladimir', 'Volibear', 'Warwick', 'Yuumi', 'Zac',
]);

// Itens situacionais por necessidade e por tipo de build. IDs que não existirem
// no patch atual são ignorados automaticamente.
const SITUATIONAL = {
  antiheal: { adc: [3033], ad: [6609, 3123], ap: [3165, 3916], tank: [3075, 3076] },
  vsAD: { adc: [3026], ad: [6333, 3026], ap: [3157], tank: [3143, 3110, 3075] },
  vsAP: { adc: [3139], ad: [3156], ap: [3102], tank: [4401, 3065, 2504] },
  vsTank: { adc: [3036, 3153], ad: [3071, 6694], ap: [3135, 6653], tank: [] },
};
const BOOTS = { vsAD: 3047, vsAP: 3111 };

const POSITIONS = [
  ['TOP', 'Topo'],
  ['JUNGLE', 'Selva'],
  ['MIDDLE', 'Meio'],
  ['BOTTOM', 'Atirador'],
  ['UTILITY', 'Suporte'],
];

function champFor(player, champions) {
  const id = (player.rawChampionName || '').replace('game_character_displayname_', '');
  if (champions[id]) return champions[id];
  return Object.values(champions).find((c) => c.name === player.championName) || null;
}

function archetype(champ) {
  if (!champ) return 'ad';
  if (champ.tags[0] === 'Tank') return 'tank';
  if (champ.tags[0] === 'Marksman') return 'adc';
  return champ.info.magic > champ.info.attack ? 'ap' : 'ad';
}

function damageType(champ) {
  if (!champ) return 'AD';
  return champ.info.magic > champ.info.attack ? 'AP' : 'AD';
}

function isTank(champ) {
  return !!champ && (champ.tags[0] === 'Tank' || (champ.tags.includes('Tank') && champ.info.defense >= 7));
}

function isMe(player, active) {
  if (active.riotId && player.riotId) return player.riotId === active.riotId;
  return player.summonerName === active.summonerName;
}

function itemGold(player, items) {
  return player.items.reduce((sum, it) => sum + (items[it.itemID]?.gold?.total ?? 0) * (it.count || 1), 0);
}

function isBuyable(item, map) {
  return !!item && item.gold?.purchasable && item.maps?.[String(map)] !== false && !item.requiredChampion;
}

// Alguns modos (como o Arena) usam versões próprias dos itens, com outro ID e o mesmo nome.
function resolveItem(id, map, sd) {
  const base = sd.items[id];
  if (!base) return null;
  if (isBuyable(base, map)) return id;
  const variant = Object.entries(sd.items).find(([, it]) => it.name === base.name && isBuyable(it, map));
  return variant ? Number(variant[0]) : null;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function analyzeThreats(enemies, champions) {
  let ad = 0;
  let ap = 0;
  let tanks = 0;
  const healers = [];
  let fed = null;

  for (const e of enemies) {
    const champ = champFor(e, champions);
    const lead = e.scores.kills - e.scores.deaths;
    const weight = 1 + Math.max(0, lead) * 0.25; // inimigo forte pesa mais
    if (damageType(champ) === 'AP') ap += weight;
    else ad += weight;
    if (isTank(champ)) tanks++;
    if (champ && HEALERS.has(champ.id)) healers.push(e.championName);
    if (lead >= 3 && (!fed || lead > fed.lead)) fed = { name: e.championName, lead, kills: e.scores.kills, deaths: e.scores.deaths };
  }

  const total = ad + ap || 1;
  return { adPct: ad / total, apPct: ap / total, tanks, healers, fed };
}

function rankNeeds(t) {
  const needs = [
    ['antiheal', t.healers.length >= 2 ? 3 : t.healers.length === 1 ? 1.5 : 0],
    ['vsAD', t.adPct >= 0.6 ? (t.adPct - 0.5) * 10 : 0],
    ['vsAP', t.apPct >= 0.6 ? (t.apPct - 0.5) * 10 : 0],
    ['vsTank', t.tanks >= 2 ? t.tanks : 0],
  ];
  return needs.filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1]).map(([need]) => need);
}

function reasonFor(need, t, mode) {
  const where = mode.key === 'CHERRY' ? 'no lobby' : 'no time inimigo';
  const dmg = mode.key === 'CHERRY' ? 'do dano no lobby' : 'do dano inimigo';
  switch (need) {
    case 'antiheal': return `Cura forte: ${t.healers.join(', ')}`;
    case 'vsAD': return `${Math.round(t.adPct * 100)}% ${dmg} é físico`;
    case 'vsAP': return `${Math.round(t.apPct * 100)}% ${dmg} é mágico`;
    case 'vsTank': return `${t.tanks} tanques ${where}`;
    default: return '';
  }
}

// itens completos (fora botas) que o jogador já tem
function completedItems(me, sd) {
  return me.items.filter((i) => {
    const it = sd.items[i.itemID];
    return it && !it.into && it.gold.total >= 2000 && !(it.tags || []).includes('Boots');
  }).length;
}

// Com a build da Riot do campeão (nó do grafo): segue a build principal em ordem e só adapta
// com itens que o próprio campeão usa. Um assassino nunca recebe item de lutador só porque
// o inimigo tem muito dano físico.
function recommendFromBuild(node, me, threats, sd, mode, toRec) {
  const ownedNames = new Set(me.items.map((i) => sd.items[i.itemID]?.name));
  const have = (it) => ownedNames.has(it.name);
  const needs = rankNeeds(threats);
  const fits = (it, need) => it.counters.includes(need);
  const hasBoots = me.items.some((i) => i.itemID !== 1001 && sd.items[i.itemID]?.tags?.includes('Boots'));

  const core = [];
  const counted = new Set(); // cada item que a pessoa tem fecha uma etapa só ("Youmuu ou Véu" aparece duas vezes)
  const picked = new Set();
  for (const stage of node.core) {
    const owned = stage.find((it) => have(it) && !counted.has(it.name));
    if (owned) {
      counted.add(owned.name);
      continue;
    }
    const boots = stage.every((it) => sd.items[it.id]?.tags?.includes('Boots'));
    if (boots && hasBoots) continue;
    const open = stage.filter((it) => !have(it) && !picked.has(it.name));
    if (!open.length) continue;
    // dentro da etapa, a opção que também resolve a maior necessidade do momento
    const need = needs.find((n) => open.some((it) => fits(it, n)));
    const best = (need && open.find((it) => fits(it, need))) || open[0];
    picked.add(best.name);
    const adapted = need && fits(best, need) ? need : null;
    core.push({ rec: toRec(best.id, adapted ? `Build de ${node.name} · ${reasonFor(adapted, threats, mode)}` : `Build principal de ${node.name}`), need: adapted });
    if (core.length === 3) break;
  }

  // antes de 2 itens prontos: só a build principal (é o que a Riot recomenda nessa hora)
  if (completedItems(me, sd) < 2) return core.map((c) => c.rec);

  // necessidades que a build ainda não cobre: situacionais do próprio campeão
  const covered = new Set(core.map((c) => c.need).filter(Boolean));
  const situational = [];
  const pool = [...node.situational, ...node.core.flat()];
  for (const need of needs.filter((n) => !covered.has(n))) {
    const it = pool.find((x) => fits(x, need) && !have(x) && !sd.items[x.id]?.tags?.includes('Boots') && !picked.has(x.name) && !situational.some((r) => r.id === x.id));
    if (it) situational.push(toRec(it.id, reasonFor(need, threats, mode)));
  }

  // com 2+ itens prontos: primeiro o que adapta à partida (etapas adaptadas e situacionais), depois o resto da build
  const adaptedCore = core.filter((c) => c.need).map((c) => c.rec);
  const plainCore = core.filter((c) => !c.need).map((c) => c.rec);
  return [...adaptedCore, ...situational, ...plainCore].slice(0, 3);
}

function recommendItems(me, arch, threats, sd, mode, node) {
  if (!mode.items) return [];
  const owned = new Set(me.items.map((i) => i.itemID));
  const ownedNames = new Set(me.items.map((i) => sd.items[i.itemID]?.name));
  const toRec = (id, reason) => {
    const item = sd.items[id];
    return { id, name: item.name, price: item.gold.total, reason, icon: `${sd.imgBase}/item/${id}.png` };
  };
  if (node?.core.length) return recommendFromBuild(node, me, threats, sd, mode, toRec);
  // sem build da Riot para o modo (Arena, campeão novo, sem internet): regra geral por tipo de build
  const pick = (candidates) =>
    candidates
      .map((cand) => resolveItem(cand, mode.map, sd))
      .find((id) => id && !owned.has(id) && !ownedNames.has(sd.items[id].name));

  const recs = [];
  const needs = rankNeeds(threats);
  for (const need of needs) {
    const id = pick(SITUATIONAL[need][arch]);
    if (id) recs.push(toRec(id, reasonFor(need, threats, mode)));
  }

  const hasBoots = me.items.some((i) => i.itemID !== 1001 && sd.items[i.itemID]?.tags?.includes('Boots'));
  const bootsNeed = needs.find((n) => BOOTS[n]);
  const bootsId = bootsNeed && pick([BOOTS[bootsNeed]]);
  if (!hasBoots && bootsId) recs.push(toRec(bootsId, `Botas: ${reasonFor(bootsNeed, threats, mode)}`));

  return recs.slice(0, 3);
}

function buyNow(rec, gold, me, sd) {
  if (!rec) return null;
  if (gold >= rec.price) return { text: `Dá pra comprar ${rec.name} agora!`, ready: true };

  const owned = new Set(me.items.map((i) => i.itemID));
  const parts = (sd.items[rec.id].from || [])
    .map((id) => ({ id: Number(id), item: sd.items[id] }))
    .filter(({ id, item }) => item && !owned.has(id) && item.gold.total <= gold)
    .sort((a, b) => b.item.gold.total - a.item.gold.total);

  const missing = rec.price - gold;
  if (parts.length) {
    const p = parts[0];
    return {
      text: `Faltam ${missing} de ouro. Dá pra adiantar: ${p.item.name} (${p.item.gold.total})`,
      ready: false,
      partIcon: `${sd.imgBase}/item/${p.id}.png`,
    };
  }
  return { text: `Faltam ${missing} de ouro para ${rec.name}.`, ready: false };
}

function compareLanes(allies, enemies, me, sd) {
  const lanes = [];
  const iconOf = (p) => {
    const c = champFor(p, sd.champions);
    return c ? `${sd.imgBase}/champion/${c.image.full}` : null;
  };
  for (const [pos, label] of POSITIONS) {
    const ally = allies.find((p) => p.position === pos);
    const enemy = enemies.find((p) => p.position === pos);
    if (!ally || !enemy) continue;

    const goldDiff = itemGold(ally, sd.items) - itemGold(enemy, sd.items);
    const levelDiff = ally.level - enemy.level;
    const score = goldDiff + levelDiff * 300;
    lanes.push({
      pos,
      label,
      mine: ally === me,
      ally: { name: ally.championName, icon: iconOf(ally), level: ally.level, kda: `${ally.scores.kills}/${ally.scores.deaths}/${ally.scores.assists}`, dead: ally.isDead },
      enemy: {
        name: enemy.championName,
        icon: iconOf(enemy),
        level: enemy.level,
        kda: `${enemy.scores.kills}/${enemy.scores.deaths}/${enemy.scores.assists}`,
        dead: enemy.isDead,
        respawn: enemy.isDead ? Math.ceil(enemy.respawnTimer) : 0,
      },
      goldDiff,
      levelDiff,
      state: score > 500 ? 'ahead' : score < -500 ? 'behind' : 'even',
    });
  }
  return lanes;
}

// Leitura do jogo: só o que o placar (Tab) já mostra — quem está vivo e quem está morto por quanto tempo.
// É informação, não ordem: as regras da Riot não deixam o app decidir jogadas pelo jogador.
function gameRead(allies, enemies, sd) {
  const alive = (list) => list.filter((p) => !p.isDead).length;
  const POS = Object.fromEntries(POSITIONS);
  return {
    alliesAlive: alive(allies),
    enemiesAlive: alive(enemies),
    total: Math.max(allies.length, enemies.length),
    deadEnemies: enemies
      .filter((p) => p.isDead)
      .map((p) => {
        const c = champFor(p, sd.champions);
        return { name: p.championName, lane: POS[p.position] || '', respawn: Math.ceil(p.respawnTimer || 0), icon: c ? `${sd.imgBase}/champion/${c.image.full}` : null };
      })
      .sort((a, b) => b.respawn - a.respawn),
  };
}

// Farm: CS por minuto contra uma meta da função e contra o inimigo direto (os dois aparecem no Tab).
// Suporte não tem meta (não deve farmar); antes dos 3:00 o CS/min ainda não diz nada.
const FARM_TARGET = { TOP: 7, MIDDLE: 7.5, BOTTOM: 8, JUNGLE: 5.5 };

function farmStats(me, enemies, gameTime, sd) {
  const cs = me.scores?.creepScore || 0;
  const perMin = gameTime >= 180 ? Math.round((cs / (gameTime / 60)) * 10) / 10 : null;
  const target = FARM_TARGET[me.position] ?? null;
  let state = null;
  if (perMin != null && target) state = perMin >= target ? 'good' : perMin >= target * 0.8 ? 'ok' : 'low';
  const rival = me.position ? enemies.find((p) => p.position === me.position) : null;
  let vs = null;
  if (rival) {
    const c = champFor(rival, sd.champions);
    vs = { name: rival.championName, icon: c ? `${sd.imgBase}/champion/${c.image.full}` : null, diff: cs - (rival.scores?.creepScore || 0) };
  }
  return { cs, perMin, target, state, vs, vision: visionStats(me, rival, gameTime) };
}

// Placar de visão (wardScore, o mesmo número do Tab) por minuto, com meta da função.
// Antes dos 5:00 o valor por minuto ainda não diz nada (as sentinelas mal começaram).
const VISION_TARGET = { UTILITY: 2.2, JUNGLE: 1.3, TOP: 0.8, MIDDLE: 0.8, BOTTOM: 0.7 };

function visionStats(me, rival, gameTime) {
  const score = Math.round(me.scores?.wardScore || 0);
  const perMin = gameTime >= 300 ? Math.round((score / (gameTime / 60)) * 10) / 10 : null;
  const target = VISION_TARGET[me.position] ?? null;
  let state = null;
  if (perMin != null && target) state = perMin >= target ? 'good' : perMin >= target * 0.75 ? 'ok' : 'low';
  const diff = rival ? score - Math.round(rival.scores?.wardScore || 0) : null;
  return { score, perMin, target, state, diff };
}

function buildTips(gameTime, me, threats, lanes, mode) {
  const tips = [];
  if (threats.fed) {
    tips.push(`Cuidado: ${threats.fed.name} está ${threats.fed.kills}/${threats.fed.deaths}. Evite lutas 1x1.`);
  }
  if (mode.lanes && me.position === 'JUNGLE') {
    const ahead = lanes.filter((l) => !l.mine && l.state === 'ahead').map((l) => l.label);
    const behind = lanes.filter((l) => !l.mine && l.state === 'behind').map((l) => l.label);
    if (ahead.length) tips.push(`Rotas com aliado em vantagem: ${ahead.join(', ')}.`);
    if (behind.length) tips.push(`Rotas com aliado atrás: ${behind.join(', ')}.`);
  }
  return [...tips, ...modeTips(mode, gameTime / 60, me)];
}

// Placar por time, para modos sem rotas definidas (como o ARAM).
function teamScore(allies, enemies, sd) {
  const sum = (list, fn) => list.reduce((s, p) => s + fn(p), 0);
  return {
    allyGold: sum(allies, (p) => itemGold(p, sd.items)),
    enemyGold: sum(enemies, (p) => itemGold(p, sd.items)),
    allyKills: sum(allies, (p) => p.scores.kills),
    enemyKills: sum(enemies, (p) => p.scores.kills),
  };
}

// opts.node: nó do grafo do campeão (build da Riot); sem ele, as recomendações usam a regra geral
function analyze(raw, sd, opts = {}) {
  const active = raw.activePlayer;
  const players = raw.allPlayers || [];
  const me = active && players.find((p) => isMe(p, active));
  if (!me) throw new Error('Jogador ativo não encontrado (modo espectador?)');

  const mode = modeFor(raw.gameData?.gameMode, raw.gameData?.mapNumber);
  // No Arena o placar não separa as duplas de um jeito confiável: todo mundo conta como adversário.
  const teamed = mode.key !== 'CHERRY';
  const allies = teamed ? players.filter((p) => p.team === me.team) : [me];
  const enemies = teamed ? players.filter((p) => p.team !== me.team) : players.filter((p) => p !== me);
  const myChamp = champFor(me, sd.champions);
  const arch = archetype(myChamp);
  const gold = Math.floor(active.currentGold || 0);
  const gameTime = raw.gameData?.gameTime || 0;

  const threats = analyzeThreats(enemies, sd.champions);
  const recs = recommendItems(me, arch, threats, sd, mode, opts.node);
  const lanes = mode.lanes ? compareLanes(allies, enemies, me, sd) : [];

  const itemNames = (p) => p.items.map((i) => sd.items[i.itemID]?.name).filter(Boolean);
  const kda = (p) => `${p.scores.kills}/${p.scores.deaths}/${p.scores.assists}`;

  return {
    mode: { key: mode.key, label: mode.label, lanes: mode.lanes, runes: mode.runes, items: mode.items, rules: mode.rules },
    graph: opts.node ? graphContext(opts.node) : null,
    gameTime,
    clock: formatTime(gameTime),
    me: {
      champion: me.championName,
      level: me.level,
      gold,
      archetype: arch,
      position: me.position,
      dead: me.isDead,
      kills: me.scores?.kills || 0,
      deaths: me.scores?.deaths || 0,
      assists: me.scores?.assists || 0,
      items: itemNames(me),
      icon: myChamp ? `${sd.imgBase}/champion/${myChamp.image.full}` : null,
    },
    allies: allies.filter((p) => p !== me).map((p) => ({ name: p.championName, position: p.position, level: p.level, kda: kda(p), items: itemNames(p) })),
    enemies: enemies.map((p) => ({ name: p.championName, position: p.position, level: p.level, kda: kda(p), items: itemNames(p) })),
    threats,
    recs,
    buyNow: buyNow(recs[0], gold, me, sd),
    lanes,
    team: teamed && !mode.lanes ? teamScore(allies, enemies, sd) : null,
    read: teamed ? gameRead(allies, enemies, sd) : null,
    // só em modos com rotas e tropas (no Arena não existe farm)
    farm: mode.lanes ? farmStats(me, enemies, gameTime, sd) : null,
    tips: buildTips(gameTime, me, threats, lanes, mode),
  };
}

// Resumo em texto da análise, para mandar ao Gemini.
function describeForCoach(a) {
  const player = (p) => `${p.name} (${p.position || '?'}, nv ${p.level}, ${p.kda}) itens: ${p.items.join(', ') || 'nenhum'}`;
  const arena = a.mode.key === 'CHERRY';
  return [
    `Modo de jogo: ${a.mode.label}. ${a.mode.rules}`,
    `Tempo: ${a.clock}`,
    `Eu: ${a.me.champion} (${a.mode.lanes ? `${a.me.position || '?'}, ` : ''}nv ${a.me.level}, ${a.me.gold} de ouro${a.me.dead ? ', morto' : ''}) itens: ${a.me.items.join(', ') || 'nenhum'}`,
    arena ? '' : `Aliados: ${a.allies.map(player).join(' | ')}`,
    `${arena ? 'Outros jogadores do lobby' : 'Inimigos'}: ${a.enemies.map(player).join(' | ')}`,
    `Dano ${arena ? 'no lobby' : 'inimigo'}: ${Math.round(a.threats.adPct * 100)}% físico, ${Math.round(a.threats.apPct * 100)}% mágico`,
    `Sugestões de item do app: ${a.recs.map((r) => `${r.name} (${r.reason})`).join('; ') || 'nenhuma'}`,
    a.graph ? `\nConhecimento do campeão (use só isto para falar de itens):\n${a.graph}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = { analyze, describeForCoach, archetype, damageType, rankNeeds, resolveItem, champFor };
