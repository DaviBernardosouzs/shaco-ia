// Ajuda na seleção de campeões: counters para banir e meta da rota.
// O Gemini responde nomes; aqui eles viram campeões de verdade do Data Dragon.
const POSITION_LABEL = { top: 'Topo', jungle: 'Selva', middle: 'Meio', bottom: 'Atirador', utility: 'Suporte' };

const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();

// nomes → campeões existentes, sem repetir e sem os que não podem ser escolhidos/banidos
function resolveChampions(names, sd, { exclude = [], max = 5 } = {}) {
  const byName = new Map();
  for (const c of Object.values(sd.champions)) {
    byName.set(fold(c.name), c);
    byName.set(fold(c.id), c);
  }
  const skip = new Set(exclude.map(String));
  const out = [];
  for (const n of names) {
    const c = byName.get(fold(n));
    if (!c || skip.has(c.key) || out.some((o) => o.id === c.id)) continue;
    out.push({ id: c.id, key: c.key, name: c.name, icon: `${sd.imgBase}/champion/${c.image.full}` });
    if (out.length >= max) break;
  }
  return out;
}

function positionLabel(position) {
  return POSITION_LABEL[String(position).toLowerCase()] || '';
}

module.exports = { resolveChampions, positionLabel };
