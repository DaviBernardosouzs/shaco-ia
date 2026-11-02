// Roda a análise sobre a partida simulada usando os dados reais do patch atual.
const assert = require('assert');
const os = require('os');
const { loadStaticData } = require('../src/ddragon');
const { createLiveClient } = require('../src/liveclient');
const { analyze, describeForCoach } = require('../src/advisor');
const { createCoach, validateRunes } = require('../src/coach');
const { createEmoteTracker, createReadTracker, createPhaseTracker, createWardTracker } = require('../src/emotes');
const { validateSkills, skillSequence, nextSkill } = require('../src/skills');
const { resolveChampions, positionLabel } = require('../src/draft');
const { loadAugments, poolFor, resolveAugments } = require('../src/augments');
const { buildSummary, describeSummary, loadHistory, saveHistory } = require('../src/summary');
const { playlistLinks, openPlaylist } = require('../src/spotify');
const { loadOverrides, buildForMode } = require('../src/riotbuilds');
const { championNode, graphContext } = require('../src/graph');
const { classBuild } = require('../src/classbuilds');
const challenges = require('../src/challenges');
const { objectiveTimers } = require('../src/objectives');
const { chaosRoulette } = require('../src/roulette');
const { resolveItem } = require('../src/advisor');
const { modeFor: modeOf } = require('../src/modes');
const modeFor = modeOf;
const isMeLike = (p) => p.riotId === 'Davi#BR1';

