# A Sinfonia da Terra: Earth Jukebox Multissensorial

Experiência web que transforma mapas de dados terrestres da NASA em **música instrumental em tempo real**, **vibração no smartphone** e **narração acessível**. É HTML, CSS e JavaScript puros (módulos ES), com Tone.js, PeerJS e QRCode.js via CDN. Não há etapa de build.

## Como executar

```bash
python3 servidor.py          # serve em http://localhost:8000 e na rede local
```

Abra `http://localhost:8000`. O `servidor.py` escuta em todas as interfaces e, se a porta 8000 estiver ocupada, usa a próxima livre. O QR Code do celular é montado **sozinho em qualquer computador**:

1. Se a página foi aberta por um endereço de rede ou HTTPS (ex.: `http://192.168.0.7:8000`), o QR usa esse mesmo endereço.
2. Em `localhost`, o app pergunta ao `servidor.py` (`/__lan`). Ele lista os IPs da máquina (Linux, macOS, Windows e WSL), ignora Docker, VPN e loopback e coloca a rede Wi-Fi/cabo primeiro. A detecção é refeita a cada QR gerado, então trocar de rede não exige reiniciar. Se houver mais de uma rede, o painel deixa escolher.
3. Com outro servidor estático (ex.: `python3 -m http.server`), o navegador tenta descobrir o IP pela WebRTC. Se não conseguir, basta digitar o IP no painel.

> **WSL2 em modo NAT:** o IP interno do WSL não é visível na rede. O `servidor.py` detecta isso, oferece o IP do Windows e imprime os comandos (`networkingMode=mirrored` ou `netsh portproxy`). Para forçar um endereço: `python3 servidor.py 8000 --url http://IP:8000`.

Na primeira execução é preciso internet: Tone.js, PeerJS, QRCode.js e as amostras dos instrumentos vêm de CDNs. Sem as amostras, o app usa instrumentos sintetizados.

O site abre em **inglês**; o botão **Português** no topo (ou a tecla `I`) troca o idioma de toda a interface e de todas as narrações. O idioma inicial fica em `config.json` → `acessibilidade.idioma`.

### Dados GMAO (pasta `dados/`)

Descompacte `dados.zip` na raiz para obter `dados/{temp,humidity,wind,co}_frames/frame_000000.jpg … frame_000371.jpg`. São 372 frames horários, de 30/out/2026 09:00 UTC a 14/nov/2026 20:00 UTC. Se a pasta existir, os cartões GMAO da galeria abrem a **sequência completa com linha do tempo**. Ao escolher um mapa, **todos os 372 frames começam a baixar** (6 por vez, a partir da hora inicial, com uma barra de progresso na linha do tempo). Eles ficam na memória como JPEG comprimido (~200 a 400 MB por mapa) e cada um só é decodificado quando aparece na tela; trocar de mapa libera os frames do anterior. Sem ela, abrem um frame de amostra (`assets/gmao_*.jpg`). A pasta e o zip ficam fora do git por causa do tamanho.

## Fluxo da experiência

1. **Galeria:** quatro mapas GMAO pré-carregados (temperatura, umidade, vento e CO). Cada mapa tem a **sua escala de cores própria e fixa** (não há como trocar a escala: a de um mapa não faria sentido em outro).
2. **Legenda:** diálogo modal com a barra de cores e o **instrumento do mapa**. Os sons dos lugares ficam escondidos e só aparecem (e são lidos) quando a pessoa aperta **Rever o tutorial dos sons dos lugares**. Passar o mouse sobre um cartão toca o som na hora; pelo teclado, cada cartão tem um botão **Ouvir**. Passar o mouse sobre a barra de cores toca o valor daquela posição. Fecha com `Escape` ou **clicando fora da janela** (volta à galeria); **Começar a explorar** abre o mapa.
3. **Exploração:** mouse, toque ou teclado sobre o mapa. **Clicar no mapa ou apertar Espaço fala o país e o valor da característica do mapa** (ex.: "Brasil. Temperatura 27,3 graus Celsius"). Em sequências, no **Play** da linha do tempo (tecla `P`) **são as mudanças de uma hora para a outra que geram os sons**. Não é um passeio: o cursor fica parado e não influencia o som (o som do cursor cala). A cada hora nova, o mapa é lido numa grade 24×12 e comparado com a hora anterior. Os pontos que mais mudaram (até 5 por hora, menos nas velocidades altas) tocam da esquerda para a direita, e o estéreo diz onde ficam. A nota é a do valor novo e chega por uma nota de apoio: de um degrau **abaixo** quando o valor aumentou (ex.: esquentou) e de um degrau **acima** quando diminuiu. Mudança maior toca mais forte, e uma hora sem mudança acima do ruído da leitura fica em silêncio. No mapa, um anel marca cada ponto (laranja = aumentou, azul = diminuiu). A volta do fim ao começo da sequência não toca. O aviso de início vai só para o leitor de tela, para a voz não pausar a música. A linha do tempo e o passeio não rodam juntos: começar um para o outro.

