// Emotes do Shaco no painel: lê os eventos da Live Client API e diz qual reação mostrar.
// Arquivos em assets/emotes/<chave>.webp.
const OBJECTIVES = new Set(['DragonKill', 'HeraldKill', 'BaronKill', 'HordeKill', 'AtakhanKill']);

// os eventos trazem o nome do jogador em formatos diferentes conforme a versão do cliente
function namesOf(p) {
  return [p.riotId, p.riotIdGameName, p.summonerName, p.riotId?.split('#')[0]].filter(Boolean);
}

// turret: "Turret_T1_..." é do time ORDER, "Turret_T2_..." do CHAOS
function turretTeam(name) {
  const m = /_T([12])_/.exec(name || '');
  return m ? (m[1] === '1' ? 'ORDER' : 'CHAOS') : null;
}

function emoteFor(ev, me, teamOf) {
  switch (ev.EventName) {
    case 'ChampionKill':
      if (me.names.has(ev.VictimName)) return 'death';
      if (me.names.has(ev.KillerName)) return 'kill';
      if ((ev.Assisters || []).some((n) => me.names.has(n))) return 'assist';
      return null;
    case 'FirstBlood':
      return me.names.has(ev.Recipient) ? 'firstblood' : null;
    case 'Multikill': {
      if (!me.names.has(ev.KillerName)) return null;
      const streak = Number(ev.KillStreak);
      return streak >= 5 ? 'penta' : { 2: 'double', 3: 'triple', 4: 'quadra' }[streak] || null;
    }
    case 'TurretKilled': {
      const owner = turretTeam(ev.TurretKilled);
      return owner && owner !== me.team ? 'tower' : null;
    }
    case 'GameEnd':
      return ev.Result === 'Win' ? 'win' : 'lose';
    default:
      if (OBJECTIVES.has(ev.EventName) && String(ev.Stolen) === 'True' && teamOf(ev.KillerName) === me.team) return 'steal';
      return null;
  }
}

// Guarda o último evento visto; na primeira leitura só marca o histórico (abrir o app no meio da partida não dispara nada).
const GRUBS_GAP_S = 60; // vastilarvas morrem em grupo: uma reação por minuto de jogo

function createEmoteTracker() {
  let lastId = null;
  let lastGrubs = -Infinity;
  return function next(raw) {
    const events = raw.events?.Events || [];
    const fresh = lastId == null ? [] : events.filter((e) => e.EventID > lastId);
    const lastSeenBefore = lastId ?? -1;
    lastId = events.reduce((max, e) => Math.max(max, e.EventID), lastId ?? -1);
    if (!fresh.length) return [];

    const team = new Map();
    for (const p of raw.allPlayers || []) for (const n of namesOf(p)) team.set(n, p.team);
    const active = raw.activePlayer || {};
    const mine = (raw.allPlayers || []).find((p) => namesOf(p).some((n) => namesOf(active).includes(n)));
    if (!mine) return [];
    const me = { names: new Set(namesOf(mine)), team: mine.team };
    const teamOf = (n) => team.get(n);
    const keys = fresh.map((ev) => emoteFor(ev, me, teamOf)).filter(Boolean);
    // Barão do seu time (se foi roubado, já aparece o "Steal!")
    if (fresh.some((e) => e.EventName === 'BaronKill' && String(e.Stolen) !== 'True' && teamOf(e.KillerName) === me.team)) keys.push('baron');
    // Vastilarvas do seu time (roubadas já aparecem como "Steal!"); no máximo uma vez por minuto de jogo
    const grubs = fresh.find((e) => e.EventName === 'HordeKill' && String(e.Stolen) !== 'True' && teamOf(e.KillerName) === me.team);
    if (grubs && (grubs.EventTime ?? 0) - lastGrubs >= GRUBS_GAP_S) {
      keys.push('grubs');
      lastGrubs = grubs.EventTime ?? 0;
    }
    // Alma do Dragão: o 4º dragão elemental do seu time (o Ancião não conta)
    const isOurDragon = (e) => e.EventName === 'DragonKill' && e.DragonType !== 'Elder' && teamOf(e.KillerName) === me.team;
    const before = events.filter((e) => e.EventID <= lastSeenBefore && isOurDragon(e)).length;
    if (before < 4 && before + fresh.filter(isOurDragon).length >= 4) keys.push('soul');
    // qualquer outro dragão do seu time (roubado já aparece como "Steal!"); o Ancião tem legenda própria
    else {
      const drag = fresh.find((e) => e.EventName === 'DragonKill' && String(e.Stolen) !== 'True' && teamOf(e.KillerName) === me.team);
      if (drag) keys.push(drag.DragonType === 'Elder' ? 'elder' : 'dragon');
    }
    // primeiro abate e multiabates já contam o abate que veio junto; de vários multiabates na mesma leitura, só o maior
    const MULTI = ['double', 'triple', 'quadra', 'penta'];
    const top = MULTI.filter((k) => keys.includes(k)).pop();
    const out = top || keys.includes('firstblood') ? keys.filter((k) => k !== 'kill' && (!MULTI.includes(k) || k === top)) : keys;
    return out;
  };
}

