// Feitiços de invocador: Flash + um segundo feitiço pela posição e pelo modo.
// Só usa feitiços que existem no modo atual, segundo o Data Dragon.

// Segundo feitiço, em ordem de preferência (pelo id do Data Dragon)
const SECOND = {
  JUNGLE: ['SummonerSmite'],
  TOP: ['SummonerTeleport', 'SummonerDot'],
  MIDDLE: ['SummonerDot', 'SummonerTeleport'],
  BOTTOM: ['SummonerHeal', 'SummonerBarrier'],
  UTILITY_ENCHANTER: ['SummonerExhaust', 'SummonerHeal'],
  UTILITY: ['SummonerDot', 'SummonerExhaust'],
  ARAM: ['SummonerSnowball', 'SummonerHeal'],
  CHERRY: ['SummonerCherryHold'],
  DEFAULT: ['SummonerDot', 'SummonerHeal', 'SummonerHaste'],
};

// Suportes de cura e escudo preferem Exaustão
function isEnchanter(champ) {
  return !!champ && champ.tags[0] === 'Support' && champ.info.magic >= champ.info.attack;
}

function pickSpells({ mode, position, champ, flashKey = 'D' }, summoners) {
  const spells = Object.values(summoners);
  const inMode = (s) => s.modes.includes(mode.key);
  const flash = spells.find((s) => inMode(s) && s.name.toLowerCase() === 'flash');
  if (!flash) return null; // modo sem Flash: não mexe nos feitiços

  const pos = String(position || '').toUpperCase();
  let list;
  if (mode.key === 'ARAM' || mode.key === 'CHERRY') list = SECOND[mode.key];
  else if (pos === 'UTILITY') list = isEnchanter(champ) ? SECOND.UTILITY_ENCHANTER : SECOND.UTILITY;
  else list = SECOND[pos] || SECOND.DEFAULT;

  const second =
    list.map((id) => spells.find((s) => s.id === id && inMode(s))).find(Boolean) ||
    SECOND.DEFAULT.map((id) => spells.find((s) => s.id === id && inMode(s))).find(Boolean);
  if (!second) return null;

  const flashOnD = flashKey !== 'F';
  const d = flashOnD ? flash : second;
  const f = flashOnD ? second : flash;
  return {
    spell1Id: Number(d.key), // D
    spell2Id: Number(f.key), // F
    d: { name: d.name, icon: d.image.full },
    f: { name: f.name, icon: f.image.full },
  };
}

module.exports = { pickSpells };