## Das cores aos números

As legendas oficiais (`referencias/escalas/*.jpeg`) foram amostradas coluna a coluna por `tools/extrair_escalas.py`, que gera `js/colormaps.js`. Cada posição da barra vira um valor físico de acordo com os rótulos:

| Escala | Faixa | Mapeamento da barra |
| --- | --- | --- |
| Temperatura T2M | −40 a 40 °C | linear |
| Umidade Q2M | 0 a 22 g/kg | linear |
| Vento | 0 a 40 m/s | linear; 0–3,4 m/s é transparente (ver abaixo) |
| CO | 40 a 500 ppbv | **não linear**: marcas 40/100/130/200/500 medidas nos pixels 72,5 / 188,5 / 279,5 / 370,5 / 463,5 |

No navegador, cada pixel é convertido para CIELAB e associado à cor mais próxima da barra, com projeção no segmento vizinho para obter um valor contínuo. A leitura usa a **mediana de uma janela 5×5**, o que elimina linhas de costa, fronteiras e ruído JPEG. O logotipo GMAO e o carimbo de data são mascarados.

Casos especiais:

- **Vento:** a faixa calma é transparente. No frame ela aparece como relevo cinza nos continentes ou fundo escuro no oceano. Pixels quase neutros contam como calmaria (< 4 m/s), e a transição púrpura sobre o oceano foi medida empiricamente.

Validação (`python3 tools/extrair_escalas.py --validar`, 12 mil pixels por variável): ΔE mediano de 1,0 a 2,3. O Pacífico equatorial lê 28,8 °C, a Antártida −39,7 °C, a umidade da Amazônia 19 g/kg e o CO no leste da China 311 ppbv.

## Configuração (`config.json`)

Tudo o que é ajustável fica em **`config.json`**, na raiz do projeto. O arquivo só muda **à mão**: edite, salve e recarregue a página. A interface não grava nada nele.

| Seção | O que controla |
| --- | --- |
| `mapeamento` | **Um instrumento por característica**: `TEMPERATURE` (piano), `HUMIDITY` (flauta), `WIND_SPEED` (harpa) e `CARBON_MONOXIDE` (marimba). O app avisa se duas características usarem o mesmo instrumento. |
| `instrumentos` | Para cada um dos 10 instrumentos: **`volumeDb`** (volume na mixagem) e a faixa de notas MIDI (`notaMaisGrave`, `notaMaisAguda`). O valor mais baixo do mapa toca a nota mais grave e o mais alto, a mais aguda. |
| `audio` | Volume geral inicial, tonalidade (`C` ou `G`), amostras gravadas (`usarAmostrasGravadas`), limitador e reverberação. |
| `paisagem` | Sons dos lugares: `ativo` e o `volumeDb` de `mar` (mais `periodoOndaS`), `gelo`, `floresta` e `deserto`. |
| `passeio` | Velocidade do passeio sonoro (`velocidade`, fração da largura do mapa por segundo; padrão 0,05). |
| `narracao` | Voz do site ligada ao abrir, pausa da música durante a fala, rampas, velocidade e volume da voz, leitura dos controles e leitura da legenda ao abrir. |
| `teclado` | Passo do cursor por toque de seta e passo com a seta segurada (sem Shift). |
| `vibracao` | Duração, intervalo e força dos pulsos do celular nos extremos frio e quente. |
| `acessibilidade` | Idioma inicial (`en` ou `pt`), tamanho do texto e alto contraste iniciais. |

Exemplo: para a temperatura tocar no contrabaixo, 6 dB mais baixo:

```json
"mapeamento":   { "TEMPERATURE": "DOUBLE_BASS" },
"instrumentos": { "DOUBLE_BASS": { "volumeDb": -6.5, "notaMaisGrave": 28, "notaMaisAguda": 52 } }
```

Chaves que começam com `_` são comentários. Um valor ausente ou inválido não derruba o app: ele usa o padrão, mostra um aviso na tela e detalha no console. Controles da interface (volume, voz, tamanho do texto, idioma) partem do valor do arquivo e a escolha da pessoa fica salva no navegador; se o valor do arquivo for editado, ele volta a valer.

