// Build por classe: para campeões sem recomendação própria da Riot (Jinx, Darius...), junta as builds
// oficiais de todos os campeões da mesma classe e do mesmo tipo de dano e usa os itens mais frequentes
// em cada etapa. Assim um atirador sem build própria recebe build de atirador, nunca de lutador.
const { damageOf } = require('./graph');

const STAGES = 5; // etapas da build principal consideradas
const PER_STAGE = 3; // opções por etapa
const SITUATIONAL = 7;

// grupo do campeão: classe principal + tipo de dano (ex.: "Marksman:físico")
function groupOf(champ) {
  return `${champ.tags[0]}:${damageOf(champ)}`;
}

// builds: [{ champ, build }] dos campeões que têm build da Riot no modo (IDs crus, sem validar)
function aggregate(builds) {
  const groups = {};
  for (const { champ, build } of builds) {
    const g = (groups[groupOf(champ)] ||= { champions: [], stages: Array.from({ length: STAGES }, () => ({})), starting: {}, situational: {} });
    g.champions.push(champ.id);
    build.core.slice(0, STAGES).forEach((stage, i) => stage.items.forEach((id) => (g.stages[i][id] = (g.stages[i][id] || 0) + 1)));
    build.starting.forEach((b) => {
      const key = b.join('+');
      g.starting[key] = (g.starting[key] || 0) + 1;
    });
    build.situational.forEach((id) => (g.situational[id] = (g.situational[id] || 0) + 1));
  }
  const top = (counts, n) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
  const out = {};
  for (const [key, g] of Object.entries(groups)) {
    out[key] = {
      champions: g.champions,
      starting: top(g.starting, 3).map((k) => k.split('+').map(Number)),
      core: g.stages.map((s) => top(s, PER_STAGE).map(Number)).filter((s) => s.length),
      situational: top(g.situational, SITUATIONAL).map(Number),
    };
  }
  return out;
}

// build de classe no mesmo formato de buildForMode, com itens validados no mapa (buyable)
function classBuild(classes, champ, buyable) {
  const g = classes?.[groupOf(champ)] || classes?.[`${champ.tags[0]}:${damageOf(champ) === 'físico' ? 'mágico' : 'físico'}`];
  if (!g) return null;
  const clean = (ids) => [...new Set(ids.map(buyable).filter(Boolean))];
  const core = g.core.map((items) => ({ items: clean(items) })).filter((s) => s.items.length);
  if (!core.length) return null;
  return { starting: g.starting.map(clean).filter((b) => b.length), core, situational: clean(g.situational), fromClass: groupOf(champ), basedOn: g.champions };
}

module.exports = { aggregate, classBuild, groupOf };
