// Grafo de conhecimento do LoL: campeão → classe e tipo de dano → build da Riot → o que cada item resolve.
// É a base das recomendações de item (só itens que o campeão realmente usa) e do contexto do Gemini.
// O mesmo grafo é exportado como cofre do Obsidian (scripts/cofre.js).

const CLASS_PT = { Assassin: 'Assassino', Fighter: 'Lutador', Mage: 'Mago', Marksman: 'Atirador', Support: 'Suporte', Tank: 'Tanque' };
const NEED_PT = { vsAD: 'contra dano físico', vsAP: 'contra dano mágico', antiheal: 'antícura', vsTank: 'contra tanques' };

// o que um item resolve, pelas tags e pela descrição do Data Dragon
function itemCounters(item) {
  const tags = item.tags || [];
  const out = [];
  if (tags.includes('Armor')) out.push('vsAD');
  if (tags.includes('SpellBlock') || tags.includes('MagicResist')) out.push('vsAP');
  // antícura: "Feridas Dolorosas" em uns itens, "Ferimentos" em outros (depende do patch)
  if (/ferida|ferimento/i.test(item.description || '')) out.push('antiheal');
  if (tags.includes('ArmorPenetration') || tags.includes('MagicPenetration')) out.push('vsTank');
  return out;
}

function damageOf(champ) {
  return champ.info.magic > champ.info.attack ? 'mágico' : 'físico';
}

// nó do campeão com a build da Riot já resolvida em nomes e no que cada item resolve
function championNode(champ, build, sd) {
  const item = (id) => ({ id, name: sd.items[id].name, counters: itemCounters(sd.items[id]) });
  return {
    id: champ.id,
    name: champ.name,
    classes: champ.tags.map((t) => CLASS_PT[t] || t),
    damage: damageOf(champ),
    starting: build ? build.starting.map((b) => b.map(item)) : [],
    core: build ? build.core.map((s) => s.items.map(item)) : [],
    situational: build ? build.situational.map(item) : [],
    // de onde veio a build: do próprio campeão (Riot) ou da classe dele (campeões parecidos)
    source: build?.fromClass ? 'classe' : build ? 'riot' : null,
    basedOn: build?.basedOn || [],
  };
}

// todos os itens que o campeão usa (principal e situacionais), sem repetir
function poolOf(node) {
  const seen = new Map();
  for (const it of [...node.core.flat(), ...node.situational]) if (!seen.has(it.id)) seen.set(it.id, it);
  return [...seen.values()];
}

// Texto do grafo para o Gemini: só fatos do LoL ligados a este campeão.
function graphContext(node) {
  const names = (list) => list.map((i) => i.name).join(' ou ');
  const lines = [
    `Campeão: ${node.name}. Classe: ${node.classes.join(', ')}. Dano principal: ${node.damage}.`,
  ];
  if (node.core.length) {
    lines.push(
      node.source === 'classe'
        ? `Build principal mais usada por campeões da mesma classe e tipo de dano (${node.basedOn.length} campeões parecidos), em ordem:`
        : 'Build principal mais usada (recomendação da Riot), em ordem:'
    );
    node.core.forEach((stage, i) => lines.push(`  ${i + 1}. ${names(stage)}`));
    const sit = node.situational.map((i) => `${i.name}${i.counters.length ? ` (${i.counters.map((c) => NEED_PT[c]).join(', ')})` : ''}`);
    if (sit.length) lines.push(`Situacionais que ${node.name} usa: ${sit.join('; ')}.`);
  } else {
    lines.push('Sem build da Riot para este modo.');
  }
  return lines.join('\n');
}

module.exports = { championNode, poolOf, graphContext, itemCounters, damageOf, CLASS_PT, NEED_PT };