`js/config.js` só lê e valida o arquivo. A parte técnica de cada instrumento (timbre sintetizado e URLs das amostras) continua no código. O tutorial lê o mapeamento na hora para dizer qual instrumento é de cada característica.

## Atalhos de teclado (`js/shortcuts.js`)

**Nenhum atalho usa tecla modificadora** (Ctrl, Alt, Shift ou Meta). Os atalhos ficam num **dicionário que liga cada tecla ao botão correspondente** da página: o atalho faz exatamente o mesmo que clicar no botão. Para trocar uma tecla, mude só o campo `key` em `js/shortcuts.js`; a ajuda, o tutorial, as dicas `<kbd>` nos botões e o `aria-keyshortcuts` são montados a partir dele.

```js
help:     { key: "h", alt: ["F1"], button: "helpOpen",     scope: "global" },
language: { key: "i",              button: "langToggle",   scope: "global" },
read:     { key: " ", alt: ["Enter"], button: null,        scope: "map" },
```

| Tecla | Ação |
| --- | --- |
| `H` (ou `F1`) | ajuda com todos os atalhos (com a voz ligada, é lida inteira ao abrir) |
| `T` | tutorial em áudio |
| `I` | troca o idioma (inglês ↔ português) |
| `Espaço` (ou `Enter`), no mapa | fala o país e o valor sob o cursor (o clique faz o mesmo) |
| `F` | leva o foco ao mapa |
| `M` | liga ou pausa o som |
| `G` | volta à galeria |
| `L` | legenda do mapa |
| `V` | passeio sonoro: o cursor passeia sozinho pelo mapa |
| `O` | visão geral: valores mais alto e mais baixo, onde ficam, e a média |
| `C` | posição do cursor e coordenadas |
| `Home`, no mapa | volta ao centro |
| `P`, `[`, `]` | linha do tempo: tocar/pausar, hora anterior, próxima hora |
| `+`, `-` | volume |
| Setas, no mapa | movem o cursor; **segurar a seta anda mais rápido** |
| `1` a `9`, no mapa | saltam para nove regiões (1 = em cima à esquerda, 5 = centro) |
| `Escape` | cala a voz, para o passeio ou fecha a janela aberta |

Os atalhos valem na página toda, menos dentro de campos de texto e listas. Com uma janela modal aberta, só `H` e `I` valem (o resto é da janela).

## Sonificação (Tone.js)

**Um instrumento por característica.** Cada mapa representa uma característica do planeta e é tocado só pelo instrumento dela: temperatura no piano, umidade na flauta, velocidade do vento na harpa e monóxido de carbono na marimba. **Quanto mais intensa a característica, mais aguda a nota**, e vice-versa: a posição do valor na barra de cores escolhe a nota dentro da faixa do instrumento (`config.json` → `instrumentos`).

- **Eixo X → panorama estéreo** (`Panner`, com rampa).
- As notas são quantizadas na **pentatônica maior de Dó ou Sol**, com histerese para não oscilar na fronteira entre duas notas. A flauta faz legato ou glide; piano, harpa e marimba tocam quando a nota muda e re-tocam suavemente com o cursor parado. A marimba é sintetizada (não há gravação dela na biblioteca de amostras).
- As amostras são gravações reais (piano Salamander; violoncelo, contrabaixo, violino, clarinete, flauta e harpa do *tonejs-instruments*), carregadas só para o instrumento em uso, com fallback sintetizado. Para usar só os sintetizadores, `audio.usarAmostrasGravadas: false`.
- **Sons dos lugares** (por baixo do instrumento, para saber onde se está): ondas no mar, vento gelado e cristais no gelo, insetos e pássaros na floresta, e vento seco no deserto. O lugar vem de `landscapeAt` (`js/geo.js`).
- **Barra de cores tocável:** passar o mouse (ou usar as setas, `Page Up`/`Page Down` para passos maiores) toca exatamente o que um pixel daquela cor tocaria no mapa.
- **A voz tem prioridade:** enquanto a voz fala, a música para e volta sozinha ao fim da fala (`narracao.pausarMusica`).

### Passeio sonoro

O botão **Fazer um passeio** (tecla `V`) faz o cursor passear sozinho pelo mapa, em **movimentos aleatórios e contínuos**, **até a pessoa pedir para parar**, na velocidade de `passeio.velocidade` (0,05 = o mapa inteiro em uns 20 segundos): velocidade constante, curvas suaves que mudam de tempos em tempos e um "quique" ao chegar à borda. O som começa na hora (não há fala antes, que pausaria a música, nem relatório no fim); o leitor de tela recebe um aviso curto pela região ARIA. As setas, um clique no mapa, `V` ou `Escape` param. Pausar o som (ou abrir a legenda ou a ajuda) só congela o passeio, que continua de onde parou. Código: `js/passeio.js`.

