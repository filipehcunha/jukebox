# A Sinfonia da Terra: Earth Jukebox Multissensorial

Experiência web que transforma mapas de dados terrestres da NASA (ou imagens enviadas pelo usuário) em **música instrumental em tempo real**, **vibração no smartphone** e **narração acessível**. É HTML, CSS e JavaScript puros (módulos ES), com Tone.js, PeerJS e QRCode.js via CDN. Não há etapa de build.

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

### Dados GMAO (pasta `dados/`)

Descompacte `dados.zip` na raiz para obter `dados/{temp,humidity,wind,co}_frames/frame_000000.jpg … frame_000371.jpg`. São 372 frames horários, de 30/out/2026 09:00 UTC a 14/nov/2026 20:00 UTC. Se a pasta existir, os cartões GMAO da galeria abrem a **sequência completa com linha do tempo**. Sem ela, abrem um frame de amostra (`assets/gmao_*.jpg`). A pasta e o zip ficam fora do git por causa do tamanho.

## Fluxo da experiência

1. **Galeria de escolha:** traz 6 mapas pré-carregados: ECCO2 (temperatura dos oceanos), GEDI (altura das florestas) e quatro mapas GMAO (temperatura, umidade, vento e CO). Também é possível carregar uma pasta (`webkitdirectory`), selecionar várias imagens ou arrastar e soltar. Cada pasta vira um grupo de miniaturas clicáveis com o nome do arquivo, carregadas sob demanda.
2. **Legenda auditiva e sensorial (obrigatória):** é um diálogo modal que mostra a barra de cores da escala e as 4 camadas. **Passar o mouse sobre um card toca o instrumento na hora** (`mouseenter`, sem clicar). Pelo teclado, cada card tem um botão **Ouvir** com o nome e a explicação do instrumento. Cada card mostra a característica do `config.json` que o alimenta e quais cores o acionam. Os instrumentos só mudam editando o `config.json`. **Passar o mouse sobre a barra de cores toca o valor daquela posição.** O botão **Iniciar Experiência Multissensorial** abre o mapa.
3. **Exploração:** mouse, toque ou teclado sobre o mapa, com leitura em tempo real. Em sequências, a linha do tempo permite escutar o tempo passar com o cursor parado.

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
- **ECCO2:** as correntes são estrias brilhantes. A **matiz** dá a temperatura (decodificada pela cromaticidade, ignorando o brilho) e o **brilho** dá a intensidade da corrente, que aciona a harpa.
- **GEDI:** o oceano azul é descartado. O globo inclinado usa uma projeção ortográfica ajustada por mínimos quadrados a 6 pontos de controle.
- **Imagens desconhecidas:** a escala é detectada pelo nome da pasta (`temp`, `humid`, `wind`, `co`, `sst`, `gedi`…) ou pelas cores. Sem correspondência, usa o matiz (azul = frio, vermelho = quente). A escala pode ser trocada manualmente.

Validação (`python3 tools/extrair_escalas.py --validar`, 12 mil pixels por variável): ΔE mediano de 1,0 a 2,3. O Pacífico equatorial lê 28,8 °C, a Antártida −39,7 °C, a umidade da Amazônia 19 g/kg e o CO no leste da China 311 ppbv.

## Configuração (`config.json`)

Tudo o que é ajustável fica em **`config.json`**, na raiz do projeto. O arquivo só muda **à mão**: edite, salve e recarregue a página. A interface não grava nada nele, e a legenda não troca mais instrumentos.

| Seção | O que controla |
| --- | --- |
| `mapeamento` | Qual instrumento toca cada característica: `TEMPERATURE`, `HUMIDITY`, `VEGETATION_DENSITY`, `OCEAN_CURRENTS`, `ALTITUDE_ELEVATION`. |
| `camadasPorEscala` | Qual característica alimenta cada camada (`low`, `mid`, `high`, `arp`). `default` vale para todos os mapas; `gedi`, `temp`, `wind` etc. trocam só as camadas indicadas. |
| `instrumentos` | Para cada um dos 10 instrumentos: `nome`, **`volumeDb`** (volume na mixagem, em decibéis) e a faixa de notas MIDI (`notaMaisGrave`, `notaMaisAguda`). |
| `audio` | Volume geral inicial, tonalidade (`C` ou `G`), amostras gravadas, limitador e reverberação. |
| `narracao` | `pausarMusica` (a música para enquanto a voz fala), `reducaoDb` (usado se `pausarMusica` for `false`), rampas, velocidade e volume da voz, espera com o cursor parado, leitura dos controles. |
| `baixaSensibilidade` | Redução de volume, limitador, filtro, voz e vibração do modo de baixa sensibilidade. |
| `teclado` | Tamanho do passo do cursor no mapa. |
| `vibracao` | Duração, intervalo e força dos pulsos do celular nos extremos frio e quente. |
| `acessibilidade` | Tamanho do texto e alto contraste iniciais. |

