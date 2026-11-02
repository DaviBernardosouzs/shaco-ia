// Conversa com o Gemini (API gratuita do Google AI Studio).
const { planPrompt, selectPrompt } = require('./modes');
const { buildCatalog, catalogText, validateBuild } = require('./build');
const { validateSkills } = require('./skills');
const { graphContext, poolOf } = require('./graph');

// catálogo só com os itens da build do campeão (iniciais, botas e itens completos que ele usa)
function championCatalog(node, sd) {
  const isBoots = (id) => (sd.items[id]?.tags || []).includes('Boots');
  const pool = poolOf(node).map((i) => i.id);
  return {
    start: [...new Set(node.starting.flat().map((i) => i.id))],
    boots: pool.filter(isBoots),
    complete: pool.filter((id) => !isBoots(id)),
  };
}

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

const PERSONA = [
  'Você é o Shaco IA, um treinador de League of Legends com a personalidade do Shaco: brincalhão, mas útil.',
  'Responda sempre em português do Brasil, em no máximo 3 frases curtas: a resposta vai ser lida em voz alta durante a partida.',
  'Pode falar de itens, runas, matchups, rota inicial da selva, como jogar contra cada campeão e como ler o placar.',
  'Sempre siga o modo de jogo informado na situação: no Arena não existem runas, rotas, selva nem sentinelas (lá se fala de Aumentos, itens e jogo em dupla); no ARAM não existe selva e só se compra ao morrer.',
  'Nunca recomende algo que não existe no modo atual.',
  'Seu raciocínio fica só dentro de League of Legends: campeões, itens, runas, habilidades, modos e o jogo em si. Se perguntarem qualquer outra coisa, diga com bom humor que você só entende de LoL e volte para a partida.',
  'Para itens, quando receber o "Conhecimento do campeão", use só os itens listados ali: é a build mais usada daquele campeão. Adapte à partida trocando entre esses itens, nunca puxando item de outra classe (por exemplo, item de lutador para assassino).',
  'Pense na classe e no tipo de dano do campeão antes de qualquer item: o item tem que combinar com o que o campeão faz.',
  'Não dê ordens em tempo real como "ganke a rota X agora" ou "faça o dragão agora": as regras da Riot proíbem apps que tomam decisões pelo jogador.',
  'Se pedirem isso, explique o princípio geral (ex.: rotas com aliado em vantagem e inimigo sem fuga são boas para ganks) e deixe a decisão com o jogador.',
].join(' ');

const SHARDS = [
  { row: 'Ofensivo', options: [[5008, 'Força Adaptativa'], [5005, 'Velocidade de Ataque'], [5007, 'Aceleração de Habilidade']] },
  { row: 'Flex', options: [[5008, 'Força Adaptativa'], [5010, 'Velocidade de Movimento'], [5001, 'Vida Escalável']] },
  { row: 'Defensivo', options: [[5011, 'Vida'], [5013, 'Tenacidade'], [5001, 'Vida Escalável']] },
];

// Quando o Google aposenta um modelo, o erro 404 diz qual usar: "...use models/gemini-x-flash...".
function suggestedModel(body) {
  return body.match(/use\s+models\/([\w.-]+)/i)?.[1] || null;
}

const TIMEOUT_MS = 20000;
// Reservas para quando o modelo escolhido está lotado, travado ou foi aposentado.
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];

function retryable(message, extra = {}) {
  return Object.assign(new Error(message), { retry: true }, extra);
}

