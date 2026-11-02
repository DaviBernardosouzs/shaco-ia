// Gera o conhecimento do LoL do patch atual:
// 1. assets/grafo/classes.json: build mais usada por classe e tipo de dano (o app usa para campeões sem build própria)
// 2. um cofre do Obsidian com notas de campeões, itens, classes e necessidades ligadas entre si (o grafo)
// Uso: npm run cofre  [-- pasta-do-cofre]   (padrão: ../Conhecimento LoL)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadStaticData } = require('../src/ddragon');
const { loadOverrides, buildForMode } = require('../src/riotbuilds');
const { aggregate, classBuild, groupOf } = require('../src/classbuilds');
const { championNode, itemCounters, CLASS_PT, NEED_PT } = require('../src/graph');
const { resolveItem } = require('../src/advisor');
const { modeFor } = require('../src/modes');

const ROOT = path.join(__dirname, '..');
const VAULT = path.resolve(process.argv[2] || path.join(ROOT, '..', 'Conhecimento LoL'));
const CACHE = path.join(os.tmpdir(), 'shaco-cofre');

const safe = (name) => String(name).replace(/[<>:"/\\|?*#^[\]]/g, '').trim();
const link = (folder, name) => `[[${folder}/${safe(name)}|${name}]]`;
const NEED_NOTE = { vsAD: 'Contra dano físico', vsAP: 'Contra dano mágico', antiheal: 'Antícura', vsTank: 'Contra tanques' };

async function pool(list, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < list.length) {
      const k = i++;
      out[k] = await fn(list[k], k);
    }
  }));
  return out;
}

