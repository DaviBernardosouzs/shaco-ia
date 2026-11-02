// Tempo até os objetivos do Summoner's Rift, a partir dos eventos da partida.
// O próprio jogo mostra esses tempos no placar, então é informação permitida.
// Regras de nascimento (em segundos de jogo): ajuste aqui se a Riot mudar num patch.
const RULES = {
  dragonFirst: 5 * 60,
  dragonRespawn: 5 * 60,
  elderAfter: 6 * 60, // depois da Alma e depois de cada Ancião
  grubsFirst: 8 * 60,
  grubsGone: 14 * 60 + 45,
  heraldFirst: 15 * 60,
  heraldGone: 19 * 60 + 45,
  baronFirst: 20 * 60,
  baronRespawn: 6 * 60,
};

function clock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// [{ id, label, state: 'vivo' | 'nasce' | 'fim', at, text }]
function objectiveTimers(raw) {
  const now = raw.gameData?.gameTime || 0;
  const events = raw.events?.Events || [];
  const last = (name, filter = () => true) => events.filter((e) => e.EventName === name && filter(e)).pop();
  const out = [];
  const timer = (id, label, at) => {
    const state = now >= at ? 'vivo' : 'nasce';
    out.push({ id, label, state, at, text: state === 'vivo' ? 'vivo' : `em ${clock(at - now)}` });
  };

  // Dragão (ou Ancião, depois que algum time pegou a Alma: 4 dragões elementais do mesmo time)
  const dragons = events.filter((e) => e.EventName === 'DragonKill');
  const byKiller = {};
  let soulAt = null;
  for (const d of dragons.filter((e) => e.DragonType !== 'Elder')) {
    // time de quem matou, pelo nome no placar
    const team = raw.allPlayers?.find((p) => [p.riotId, p.riotIdGameName, p.summonerName, p.riotId?.split('#')[0]].includes(d.KillerName))?.team || '?';
    byKiller[team] = (byKiller[team] || 0) + 1;
    if (byKiller[team] === 4 && soulAt == null) soulAt = d.EventTime;
  }
  if (soulAt != null) {
    const elder = last('DragonKill', (e) => e.DragonType === 'Elder');
    timer('elder', 'Dragão Ancião', (elder ? elder.EventTime : soulAt) + RULES.elderAfter);
  } else {
    const d = dragons[dragons.length - 1];
    timer('dragon', 'Dragão', d ? d.EventTime + RULES.dragonRespawn : RULES.dragonFirst);
  }

  // Vastilarvas e Arauto só no começo da partida
  if (now < RULES.grubsGone && events.filter((e) => e.EventName === 'HordeKill').length < 6) timer('grubs', 'Vastilarvas', RULES.grubsFirst);
  if (now < RULES.heraldGone && !last('HeraldKill')) timer('herald', 'Arauto', RULES.heraldFirst);

  // Barão a partir dos 14 minutos (antes disso é cedo demais para importar)
  if (now >= 14 * 60) {
    const b = last('BaronKill');
    timer('baron', 'Barão', b ? b.EventTime + RULES.baronRespawn : RULES.baronFirst);
  }
  return out;
}

module.exports = { objectiveTimers, RULES };