function createCoach(config, { onModelChange } = {}) {
  const enabled = !!config.geminiApiKey && !config.geminiApiKey.startsWith('COLE_');
  let model = config.geminiModel;

  async function callModel(name, contents, json) {
    let res;
    try {
      res = await fetch(`${API}/${name}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: PERSONA }] },
          contents,
          generationConfig: json ? { responseMimeType: 'application/json' } : {},
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (err.name === 'TimeoutError') throw retryable(`O ${name} não respondeu em ${TIMEOUT_MS / 1000}s.`);
      throw new Error('Sem conexão com o Gemini. Confira sua internet.');
    }
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error('Limite gratuito do Gemini atingido. Espere um pouco.');
      if (res.status === 400 && /api key/i.test(body)) throw new Error('Chave do Gemini inválida. Copie de novo do Google AI Studio.');
      if (res.status === 403) throw new Error('Essa chave não tem permissão para usar o Gemini.');
      if (res.status === 404) throw retryable(`O modelo ${name} não está disponível.`, { suggest: suggestedModel(body) });
      if (res.status >= 500) throw retryable(`O ${name} está sobrecarregado.`);
      throw new Error(`Gemini respondeu ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
    if (!text) throw new Error('O Gemini não respondeu nada.');
    return text;
  }

  // Tenta o modelo atual e, se ele falhar de um jeito passageiro, os de reserva.
  async function generate(contents, { json = false } = {}) {
    if (!enabled) throw new Error('Coloque sua chave do Gemini na janela do Shaco IA.');
    const queue = [model, ...FALLBACK_MODELS];
    const tried = new Set();
    let lastErr = null;
    while (queue.length) {
      const name = queue.shift();
      if (tried.has(name)) continue;
      tried.add(name);
      try {
        const text = await callModel(name, contents, json);
        if (name !== model) {
          model = name;
          onModelChange?.(name);
        }
        return text;
      } catch (err) {
        if (!err.retry) throw err;
        lastErr = err;
        if (err.suggest) queue.unshift(err.suggest);
      }
    }
    throw new Error(`Nenhum modelo do Gemini respondeu agora (${lastErr.message}) Tente de novo em alguns minutos.`);
  }

  const history = [];

  async function ask(question, context) {
    const contents = [
      ...history,
      { role: 'user', parts: [{ text: `Situação da partida (placar):\n${context}\n\nPergunta: ${question}` }] },
    ];
    const answer = await generate(contents);
    // guarda só a pergunta, para o contexto da partida não se acumular no histórico
    history.push({ role: 'user', parts: [{ text: question }] }, { role: 'model', parts: [{ text: answer }] });
    if (history.length > 12) history.splice(0, history.length - 12);
    return answer;
  }

  function resetChat() {
    history.length = 0;
  }

  async function startPlan(context, position, mode) {
    const prompt = planPrompt(mode, position);
    return generate([{ role: 'user', parts: [{ text: `Situação:\n${context}\n\n${prompt}` }] }]);
  }

  // Seleção de campeões num modo sem runas (Arena, Swarm): dica do que priorizar.
  async function selectTip(mode, champion) {
    const text = `Modo de jogo: ${mode.label}. ${mode.rules}\n\n${selectPrompt(mode, champion)}`;
    return generate([{ role: 'user', parts: [{ text }] }]);
  }

  // node: nó do grafo do campeão (build da Riot); com ele, o Gemini só escolhe entre os itens que o campeão usa
  async function suggestBuild({ champion, enemies, mode, node }, sd) {
    const catalog = node?.core.length ? championCatalog(node, sd) : buildCatalog(sd, mode.map);
    const prompt = [
      `Modo de jogo: ${mode.label}. ${mode.rules}`,
      node ? `Conhecimento do campeão:\n${graphContext(node)}` : '',
      `Monte a build de ${champion} para este modo${node ? ', partindo da build mais usada e adaptando os situacionais à composição inimiga' : ''}.`,
      enemies.length ? `Inimigos já escolhidos: ${enemies.join(', ')}.` : '',
      'Use só IDs desta lista (id:nome):',
      catalogText(catalog, sd),
      'Responda só com JSON: {"start":[ids iniciais, até 2, vazio se o modo não tiver],"boots":[id ou vazio],"core":[3 a 4 ids na ordem de compra],"situational":[até 3 ids],"explain":"uma frase"}',
    ].join('\n');
    const text = await generate([{ role: 'user', parts: [{ text: prompt }] }], { json: true });
    return validateBuild(JSON.parse(text), catalog, sd);
  }

  // Lista de campeões para a seleção (counters para banir, meta da rota). Só nomes desta lista.
  async function suggestChampions({ question, mode, names, count = 5 }) {
    const prompt = [
      `Modo de jogo: ${mode.label}. ${mode.rules}`,
      question,
      `Use só nomes desta lista: ${names.join(', ')}.`,
      `Responda só com JSON: {"champions":[até ${count} nomes, do mais forte para o menos],"explain":"uma frase curta"}`,
    ].join('\n');
    const text = await generate([{ role: 'user', parts: [{ text: prompt }] }], { json: true });
    const raw = JSON.parse(text);
    return { names: Array.isArray(raw.champions) ? raw.champions.map(String) : [], explain: String(raw.explain || '') };
  }

  // Depois da partida: o que foi bem e 3 pontos práticos para melhorar, a partir dos números.
  async function reviewGame(summaryText) {
    const prompt = [
      'A partida acabou. Estes são os meus números:',
      summaryText,
      'Avalie como um treinador honesto. Dê exatamente 3 pontos para melhorar, curtos e práticos, ligados a esses números (farm, visão, mortes cedo, itens), e uma coisa que fui bem.',
      'Responda só com JSON: {"good":"uma frase","points":["ponto 1","ponto 2","ponto 3"]}',
    ].join('\n');
    const text = await generate([{ role: 'user', parts: [{ text: prompt }] }], { json: true });
    const raw = JSON.parse(text);
    const points = (Array.isArray(raw.points) ? raw.points : []).map(String).filter(Boolean).slice(0, 3);
    if (!points.length) throw new Error('O Gemini não mandou os pontos da partida.');
    return { good: String(raw.good || ''), points };
  }

  // Melhores Aumentos do campeão no modo (Arena, ARAM: Desordem), 2 por raridade, só da lista do modo.
  async function suggestAugments({ champion, mode, pool }) {
    const names = (tier) => pool.filter((a) => a.tier === tier).map((a) => a.name).join('; ');
    const prompt = [
      `Modo de jogo: ${mode.label}. ${mode.rules}`,
      `Quais os melhores Aumentos para ${champion} neste modo? Pense no tipo de dano, nas habilidades e no papel do campeão.`,
      `Prismáticos: ${names('prismatic')}`,
      `Ouro: ${names('gold')}`,
      `Prata: ${names('silver')}`,
      'Use só nomes exatamente como nas listas acima.',
      'Responda só com JSON: {"prismatic":[2 nomes],"gold":[2 nomes],"silver":[2 nomes],"explain":"uma frase curta"}',
    ].join('\n');
    const text = await generate([{ role: 'user', parts: [{ text: prompt }] }], { json: true });
    const raw = JSON.parse(text);
    return { prismatic: raw.prismatic, gold: raw.gold, silver: raw.silver, explain: String(raw.explain || '') };
  }

  async function suggestSkills({ champion, position, enemies = [], mode, spells }) {
    const names = spells ? ` (Q: ${spells.Q.name}, W: ${spells.W.name}, E: ${spells.E.name}, R: ${spells.R.name})` : '';
    const prompt = [
      `Modo de jogo: ${mode.label}. ${mode.rules}`,
      `Qual a ordem de habilidades de ${champion}${names}${position && mode.lanes ? ` na posição ${position}` : ''}?`,
      enemies.length ? `Inimigos: ${enemies.join(', ')}.` : '',
      'Responda só com JSON: {"start":[as 3 primeiras habilidades, ex. "Q","W","E"],"max":[ordem para maximizar Q, W e E, ex. "Q","E","W"],"explain":"uma frase curta"}',
    ].join('\n');
    const text = await generate([{ role: 'user', parts: [{ text: prompt }] }], { json: true });
    return validateSkills(JSON.parse(text));
  }

  async function suggestRunes({ champion, position, enemies, mode }, runeTrees) {
    const trees = runeTrees.map((t) => ({
      id: t.id,
      name: t.name,
      slots: t.slots.map((s) => s.runes.map((r) => ({ id: r.id, name: r.name }))),
    }));
    const prompt = [
      `Modo de jogo: ${mode.label}. ${mode.rules}`,
      `Sugira as runas para ${champion} neste modo${position && mode.lanes ? `, na posição ${position}` : ''}.`,
      enemies.length ? `Inimigos já escolhidos: ${enemies.join(', ')}.` : '',
      'Use só os IDs desta lista de árvores (slots[0] são as runas-chave):',
      JSON.stringify(trees),
      'Fragmentos (um por linha): ' + JSON.stringify(SHARDS.map((s) => s.options.map(([id]) => id))),
      'Responda só com JSON: {"primaryStyleId":n,"subStyleId":n,"primary":[runaChave,slot1,slot2,slot3],"secondary":[a,b],"shards":[ofensivo,flex,defensivo],"explain":"uma frase"}',
    ].join('\n');
    const text = await generate([{ role: 'user', parts: [{ text: prompt }] }], { json: true });
    return validateRunes(JSON.parse(text), runeTrees);
  }

  return {
    enabled,
    ask,
    resetChat,
    startPlan,
    selectTip,
    suggestBuild,
    suggestRunes,
    suggestSkills,
    suggestChampions,
    suggestAugments,
    reviewGame,
    get model() {
      return model;
    },
  };
}

// Confere se a página de runas é válida; o modelo às vezes inventa combinações.
function validateRunes(page, runeTrees) {
  const primary = runeTrees.find((t) => t.id === page.primaryStyleId);
  const sub = runeTrees.find((t) => t.id === page.subStyleId);
  if (!primary || !sub || primary.id === sub.id) throw new Error('Árvores de runas inválidas');

  const slotOf = (tree, id) => tree.slots.findIndex((s) => s.runes.some((r) => r.id === id));
  if (!Array.isArray(page.primary) || page.primary.length !== 4) throw new Error('Runas primárias inválidas');
  page.primary.forEach((id, i) => {
    if (slotOf(primary, id) !== i) throw new Error(`Runa ${id} fora do lugar`);
  });

  if (!Array.isArray(page.secondary) || page.secondary.length !== 2) throw new Error('Runas secundárias inválidas');
  const subSlots = page.secondary.map((id) => slotOf(sub, id));
  if (subSlots.some((s) => s < 1) || subSlots[0] === subSlots[1]) throw new Error('Runas secundárias inválidas');

  if (!Array.isArray(page.shards) || page.shards.length !== 3) throw new Error('Fragmentos inválidos');
  page.shards.forEach((id, i) => {
    if (!SHARDS[i].options.some(([opt]) => opt === id)) throw new Error('Fragmento inválido');
  });

  const runeById = new Map(runeTrees.flatMap((t) => t.slots.flatMap((s) => s.runes)).map((r) => [r.id, r]));
  const describe = (id) => ({ id, name: runeById.get(id).name, icon: `https://ddragon.leagueoflegends.com/cdn/img/${runeById.get(id).icon}` });

  return {
    primaryStyleId: primary.id,
    subStyleId: sub.id,
    primaryName: primary.name,
    subName: sub.name,
    primary: page.primary.map(describe),
    secondary: page.secondary.map(describe),
    shards: page.shards.map((id, i) => ({ id, name: SHARDS[i].options.find(([opt]) => opt === id)[1] })),
    explain: String(page.explain || ''),
    selectedPerkIds: [...page.primary, ...page.secondary, ...page.shards],
  };
}

module.exports = { createCoach, validateRunes };