Exemplo: para a temperatura tocar no contrabaixo, 6 dB mais baixo:

```json
"mapeamento":   { "TEMPERATURE": "DOUBLE_BASS" },
"instrumentos": { "DOUBLE_BASS": { "nome": "Contrabaixo", "volumeDb": -6.5, "notaMaisGrave": 28, "notaMaisAguda": 50 } }
```

Chaves que começam com `_` são comentários. Um valor ausente ou inválido (instrumento que não existe, texto no lugar de número, JSON com erro de sintaxe) não derruba o app: ele usa o padrão, mostra um aviso na tela e detalha no console. Controles que continuam na interface (volume geral, tonalidade, narração, tamanho do texto) partem do valor do arquivo e a escolha da pessoa fica salva no navegador; se o valor do arquivo for editado, ele volta a valer.

`js/config.js` só lê e valida o arquivo. A parte técnica de cada instrumento (timbre sintetizado e URLs das amostras) continua no código. Os textos do tutorial (`assets/tutorial/roteiro.json`) citam violoncelo, piano, flauta e harpa pelo nome: se trocar o mapeamento, ajuste o roteiro e regrave os áudios.

## Sonificação (Tone.js)

| Camada | Instrumento | Papel |
| --- | --- | --- |
| Grave | Violoncelo / Contrabaixo | águas frias, baixas temperaturas, regiões polares (e ar seco, calmaria, CO alto) |
| Médio | Piano de cauda / Marimba | temperaturas amenas, vegetação moderada |
| Agudo | Flauta / Madeiras | alta umidade, ar limpo, dossel elevado, pixels claros |
| Arpejos | Harpa / Percussão leve | ventos fortes, correntes marítimas, frentes (gradientes) |

- **Eixo X → panorama estéreo** (`Panner`, com rampa).
- **Valor/cor → nota**, quantizada na **pentatônica maior de Dó ou Sol**. Todas as camadas usam o mesmo conjunto de notas e por isso nunca dissonam. Há histerese para a nota não oscilar na fronteira entre graus.
- **Brilho → filtro passa-baixas** e camadas secundárias. **Intensidade (vento, corrente, gradiente) → velocidade e volume do arpejo.**
- Todas as mudanças de volume, filtro e panorama usam `rampTo`. Violoncelo e flauta fazem glide ou legato, e o piano re-toca suavemente quando o cursor repousa.
- As amostras são gravações reais (piano Salamander; violoncelo, contrabaixo, violino, clarinete, flauta e harpa do *tonejs-instruments*), carregadas só para os instrumentos em uso e com fallback sintetizado.
- **Barra de cores tocável:** passar o mouse (ou usar as setas com a barra em foco) toca exatamente o que um pixel daquela cor tocaria no mapa e também vibra o celular.
- **A voz tem prioridade:** enquanto qualquer narração fala (tutorial, leitura do mapa, leitura dos controles), a música **para por completo** e volta sozinha ao fim da fala, com uma rampa curta. O narrador (`js/voz.js`) avisa o motor de áudio quando começa e quando termina. Com `narracao.pausarMusica: false` no `config.json`, a música só abaixa `reducaoDb` decibéis.

## Smartphone (vibração tátil)