## Voz e narração

Só existe **uma** narração por vez (`js/voz.js`): antes de começar uma fala, a anterior é parada, e uma fala só termina quando a voz realmente parou. Assim, nunca há duas descrições da página tocando ao mesmo tempo.

- **A voz fala quando a pessoa pede:** clique no mapa ou `Espaço` (país e valor), respostas aos atalhos, legenda, ajuda e tutorial. **Não há narração automática ao passar o mouse.**
- A opção **Voz do site** (painel Acessibilidade e tutorial) liga ou desliga a voz. Quem usa leitor de tela deve desligá-la: tudo o que ela diz também vai para regiões ARIA live.
- Com a voz ligada, os controles são lidos ao navegar **pelo teclado** (Tab); cliques com o mouse não são lidos (`js/a11y.js`). Ao navegar com **Tab**, o controle selecionado é **sempre lido na hora**, interrompendo qualquer outra fala (legenda, ajuda, tutorial), como faz um leitor de tela. Um foco movido pelo próprio app (abrir uma janela) espera as descrições importantes terminarem.
- **Primeira visita:** os navegadores bloqueiam som antes do primeiro gesto. A janela de boas-vindas fica guardada e é lida **do início ao fim** a partir do primeiro clique ou tecla. Para leitores de tela, o foco vai para o título da janela, que tem o texto inteiro como descrição (`aria-describedby`), então o leitor lê a janela completa.
- A voz usa o idioma escolhido (a melhor voz `en-US` ou `pt-BR` instalada: "Natural/Online" no Edge, "Google" no Chrome).
- Textos longos (ajuda, legenda, tutorial) são falados em blocos de até ~150 caracteres, **um de cada vez**: o Chrome corta em ~15 s as falas longas das vozes do Google e descartava o fim da fila. Com essas vozes, um `pause()`/`resume()` periódico mantém a fala viva.
- Abrir um mapa não fala mais as instruções de uso: elas ficam só no tutorial (tecla `T`) e na ajuda (tecla `H`).

### Legenda falada, sem atropelo

Ao abrir a legenda, a voz a lê inteira (`narracao.lerLegendaAoAbrir`). Passar o mouse num cartão pausa a voz e toca o som com fade; ao sair, a voz continua da frase em que parou. Nunca tocam dois sons juntos, e rolar a legenda não dispara nada.

## Smartphone (vibração tátil)

O painel **Vibração no celular** gera um peer PeerJS com ID aleatório e um QR Code para `receiver.html#<id>`. O servidor público do PeerJS só faz a sinalização: os dados seguem via WebRTC, peer-to-peer. **A vibração é proporcional ao valor:** valores altos dão pulsos curtos e rápidos, valores baixos dão pulsos longos e lentos, com um pulso duplo ao cruzar zonas. No iPhone/Safari, que não suporta `navigator.vibrate`, o receptor mostra pulsos visuais. O botão **Copiar o link do receptor** permite mandar o endereço por mensagem a quem não enxerga o QR Code.

## Acessibilidade

- **Leitor de tela** (NVDA, JAWS, VoiceOver, TalkBack): links de atalho, regiões e títulos, diálogos modais com foco gerenciado, nomes e estados em todos os controles e regiões ARIA live. O mapa é um `role="application"`, então as teclas chegam direto a ele.
- **Sem leitor de tela:** a voz do site responde aos atalhos e lê os controles ao navegar com Tab.
- **Janelas:** legenda e ajuda fecham com `Escape` ou com um clique fora delas.
- **Baixa visão:** tamanho do texto (o cursor do mapa cresce junto), **alto contraste** (respeita `prefers-contrast`) e **filtros de cor**: paletas seguras que recolorem a imagem pelos dados decodificados (Cividis, Viridis, cinza) e simulações de daltonismo.
- O layout é responsivo e respeita `prefers-reduced-motion`.

### Tutorial em áudio (pessoas cegas)

