// Build recomendada pela própria Riot para cada campeão (a mesma de "Recomendados" na loja do jogo).
// Vem do arquivo do campeão nos dados de jogo (ItemRecommendationOverride), espelhado pela CommunityDragon.
// Cada build tem itens iniciais e etapas em ordem; a última etapa é a lista de itens situacionais.
const fs = require('fs');
const path = require('path');

const GAME_DATA = 'https://raw.communitydragon.org/latest/game/data/characters';

// modo do jogo → contexto da recomendação da Riot (ARAM: Desordem usa a do ARAM)
function contextFor(mode) {
  if (mode.key === 'CLASSIC' || mode.map === 11) return { map: 11, mode: 'CLASSIC' };
  if (mode.map === 12) return { map: 12, mode: 'ARAM' };
  return null;
}

const itemId = (ref) => Number(String(ref).split('/').pop());

// todas as recomendações do arquivo do campeão: [{ map, mode, starting: [[id]], stages: [{ items, maxCompleted }] }]
function parseOverrides(bin) {
  const out = [];
  (function walk(v) {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    if (v.__type === 'ItemRecommendationOverride') {
      for (const ctx of v.mOverrideContexts || []) {
        out.push({
          map: ctx.mMapID,
          mode: ctx.mModeNameStringId,
          starting: (v.StartingItemBundles || []).map((b) => (b.items || []).map(itemId)),
          stages: (v.mRecItemRanges || []).map((r) => ({ items: (r.items || []).map(itemId), maxCompleted: r.MaxCompletedItems ?? null })),
        });
      }
    }
    Object.values(v).forEach(walk);
  })(bin);
  return out;
}

const memory = new Map();
async function loadOverrides(champId, cacheDir, version) {
  const key = champId.toLowerCase();
  if (memory.has(key)) return memory.get(key);
  const dir = path.join(cacheDir, 'builds-riot', version);
  const file = path.join(dir, `${key}.json`);
  let overrides = null;
  try {
    overrides = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  if (!overrides) {
    const res = await fetch(`${GAME_DATA}/${key}/${key}.bin.json`);
    if (!res.ok) throw new Error(`Build da Riot indisponível para ${champId} (HTTP ${res.status})`);
    overrides = parseOverrides(await res.json());
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(overrides));
    } catch {}
  }
  memory.set(key, overrides);
  return overrides;
}

// A build do modo, só com itens que existem e são compráveis no mapa deste patch.
// buyable(id) → id válido no mapa (ou a variante do mapa) ou null.
function buildForMode(overrides, mode, buyable) {
  const ctx = contextFor(mode);
  if (!ctx) return null;
  const o = overrides.find((x) => x.map === ctx.map && x.mode === ctx.mode) || overrides.find((x) => x.map === ctx.map && !String(x.mode).startsWith('{'));
  if (!o) return null;
  const clean = (ids) => [...new Set(ids.map(buyable).filter(Boolean))];
  const stages = o.stages.map((s) => ({ items: clean(s.items), maxCompleted: s.maxCompleted })).filter((s) => s.items.length);
  if (!stages.length) return null;
  return {
    starting: o.starting.map(clean).filter((b) => b.length),
    // a última etapa da Riot é a lista de situacionais; as outras são a build principal, em ordem
    core: stages.length > 1 ? stages.slice(0, -1) : stages,
    situational: stages.length > 1 ? stages[stages.length - 1].items : [],
  };
}

module.exports = { loadOverrides, buildForMode, parseOverrides, contextFor };
