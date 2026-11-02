// Resumo pós-partida: números da partida (da última leitura da Live Client API) e histórico em disco.
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = 'partidas.json';
const HISTORY_MAX = 20;

function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function namesOf(p) {
  return [p.riotId, p.riotIdGameName, p.summonerName, p.riotId?.split('#')[0]].filter(Boolean);
}

// raw: última resposta da Live Client API; a: a análise dela (advisor.analyze)
function buildSummary(raw, a) {
  const active = namesOf(raw.activePlayer || {});
  const me = (raw.allPlayers || []).find((p) => namesOf(p).some((n) => active.includes(n)));
  const names = new Set(me ? namesOf(me) : active);
  const events = raw.events?.Events || [];
  const end = events.find((e) => e.EventName === 'GameEnd');
  const deathTimes = events.filter((e) => e.EventName === 'ChampionKill' && names.has(e.VictimName)).map((e) => e.EventTime);
  const firstBlood = events.some((e) => e.EventName === 'FirstBlood' && names.has(e.Recipient));
  const bestMulti = Math.max(0, ...events.filter((e) => e.EventName === 'Multikill' && names.has(e.KillerName)).map((e) => Number(e.KillStreak) || 0));
  const minutes = a.gameTime / 60;
  const sc = me?.scores || {};
  const cs = sc.creepScore || 0;
  const vision = Math.round(sc.wardScore || 0);
  return {
    id: Date.now(),
    date: new Date().toISOString(),
    mode: a.mode.label,
    lanes: !!a.mode.lanes,
    champion: a.me.champion,
    icon: a.me.icon,
    position: a.me.position || '',
    result: end ? (end.Result === 'Win' ? 'win' : 'lose') : null,
    duration: clock(a.gameTime),
    minutes: Math.round(minutes * 10) / 10,
    firstBlood,
    bestMulti,
    kills: sc.kills || 0,
    deaths: sc.deaths || 0,
    assists: sc.assists || 0,
    cs,
    csPerMin: minutes ? Math.round((cs / minutes) * 10) / 10 : 0,
    vision,
    visionPerMin: minutes ? Math.round((vision / minutes) * 10) / 10 : 0,
    earlyDeaths: deathTimes.filter((t) => t < 600).length,
    deathTimes: deathTimes.map(clock),
    level: a.me.level,
    items: a.me.items,
    review: null,
  };
}

// texto para o Gemini avaliar a partida
function describeSummary(s) {
  return [
    `Modo: ${s.mode}. Campeão: ${s.champion}${s.position ? ` (${s.position})` : ''}. Resultado: ${s.result === 'win' ? 'vitória' : s.result === 'lose' ? 'derrota' : 'desconhecido'}. Duração: ${s.duration}.`,
    `KDA: ${s.kills}/${s.deaths}/${s.assists}. Nível final: ${s.level}.`,
    s.lanes ? `Farm: ${s.cs} CS (${s.csPerMin}/min). Placar de visão: ${s.vision} (${s.visionPerMin}/min).` : `Farm: ${s.cs} CS.`,
    `Mortes: ${s.deathTimes.join(', ') || 'nenhuma'}${s.earlyDeaths ? ` (${s.earlyDeaths} antes dos 10 minutos)` : ''}.`,
    `Itens finais: ${s.items.join(', ') || 'nenhum'}.`,
  ].join('\n');
}

function loadHistory(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, HISTORY_FILE), 'utf8'));
  } catch {
    return [];
  }
}

function saveHistory(dir, list) {
  const kept = list.slice(0, HISTORY_MAX);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, HISTORY_FILE), JSON.stringify(kept));
  } catch {}
  return kept;
}

module.exports = { buildSummary, describeSummary, loadHistory, saveHistory };