(async () => {
  const sd = await loadStaticData(os.tmpdir());
  const raw = await createLiveClient({ mock: true }).getAllGameData();
  const result = analyze(raw, sd);

  console.log(`Patch ${sd.version}`);
  console.log(describeForCoach(result));

  assert.strictEqual(result.me.champion, 'Shaco');
  assert.strictEqual(result.me.archetype, 'ad');
  assert.strictEqual(result.lanes.length, 5);
  assert.ok(result.threats.healers.includes('Soraka'), 'Soraka deve contar como cura');
  assert.ok(result.recs.length > 0, 'deve sugerir ao menos um item');
  assert.ok(result.lanes.find((l) => l.pos === 'TOP').enemy.dead, 'Darius está morto no mock');

  // modo clássico: rotas e dicas de fase de rotas
  assert.strictEqual(result.mode.key, 'CLASSIC');
  assert.ok(result.tips.some((t) => t.includes('Fase de rotas')));

  // Arena: sem rotas, sem placar de time, todo o lobby conta como adversário, nada de selva/sentinela
  const arena = analyze(await createLiveClient({ mock: 'CHERRY' }).getAllGameData(), sd);
  assert.strictEqual(arena.mode.label, 'Arena');
  assert.strictEqual(arena.lanes.length, 0);
  assert.strictEqual(arena.team, null);
  assert.strictEqual(arena.enemies.length, 9);
  assert.ok(!arena.tips.some((t) => /sentinela|rota|selva/i.test(t)), 'Arena não fala de rota/selva/sentinela');
  assert.ok(describeForCoach(arena).includes('Não existem runas'));
  console.log(`\nArena: itens ${arena.recs.map((r) => `${r.name} [${r.id}]`).join(', ') || 'nenhum'}`);
  console.log(`Arena: dicas ${arena.tips.join(' | ')}`);

  // ARAM: sem rotas, com placar do time e dica de comprar ao morrer
  const aram = analyze(await createLiveClient({ mock: 'ARAM' }).getAllGameData(), sd);
  assert.strictEqual(aram.lanes.length, 0);
  assert.ok(aram.team && aram.team.allyKills === 6);
  assert.ok(aram.tips.some((t) => t.includes('só compra quando morre')));
  console.log(`ARAM: itens ${aram.recs.map((r) => r.name).join(', ')}`);

  // build para a loja: IDs inventados ou de outro mapa são descartados
  const { buildCatalog, validateBuild, toItemSet } = require('../src/build');
  const rift = buildCatalog(sd, 11);
  const build = validateBuild(
    { start: [rift.start[0], 999999], boots: [rift.boots[0]], core: [rift.complete[0], rift.complete[1], 123], situational: [rift.complete[1], rift.complete[2]] },
    rift,
    sd
  );
  assert.strictEqual(build.start.length, 1);
  assert.strictEqual(build.core.length, 2);
  assert.deepStrictEqual(build.situational.map((i) => i.id), [rift.complete[2]], 'situacional não repete item principal');
  const set = toItemSet(build, sd.champions.Shaco, { map: 11 }, 'Shaco IA: Shaco');
  assert.strictEqual(set.associatedChampions[0], 35);
  assert.ok(set.blocks.every((b) => b.items.every((i) => typeof i.id === 'string')));
  assert.throws(() => validateBuild({ core: [1] }, rift, sd), /válidos/);
  const arenaCatalog = buildCatalog(sd, 30);
  assert.ok(arenaCatalog.complete.length > 50 && arenaCatalog.boots.length === 0);

  // feitiços: Flash na tecla escolhida + segundo feitiço pela posição e pelo modo
  const { pickSpells } = require('../src/spells');
  const { modeFor } = require('../src/modes');
  const jg = pickSpells({ mode: modeFor('CLASSIC'), position: 'jungle', champ: sd.champions.Shaco, flashKey: 'F' }, sd.summoners);
  assert.deepStrictEqual([jg.spell1Id, jg.spell2Id], [11, 4], 'selva com Flash no F: D=Golpear, F=Flash');
  const sup = pickSpells({ mode: modeFor('CLASSIC'), position: 'utility', champ: sd.champions.Soraka, flashKey: 'D' }, sd.summoners);
  assert.deepStrictEqual([sup.spell1Id, sup.spell2Id], [4, 3], 'suporte de cura: Flash + Exaustão');
  const aramSpells = pickSpells({ mode: modeFor('ARAM'), position: '', champ: sd.champions.Jinx, flashKey: 'D' }, sd.summoners);
  assert.deepStrictEqual([aramSpells.spell1Id, aramSpells.spell2Id], [4, 32], 'ARAM: Flash + Marca');
  const arenaSpells = pickSpells({ mode: modeFor('CHERRY'), position: '', champ: sd.champions.Mordekaiser, flashKey: 'F' }, sd.summoners);
  assert.deepStrictEqual([arenaSpells.spell1Id, arenaSpells.spell2Id], [2201, 2202], 'Arena: Fuga no D, Flash do Arena no F');
  console.log(`Feitiços: selva ${jg.d.name}/${jg.f.name} · suporte ${sup.d.name}/${sup.f.name} · ARAM ${aramSpells.d.name}/${aramSpells.f.name} · Arena ${arenaSpells.d.name}/${arenaSpells.f.name}`);

  // página de runas montada a partir dos dados reais: deve passar na validação
  const [p, s] = sd.runes;
  const valid = {
    primaryStyleId: p.id,
    subStyleId: s.id,
    primary: p.slots.map((slot) => slot.runes[0].id),
    secondary: [s.slots[1].runes[0].id, s.slots[2].runes[0].id],
    shards: [5008, 5008, 5011],
    explain: 'teste',
  };
  const page = validateRunes(valid, sd.runes);
  assert.strictEqual(page.selectedPerkIds.length, 9);
  console.log(`\nRunas válidas: ${page.primary.map((r) => r.name).join(', ')} + ${page.secondary.map((r) => r.name).join(', ')}`);

  // runa secundária repetida no mesmo slot deve ser recusada
  assert.throws(() => validateRunes({ ...valid, secondary: [s.slots[1].runes[0].id, s.slots[1].runes[1].id] }, sd.runes));
  // runa-chave fora do lugar deve ser recusada
  assert.throws(() => validateRunes({ ...valid, primary: [...valid.primary].reverse() }, sd.runes));

  // sem chave, o coach avisa em vez de quebrar
  const coach = createCoach({ geminiApiKey: '', geminiModel: 'x' });
  assert.strictEqual(coach.enabled, false);
  await assert.rejects(coach.ask('oi', ''), /chave do Gemini/);

  // modelo aposentado: segue o modelo indicado no erro 404 e avisa quem chamou
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    if (url.includes('gemini-2.5-flash')) {
      return new Response('{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features"}}', { status: 404 });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Oi!' }] } }] }), { status: 200 });
  };
  let changedTo = null;
  const old = createCoach({ geminiApiKey: 'teste', geminiModel: 'gemini-2.5-flash' }, { onModelChange: (m) => (changedTo = m) });
  assert.strictEqual(await old.ask('oi', ''), 'Oi!');
  assert.strictEqual(changedTo, 'gemini-3.8-flash');
  assert.strictEqual(old.model, 'gemini-3.8-flash');
  assert.strictEqual(calls.length, 2);
  global.fetch = realFetch;

  // emotes: só eventos novos, e cada um com a reação certa (Davi é do ORDER no mock)
  const emotes = createEmoteTracker();
  const withEvents = (list) => ({ ...raw, events: { Events: list } });
  const start = { EventID: 0, EventName: 'GameStart' };
  assert.deepStrictEqual(emotes(withEvents([start, { EventID: 1, EventName: 'ChampionKill', KillerName: 'Davi', VictimName: 'Inimigo1' }])), [], 'histórico não dispara');
  assert.deepStrictEqual(
    emotes(withEvents([
      start,
      { EventID: 2, EventName: 'ChampionKill', KillerName: 'Davi', VictimName: 'Inimigo2' },
      { EventID: 3, EventName: 'ChampionKill', KillerName: 'Inimigo3#BR1', VictimName: 'Davi#BR1' },
      { EventID: 4, EventName: 'ChampionKill', KillerName: 'Aliado1', VictimName: 'Inimigo1' },
      { EventID: 5, EventName: 'TurretKilled', TurretKilled: 'Turret_T2_L_03_A', KillerName: 'Aliado1' },
      { EventID: 6, EventName: 'TurretKilled', TurretKilled: 'Turret_T1_C_05_A', KillerName: 'Inimigo3' },
      { EventID: 7, EventName: 'BaronKill', Stolen: 'True', KillerName: 'Aliado3' },
      { EventID: 8, EventName: 'DragonKill', Stolen: 'True', KillerName: 'Inimigo2' },
      { EventID: 9, EventName: 'DragonKill', Stolen: 'False', KillerName: 'Davi' },
      { EventID: 10, EventName: 'GameEnd', Result: 'Win' },
    ])),
    ['kill', 'death', 'tower', 'steal', 'win', 'dragon']
  );
  assert.deepStrictEqual(emotes(withEvents([{ EventID: 10, EventName: 'GameEnd', Result: 'Win' }])), [], 'não repete');
  // primeiro abate: substitui o "Abate!"; o de outra pessoa não conta
  const fb = createEmoteTracker();
  fb(withEvents([start]));
  assert.deepStrictEqual(
    fb(withEvents([
      start,
      { EventID: 1, EventName: 'ChampionKill', KillerName: 'Davi', VictimName: 'Inimigo2' },
      { EventID: 2, EventName: 'FirstBlood', Recipient: 'Davi' },
    ])),
    ['firstblood']
  );
  assert.deepStrictEqual(fb(withEvents([{ EventID: 3, EventName: 'FirstBlood', Recipient: 'Aliado1' }])), []);

  // barão do time (não roubado) e alma do dragão no 4º dragão elemental do time
  const obj = createEmoteTracker();
  obj(withEvents([start]));
  const drag = (id, killer, type = 'Fire') => ({ EventID: id, EventName: 'DragonKill', DragonType: type, Stolen: 'False', KillerName: killer });
  assert.deepStrictEqual(obj(withEvents([start, drag(1, 'Davi'), drag(2, 'Aliado3'), drag(3, 'Inimigo2')])), ['dragon'], 'dragão do time: uma reação por leitura');
  assert.deepStrictEqual(obj(withEvents([start, drag(1, 'Davi'), drag(2, 'Aliado3'), drag(3, 'Inimigo2'), drag(4, 'Davi')])), ['dragon']);
  assert.deepStrictEqual(obj(withEvents([start, drag(1, 'Davi'), drag(2, 'Aliado3'), drag(3, 'Inimigo2'), drag(4, 'Davi'), { EventID: 5, EventName: 'BaronKill', Stolen: 'False', KillerName: 'Aliado1' }, drag(6, 'Davi')])), ['baron', 'soul'], 'o 4º vira Alma (sem o "Dragon!" junto)');
  assert.deepStrictEqual(obj(withEvents([drag(7, 'Davi', 'Elder'), drag(8, 'Davi')])), ['elder'], 'alma só uma vez; Ancião tem reação própria');
  assert.deepStrictEqual(obj(withEvents([drag(9, 'Inimigo2')])), [], 'dragão do inimigo não conta');

  // assistência: estar entre os Assisters (e não ser quem deu o abate)
  const asst = createEmoteTracker();
  asst(withEvents([start]));
  const ck = (id, killer, assisters, victim = 'Inimigo1') => ({ EventID: id, EventName: 'ChampionKill', KillerName: killer, VictimName: victim, Assisters: assisters });
  assert.deepStrictEqual(asst(withEvents([ck(1, 'Aliado1', ['Davi', 'Aliado3'])])), ['assist']);
  assert.deepStrictEqual(asst(withEvents([ck(2, 'Davi', ['Aliado1'])])), ['kill'], 'abate próprio é Kill, não assistência');
  assert.deepStrictEqual(asst(withEvents([ck(3, 'Aliado1', ['Aliado3'])])), [], 'sem você na lista');
  assert.deepStrictEqual(asst(withEvents([ck(4, 'Inimigo2', ['Inimigo3'], 'Aliado1')])), []);

  // vastilarvas do time: uma reação por grupo (no máximo 1 por minuto de jogo); as do inimigo não contam
  const grub = createEmoteTracker();
  grub(withEvents([start]));
  const hk = (id, killer, t) => ({ EventID: id, EventName: 'HordeKill', KillerName: killer, Stolen: 'False', EventTime: t });
  assert.deepStrictEqual(grub(withEvents([hk(1, 'Davi', 360), hk(2, 'Davi', 362)])), ['grubs']);
  assert.deepStrictEqual(grub(withEvents([hk(3, 'Aliado1', 365)])), [], 'mesmo grupo');
  assert.deepStrictEqual(grub(withEvents([hk(4, 'Inimigo2', 600)])), [], 'do inimigo');
  assert.deepStrictEqual(grub(withEvents([hk(5, 'Aliado1', 600)])), ['grubs'], 'próximo grupo');

  // multiabates: cada um no seu evento; abate junto não aparece separado; de outra pessoa não conta
  const multi = createEmoteTracker();
  multi(withEvents([start]));
  const mk = (id, killer, streak) => ({ EventID: id, EventName: 'Multikill', KillerName: killer, KillStreak: streak });
  const kl = (id) => ({ EventID: id, EventName: 'ChampionKill', KillerName: 'Davi', VictimName: 'Inimigo1' });
  assert.deepStrictEqual(multi(withEvents([kl(1)])), ['kill']);
  assert.deepStrictEqual(multi(withEvents([kl(2), mk(3, 'Davi', 2)])), ['double']);
  assert.deepStrictEqual(multi(withEvents([kl(4), mk(5, 'Davi', 3)])), ['triple']);
  assert.deepStrictEqual(multi(withEvents([kl(6), mk(7, 'Davi', 3), kl(8), mk(9, 'Davi', 4)])), ['quadra'], 'na mesma leitura: só o maior');
  assert.deepStrictEqual(multi(withEvents([mk(10, 'Aliado1', 2)])), []);

  // pentakill: o abate que fechou não aparece separado; penta de outro não conta
  assert.deepStrictEqual(
    emotes(withEvents([
      { EventID: 11, EventName: 'ChampionKill', KillerName: 'Davi', VictimName: 'Inimigo5' },
      { EventID: 12, EventName: 'Multikill', KillerName: 'Davi', KillStreak: 5 },
      { EventID: 13, EventName: 'Multikill', KillerName: 'Aliado3', KillStreak: 5 },
      { EventID: 14, EventName: 'Multikill', KillerName: 'Davi', KillStreak: 3 },
    ])),
    ['penta']
  );

  // build da Riot + grafo: Shaco (assassino) contra muito dano físico segue a build de assassino
  const shacoOv = await loadOverrides('Shaco', os.tmpdir(), sd.version);
  const classic = modeFor('CLASSIC', 11);
  const shacoBuild = buildForMode(shacoOv, classic, (id) => resolveItem(id, 11, sd));
  const shacoNode = championNode(sd.champions.Shaco, shacoBuild, sd);
  console.log(`\nGrafo do Shaco:\n${graphContext(shacoNode)}`);
  assert.ok(shacoNode.core.length >= 2, 'Shaco tem build principal da Riot');
  const adHeavy = { ...raw, allPlayers: raw.allPlayers.map((p) => (isMeLike(p) ? { ...p, items: [] } : p)) };
  const withGraph = analyze(adHeavy, sd, { node: shacoNode });
  console.log('Recomendações com o grafo:', withGraph.recs.map((r) => `${r.name} (${r.reason})`).join(' | '));
  const coreNames = new Set(shacoNode.core.flat().map((i) => i.name));
  assert.ok(coreNames.has(withGraph.recs[0].name), 'sem itens: o primeiro é da build principal do Shaco');
  assert.notStrictEqual(withGraph.recs[0].name, 'Dança da Morte');
  const poolNames = new Set([...coreNames, ...shacoNode.situational.map((i) => i.name)]);
  assert.ok(withGraph.recs.every((r) => poolNames.has(r.name)), 'só itens que o Shaco usa');
  assert.ok(withGraph.graph.includes('Assassino'));
  assert.strictEqual(withGraph.recs.length, 3);
  assert.ok(!withGraph.recs.some((r) => r.name === 'Dança da Morte'), 'sem itens prontos: nada de situacional ainda');
  // com 2 itens prontos (Eclipse e Youmuu) contra muito dano físico: agora sim adapta, com item do próprio Shaco
  const twoItems = { ...raw, allPlayers: raw.allPlayers.map((p) => (isMeLike(p) ? { ...p, items: [{ itemID: 6692 }, { itemID: 3142 }] } : p)) };
  const later = analyze(twoItems, sd, { node: shacoNode });
  console.log('Com Eclipse + Youmuu:', later.recs.map((r) => `${r.name} (${r.reason})`).join(' | '));
  assert.ok(later.recs.every((r) => poolNames.has(r.name)));
  assert.ok(!later.recs.some((r) => r.name === 'Lâmina Fantasma de Youmuu'), 'Youmuu já foi comprado');
  assert.ok(later.recs.some((r) => r.reason.includes('físico')), 'adapta ao dano físico');
  assert.ok(later.recs.some((r) => r.reason.includes('Cura forte')), 'cobre a cura da Soraka');
  // campeão sem build própria (Jinx): usa a build da classe (atiradores de dano físico), nunca item de lutador
  const classes = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'grafo', 'classes.json'), 'utf8')).classes;
  const jinxBuild = classBuild(classes, sd.champions.Jinx, (id) => resolveItem(id, 11, sd));
  const jinxNode = championNode(sd.champions.Jinx, jinxBuild, sd);
  assert.strictEqual(jinxNode.source, 'classe');
  const asJinx = { ...raw, allPlayers: raw.allPlayers.map((p) => (isMeLike(p) ? { ...p, championName: 'Jinx', rawChampionName: 'game_character_displayname_Jinx', items: [] } : p)) };
  const jinxRecs = analyze(asJinx, sd, { node: jinxNode }).recs;
  console.log('Jinx (build da classe):', jinxRecs.map((r) => r.name).join(' | '));
  assert.ok(!jinxRecs.some((r) => ['Anjo Guardião', 'Dança da Morte'].includes(r.name)), 'Jinx sem itens não começa por item defensivo');
  assert.ok(jinxRecs.every((r) => sd.items[r.id].tags.some((t) => ['CriticalStrike', 'AttackSpeed', 'Boots', 'Damage'].includes(t))), 'itens de atirador');

  // ARAM tem outra build (Shaco AP na recomendação da Riot)
  const aramBuild = buildForMode(shacoOv, modeFor('ARAM', 12), (id) => resolveItem(id, 12, sd));
  assert.ok(aramBuild && aramBuild.core.length, 'Shaco tem build de ARAM');

  // rotas: cada lado com o ícone do próprio campeão
  result.lanes.forEach((l) => assert.ok(l.ally.icon?.endsWith('.png') && l.enemy.icon?.endsWith('.png'), `ícones na rota ${l.label}`));

  // seleção: nomes do Gemini viram campeões de verdade (com acento/espaço diferentes), sem repetir nem banidos
  const champs = resolveChampions(['lee sin', 'Kha’Zix', 'Nidalee', 'Campeão Inventado', 'LeeSin', 'Graves'], sd, { exclude: [sd.champions.Graves.key] });
  assert.deepStrictEqual(champs.map((c) => c.id), ['LeeSin', 'Khazix', 'Nidalee']);
  assert.strictEqual(positionLabel('JUNGLE'), 'Selva');

  // leitura do jogo: mock tem o Darius (topo inimigo) morto por 18,4s e todos os outros vivos
  assert.deepStrictEqual([result.read.alliesAlive, result.read.enemiesAlive], [5, 4]);
  assert.deepStrictEqual(result.read.deadEnemies.map((d) => [d.name, d.lane, d.respawn]), [['Darius', 'Topo', 19]]);

  // reações: primeira leitura é só referência; depois só no que mudou, com intervalo mínimo
  const reads = createReadTracker();
  const lane = (pos, enemyDead, respawn = 20, extra = {}) => ({ pos, label: pos, mine: false, state: 'even', ally: { dead: false }, enemy: { name: `E-${pos}`, dead: enemyDead, respawn }, ...extra });
  const snap = (allies, enemies, lanes) => ({ read: { alliesAlive: allies, enemiesAlive: enemies, deadEnemies: lanes.filter((l) => l.enemy.dead).map((l) => ({ name: l.enemy.name })) }, lanes });
  assert.deepStrictEqual(reads(snap(5, 5, [lane('TOP', false)]), 0), []);
  assert.deepStrictEqual(reads(snap(5, 4, [lane('TOP', true, 24)]), 1000), [{ key: 'opening', text: 'Top down · 24s' }]);
  assert.deepStrictEqual(reads(snap(5, 4, [lane('TOP', true, 22)]), 3000), [], 'mesma morte não repete');
  assert.deepStrictEqual(reads(snap(3, 5, [lane('MIDDLE', true, 30)]), 5000), [{ key: 'outnumbered', text: '3v5!' }], 'abertura dentro do intervalo fica de fora');
  assert.deepStrictEqual(reads(snap(2, 5, []), 7000), [], 'continua em desvantagem: não repete');
  assert.deepStrictEqual(reads(snap(5, 4, [lane('BOTTOM', true, 8)]), 60000), [], 'volta logo: não conta');
  assert.deepStrictEqual(reads(snap(5, 4, [lane('UTILITY', true, 25, { state: 'behind' })]), 62000), [], 'aliado atrás: não conta');
  assert.deepStrictEqual(reads(snap(5, 4, [lane('JUNGLE', true, 25, { mine: true })]), 64000), [], 'a sua própria rota: não conta');

  // farm: 70 CS aos 10:12 = 6,9/min; meta de selva 5,5 (verde); selva inimigo tem 74 (-4)
  assert.strictEqual(result.farm.cs, 70);
  assert.strictEqual(result.farm.perMin, 6.9);
  assert.deepStrictEqual([result.farm.target, result.farm.state, result.farm.vs.diff], [5.5, 'good', -4]);
  assert.strictEqual(arena.farm, null, 'Arena não tem farm');
  // visão: mock tem wardScore 6 para o Davi (selva) e 5 para o selva inimigo
  assert.deepStrictEqual([result.farm.vision.score, result.farm.vision.target, result.farm.vision.diff], [6, 1.3, 1]);

  // resumo pós-partida a partir da última leitura, com as mortes antes dos 10:00
  const endRaw = { ...raw, events: { Events: [
    { EventID: 1, EventName: 'ChampionKill', EventTime: 312, KillerName: 'Inimigo2', VictimName: 'Davi' },
    { EventID: 2, EventName: 'ChampionKill', EventTime: 900, KillerName: 'Inimigo3', VictimName: 'Davi' },
    { EventID: 3, EventName: 'GameEnd', Result: 'Win' },
  ] } };
  const sum = buildSummary(endRaw, result);
  assert.deepStrictEqual([sum.result, sum.champion, sum.kills, sum.deaths, sum.cs, sum.vision, sum.earlyDeaths], ['win', 'Shaco', 2, 2, 70, 6, 1]);
  assert.deepStrictEqual(sum.deathTimes, ['5:12', '15:00']);
  assert.ok(describeSummary(sum).includes('Resultado: vitória'));
  const hdir = require('fs').mkdtempSync(require('path').join(os.tmpdir(), 'shaco-hist-'));
  const saved = saveHistory(hdir, Array.from({ length: 25 }, (_, i) => ({ id: i })));
  assert.strictEqual(saved.length, 20);
  assert.strictEqual(loadHistory(hdir).length, 20, 'guarda só as últimas 20');

  // aumentos: Arena e ARAM: Desordem com listas próprias; nomes do Gemini só valem se existirem na raridade certa
  const pools = await loadAugments(os.tmpdir());
  const arenaPool = poolFor(pools, 'CHERRY');
  const kiwiPool = poolFor(pools, 'KIWI');
  console.log(`\nAumentos: Arena ${arenaPool.length}, ARAM: Desordem ${kiwiPool.length}, variante ${poolFor(pools, 'KIWI_JADE').length}`);
  assert.ok(arenaPool.length > 100 && kiwiPool.length > 100);
  assert.ok(arenaPool.every((a) => a.icon.startsWith('https://raw.communitydragon.org/') && ['silver', 'gold', 'prismatic'].includes(a.tier)));
  const gauntlet = arenaPool.find((a) => a.name === 'Manopla Adornada');
  assert.ok(gauntlet, 'Manopla Adornada existe na Arena');
  assert.deepStrictEqual(resolveAugments(['manopla adornada', 'Aumento Inventado', 'Manopla Adornada'], arenaPool, gauntlet.tier).map((a) => a.name), ['Manopla Adornada']);
  assert.deepStrictEqual(resolveAugments(['Manopla Adornada'], arenaPool, gauntlet.tier === 'gold' ? 'silver' : 'gold'), [], 'raridade errada não vale');
  assert.strictEqual(modeFor('KIWI_JADE', 12).label, 'ARAM: Desordem');

  // playlist do campeão: app do Spotify quando instalado (cai para o Web se falhar), senão o Web direto
  const links = playlistLinks("Kai'Sa");
  assert.strictEqual(links.app, "spotify:search:Kai'Sa%20playlist");
  assert.strictEqual(links.web, "https://open.spotify.com/search/Kai'Sa/playlists");
  const opened = [];
  const fakeShell = (fail) => ({ openExternal: async (u) => { opened.push(u); if (fail && u.startsWith('spotify:')) throw new Error('sem app'); } });
  assert.strictEqual(await openPlaylist('Shaco', { shell: fakeShell(false), hasApp: true }), 'app');
  assert.strictEqual(await openPlaylist('Shaco', { shell: fakeShell(true), hasApp: true }), 'web');
  assert.strictEqual(await openPlaylist('Shaco', { shell: fakeShell(false), hasApp: false }), 'web');
  assert.deepStrictEqual(opened, ['spotify:search:Shaco%20playlist', 'spotify:search:Shaco%20playlist', 'https://open.spotify.com/search/Shaco/playlists', 'https://open.spotify.com/search/Shaco/playlists']);

  // fim da fase de rotas: uma vez, pela torre externa da própria rota ou aos 14:00
  const phaseSnap = (pos, gameTime) => ({ mode: { lanes: true }, me: { position: pos }, gameTime });
  const evs = (list) => ({ events: { Events: list } });
  const bot = createPhaseTracker();
  assert.deepStrictEqual(bot(evs([]), phaseSnap('BOTTOM', 600)), []);
  assert.deepStrictEqual(bot(evs([{ EventName: 'TurretKilled', TurretKilled: 'Turret_T1_L_03_A' }]), phaseSnap('BOTTOM', 620)), [], 'torre de outra rota');
  assert.deepStrictEqual(bot(evs([{ EventName: 'TurretKilled', TurretKilled: 'Turret_T2_R_03_A' }]), phaseSnap('BOTTOM', 640)), [{ key: 'rotate-bot', text: 'Lane phase over' }]);
  assert.deepStrictEqual(bot(evs([]), phaseSnap('BOTTOM', 900)), [], 'só uma vez');
  const mid = createPhaseTracker();
  mid(evs([]), phaseSnap('MIDDLE', 700));
  assert.deepStrictEqual(mid(evs([]), phaseSnap('MIDDLE', 840)), [{ key: 'rotate-mid', text: 'Lane phase over' }], 'aos 14:00');
  const late = createPhaseTracker();
  assert.deepStrictEqual(late(evs([]), phaseSnap('TOP', 1300)), [], 'app aberto tarde não mostra atrasado');
  assert.deepStrictEqual(createPhaseTracker()(evs([]), phaseSnap('JUNGLE', 900)), [], 'selva não tem');

  // 6/7: aparece quando o placar chega em 6 abates e 7 mortes, uma vez só
  const six = createReadTracker();
  const kd = (kills, deaths) => ({ me: { kills, deaths }, read: { alliesAlive: 5, enemiesAlive: 5, deadEnemies: [] }, lanes: [] });
  assert.deepStrictEqual(six(kd(5, 7), 0), []);
  assert.deepStrictEqual(six(kd(6, 7), 1000), [{ key: 'sixseven', text: '6/7!' }]);
  assert.deepStrictEqual(six(kd(6, 7), 3000), [], 'continua 6/7: não repete');
  assert.deepStrictEqual(six(kd(6, 8), 5000), []);
  assert.deepStrictEqual(six(kd(6, 7), 7000), [], 'uma vez por partida');
  assert.deepStrictEqual([result.me.kills, result.me.deaths], [2, 2], 'placar do jogador na análise');

  // desafio do dia: sorteio fixo por dia, troca uma vez, cumpre no fim da partida, sequência de dias
  const day = (d) => new Date(2026, 10, d, 12);
  const st = challenges.today({ date: null, streak: 0, best: 0, lastDone: null }, day(2));
  assert.strictEqual(st.id, challenges.pickFor('2026-11-02'), 'mesmo desafio o dia todo');
  const first = st.id;
  assert.ok(challenges.swap(st) && st.id !== first, 'troca para outro');
  assert.ok(!challenges.swap(st), 'só uma troca por dia');
  st.id = 'kda'; // fixa para testar a conferência
  const game = (extra) => ({ ...sum, minutes: 25, lanes: true, position: 'JUNGLE', ...extra });
  assert.ok(!challenges.complete(st, game({ kills: 1, deaths: 5, assists: 2 })), 'KDA 0,6 não cumpre');
  assert.ok(challenges.complete(st, game({ kills: 6, deaths: 1, assists: 4 })), 'KDA 10 cumpre');
  assert.deepStrictEqual([st.done, st.streak, st.best], [true, 1, 1]);
  assert.ok(!challenges.complete(st, game({ kills: 9, deaths: 0, assists: 0 })), 'não conta duas vezes no mesmo dia');
  // dia seguinte: desafio novo; cumprir de novo vira sequência de 2
  challenges.today(st, day(3));
  assert.strictEqual(st.done, false);
  st.id = 'win';
  assert.ok(challenges.complete(st, game({ result: 'win' })));
  assert.deepStrictEqual([st.streak, st.best], [2, 2]);
  // pulou um dia: a sequência zera
  challenges.today(st, day(5));
  assert.deepStrictEqual([st.streak, st.best], [0, 2]);
  // não vale na partida: farm no ARAM ou de suporte
  st.id = 'farm';
  assert.ok(!challenges.complete(st, game({ lanes: false, csPerMin: 9 })), 'farm não conta fora do mapa com rotas');
  assert.ok(!challenges.complete(st, game({ position: 'UTILITY', csPerMin: 9 })), 'suporte não tem desafio de farm');
  assert.strictEqual(challenges.view(st, game({ position: 'UTILITY' })).note, 'não vale nesta partida (modo ou função)');
  assert.strictEqual(challenges.view(st, game({ csPerMin: 6.4 })).progress, '6.4 de 7 por minuto');
  // first blood e multiabate saem dos eventos da partida
  assert.deepStrictEqual([sum.firstBlood, sum.bestMulti, sum.minutes], [false, 0, 10.2]);

  // lembrete de sentinela: comprou (inventário mudou e ouro caiu) sem Sentinela de Controle
  const wards = createWardTracker();
  const shop = (t, gold, itemIDs) => [
    { ...raw, allPlayers: raw.allPlayers.map((p) => (isMeLike(p) ? { ...p, items: itemIDs.map((itemID) => ({ itemID })) } : p)) },
    { mode: { lanes: true }, gameTime: t, me: { gold } },
  ];
  assert.deepStrictEqual(wards(...shop(400, 1500, [1055])), []);
  assert.deepStrictEqual(wards(...shop(410, 300, [1055, 3133])), [{ key: 'ward', text: 'Control Ward!' }], 'comprou sem sentinela');
  assert.deepStrictEqual(wards(...shop(500, 1400, [1055, 3133])), []);
  assert.deepStrictEqual(wards(...shop(520, 200, [1055, 3133, 3134])), [], 'intervalo de 5 min');
  assert.deepStrictEqual(wards(...shop(800, 1500, [1055, 3133, 3134])), []);
  assert.deepStrictEqual(wards(...shop(810, 500, [1055, 3133, 3134, 2055])), [], 'já tem sentinela de controle');
  assert.deepStrictEqual(wards(...shop(900, 700, [1055, 3133, 3134])), [], 'usou a sentinela (sem compra): não lembra');

  // roleta do caos: campeão, 5 itens completos diferentes e uma bota
  const spin = chaosRoulette(sd);
  assert.ok(spin.champion.name && spin.champion.icon.endsWith('.png'));
  assert.strictEqual(new Set(spin.items.map((i) => i.id)).size, 5);
  assert.ok(sd.items[spin.boots.id].tags.includes('Boots'));
  assert.ok(['Q', 'W', 'E'].includes(spin.max) && spin.spin.length === 18);

  // tempo até os objetivos, a partir dos eventos
  const at = (t, evs = []) => objectiveTimers({ ...raw, gameData: { ...raw.gameData, gameTime: t }, events: { Events: evs } });
  const pick = (list, id) => list.find((o) => o.id === id);
  let objs = at(240);
  assert.deepStrictEqual([pick(objs, 'dragon').text, pick(objs, 'grubs').text, pick(objs, 'herald').text, pick(objs, 'baron')], ['em 1:00', 'em 4:00', 'em 11:00', undefined], 'começo: dragão 5:00, vastilarvas 8:00, arauto 15:00, barão ainda não');
  objs = at(400, [{ EventName: 'DragonKill', DragonType: 'Fire', KillerName: 'Davi', EventTime: 380 }]);
  assert.strictEqual(pick(objs, 'dragon').text, 'em 4:40', 'renasce 5 min depois');
  assert.strictEqual(at(320).find((o) => o.id === 'dragon').text, 'vivo');
  // Alma (4 dragões do mesmo time) → Ancião 6 min depois
  const soulEvs = [300, 700, 1000, 1300].map((t, i) => ({ EventName: 'DragonKill', DragonType: 'Fire', KillerName: i % 2 ? 'Aliado3' : 'Davi', EventTime: t }));
  objs = at(1400, soulEvs);
  assert.ok(!pick(objs, 'dragon') && pick(objs, 'elder').text === 'em 4:20', 'depois da Alma: Ancião');
  assert.strictEqual(pick(objs, 'baron').text, 'vivo', 'barão nasce 20:00');
  objs = at(1500, [{ EventName: 'BaronKill', KillerName: 'Davi', EventTime: 1450 }]);
  assert.strictEqual(pick(objs, 'baron').text, 'em 5:10');
  assert.ok(!pick(objs, 'herald') && !pick(objs, 'grubs'), 'arauto e vastilarvas somem depois de 19:45');

  // habilidades: sequência dos 18 níveis e o que subir agora
  const plan = validateSkills({ start: ['w', 'E', 'Q'], max: ['E', 'W'] });
  assert.deepStrictEqual(plan.max, ['E', 'W', 'Q'], 'completa a ordem com a que faltou');
  const seq = skillSequence(plan);
  console.log(`Sequência: ${seq.join(' ')}`);
  assert.strictEqual(seq.length, 18);
  assert.deepStrictEqual(seq.slice(0, 3), ['W', 'E', 'Q']);
  assert.deepStrictEqual([seq[5], seq[10], seq[15]], ['R', 'R', 'R']);
  for (const k of ['Q', 'W', 'E']) assert.strictEqual(seq.filter((x) => x === k).length, 5);
  seq.forEach((k, i) => {
    const n = seq.slice(0, i + 1).filter((x) => x === k).length;
    if (k !== 'R') assert.ok(n <= Math.ceil((i + 1) / 2), `nível ${i + 1}: ${k} passou da metade do nível`);
  });
  // mock: nível 9 com Q1 W2 E4 R1 (8 pontos) -> sobra 1; pelo plano o E fecha no 9
  assert.strictEqual(nextSkill(seq, raw.activePlayer.abilities, 9), 'E');
  // fugiu do plano (subiu Q em vez de E): aponta o E que ficou para trás
  assert.strictEqual(nextSkill(seq, { Q: { abilityLevel: 3 }, W: { abilityLevel: 1 }, E: { abilityLevel: 1 }, R: { abilityLevel: 0 } }, 6), 'E');
  assert.strictEqual(nextSkill(seq, { Q: { abilityLevel: 1 }, W: { abilityLevel: 1 }, E: { abilityLevel: 1 }, R: { abilityLevel: 0 } }, 3), null, 'sem ponto livre');
  assert.strictEqual(nextSkill(seq, { Q: { abilityLevel: 1 }, W: { abilityLevel: 1 }, E: { abilityLevel: 3 }, R: { abilityLevel: 0 } }, 6), 'R');

  console.log('\nOK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