O painel **Conectar Smartphone** gera um peer PeerJS com ID aleatório e um QR Code para `receiver.html#<id>`. O servidor público do PeerJS só faz a sinalização: os dados seguem via WebRTC, peer-to-peer. O computador envia até ~16 pacotes/s. **A vibração é proporcional à cor:** valores altos ou cores quentes (vermelho) dão pulsos curtos e rápidos (22 ms, ~16 por segundo), e valores baixos ou cores frias (azul) dão pulsos longos e lentos (240 ms, ~1,3 por segundo). O celular também dá um pulso duplo ao cruzar zonas (ex.: "Ameno" → "Quente") e um pulso em frentes térmicas ou bordas de plumas. No iPhone/Safari, que não suporta `navigator.vibrate`, o receptor mostra pulsos visuais.

## Acessibilidade

O site inteiro funciona sem ver a tela, de dois jeitos:

- **Com leitor de tela** (NVDA, JAWS, VoiceOver, TalkBack): a página tem links de atalho, regiões e títulos, diálogos modais com foco gerenciado, nomes e estados em todos os controles e regiões ARIA live para leituras, avisos e mudanças de tela. O mapa é um `role="application"`, então as teclas chegam direto a ele.
- **Sem leitor de tela:** a **Narração por voz** vira um leitor embutido (`js/a11y.js`). Ela lê cada controle que recebe o foco (nome, tipo, estado e descrição), o novo estado de interruptores, listas e controles deslizantes, os avisos, as trocas de tela e, no mapa, o lugar, os instrumentos e o valor. Quem termina o tutorial com a narração ligada continua com ela no resto do site.

Enquanto a voz fala, a música para.

**Atalhos na página toda:** `F1` ou `Alt+Shift+H` abre a ajuda (que também pode ser ouvida em voz alta), `Alt+Shift+N` liga ou desliga a narração, `Alt+Shift+M` leva o foco ao mapa, `Alt+Shift+G` volta à galeria, `Alt+Shift+T` abre o tutorial e `Escape` cala a voz.

**Com o mapa em foco:**

| Tecla | Ação |
| --- | --- |
| Setas (`Shift` = passo maior) | movem o cursor; a voz avisa ao chegar à borda |
| `Enter` | lê o lugar, os instrumentos e o valor |
| `O` | visão geral: valores mais alto e mais baixo, onde ficam, e a média |
| `C` | posição do cursor e coordenadas |
| `1` a `9` | saltam para nove regiões do mapa (1 = em cima à esquerda, 5 = centro) |
| `Home` | volta ao centro |
| `Espaço`, `+`, `-` | liga ou pausa o som; aumenta e diminui o volume |
| `N` | liga ou desliga a narração |
| `[` `]`, `P` | hora anterior e próxima; toca ou pausa a linha do tempo |
| `L`, `G`, `T`, `H` | legenda, galeria, tutorial, ajuda |

Outros recursos:

- **Celular sem QR Code:** o botão **Copiar o link do receptor** permite mandar o endereço para o celular por mensagem.
- **Baixa visão:** tamanho do texto (normal, grande, enorme; o cursor do mapa cresce junto), **alto contraste** (respeita `prefers-contrast`) e **filtros de cor**: paletas seguras que recolorem a imagem *pelos dados decodificados* (Cividis, Viridis, cinza) e simulações de deuteranopia, protanopia e tritanopia.
- **Modo de baixa sensibilidade:** limitador, volume e filtro reduzidos, rampas lentas, arpejos mais lentos, vibração mais fraca e animações desligadas (valores em `config.json`).
- O layout é responsivo e respeita `prefers-reduced-motion`.

### Tutorial em áudio (pessoas cegas)

É um guia de uns cinco minutos que funciona só com teclado e som.

**Primeira visita:** o guia abre sozinho, centralizado e com o resto da página escurecido, e é a primeira coisa que o leitor de tela encontra. O foco já está em **Começar o tutorial**: `Enter` começa e `Escape` pula. A voz só começa depois desse primeiro toque, porque os navegadores bloqueiam áudio antes de qualquer interação. Depois que o tutorial é fechado, ele não abre mais sozinho. Para ver de novo, use o botão **Tutorial em áudio** no topo, o segundo link de atalho da página ou a tecla `T` com o mapa em foco. Para testar a primeira visita outra vez, apague `sinfonia-tutorial-visto` do `localStorage`.

O tutorial tem duas partes:

