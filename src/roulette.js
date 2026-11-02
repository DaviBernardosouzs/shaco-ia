// Roleta do caos: campeão, 5 itens completos, botas e habilidade para maximizar, tudo no sorteio.
// Para partidas normais com os amigos (a graça é a build não fazer sentido).
const { buildCatalog } = require('./build');

const sample = (list, n, rnd) => {
  const pool = [...list];
  const out = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
};

function chaosRoulette(sd, rnd = Math.random) {
  const champs = Object.values(sd.champions);
  const icon = (c) => `${sd.imgBase}/champion/${c.image.full}`;
  const catalog = buildCatalog(sd, 11);
  const item = (id) => ({ id, name: sd.items[id].name, icon: `${sd.imgBase}/item/${id}.png` });
  const champ = champs[Math.floor(rnd() * champs.length)];
  return {
    champion: { id: champ.id, name: champ.name, title: champ.title, icon: icon(champ) },
    items: sample(catalog.complete, 5, rnd).map(item),
    boots: item(sample(catalog.boots, 1, rnd)[0]),
    max: ['Q', 'W', 'E'][Math.floor(rnd() * 3)],
    // rostos que passam na tela enquanto a roleta gira
    spin: sample(champs, 18, rnd).map(icon),
  };
}

module.exports = { chaosRoulette };
