// LCU: API local do cliente do LoL (fora da partida). Usada para ler a seleção de
// campeões e criar a página de runas, como fazem Blitz e Porofessor.
const https = require('https');
const fs = require('fs');
const path = require('path');

const agent = new https.Agent({ rejectUnauthorized: false });
const PAGE_PREFIX = 'Shaco IA';

function readLockfile(leaguePath) {
  try {
    // formato: LeagueClient:pid:porta:senha:https
    const [, , port, password] = fs.readFileSync(path.join(leaguePath, 'lockfile'), 'utf8').split(':');
    return { port: Number(port), auth: Buffer.from(`riot:${password}`).toString('base64') };
  } catch {
    return null;
  }
}

function request(conn, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        host: '127.0.0.1',
        port: conn.port,
        path: pathname,
        method,
        agent,
        timeout: 2000,
        headers: {
          Authorization: `Basic ${conn.auth}`,
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`LCU ${res.statusCode}: ${data.slice(0, 200)}`));
          try {
            resolve(data ? JSON.parse(data) : null);
          } catch {
            resolve(data);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// mock: false, ou o gameMode a simular na seleção ('CLASSIC', 'CHERRY'...)
// dataDir: onde guardar a cópia da página de runas emprestada
function createLcu({ leaguePath, mock = false, dataDir }) {
  if (mock) {
    // seleção simulada em três tempos: intenção no Shaco na fase de banimento (counters),
    // depois sem campeão escolhido (meta da rota) e, a partir de 20s, Shaco travado
    const startedAt = Date.now();
    return {
      getChampSelect: async () => {
        const t = (Date.now() - startedAt) / 1000;
        const stage = t < 10 ? 'ban' : t < 20 ? 'pick' : 'locked';
        return {
          championId: stage === 'pick' ? 0 : 35,
          locked: stage === 'locked',
          banPending: stage === 'ban',
          bannedIds: stage === 'ban' ? [] : [64],
          position: mock === 'CLASSIC' ? 'jungle' : '',
          enemyChampionIds: stage === 'locked' ? [64, 103] : [],
          gameMode: mock,
          mapId: mock === 'CHERRY' ? 30 : 11,
        };
      },
      applyRunes: async () => {},
      acceptReadyCheck: async () => false,
      saveItemSet: async () => {},
      setSpells: async () => {},
      getPhase: async () => 'ChampSelect',
      cleanup: async () => true,
    };
  }

  const conn = () => readLockfile(leaguePath);

  async function getChampSelect() {
    const c = conn();
    if (!c) return null;
    const flow = await request(c, 'GET', '/lol-gameflow/v1/session').catch(() => null);
    if (flow?.phase !== 'ChampSelect') return null;
    const session = await request(c, 'GET', '/lol-champ-select/v1/session');
    const me = session.myTeam.find((p) => p.cellId === session.localPlayerCellId);
    if (!me) return null;
    // ações do draft: banir e escolher, cada uma marcada como concluída quando confirmada
    const actions = (session.actions || []).flat();
    const mine = actions.filter((a) => a.actorCellId === session.localPlayerCellId);
    const pick = mine.find((a) => a.type === 'pick');
    const ban = mine.find((a) => a.type === 'ban');
    return {
      // no draft o championId já aparece enquanto você passa o mouse; a intenção vem antes dos banimentos
      championId: me.championId || me.championPickIntent || 0,
      // sem ações (ARAM, partida personalizada às cegas): vale o campeão que já está no slot
      locked: pick ? !!pick.completed : !!me.championId,
      banPending: !!ban && !ban.completed,
      bannedIds: actions.filter((a) => a.type === 'ban' && a.completed && a.championId).map((a) => a.championId),
      position: me.assignedPosition || '',
      enemyChampionIds: (session.theirTeam || []).map((p) => p.championId).filter(Boolean),
      gameMode: flow.gameData?.queue?.gameMode || flow.map?.gameMode || 'CLASSIC',
      mapId: flow.gameData?.queue?.mapId || flow.map?.id || 11,
    };
  }

  // Página temporária, como o Blitz: criada ao travar o campeão e removida no fim da partida.
  // Sem espaço para uma página nova, pega emprestada a página atual e guarda uma cópia dela
  // em disco; a cópia volta no lugar no fim da partida (ou na próxima vez que o app abrir).
  const backupFile = dataDir && path.join(dataDir, 'runas-emprestadas.json');
  const readBackup = () => {
    try {
      return JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    } catch {
      return null;
    }
  };

  async function applyRunes(name, page) {
    const c = conn();
    if (!c) throw new Error('Cliente do LoL não encontrado');
    const body = {
      name: `${PAGE_PREFIX}: ${name}`.slice(0, 25),
      primaryStyleId: page.primaryStyleId,
      subStyleId: page.subStyleId,
      selectedPerkIds: page.selectedPerkIds,
      current: true,
    };
    const borrowed = readBackup();
    if (borrowed) {
      const ok = await request(c, 'PUT', `/lol-perks/v1/pages/${borrowed.id}`, { ...body, id: borrowed.id }).then(() => true, () => false);
      if (ok) return;
      fs.rmSync(backupFile, { force: true }); // a página emprestada não existe mais
    }
    // troca a página do Shaco IA que já existir; nunca apaga páginas suas
    const pages = await request(c, 'GET', '/lol-perks/v1/pages');
    const old = pages.find((p) => p.isDeletable && p.name.startsWith(PAGE_PREFIX));
    if (old) await request(c, 'DELETE', `/lol-perks/v1/pages/${old.id}`);
    try {
      await request(c, 'POST', '/lol-perks/v1/pages', body);
      return;
    } catch {}
    const target = pages.find((p) => p.current && p.isEditable) || pages.find((p) => p.isEditable && p.isDeletable);
    if (!target) throw new Error('Não achei uma página de runas editável no cliente.');
    const copy = { id: target.id, name: target.name, primaryStyleId: target.primaryStyleId, subStyleId: target.subStyleId, selectedPerkIds: target.selectedPerkIds };
    fs.writeFileSync(backupFile, JSON.stringify(copy));
    await request(c, 'PUT', `/lol-perks/v1/pages/${target.id}`, { ...body, id: target.id });
  }

  // Fase do cliente: None, Lobby, Matchmaking, ChampSelect, InProgress, EndOfGame...
  async function getPhase() {
    const c = conn();
    if (!c) return null;
    return request(c, 'GET', '/lol-gameflow/v1/gameflow-phase').catch(() => null);
  }

  // Desfaz o que foi temporário: devolve a página emprestada, apaga a página e o conjunto de itens do Shaco IA.
  async function cleanup() {
    const c = conn();
    if (!c) return false;
    const borrowed = readBackup();
    if (borrowed) {
      await request(c, 'PUT', `/lol-perks/v1/pages/${borrowed.id}`, borrowed).catch(() => {});
      fs.rmSync(backupFile, { force: true });
    }
    const pages = await request(c, 'GET', '/lol-perks/v1/pages');
    for (const p of pages.filter((p) => p.isDeletable && p.name.startsWith(PAGE_PREFIX) && p.id !== borrowed?.id)) {
      await request(c, 'DELETE', `/lol-perks/v1/pages/${p.id}`);
    }
    const me = await request(c, 'GET', '/lol-summoner/v1/current-summoner');
    const url = `/lol-item-sets/v1/item-sets/${me.summonerId}/sets`;
    const current = await request(c, 'GET', url);
    const others = (current.itemSets || []).filter((s) => !String(s.title).startsWith(PAGE_PREFIX));
    if (others.length !== (current.itemSets || []).length) {
      await request(c, 'PUT', url, { ...current, accountId: current.accountId ?? me.accountId, itemSets: others, timestamp: Date.now() });
    }
    return true;
  }

  // Aceita a partida quando a fila encontra jogo. Retorna true se aceitou agora.
  async function acceptReadyCheck() {
    const c = conn();
    if (!c) return false;
    const check = await request(c, 'GET', '/lol-matchmaking/v1/ready-check').catch(() => null);
    if (check?.state !== 'InProgress' || check.playerResponse !== 'None') return false;
    await request(c, 'POST', '/lol-matchmaking/v1/ready-check/accept');
    return true;
  }

  // Grava a build como conjunto de itens: aparece na aba de itens recomendados da loja.
  // Substitui só conjuntos criados pelo Shaco IA; os seus continuam lá.
  async function saveItemSet(itemSet) {
    const c = conn();
    if (!c) throw new Error('Cliente do LoL não encontrado');
    const me = await request(c, 'GET', '/lol-summoner/v1/current-summoner');
    const url = `/lol-item-sets/v1/item-sets/${me.summonerId}/sets`;
    const current = await request(c, 'GET', url);
    const others = (current.itemSets || []).filter((s) => !String(s.title).startsWith(PAGE_PREFIX));
    await request(c, 'PUT', url, {
      ...current,
      accountId: current.accountId ?? me.accountId,
      itemSets: [...others, itemSet],
      timestamp: Date.now(),
    });
  }

  // Troca os feitiços na seleção de campeões (spell1 = tecla D, spell2 = tecla F).
  async function setSpells(spell1Id, spell2Id) {
    const c = conn();
    if (!c) throw new Error('Cliente do LoL não encontrado');
    await request(c, 'PATCH', '/lol-champ-select/v1/session/my-selection', { spell1Id, spell2Id });
  }

  return { getChampSelect, applyRunes, acceptReadyCheck, saveItemSet, setSpells, getPhase, cleanup };
}

module.exports = { createLcu };
