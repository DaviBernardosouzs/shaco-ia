# Shaco IA

Overlay para League of Legends que conversa com você (por voz e texto) e mostra, em tempo real:

- **Runas** na seleção de campeões, com um botão que cria a página no cliente.
- **Plano inicial** quando a partida começa (rota de limpeza da selva ou plano da fase de rotas).
- **Itens situacionais** contra a composição inimiga (dano físico/mágico, cura, tanques). Avisa quando você já tem ouro e, quando você morre, diz o que comprar.
- **Comparação de rotas**: ouro em itens, nível e KDA de cada rota, com quem está na frente ou atrás.
- **Chat**: pergunte qualquer coisa (matchup, item, como jogar contra alguém) e o Shaco responde em voz alta.

## Instalar

Ninguém precisa instalar Node: o app já leva tudo dentro dele. Escolha uma das duas versões em `dist/`:

- **`ShacoIA-Setup.exe`**: instalador. Cria atalhos na Área de Trabalho e no menu Iniciar e aparece em "Adicionar ou remover programas" para desinstalar.
- **`ShacoIA.exe`**: portátil. É só abrir, sem instalar.

Como o app não é assinado digitalmente, o Windows pode mostrar "O Windows protegeu o computador".
Clique em **Mais informações** e depois em **Executar assim mesmo**.

## Primeiro uso

Na janela do Shaco IA:

1. Clique em **Como pegar uma chave grátis**, crie a chave do Gemini e cole no campo.
2. Clique em **Testar**.
3. Se o LoL não estiver em `C:\Riot Games\League of Legends`, clique em **Procurar** e escolha a pasta.

Fechar a janela deixa o Shaco rodando na bandeja do Windows (perto do relógio). Para sair de vez,
clique com o botão direito no ícone e escolha **Sair**. As configurações ficam em `%APPDATA%\Shaco IA\config.json`.

## Desenvolvimento

```bash
npm install
npm start               # modo real
npm run mock            # partida simulada
npm run mock-select     # seleção de campeões simulada
npm test
npm run dist            # gera dist/ShacoIA.exe
```

O `npm run dist` precisa rodar numa pasta de caminho curto (o NSIS não aceita caminhos com mais de 260 caracteres).

**No LoL, use o modo de janela "Sem bordas" (Borderless).** Em tela cheia exclusiva nenhum overlay aparece.

| Atalho | Ação |
| --- | --- |
| Ctrl+Shift+A | Abrir o chat (Enter envia, Esc fecha) |
| Ctrl+Shift+M | Ligar/desligar a voz |
| Ctrl+Shift+S | Mostrar/esconder |

Para mover o painel, arraste pelo topo. Depois de usar o chat, clique no jogo para ele voltar a receber o teclado.

## Como funciona

- **Partida**: Live Client Data API oficial (`https://127.0.0.1:2999`), que só traz o que você vê no placar (Tab).
- **Seleção de campeões e runas**: API local do cliente (LCU), a mesma que Blitz e Porofessor usam. O Shaco IA só apaga ou substitui páginas de runas com nome começando por "Shaco IA".
- **Itens, campeões e runas**: Data Dragon da Riot, em pt-BR, atualizado a cada patch.
- **Conversa**: Gemini. A voz usa a síntese de voz do Windows (voz pt-BR).

## Regras da Riot

As regras da Riot para apps de terceiros proíbem mostrar informação escondida (posição do inimigo,
recarga de feitiços, timers de monstros) e dar ordens em tempo real como "ganke o meio agora".
Por isso o Shaco IA fala de itens, runas, matchups e plano inicial, mas não manda gankar nem fazer objetivo:
ele mostra quais rotas estão na frente ou atrás e a decisão fica com você.
Mesmo assim, use por sua conta e risco.
