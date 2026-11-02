// Configuração do usuário: config.json na pasta de dados do app (%APPDATA%\shaco-ia).
// Em desenvolvimento, um config.json na pasta do projeto também é lido.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  geminiApiKey: '',
  geminiModel: 'gemini-3.5-flash-lite',
  voice: true,
  voiceStyle: 'shaco', // 'shaco' (Windows, grave e lento), 'gemini' (expressiva) ou 'natural'
  geminiVoice: 'Algenib',
  voicePitch: 0.6,
  voiceRate: 0.9,
  leaguePath: 'C:\\Riot Games\\League of Legends',
  autoAccept: false,
  autoBuild: true,
  autoRunes: false,
  autoSpells: false,
  flashKey: 'D', // tecla do Flash: 'D' ou 'F'
  overlayScale: 1,
  overlayOpacity: 0.9,
  overlayCompact: false,
  tutorialDone: false, // tutorial da primeira abertura já visto
  spotifyPlaylist: false, // ao travar o campeão, abre playlists dele no Spotify
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function loadConfig(dataDir) {
  const devFile = readJson(path.join(__dirname, '..', 'config.json'));
  const userFile = readJson(path.join(dataDir, 'config.json'));
  const config = { ...DEFAULTS, ...devFile, ...userFile };
  // modelos aposentados ou que viviam travando: volta para o padrão rápido
  if (/^gemini-(2\.5|3\.8-flash$)/.test(config.geminiModel)) config.geminiModel = DEFAULTS.geminiModel;
  if (process.env.GEMINI_API_KEY) config.geminiApiKey = process.env.GEMINI_API_KEY;
  return config;
}

function saveConfig(dataDir, config) {
  const clean = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, config[k] ?? DEFAULTS[k]]));
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(clean, null, 2));
  return clean;
}

module.exports = { loadConfig, saveConfig, DEFAULTS };
