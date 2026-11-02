// Desafio do dia: um desafio sorteado por dia (o mesmo o dia todo), conferido no fim de cada partida.
// Cumprir em dias seguidos aumenta a sequência. O estado fica em desafios.json na pasta de dados do app.
// "s" é o resumo da partida (summary.js): serve tanto no fim da partida quanto ao vivo, durante ela.
const fs = require('fs');
const path = require('path');

const FILE = 'desafios.json';
const kda = (s) => (s.kills + s.assists) / Math.max(1, s.deaths);

const CHALLENGES = [
  { id: 'farm', text: 'Faça 7 de farm por minuto', lanes: true, skipRoles: ['UTILITY'], minMinutes: 15, progress: (s) => `${s.csPerMin} de 7 por minuto`, check: (s) => s.csPerMin >= 7 },
  { id: 'early', text: 'Não morra antes dos 10 minutos', minMinutes: 12, progress: (s) => (s.earlyDeaths ? `${s.earlyDeaths} morte(s) antes dos 10:00` : 'nenhuma morte antes dos 10:00'), check: (s) => s.earlyDeaths === 0 },
  { id: 'kda', text: 'Termine a partida com KDA 3 ou mais', progress: (s) => `KDA ${kda(s).toFixed(1)} de 3`, check: (s) => kda(s) >= 3 },
  { id: 'vision', text: 'Placar de visão de 1 por minuto (2 se for suporte)', lanes: true, minMinutes: 15, progress: (s) => `${s.visionPerMin} de ${s.position === 'UTILITY' ? 2 : 1} por minuto`, check: (s) => s.visionPerMin >= (s.position === 'UTILITY' ? 2 : 1) },
  { id: 'deaths', text: 'Morra no máximo 3 vezes', minMinutes: 20, progress: (s) => `${s.deaths} de no máximo 3 mortes`, check: (s) => s.deaths <= 3 },
  { id: 'assists', text: 'Ajude em 10 abates (assistências)', progress: (s) => `${s.assists} de 10 assistências`, check: (s) => s.assists >= 10 },
  { id: 'firstblood', text: 'Pegue o First Blood', progress: (s) => (s.firstBlood ? 'First Blood é seu!' : 'ainda não'), check: (s) => s.firstBlood },
  { id: 'multikill', text: 'Faça um Double Kill (ou mais)', progress: (s) => (s.bestMulti >= 2 ? 'feito!' : 'ainda não'), check: (s) => s.bestMulti >= 2 },
  { id: 'win', text: 'Vença uma partida', progress: () => 'vença para cumprir', check: (s) => s.result === 'win' },
];
const byId = new Map(CHALLENGES.map((c) => [c.id, c]));

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function previousDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

// sorteio fixo pela data (todo mundo que abre no mesmo dia tem o mesmo desafio), pulando os excluídos
function pickFor(key, exclude = []) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const options = CHALLENGES.filter((c) => !exclude.includes(c.id));
  return options[h % options.length].id;
}

function load(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
  } catch {
    return { date: null, id: null, done: false, swapped: false, streak: 0, best: 0, lastDone: null };
  }
}
function save(dir, state) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify(state, null, 1));
  } catch {}
  return state;
}

// garante o desafio de hoje; a sequência zera se ontem não foi cumprido
function today(state, now = new Date()) {
  const key = dayKey(now);
  if (state.date !== key) Object.assign(state, { date: key, id: pickFor(key), done: false, swapped: false });
  if (state.lastDone && state.lastDone !== key && state.lastDone !== previousDay(key)) state.streak = 0;
  return state;
}

// troca o desafio de hoje (uma vez por dia, e só se ainda não cumpriu)
function swap(state) {
  if (state.swapped || state.done) return false;
  state.id = pickFor(`${state.date}#troca`, [state.id]);
  state.swapped = true;
  return true;
}

// a partida conta para este desafio? (modo com rotas, função, duração mínima)
function applies(ch, s, { live = false } = {}) {
  if (ch.lanes && !s.lanes) return false;
  if ((ch.skipRoles || []).includes(s.position)) return false;
  return live || s.minutes >= (ch.minMinutes || 0);
}

// fim da partida: true se cumpriu agora (e atualiza a sequência)
function complete(state, s) {
  const ch = byId.get(state.id);
  if (!ch || state.done || !applies(ch, s) || !ch.check(s)) return false;
  state.done = true;
  state.streak = state.lastDone === previousDay(state.date) ? state.streak + 1 : 1;
  state.best = Math.max(state.best || 0, state.streak);
  state.lastDone = state.date;
  return true;
}

// o que as telas mostram; com s, inclui o progresso da partida em andamento
function view(state, s = null) {
  const ch = byId.get(state.id);
  if (!ch) return null;
  const counts = s ? applies(ch, s, { live: true }) : true;
  return {
    text: ch.text,
    done: state.done,
    swapped: state.swapped,
    streak: state.streak,
    best: state.best || 0,
    progress: s && counts ? ch.progress(s) : null,
    note: s && !counts ? 'não vale nesta partida (modo ou função)' : null,
  };
}

module.exports = { CHALLENGES, load, save, today, swap, complete, view, dayKey, pickFor };
