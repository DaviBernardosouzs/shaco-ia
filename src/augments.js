// Aumentos da Arena e do ARAM: Desordem, com nome em português, ícone e raridade.
// Fonte: CommunityDragon, que espelha os arquivos de dados do próprio cliente do LoL.
// - Arena (CHERRY): aumentos sem o prefixo ARAM_ em cherry-augments.json
// - ARAM: Desordem (KIWI e a variante KIWI_JADE): a lista do modo em augment-lists.json
const fs = require('fs');
const path = require('path');

const DATA = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/pt_br/v1';
const ASSETS = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default';
const TIERS = { kSilver: 'silver', kGold: 'gold', kPrismatic: 'prismatic' };
const CACHE_MS = 24 * 60 * 60 * 1000;

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();

function iconUrl(p) {
  return `${ASSETS}/${String(p).replace('/lol-game-data/assets/', '').toLowerCase()}`;
}

// { CHERRY: [...], KIWI: [...], KIWI_JADE: [...] }, cada aumento { id, name, tier, icon }
function buildPools(all, lists) {
  const describe = (a) => ({ id: a.id, name: a.nameTRA, tier: TIERS[a.rarity], icon: iconUrl(a.augmentSmallIconPath) });
  const usable = all.filter((a) => TIERS[a.rarity] && a.nameTRA);
  const pools = { CHERRY: usable.filter((a) => !a.augmentNameId.startsWith('ARAM_')).map(describe) };
  const byNameId = new Map(usable.map((a) => [a.augmentNameId.toLowerCase(), a]));
  for (const l of lists) {
    if (!String(l.modeName).startsWith('KIWI')) continue;
    pools[l.modeName] = l.augmentList.map((p) => byNameId.get(p.split('/').pop().toLowerCase())).filter(Boolean).map(describe);
  }
  return pools;
}

let memory = null;
async function loadAugments(cacheDir) {
  if (memory) return memory;
  const file = path.join(cacheDir, 'aumentos-cache.json');
  let cached = null;
  try {
    cached = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  if (cached && Date.now() - cached.savedAt < CACHE_MS) return (memory = cached.pools);
  try {
    const [all, lists] = await Promise.all(['cherry-augments.json', 'augment-lists.json'].map((f) => fetch(`${DATA}/${f}`).then((r) => r.json())));
    const pools = buildPools(all, lists);
    try {
      fs.writeFileSync(file, JSON.stringify({ savedAt: Date.now(), pools }));
    } catch {}
    return (memory = pools);
  } catch (err) {
    if (cached) return (memory = cached.pools);
    throw err;
  }
}

// lista de aumentos do modo (KIWI_JADE cai na do KIWI se não tiver a própria)
function poolFor(pools, modeKey) {
  return pools[modeKey] || (modeKey.startsWith('KIWI') ? pools.KIWI : null) || null;
}

// nomes do Gemini → aumentos existentes daquela raridade, sem repetir
function resolveAugments(names, pool, tier, max = 2) {
  const byName = new Map(pool.filter((a) => a.tier === tier).map((a) => [fold(a.name), a]));
  const out = [];
  for (const n of Array.isArray(names) ? names : []) {
    const a = byName.get(fold(n));
    if (a && !out.includes(a)) out.push(a);
    if (out.length >= max) break;
  }
  return out;
}

module.exports = { loadAugments, buildPools, poolFor, resolveAugments };
