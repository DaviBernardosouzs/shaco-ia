// Modos de jogo: o que existe em cada um e como o Shaco orienta.
// gameMode vem da Live Client API (gameData.gameMode) ou do cliente (gameflow).

const MODES = {
  CLASSIC: {
    label: "Summoner's Rift",
    map: 11,
    lanes: true,
    runes: true,
    items: true,
    rules: 'Mapa clássico 5x5 com rotas, selva, sentinelas, dragões, Arauto, Vastilarvas e Barão. Compra itens na base.',
  },
  ARAM: {
    label: 'ARAM',
    map: 12,
    lanes: false,
    runes: true,
    items: true,
    rules: 'ARAM: uma rota só, 5x5, campeões aleatórios, sem selva e sem sentinelas. Só dá para comprar itens quando morre ou no começo. Pacotes de vida aparecem na rota.',
  },
  CHERRY: {
    label: 'Arena',
    map: 30,
    lanes: false,
    runes: false,
    items: true,
    rules: 'Arena: duplas lutam rodadas 2x2 contra outras duplas. Não existem runas, rotas, selva, sentinelas nem objetivos. Entre as rodadas cada jogador escolhe Aumentos e compra itens. O anel de fogo fecha a arena durante a rodada.',
  },
  KIWI: {
    label: 'ARAM: Desordem',
    map: 12,
    lanes: false,
    runes: true,
    items: true,
    rules: 'ARAM: Desordem: ARAM numa rota só, 5x5, campeões aleatórios, com Aumentos escolhidos ao subir de nível durante a partida. Sem selva e sem sentinelas.',
  },
  URF: {
    label: 'URF',
    map: 11,
    lanes: true,
    runes: true,
    items: true,
    rules: 'URF: mapa clássico com recarga de habilidades muito curta e mana infinita. Lutas acontecem o tempo todo.',
  },
  ARURF: {
    label: 'ARURF',
    map: 11,
    lanes: true,
    runes: true,
    items: true,
    rules: 'URF com campeões aleatórios: recarga de habilidades muito curta e mana infinita.',
  },
  ONEFORALL: {
    label: 'Um por Todos',
    map: 11,
    lanes: true,
    runes: true,
    items: true,
    rules: 'Um por Todos: os cinco jogadores do time usam o mesmo campeão no mapa clássico.',
  },
  STRAWBERRY: {
    label: 'Swarm',
    map: 33,
    lanes: false,
    runes: false,
    items: false,
    rules: 'Swarm: modo cooperativo contra monstros, sem runas e sem a loja normal. As melhorias vêm durante a partida.',
  },
  PRACTICETOOL: {
    label: 'Ferramenta de Treino',
    map: 11,
    lanes: true,
    runes: true,
    items: true,
    rules: 'Ferramenta de Treino: partida sozinho para treinar combos, rotas da selva e builds.',
  },
};

function modeFor(gameMode, mapNumber) {
  const key = String(gameMode || 'CLASSIC').toUpperCase();
  // variantes do ARAM: Desordem (KIWI_JADE...) usam as regras do KIWI
  const known = MODES[key] || (key.startsWith('KIWI') ? MODES.KIWI : null);
  if (known) return { key, ...known };
  // modo novo ou de evento: usa o mapa informado e não supõe rotas
  return {
    key,
    label: gameMode,
    map: mapNumber || 11,
    lanes: mapNumber === 11,
    runes: true,
    items: true,
    rules: `Modo ${gameMode}. Considere as regras desse modo, que podem ser diferentes do mapa clássico.`,
  };
}

// Dicas fixas por modo (as do Gemini vêm à parte, pelo chat e pela voz).
function modeTips(mode, minutes, me) {
  switch (mode.key) {
    case 'ARAM':
      return [
        'Você só compra quando morre: guarde o ouro para o primeiro item da lista.',
        minutes < 8
          ? 'Pegue os pacotes de vida só quando precisar. Eles demoram a voltar.'
          : 'Atrás no placar? Lute perto da sua torre e espere o time inimigo avançar.',
      ];
    case 'CHERRY':
      return [
        'Escolha Aumentos que reforcem o seu tipo de dano principal.',
        'Fique perto do seu parceiro: quem isola um inimigo ganha a rodada.',
        'No fim da rodada o anel de fogo fecha. Não lute encostado nele.',
      ];
    case 'URF':
    case 'ARURF':
      return ['Use as habilidades sem medo: a recarga é curta e a mana é infinita.'];
    case 'STRAWBERRY':
      return ['Fique sempre em movimento e junte experiência antes de enfrentar o chefe.'];
    default: {
      if (!mode.lanes) return [];
      const tips = [];
      if (minutes < 14) tips.push('Fase de rotas: priorize farm e não esqueça das sentinelas.');
      else if (minutes < 25) tips.push('Meio de jogo: ande com o time perto dos objetivos.');
      else tips.push('Fim de jogo: uma luta decide tudo. Não seja pego sozinho.');
      if (me.position === 'JUNGLE' && minutes < 3) tips.push('Comece pelo lado da selva onde seu campeão limpa mais rápido.');
      // depois da fase de rotas: como os times costumam rotacionar (princípio geral, a decisão é do jogador)
      if (minutes >= 14 && minutes < 20 && ROTATION_TIPS[me.position]) tips.push(ROTATION_TIPS[me.position]);
      return tips;
    }
  }
}

const ROTATION_TIPS = {
  BOTTOM: 'Fim da fase de rotas: é comum a dupla de baixo ir para o meio depois que a torre externa de baixo cai, para pressionar perto do dragão.',
  UTILITY: 'Fim da fase de rotas: é comum o suporte acompanhar o atirador para o meio e colocar sentinelas perto dos próximos objetivos.',
  MIDDLE: 'Fim da fase de rotas: quando a dupla de baixo sobe para o meio, o meio costuma trocar e segurar a rota de baixo.',
  TOP: 'Fim da fase de rotas: o topo costuma ajudar outras rotas e objetivos com Teleporte ou empurrando a rota lateral.',
};

// Pedido de plano no começo da partida, de acordo com o modo.
function planPrompt(mode, position) {
  switch (mode.key) {
    case 'ARAM':
      return 'A partida de ARAM começou. Qual a primeira compra para o meu campeão, como jogar as lutas em equipe e o que evitar?';
    case 'CHERRY':
      return 'A Arena começou. Que tipo de Aumento e de item eu priorizo com meu campeão, e como jogar com meu parceiro nas rodadas?';
    case 'STRAWBERRY':
      return 'O Swarm começou. Que melhorias priorizar com meu campeão e como sobreviver às ondas?';
    default:
      if (position === 'JUNGLE') return 'A partida começou e eu sou o caçador. Qual rota de limpeza inicial você recomenda para o meu campeão e por quê?';
      if (mode.lanes) return 'A partida começou. Me dê o plano da fase de rotas para o meu campeão contra o meu oponente direto.';
      return `A partida de ${mode.label} começou. Me dê o plano para o meu campeão neste modo.`;
  }
}

// Seleção de campeões em modo sem runas: o que vale preparar.
function selectPrompt(mode, champion) {
  if (mode.key === 'CHERRY') return `Vou jogar Arena com ${champion}. Arena não tem runas. Quais Aumentos e itens priorizar e como jogar esse campeão nas rodadas?`;
  return `Vou jogar ${mode.label} com ${champion}. Esse modo não usa runas. O que eu priorizo e como jogo esse campeão aqui?`;
}

module.exports = { modeFor, modeTips, planPrompt, selectPrompt };
