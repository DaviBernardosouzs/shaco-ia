// Live Client Data API: servidor local que o próprio LoL abre durante a partida.
// Documentação: https://developer.riotgames.com/docs/lol#game-client-api
const https = require('https');
const fs = require('fs');
const path = require('path');

// O cliente usa certificado autoassinado; só aceitamos isso para 127.0.0.1:2999.
const agent = new https.Agent({ rejectUnauthorized: false });

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { host: '127.0.0.1', port: 2999, path: pathname, agent, timeout: 1500 },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// mock: false, ou o gameMode a simular ('CLASSIC', 'ARAM', 'CHERRY'...)
function createLiveClient({ mock = false } = {}) {
  if (mock) {
    const file = path.join(__dirname, '..', 'mock', 'allgamedata.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (mock !== true && mock !== 'CLASSIC') {
      const maps = { ARAM: 12, CHERRY: 30 };
      data.gameData = { ...data.gameData, gameMode: mock, mapNumber: maps[mock] || 11 };
      // fora do mapa clássico não há posições de rota
      data.allPlayers = data.allPlayers.map((p) => ({ ...p, position: '' }));
    }
    const startedAt = Date.now();
    const baseTime = data.gameData.gameTime;
    return {
      getAllGameData: async () => ({
        ...data,
        gameData: { ...data.gameData, gameTime: baseTime + (Date.now() - startedAt) / 1000 },
      }),
    };
  }
  return { getAllGameData: () => getJson('/liveclientdata/allgamedata') };
}

module.exports = { createLiveClient };
