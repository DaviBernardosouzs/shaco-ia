// Ordem de habilidades: o Gemini diz quais 3 subir primeiro e a prioridade de maximizar;
// daqui sai a sequência dos 18 níveis e qual habilidade subir agora.
const BASIC = ['Q', 'W', 'E'];
const ULT_LEVELS = new Set([6, 11, 16]);

function validateSkills(raw) {
  const max = (Array.isArray(raw.max) ? raw.max : []).map((k) => String(k).toUpperCase()).filter((k) => BASIC.includes(k));
  const order = [...new Set(max)];
  if (order.length < 2) throw new Error('Ordem de habilidades inválida');
  BASIC.forEach((k) => !order.includes(k) && order.push(k));
  const start = (Array.isArray(raw.start) ? raw.start : []).map((k) => String(k).toUpperCase()).filter((k) => BASIC.includes(k)).slice(0, 3);
  return { max: order, start, explain: String(raw.explain || '') };
}

// 18 letras, uma por nível. Habilidade básica nunca passa de metade do nível (regra do jogo) nem de 5 pontos.
function skillSequence({ max, start = [] }) {
  const count = { Q: 0, W: 0, E: 0, R: 0 };
  const seq = [];
  for (let lvl = 1; lvl <= 18; lvl++) {
    const cap = Math.min(5, Math.ceil(lvl / 2));
    let pick = null;
    if (ULT_LEVELS.has(lvl)) pick = 'R';
    else if (lvl <= 3 && start[lvl - 1] && count[start[lvl - 1]] < cap) pick = start[lvl - 1];
    else pick = max.find((k) => count[k] < cap) || max[0];
    count[pick]++;
    seq.push(pick);
  }
  return seq;
}

// Qual habilidade subir agora, comparando o que a pessoa já subiu com a sequência
// (se ela fugiu do plano, aponta o que falta para voltar a ele). null = sem ponto livre.
function nextSkill(sequence, abilities, level) {
  if (!abilities || !level) return null;
  const actual = Object.fromEntries(['Q', 'W', 'E', 'R'].map((k) => [k, abilities[k]?.abilityLevel || 0]));
  const spent = actual.Q + actual.W + actual.E + actual.R;
  if (spent >= level) return null;
  // limites do jogo neste nível: ult nos níveis 6, 11 e 16; básica até metade do nível
  const cap = (k) => (k === 'R' ? (level >= 16 ? 3 : level >= 11 ? 2 : level >= 6 ? 1 : 0) : Math.min(5, Math.ceil(level / 2)));
  const expected = { Q: 0, W: 0, E: 0, R: 0 };
  for (const k of sequence.slice(0, level)) {
    expected[k]++;
    if (expected[k] > actual[k] && actual[k] < cap(k)) return k;
  }
  return null;
}

module.exports = { validateSkills, skillSequence, nextSkill };