// Reações à leitura do jogo. Só descrevem o que aconteceu (como no placar), nunca mandam fazer algo:
// - outnumbered: o time ficou com 2 ou mais vivos a menos
// - opening: o inimigo de uma rota morreu por um bom tempo e o aliado dessa rota está vivo e não está atrás
const LANE_EN = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };

function createReadTracker({ outnumberedGapMs = 45000, openingGapMs = 30000, minRespawn = 15 } = {}) {
  let first = true;
  let wasOutnumbered = false;
  let lastOutnumbered = -Infinity;
  let lastOpening = -Infinity;
  let seenDead = new Set();
  let wasSixSeven = false;
  let sixSevenShown = false;
  return function next(a, now = Date.now()) {
    const out = [];
    // o meme do 6/7: placar com 6 abates e 7 mortes, uma vez por partida
    const sixSeven = a.me?.kills === 6 && a.me?.deaths === 7;
    if (!first && sixSeven && !wasSixSeven && !sixSevenShown) {
      out.push({ key: 'sixseven', text: '6/7!' });
      sixSevenShown = true;
    }
    wasSixSeven = sixSeven;
    const r = a.read;
    if (!r) {
      first = false;
      return out;
    }
    const outnumbered = r.alliesAlive - r.enemiesAlive <= -2;
    if (!first && outnumbered && !wasOutnumbered && now - lastOutnumbered >= outnumberedGapMs) {
      out.push({ key: 'outnumbered', text: `${r.alliesAlive}v${r.enemiesAlive}!` });
      lastOutnumbered = now;
    }
    wasOutnumbered = outnumbered;

    const fresh = (a.lanes || []).filter(
      (l) => !l.mine && l.enemy.dead && !seenDead.has(l.enemy.name) && l.enemy.respawn >= minRespawn && !l.ally.dead && l.state !== 'behind'
    );
    if (!first && fresh.length && now - lastOpening >= openingGapMs) {
      const l = fresh.sort((x, y) => y.enemy.respawn - x.enemy.respawn)[0];
      out.push({ key: 'opening', text: `${LANE_EN[l.pos] || l.label} down · ${l.enemy.respawn}s` });
      lastOpening = now;
    }
    seenDead = new Set(r.deadEnemies.map((d) => d.name));
    first = false;
    return out;
  };
}

// Fim da fase de rotas, uma vez por partida: aos 14:00 (as placas das torres somem) ou antes,
// se a torre externa da sua rota cair (de qualquer time). A reação é a da sua função; a dica
// de rotação que acompanha é geral (como os times costumam jogar), não uma ordem.
const OUTER_TURRET = { TOP: '_L_03_', MIDDLE: '_C_05_', BOTTOM: '_R_03_', UTILITY: '_R_03_' };
const ROTATE_EMOTE = { TOP: 'rotate-top', MIDDLE: 'rotate-mid', BOTTOM: 'rotate-bot', UTILITY: 'rotate-bot' };
const LANE_PHASE_END = 14 * 60;

function createPhaseTracker() {
  let done = false;
  let first = true;
  return function next(raw, a) {
    if (done || !a.mode.lanes) return [];
    const pos = a.me.position;
    const key = ROTATE_EMOTE[pos];
    // app aberto já depois da fase de rotas: não aparece atrasado
    if (first && a.gameTime > LANE_PHASE_END + 60) done = true;
    first = false;
    if (done || !key) return [];
    const turret = (raw.events?.Events || []).some((e) => e.EventName === 'TurretKilled' && String(e.TurretKilled).includes(OUTER_TURRET[pos]));
    if (a.gameTime < LANE_PHASE_END && !turret) return [];
    done = true;
    return [{ key, text: 'Lane phase over' }];
  };
}

// Lembrete de Sentinela de Controle: a API não diz quando você está na loja, então o sinal é
// uma compra (inventário mudou e o ouro caiu). Comprou sem ter Sentinela de Controle: lembra.
const CONTROL_WARD = 2055;
const WARD_GAP_S = 5 * 60;

function createWardTracker() {
  let prev = null;
  let lastReminder = -Infinity;
  return function next(raw, a) {
    if (!a.mode.lanes) return [];
    const me = (raw.allPlayers || []).find((p) => namesOf(p).some((n) => namesOf(raw.activePlayer || {}).includes(n)));
    if (!me) return [];
    const ids = [...new Set((me.items || []).map((i) => i.itemID))].sort().join(',');
    const now = a.gameTime;
    const bought = prev && ids !== prev.ids && prev.gold - a.me.gold >= 300;
    prev = { ids, gold: a.me.gold };
    if (!bought || now < 300 || now - lastReminder < WARD_GAP_S) return [];
    if ((me.items || []).some((i) => i.itemID === CONTROL_WARD)) return [];
    lastReminder = now;
    return [{ key: 'ward', text: 'Control Ward!' }];
  };
}

module.exports = { createEmoteTracker, createReadTracker, createPhaseTracker, createWardTracker };