function write(rel, text) {
  const file = path.join(VAULT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

(async () => {
  const sd = await loadStaticData(CACHE);
  const classic = modeFor('CLASSIC', 11);
  const buyable = (id) => resolveItem(id, 11, sd);
  const champs = Object.values(sd.champions).sort((a, b) => a.name.localeCompare(b.name));
  console.log(`Patch ${sd.version}: baixando a build da Riot de ${champs.length} campeões…`);

  const own = await pool(champs, 10, async (champ) => {
    try {
      return buildForMode(await loadOverrides(champ.id, CACHE, sd.version), classic, buyable);
    } catch {
      return null;
    }
  });
  const withBuild = champs.map((champ, i) => ({ champ, build: own[i] })).filter((x) => x.build);
  console.log(`${withBuild.length} campeões com build própria da Riot; os outros usam a build da classe.`);

  // 1. builds por classe (vão junto com o app)
  const classes = aggregate(withBuild.map(({ champ, build }) => ({ champ, build })));
  fs.mkdirSync(path.join(ROOT, 'assets', 'grafo'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'assets', 'grafo', 'classes.json'), JSON.stringify({ version: sd.version, classes }, null, 1));

  // 2. cofre do Obsidian: só refaz as pastas geradas aqui (suas notas e configurações do cofre ficam)
  for (const dir of ['Campeões', 'Itens', 'Classes', 'Necessidades', 'Dano']) fs.rmSync(path.join(VAULT, dir), { recursive: true, force: true });
  const usedItems = new Map();
  const byClass = {};
  for (const [i, champ] of champs.entries()) {
    const build = own[i] || classBuild(classes, champ, buyable);
    const node = championNode(champ, build, sd);
    for (const it of [...node.core.flat(), ...node.situational]) usedItems.set(it.id, it);
    champ.tags.forEach((t) => (byClass[t] ||= []).push(champ.name));
    const stageLines = node.core.map((s, k) => `${k + 1}. ${s.map((it) => link('Itens', it.name)).join(' ou ')}`);
    const sitLines = node.situational.map((it) => `- ${link('Itens', it.name)}${it.counters.length ? ` → ${it.counters.map((c) => link('Necessidades', NEED_NOTE[c])).join(', ')}` : ''}`);
    write(`Campeões/${safe(champ.name)}.md`, [
      '---',
      `tags: [campeao, classe/${(CLASS_PT[champ.tags[0]] || champ.tags[0]).toLowerCase()}, dano/${node.damage === 'físico' ? 'fisico' : 'magico'}, build/${node.source || 'nenhuma'}]`,
      `titulo: "${champ.title}"`,
      '---',
      `# ${champ.name}`,
      '',
      `Classe: ${champ.tags.map((t) => link('Classes', CLASS_PT[t] || t)).join(', ')} · Dano: ${link('Dano', node.damage === 'físico' ? 'Físico' : 'Mágico')}`,
      '',
      node.source === 'riot' ? '## Build principal (recomendação da Riot)' : node.source === 'classe' ? `## Build principal (da classe: ${node.basedOn.length} campeões parecidos)` : '## Sem build para o Summoner\'s Rift',
      ...stageLines,
      '',
      '## Situacionais',
      ...(sitLines.length ? sitLines : ['- nenhum']),
      '',
    ].join('\n'));
  }

  for (const it of usedItems.values()) {
    const item = sd.items[it.id];
    write(`Itens/${safe(it.name)}.md`, [
      '---',
      `tags: [item, ${(item.tags || []).map((t) => `tipo/${t.toLowerCase()}`).join(', ')}]`,
      `custo: ${item.gold.total}`,
      '---',
      `# ${it.name}`,
      '',
      `${item.plaintext || ''}`,
      '',
      `Custo: ${item.gold.total} de ouro`,
      it.counters.length ? `Resolve: ${it.counters.map((c) => link('Necessidades', NEED_NOTE[c])).join(', ')}` : '',
      '',
    ].join('\n'));
  }

  for (const [cls, names] of Object.entries(byClass)) {
    const pt = CLASS_PT[cls] || cls;
    write(`Classes/${pt}.md`, [`---\ntags: [classe]\n---`, `# ${pt}`, '', ...names.map((n) => `- ${link('Campeões', n)}`), ''].join('\n'));
  }
  for (const [need, note] of Object.entries(NEED_NOTE)) {
    write(`Necessidades/${note}.md`, [`---\ntags: [necessidade]\n---`, `# ${note}`, '', `Itens que resolvem: ${NEED_PT[need]}. Veja quem aponta para esta nota no grafo.`, ''].join('\n'));
  }
  for (const d of ['Físico', 'Mágico']) write(`Dano/${d}.md`, `---\ntags: [dano]\n---\n# Dano ${d.toLowerCase()}\n`);

  write('Início.md', [
    `# Conhecimento LoL · patch ${sd.version}`,
    '',
    'Gerado pelo Shaco IA (npm run cofre). Abra a visão de grafo do Obsidian para ver como tudo se liga:',
    '- **Campeões** apontam para a classe, o tipo de dano e os itens da build mais usada.',
    '- **Itens** apontam para o que resolvem (contra dano físico, contra dano mágico, antícura, contra tanques).',
    '',
    `Classes: ${Object.keys(byClass).map((c) => link('Classes', CLASS_PT[c] || c)).join(' · ')}`,
    `Necessidades: ${Object.values(NEED_NOTE).map((n) => link('Necessidades', n)).join(' · ')}`,
    '',
  ].join('\n'));

  // cores do grafo no Obsidian, por tipo de nota (só na primeira vez, para não apagar ajustes seus)
  if (!fs.existsSync(path.join(VAULT, '.obsidian', 'graph.json'))) write('.obsidian/graph.json', JSON.stringify({
    colorGroups: [
      { query: 'path:Campeões', color: { a: 1, rgb: 0xc23a4e } },
      { query: 'path:Itens', color: { a: 1, rgb: 0xd6af5c } },
      { query: 'path:Classes', color: { a: 1, rgb: 0x5b2a86 } },
      { query: 'path:Necessidades', color: { a: 1, rgb: 0x5cc79a } },
      { query: 'path:Dano', color: { a: 1, rgb: 0x6b8cff } },
    ],
  }, null, 2));

  console.log(`Builds por classe: ${Object.keys(classes).length} grupos (${Object.keys(classes).join(', ')})`);
  console.log(`Cofre do Obsidian em: ${VAULT} (${champs.length} campeões, ${usedItems.size} itens)`);
})();
