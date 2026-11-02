// Data Dragon: dados estáticos oficiais da Riot (itens, campeões, ícones), atualizados a cada patch.
const fs = require('fs');
const path = require('path');

const LANG = 'pt_BR';
const BASE = 'https://ddragon.leagueoflegends.com';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

function build(data) {
  return { ...data, imgBase: `${BASE}/cdn/${data.version}/img` };
}

async function loadStaticData(cacheDir) {
  const cacheFile = path.join(cacheDir, 'ddragon-cache.json');
  let cached = null;
  try {
    cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {}

  try {
    const [version] = await fetchJson(`${BASE}/api/versions.json`);
    if (cached && cached.version === version && cached.runes && cached.summoners) return build(cached);

    const dataUrl = `${BASE}/cdn/${version}/data/${LANG}`;
    const [items, champions, runes, summoners] = await Promise.all([
      fetchJson(`${dataUrl}/item.json`),
      fetchJson(`${dataUrl}/champion.json`),
      fetchJson(`${dataUrl}/runesReforged.json`),
      fetchJson(`${dataUrl}/summoner.json`),
    ]);
    const data = { version, items: items.data, champions: champions.data, runes, summoners: summoners.data };
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(data));
    } catch {}
    return build(data);
  } catch (err) {
    if (cached) return build(cached);
    throw err;
  }
}

// Nome e ícone das habilidades Q/W/E/R de um campeão (id do Data Dragon, ex.: "Shaco").
const spellCache = new Map();
async function loadChampionSpells(sd, champId) {
  if (!spellCache.has(champId)) {
    const url = `${BASE}/cdn/${sd.version}/data/${LANG}/champion/${champId}.json`;
    const job = fetchJson(url).then((json) => {
      const spells = json.data[champId].spells;
      return Object.fromEntries(['Q', 'W', 'E', 'R'].map((k, i) => [k, { name: spells[i].name, icon: `${sd.imgBase}/spell/${spells[i].image.full}` }]));
    });
    job.catch(() => spellCache.delete(champId));
    spellCache.set(champId, job);
  }
  return spellCache.get(champId);
}

module.exports = { loadStaticData, loadChampionSpells };
