// Build para a loja do jogo: catálogo de itens válidos no mapa do modo, validação do que
// o Gemini sugeriu e conversão para o formato de conjunto de itens do cliente.
const crypto = require('crypto');

function buyableOn(item, map) {
  return !!item && item.gold?.purchasable && item.inStore !== false && item.maps?.[String(map)] !== false && !item.requiredChampion;
}

// Itens que fazem sentido numa build: iniciais, botas e itens completos (um de cada nome).
function buildCatalog(sd, map) {
  const seen = new Set();
  const catalog = { start: [], boots: [], complete: [] };
  for (const [idStr, item] of Object.entries(sd.items)) {
    if (!buyableOn(item, map) || seen.has(item.name)) continue;
    const tags = item.tags || [];
    if (tags.includes('Consumable') || tags.includes('Trinket')) continue;
    const id = Number(idStr);
    if (tags.includes('Boots') && (item.from || []).length) catalog.boots.push(id);
    else if (tags.includes('Lane') || tags.includes('Jungle')) catalog.start.push(id);
    else if (!item.into && item.gold.total >= 2000) catalog.complete.push(id);
    else continue;
    seen.add(item.name);
  }
  return catalog;
}

function catalogText(catalog, sd) {
  const line = (ids) => ids.map((id) => `${id}:${sd.items[id].name}`).join('; ');
  return [
    catalog.start.length ? `Iniciais: ${line(catalog.start)}` : 'Iniciais: nenhum neste modo',
    catalog.boots.length ? `Botas: ${line(catalog.boots)}` : 'Botas: nenhuma neste modo',
    `Itens completos: ${line(catalog.complete)}`,
  ].join('\n');
}

// Mantém só IDs que existem no catálogo do mapa; o modelo às vezes inventa.
function validateBuild(raw, catalog, sd) {
  const only = (ids, allowed, max) => {
    const out = [];
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      const n = Number(id);
      if (allowed.includes(n) && !out.includes(n)) out.push(n);
    }
    return out.slice(0, max);
  };
  const core = only(raw.core, catalog.complete, 4);
  if (!core.length) throw new Error('O Gemini não sugeriu itens válidos para este modo.');
  const situational = only(raw.situational, catalog.complete, 4).filter((id) => !core.includes(id));
  const describe = (id) => ({ id, name: sd.items[id].name, icon: `${sd.imgBase}/item/${id}.png` });
  return {
    start: only(raw.start, catalog.start, 2).map(describe),
    boots: only(raw.boots, catalog.boots, 1).map(describe),
    core: core.map(describe),
    situational: situational.map(describe),
    explain: String(raw.explain || ''),
  };
}

function toItemSet(build, champion, mode, title) {
  const block = (type, items) => ({ type, items: items.map((i) => ({ id: String(i.id), count: 1 })) });
  const blocks = [
    build.start.length && block('Início', build.start),
    build.boots.length && block('Botas', build.boots),
    block('Principal (nesta ordem)', build.core),
    build.situational.length && block('Situacionais', build.situational),
  ].filter(Boolean);
  return {
    title,
    type: 'custom',
    map: 'any',
    mode: 'any',
    associatedChampions: [Number(champion.key)],
    associatedMaps: [mode.map],
    blocks,
    preferredItemSlots: [],
    sortrank: 0,
    startedFrom: 'blank',
    uid: crypto.randomUUID(),
  };
}

module.exports = { buildCatalog, catalogText, validateBuild, toItemSet };