1. **Ouvir (guia modal no centro da tela):** boas-vindas; botões para ouvir cada instrumento; demonstrações de "grave é frio, agudo é quente", do som passando da esquerda para a direita (com fones) e dos arpejos da harpa.
2. **Praticar:** abre o mapa de temperatura do ar sem passar pela legenda (o tutorial já a ensinou). O painel encolhe para a base da tela, sem modal, e o foco vai para o mapa. O app detecta sozinho cada desafio:
   - mover o cursor com as setas;
   - apertar `Enter` para ouvir onde está;
   - encontrar o frio da Antártida, onde toca o violoncelo;
   - voltar ao centro com `Home`;
   - avançar uma hora com `]`, se a pasta `dados/` existir.

   Assim que um desafio é cumprido, o próximo já vale. As teclas apertadas durante a fala contam. A confirmação e a nova instrução tocam em sequência, e instruções de desafios já cumpridos saem da fila.

`R` repete a instrução e `Escape` fecha o tutorial.

**Voz.** As falas fixas são MP3 gravados com voz neural (Microsoft Francisca, pt-BR) e ficam em `assets/tutorial/`. As falas que mudam a cada momento (por exemplo, "Bacia do Congo: Piano. Temperatura 29,9 °C") usam a voz mais natural instalada no navegador: "Natural/Online" no Edge, "Google" no Chrome. Essa escolha fica em `js/voz.js`, um narrador com fila usado pelo tutorial e pelo app. A opção **Narração do tutorial** (salva no navegador) liga ou desliga a voz. Quem usa leitor de tela pode desligá-la, porque todo o texto também vai para regiões ARIA live.

**Editar os textos.** Os textos ficam em `assets/tutorial/roteiro.json`. Depois de editar, regrave os áudios:

```bash
pip install edge-tts
python tools/gerar_audio_tutorial.py          # grava só as falas que mudaram
python tools/gerar_audio_tutorial.py --voz pt-BR-AntonioNeural --tudo   # trocar a voz
```

O roteiro guarda o texto de cada gravação. Se uma fala foi editada e não regravada, o app usa a voz do navegador para ela em vez de tocar um áudio desatualizado. O edge-tts envia os textos ao serviço de voz da Microsoft só no momento de gravar; no uso, os MP3 tocam localmente.

Código: `js/tutorial.js` e `js/voz.js`. No `app.js`, o tutorial recebe os eventos `move`, `announce`, `reading`, `home` e `frame`.

## Estrutura

```text
index.html, receiver.html, servidor.py
css/styles.css
config.json      TODA a configuração: instrumentos por característica, volume (dB) de cada um, narração etc.
js/config.js     lê e valida o config.json; parte técnica dos 10 instrumentos
js/a11y.js       leitura em voz alta dos controles ao navegar (leitor embutido)
js/app.js        orquestração: galeria → legenda → exploração, teclado, ARIA, voz
js/scales.js     escalas, cor → valor, papéis dos instrumentos, paletas acessíveis
js/colormaps.js  barras GMAO amostradas (gerado)
js/sampler.js    leitura robusta de pixels, gradiente, recoloração
js/geo.js        projeções, máscara terra/oceano, nomes de regiões
js/audio.js      motor Tone.js em 4 camadas, pré-escuta e pausa da música durante a voz
js/haptics.js    PeerJS + QR Code
js/receiver.js   página do celular
js/gallery.js    pastas locais, presets, miniaturas
js/tutorial.js   tutorial guiado em áudio e teclado (demonstrações + desafios no mapa)
js/voz.js        narrador com fila: MP3 neural do tutorial ou a melhor voz pt-BR do navegador
assets/tutorial/ roteiro.json (textos do tutorial) + MP3 gravados
tools/gerar_audio_tutorial.py  roteiro → MP3 com voz neural (edge-tts)
tools/extrair_escalas.py     legendas → js/colormaps.js (+ --validar)
tools/gerar_mascara_terra.py frames de vento → assets/landmask.png
referencias/escalas/         legendas oficiais usadas como referência
```

## Créditos

NASA GMAO (GEOS), NASA Scientific Visualization Studio (ECCO2 <https://svs.gsfc.nasa.gov/3912>, GEDI <https://svs.gsfc.nasa.gov/4950>). Amostras: Salamander Grand Piano (Alexander Holm, CC-BY 3.0) e *tonejs-instruments* (Nicholaus Brosowsky).