Um guia de uns cinco minutos que funciona só com teclado e som. Na primeira visita ele abre sozinho com as boas-vindas, que começam a tocar na hora quando o navegador permite autoplay de áudio no site. Se o navegador bloquear o som até o primeiro gesto, a primeira tecla (inclusive `Enter`) começa a leitura das boas-vindas do início, em vez de pular a tela. Depois, `Enter` começa e `Escape` pula. Todas as falas fixas, inclusive a lista de atalhos e a de instrumentos, são MP3 gravados (`python tools/gerar_audio_tutorial.py`), o que garante a leitura completa; sem gravação, a fala usa a voz do navegador. Depois de fechado, não abre mais sozinho (use o botão **Tutorial em áudio** ou a tecla `T`; para testar de novo, apague `sinfonia-tutorial-visto` do `localStorage`).

1. **Atalhos de teclado — a primeira informação do tutorial**, montada a partir de `js/shortcuts.js`.
2. **Ouvir:** como funciona; um botão para ouvir o instrumento de cada característica (do valor mais baixo ao mais alto); "quanto maior o valor, mais aguda a nota" (o piano sobe do mais frio ao mais quente); esquerda e direita (com fones); os sons dos lugares.
3. **Praticar** no mapa de temperatura: mover o cursor; apertar `Espaço` para ouvir onde está; encontrar o frio da Antártida, onde o piano toca as notas mais graves; voltar ao centro com `Home`; avançar uma hora com `]`, se a pasta `dados/` existir.

`R` repete a instrução e `Escape` fecha o tutorial. Trocar o idioma no meio do tutorial redesenha e fala o passo atual no novo idioma.

**Editar os textos.** Os textos ficam em `assets/tutorial/roteiro.json`, um bloco por idioma (`en` e `pt`). `{tecla:nome}` vira o nome da tecla do atalho `nome`, então o texto acompanha o dicionário de atalhos. Sem gravações, o tutorial usa a voz do navegador. Para gravar as falas fixas com voz neural (opcional):

```bash
pip install edge-tts
python tools/gerar_audio_tutorial.py          # grava só as falas que mudaram (en e pt)
python tools/gerar_audio_tutorial.py --idioma pt --tudo
```

O roteiro guarda o texto de cada gravação. Se uma fala foi editada e não regravada, o app usa a voz do navegador para ela em vez de tocar um áudio desatualizado. O edge-tts envia os textos ao serviço de voz da Microsoft só no momento de gravar.

## Estrutura

```text
index.html, receiver.html, servidor.py
css/styles.css
config.json      TODA a configuração: instrumento de cada característica, volumes (dB), voz etc.
js/config.js     lê e valida o config.json; parte técnica dos 10 instrumentos
js/i18n.js       textos da tela e da voz em inglês e português; troca de idioma
js/shortcuts.js  dicionário de atalhos: tecla → botão
js/a11y.js       leitura em voz alta dos controles ao navegar pelo teclado
js/app.js        orquestração: galeria → legenda → exploração, atalhos, ARIA, voz, idioma
js/scales.js     escalas fixas de cada mapa, cor → valor, paletas acessíveis
js/colormaps.js  barras GMAO amostradas (gerado)
js/sampler.js    leitura robusta de pixels, gradiente, recoloração
js/geo.js        projeções, máscara terra/oceano, países, regiões e paisagem sonora (landscapeAt)
js/audio.js      motor Tone.js: um instrumento por característica, lugares, pré-escutas, pausa durante a voz
js/haptics.js    PeerJS + QR Code
js/receiver.js   página do celular
js/gallery.js    mapas pré-carregados
js/tutorial.js   tutorial guiado em áudio e teclado (atalhos + demonstrações + desafios no mapa)
js/passeio.js    passeio sonoro: caminho aleatório e contínuo do cursor
js/voz.js        narrador: uma fala por vez, MP3 neural ou a melhor voz do navegador no idioma escolhido
assets/tutorial/ roteiro.json (textos do tutorial em en e pt) + MP3 gravados de todas as falas
assets/countries.geojson  fronteiras dos países (Natural Earth, 1:50m) usadas para dizer o país sob o cursor
tools/gerar_audio_tutorial.py  roteiro → MP3 com voz neural (edge-tts)
tools/extrair_escalas.py     legendas → js/colormaps.js (+ --validar)
tools/gerar_mascara_terra.py frames de vento → assets/landmask.png
referencias/escalas/         legendas oficiais usadas como referência
```

## Créditos

NASA GMAO (GEOS). Fronteiras dos países (`assets/countries.geojson`, camada *Admin 0 – Countries* 1:50m): Natural Earth <https://www.naturalearthdata.com/>, domínio público. Amostras: Salamander Grand Piano (Alexander Holm, CC-BY 3.0) e *tonejs-instruments* (Nicholaus Brosowsky).
