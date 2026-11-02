# Shaco IA

Assistente de League of Legends com a cara do Shaco: um painel por cima do jogo e uma janela (launcher) com tudo para você jogar melhor, e rir no caminho.

## Baixar

**[⬇️ Baixar a versão mais recente](https://github.com/DaviBernardosouzs/shaco-ia/releases/latest)** e escolha:

- **`ShacoIA-Setup.exe`**: instalador (recomendado). Cria atalhos, aparece em "Adicionar ou remover programas" e **se atualiza sozinho** quando sai versão nova.
- **`ShacoIA.exe`**: portátil. É só abrir, sem instalar (não se atualiza sozinho).

Não precisa instalar mais nada. Funciona no Windows 10 e 11.

> **O Windows pode mostrar "O Windows protegeu o computador".** O app não tem assinatura digital (o certificado é pago).
> Clique em **Mais informações** e depois em **Executar assim mesmo**. É só na primeira vez.

## Primeiro uso

Na primeira vez que abre, o Shaco mostra um tutorial. Em resumo:

1. **Chave do Gemini (grátis):** clique em "Pegar uma chave grátis no Google AI Studio", cole a chave e aperte **Salvar**. O certinho verde mostra que deu certo.
2. **Pasta do LoL:** se o jogo não estiver em `C:\Riot Games\League of Legends`, escolha a pasta na aba **Jogo**.
3. **No LoL, use o modo de vídeo "Sem bordas".** Em tela cheia exclusiva nenhum overlay aparece.
4. **Moldura das habilidades:** na primeira partida, ajuste na aba **Painel**.

Fechar a janela deixa o Shaco na bandeja do Windows, perto do relógio. Para sair, botão direito no ícone → **Sair**.

## O que ele faz

**Seleção de campeões**
- Página de runas **temporária**, criada na hora e removida no fim da partida.
- **Build na loja** a partir da build mais usada do campeão (recomendação da própria Riot), adaptada à composição inimiga.
- Ordem das habilidades, counters para banir, meta da rota e melhores supports quando você é atirador.
- Melhores **Aumentos** na Arena e no ARAM: Desordem.
- Opcional: abre playlists do seu campeão no Spotify.

**Durante a partida**
- Itens que combinam com o seu campeão, ordem das habilidades com moldura em cima do Q/W/E/R.
- Farm e visão por minuto, tempo até os objetivos, quem está vivo e rotas na frente ou atrás.
- Reações animadas do Shaco: abates, multiabates, First Blood, torres, dragões, Barão, vitória, derrota, dança (Ctrl+3) e mais.
- Chat e voz: pergunte qualquer coisa sobre o jogo.
- Painel minimizável (botão **−** no canto).

**Depois da partida**
- Resumo com 3 pontos para melhorar (IA) e histórico na aba **Partidas**.
- **Desafio do dia** com sequência de dias 🔥.

**Diversão:** roleta do caos com campeão e build aleatórios, falas do Shaco ao clicar nele.

| Atalho | Ação |
| --- | --- |
| Ctrl+Shift+A | Abrir o chat (Enter envia, Esc fecha) |
| Ctrl+Shift+M | Ligar/desligar a voz |
| Ctrl+Shift+S | Mostrar/esconder o painel |

## Regras da Riot

O Shaco IA só usa as APIs oficiais e locais do jogo (Live Client Data e o cliente do LoL), as mesmas de apps como Blitz e Porofessor.
Ele **não** mostra informação escondida (posição do inimigo, recarga de feitiços inimigos, timers de campos da selva) e **não dá ordens** como "ganke o meio agora": mostra o que o placar já mostra e a decisão fica com você.
Os tempos de Dragão, Arauto e Barão são os mesmos que o próprio jogo exibe.
Mesmo assim, use por sua conta e risco. O Shaco IA não é afiliado à Riot Games.

## Desenvolvimento

```bash
npm install
npm start               # modo real
npm run mock            # partida simulada
npm run mock-select     # seleção de campeões simulada
npm test
npm run dist            # gera dist/ShacoIA-Setup.exe e dist/ShacoIA.exe
npm run cofre           # atualiza as builds por classe e o cofre do Obsidian (uma vez por patch)
```

### Publicar uma versão

1. Suba a versão no `package.json` (por exemplo, `0.3.0`) e faça o commit.
2. Crie e envie a tag: `git tag v0.3.0` e `git push origin v0.3.0`.
3. O GitHub Actions monta o instalador num Windows limpo e publica na Release. Quem já instalou recebe a atualização sozinho.
