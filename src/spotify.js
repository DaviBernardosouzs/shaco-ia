// Playlist do campeão: abre a busca de playlists do Spotify com o nome do campeão.
// Com o app do Spotify instalado vai direto nele; sem, abre o Spotify Web já na aba de playlists.
// (Tocar a primeira playlist sozinho precisaria da API do Spotify com login da conta.)

function playlistLinks(champion) {
  const q = encodeURIComponent(String(champion).trim());
  return {
    app: `spotify:search:${encodeURIComponent(`${String(champion).trim()} playlist`)}`,
    web: `https://open.spotify.com/search/${q}/playlists`,
  };
}

// hasApp: o Windows tem algum programa registrado para links spotify:
async function openPlaylist(champion, { shell, hasApp }) {
  const { app, web } = playlistLinks(champion);
  if (hasApp) {
    try {
      await shell.openExternal(app);
      return 'app';
    } catch {}
  }
  await shell.openExternal(web);
  return 'web';
}

module.exports = { playlistLinks, openPlaylist };
