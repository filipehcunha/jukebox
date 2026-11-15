# A Sinfonia da Terra: Earth Jukebox Multissensorial

Experiência web que transforma mapas de dados terrestres da NASA em **música instrumental em tempo real**, **vibração no smartphone** e **narração acessível**. O site está em **inglês (padrão) e português**. É HTML, CSS e JavaScript puros (módulos ES), com Tone.js, PeerJS e QRCode.js via CDN. Não há etapa de build.

## Como executar

```bash
python3 servidor.py          # serve em http://localhost:8000 e na rede local
```

Abra `http://localhost:8000`. O `servidor.py` escuta em todas as interfaces e, se a porta 8000 estiver ocupada, usa a próxima livre. O QR Code do celular é montado **sozinho em qualquer computador**:

1. Se a página foi aberta por um endereço de rede ou HTTPS (ex.: `http://192.168.0.7:8000`), o QR usa esse mesmo endereço.
2. Em `localhost`, o app pergunta ao `servidor.py` (`/__lan`). Ele lista os IPs da máquina (Linux, macOS, Windows e WSL), ignora Docker, VPN e loopback e coloca a rede Wi-Fi/cabo primeiro. A detecção é refeita a cada QR gerado. Se houver mais de uma rede, o painel deixa escolher.
3. Com outro servidor estático (ex.: `python3 -m http.server`), o navegador tenta descobrir o IP pela WebRTC. Se não conseguir, basta digitar o IP no painel.

> **WSL2 em modo NAT:** o IP interno do WSL não é visível na rede. O `servidor.py` detecta isso, oferece o IP do Windows e imprime os comandos (`networkingMode=mirrored` ou `netsh portproxy`). Para forçar um endereço: `python3 servidor.py 8000 --url http://IP:8000`.

Na primeira execução é preciso internet: Tone.js, PeerJS, QRCode.js e as amostras dos instrumentos vêm de CDNs. Sem as amostras, o app usa instrumentos sintetizados.

## Fluxo da experiência

1. **Boas-vindas (primeira visita):** o tutorial em áudio abre sozinho. Ver [Tutorial em áudio](#tutorial-em-áudio).
2. **Galeria:** seis mapas da NASA: temperatura do ar, umidade, vento e monóxido de carbono (GMAO), temperatura dos oceanos (ECCO2) e altura das florestas (GEDI). Cada mapa tem a sua escala, que não pode ser trocada.
3. **Legenda do mapa:** um diálogo com a barra de cores, **o instrumento do mapa** e os sons dos lugares. A voz lê a legenda ao abrir, e passar o mouse num cartão toca o som. A janela fecha com `Escape` ou com um clique fora dela. **Começar a explorar** abre o mapa.
4. **Exploração:** mouse, toque ou setas movem o cursor e a música acompanha. **Clicar no mapa, ou apertar `Espaço`, fala o país (ou o oceano) e a característica do mapa com o valor**, por exemplo: "Brasil. Temperatura 27,7 °C, quente." Nada é narrado só por passar o mouse.

## Um instrumento por mapa

Cada mapa mostra uma característica, e **cada característica é tocada por um único instrumento**. **Quanto mais intensa a característica, mais aguda a nota**, e quanto menos intensa, mais grave: o valor mais baixo da escala toca a nota mais grave do instrumento e o mais alto, a mais aguda.

| Mapa | Característica | Instrumento padrão |
| --- | --- | --- |
| T2M | temperatura do ar | Piano de cauda |
| Q2M | umidade | Flauta |
| Vento | velocidade do vento | Violino |
| CO | monóxido de carbono | Violoncelo |
| ECCO2 | temperatura dos oceanos | Marimba |
| GEDI | altura das florestas | Harpa |

Os instrumentos e a faixa de notas de cada um ficam em `config.json` (`instrumentoPorMapa` e `instrumentos`).

## Idioma

O botão **Português / English** no topo, ou a tecla `I`, troca o idioma. A escolha fica salva no navegador. O padrão é inglês. Mudam juntos:

- os textos da página;
- todas as narrações: lugar clicado, avisos, legenda, ajuda e leitor embutido, com a voz do navegador no idioma escolhido;
- os nomes de países (pelo `Intl.DisplayNames`), oceanos e regiões;
- o tutorial, com áudio gravado nos dois idiomas;
- a página do celular (`receiver.html?lang=…`).

Os textos ficam em `lang/en.json` e `lang/pt.json`, com as mesmas chaves (`js/i18n.js` carrega e aplica). No HTML, `data-i18n="chave"` recebe o texto e `data-i18n-attr="aria-label:chave"` preenche atributos. No JS, use `t("chave", { variavel })`.

## Atalhos de teclado

Todos os atalhos são **uma tecla só, sem Ctrl, Alt ou Shift**. Eles ficam num dicionário em **`js/atalhos.js`**, que liga cada ação à sua tecla e ao botão correspondente da página. Para trocar um atalho, mude só a `tecla` ali. A ajuda (`H`), o texto de ajuda do mapa, o `aria-keyshortcuts` e o `title` dos botões e os textos do tutorial se ajustam sozinhos. Depois, regrave o áudio do tutorial (ver abaixo).

| Onde | Tecla | Ação |
| --- | --- | --- |
| página toda | `H` (ou `F1`) | ajuda com todos os atalhos |
| | `T` | tutorial em áudio |
| | `I` | troca o idioma |
| | `N` | liga ou desliga a voz do site |
| | `S` | liga ou pausa o som |
| | `M` | leva o foco ao mapa |
| | `G` | volta à galeria |
| | `Escape` | fecha a janela aberta ou cala a voz |
| mapa em foco | setas | movem o cursor (a voz avisa na borda) |
| | `Espaço` (ou `Enter`) | fala o país e o valor |
| | `O` | visão geral: valores mais alto e mais baixo e onde ficam |
| | `C` | posição do cursor e coordenadas |
| | `Home` | volta ao centro |
| | `V` | toca ou para a sinfonia do mapa |
| | `L` | abre a legenda |
| | `+` `-` | volume |
| | `1` a `9` | saltam para nove regiões (1 = em cima à esquerda, 5 = centro) |
| tutorial | `R` | repete o passo |

Os atalhos da página toda não valem enquanto se digita num campo de texto.

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

- **Vento:** a faixa calma é transparente. No frame ela aparece como relevo cinza nos continentes ou fundo escuro no oceano. Pixels quase neutros contam como calmaria (< 4 m/s).
- **ECCO2:** as correntes são estrias brilhantes. A **matiz** dá a temperatura, decodificada pela cromaticidade, ignorando o brilho.
- **GEDI:** o oceano azul é descartado. O globo foi renderizado por uma câmera em perspectiva, a ~3,5 raios da Terra, e por isso usa a projeção `perspective` de `js/geo.js`. Os parâmetros foram ajustados comparando terra e oceano da imagem com `assets/countries.geojson`: discordam em 4,4% dos pixels.

Validação (`python3 tools/extrair_escalas.py --validar`, 12 mil pixels por variável): ΔE mediano de 1,0 a 2,3.

## Configuração (`config.json`)

Tudo o que é ajustável fica em **`config.json`**, na raiz do projeto. O arquivo só muda **à mão**: edite, salve e recarregue a página.

| Seção | O que controla |
| --- | --- |
| `instrumentoPorMapa` | O instrumento de cada mapa (`temp`, `humidity`, `wind`, `co`, `sst`, `gedi`). |
| `instrumentos` | Para cada um dos 10 instrumentos: **`volumeDb`** (volume na mixagem) e a faixa de notas MIDI (`notaMaisGrave`, `notaMaisAguda`). Os nomes ficam em `lang/*.json` → `instruments`. |
| `audio` | Volume geral inicial, tonalidade (`C` ou `G`), uso das amostras gravadas, limitador e reverberação. |
| `paisagem` | Sons dos lugares: `ativo` e o `volumeDb` de `mar` (mais `periodoOndaS`), `gelo`, `floresta`, `deserto` e `fronteira`. |
| `alerta` | Coração nos valores extremos: `ativo`, `volumeDb` e `limites` por mapa (`temp` 35 °C, `sst` 30 °C, `co` 200 ppbv, `wind` 25 m/s). |
| `passeio` | Sinfonia e passeios: duração padrão (`duracaoS`) e faixas do caminho "Mapa inteiro" (`linhasMapaInteiro`). |
| `narracao` | Voz do site ligada ao abrir, leitor embutido ligado ao abrir, pausa da música durante a voz, rampas, velocidade e volume da voz, leitura da legenda ao abrir. |
| `teclado` | Tamanho do passo do cursor no mapa. |
| `vibracao` | Duração, intervalo e força dos pulsos do celular nos extremos frio e quente. |
| `acessibilidade` | Tamanho do texto e alto contraste iniciais. |

Exemplo: para a temperatura tocar no contrabaixo, 6 dB mais baixo:

```json
"instrumentoPorMapa": { "temp": "DOUBLE_BASS" },
"instrumentos":       { "DOUBLE_BASS": { "volumeDb": -6.5, "notaMaisGrave": 28, "notaMaisAguda": 52 } }
```

Chaves que começam com `_` são comentários. Um valor ausente ou inválido não derruba o app: ele usa o padrão, mostra um aviso na tela e detalha no console. `js/config.js` só lê e valida o arquivo. A parte técnica de cada instrumento (timbre sintetizado e URLs das amostras) continua no código.

## Sonificação (Tone.js)

- **Valor → nota:** o valor sob o cursor escolhe a nota do instrumento do mapa, do grave (valor baixo) ao agudo (valor alto), quantizada na **pentatônica maior de Dó ou Sol**, com histerese para a nota não oscilar.
- **Eixo X → panorama estéreo** (`Panner`, com rampa). **Brilho → filtro passa-baixas.**
- Todas as mudanças de volume, filtro e panorama usam `rampTo`. Instrumentos de arco e sopro fazem glide ou legato, e os de tecla e corda pinçada re-tocam suavemente quando o cursor repousa.
- As amostras são gravações reais (piano Salamander; violoncelo, contrabaixo, violino, clarinete, flauta e harpa do *tonejs-instruments*), com fallback sintetizado.
- **Coração nos extremos:** quando o valor passa do limite de alerta, soa um coração grave que acelera até ~110 bpm no máximo da escala. O clique no mapa também diz "Alerta: calor extremo…".
- **Sons dos lugares:** por baixo da música, cada lugar tem uma assinatura própria, na tonalidade da música: ondas no **mar**, vento gelado e cristais no **gelo**, insetos e pássaros na **floresta**, vento seco e bordão grave no **deserto** e um sino na **fronteira** entre países. O lugar vem de `landscapeAt` (`js/geo.js`).
- **Barra de cores tocável:** passar o mouse (ou usar as setas com a barra em foco) toca o que um pixel daquela cor tocaria no mapa.
- **Uma narração por vez:** toda fala passa pelo narrador de `js/voz.js`, que toca uma de cada vez. Uma fala nova cancela a anterior ou espera na fila, então duas descrições nunca tocam juntas. Enquanto a voz fala, a música para e volta ao fim da fala (`narracao.pausarMusica`).

## Sinfonia do mapa e passeios

O botão **Ouvir a sinfonia do mapa** (ou a tecla `V`) faz uma faixa vertical varrer a imagem da esquerda para a direita e transforma o mapa inteiro em uma música com abertura, desenvolvimento, clímax e final, tocada pelo instrumento do mapa em quatro vozes. O compositor fica em `js/sinfonia.js`: um acorde por compasso, conforme o valor médio do trecho; a melodia segue a altura, no mapa, de onde os valores são mais altos; a paisagem e o coração acompanham a faixa. No fim, a voz resume o mapa.

No painel **Sinfonia e passeios** há também três passeios em que o cursor percorre o mapa sozinho: **volta ao mundo** (oeste → leste, na altura do cursor), **de polo a polo** (norte → sul) e **mapa inteiro** (zigue-zague). As setas, um clique no mapa, `V` ou `Escape` param. Com **Gravar o áudio**, a música vira um WAV para baixar. Código: `js/passeio.js` e a seção "Sinfonia e passeios" de `js/app.js`.

## Smartphone (vibração tátil)

O painel **Conectar celular** gera um peer PeerJS com ID aleatório e um QR Code para `receiver.html?lang=…#<id>`. O servidor público do PeerJS só faz a sinalização: os dados seguem via WebRTC, peer-to-peer. **A vibração é proporcional ao valor:** valores altos dão pulsos curtos e rápidos e valores baixos, pulsos longos e lentos. Há um pulso duplo ao cruzar zonas (ex.: "Ameno" → "Quente"). No iPhone/Safari, que não suporta `navigator.vibrate`, o receptor mostra pulsos visuais. O botão **Copiar o link do receptor** permite mandar o endereço por mensagem, sem precisar ver o QR Code.

## Acessibilidade

O site inteiro funciona sem ver a tela:

- **Com leitor de tela** (NVDA, JAWS, VoiceOver, TalkBack): links de atalho, regiões e títulos, diálogos modais com foco gerenciado, nomes e estados em todos os controles e regiões ARIA live. O mapa é um `role="application"`, então as teclas chegam direto a ele. Nesse caso, desligue a **Voz do site** (`N`).
- **Sem leitor de tela:** a **Voz do site** (ligada por padrão) fala o lugar clicado, os avisos, a legenda e o tutorial. O **Leitor embutido** (`js/a11y.js`, desligado por padrão) lê cada botão e controle ao navegar com Tab. Ele liga sozinho para quem termina o tutorial com a voz ligada.
- **Baixa visão:** tamanho do texto (normal, grande, enorme; o cursor do mapa cresce junto), **alto contraste** (respeita `prefers-contrast`) e **filtros de cor**: paletas seguras que recolorem a imagem pelos dados decodificados (Cividis, Viridis, cinza) e simulações de deuteranopia, protanopia e tritanopia.
- Botões, listas e campos têm área de toque de pelo menos 44 × 44 px. O layout é responsivo e respeita `prefers-reduced-motion`.

### Tutorial em áudio

É um guia de uns cinco minutos que funciona só com teclado e som.

**Primeira visita:** o guia abre sozinho, centralizado e com o resto da página escurecido. O foco vai para a própria janela, e o leitor de tela lê o título e o texto inteiro. A voz do site também lê as boas-vindas inteiras, seguidas do aviso de idioma na outra língua ("Para ouvir em português, aperte a tecla I"). Como os navegadores só liberam áudio depois de um gesto, sem nenhum gesto anterior essa leitura começa no primeiro toque de tecla ou clique. `Enter` começa, `I` troca o idioma e `Escape` pula. Depois que o tutorial é fechado, ele não abre mais sozinho. Para abrir de novo, use o botão **Tutorial em áudio**, o segundo link de atalho ou a tecla `T`. Para testar a primeira visita outra vez, apague `sinfonia-tutorial-visto` do `localStorage`.

Passos:

1. **Os atalhos** (a primeira informação), lidos do dicionário de atalhos.
2. **Como o site funciona.**
3. **Um instrumento para cada mapa**, com um botão para ouvir cada instrumento do grave ao agudo.
4. **Mais intenso, mais agudo**: a temperatura subindo do frio ao calor.
5. **Esquerda e direita** (com fones).
6. **Os sons dos lugares** e o coração.
7. **Praticar** no mapa de temperatura. O painel encolhe para a base da tela e o foco vai para o mapa. O app detecta sozinho cada desafio: mover o cursor, apertar `Espaço` para ouvir onde está, encontrar o frio da Antártida (onde as notas ficam graves) e voltar ao centro com `Home`.

`R` repete o passo e `Escape` fecha o tutorial.

**Voz.** As falas fixas são MP3 gravados com voz neural (Jenny em inglês, Francisca em português) e ficam em `assets/tutorial/en/` e `assets/tutorial/pt/`. As falas que mudam (o lugar clicado, por exemplo) usam a voz mais natural instalada no navegador, no idioma do site.

**Editar os textos.** Os roteiros ficam em `assets/tutorial/<idioma>/roteiro.json`. Neles, `{k:acao}` vira a tecla do atalho (de `js/atalhos.js`) e `{inst:mapa}`, o instrumento do mapa (de `config.json`). Depois de editar um roteiro, trocar uma tecla ou trocar um instrumento, regrave os áudios:

```bash
pip install edge-tts
python tools/gerar_audio_tutorial.py              # grava só as falas que mudaram, nos dois idiomas
python tools/gerar_audio_tutorial.py --tudo       # regrava tudo
```

O roteiro guarda o texto de cada gravação. Se uma fala mudou e não foi regravada, o app usa a voz do navegador para ela em vez de tocar um áudio desatualizado. O edge-tts envia os textos ao serviço de voz da Microsoft só no momento de gravar; no uso, os MP3 tocam localmente.

## Estrutura

```text
index.html, receiver.html, servidor.py
css/styles.css
config.json      configuração: instrumento de cada mapa, volume (dB) de cada instrumento, narração etc.
lang/en.json     todos os textos em inglês (padrão)
lang/pt.json     todos os textos em português (mesmas chaves)
js/i18n.js       idioma: carrega lang/*.json, t("chave"), troca de idioma
js/atalhos.js    dicionário de atalhos de teclado (tecla → ação → botão)
js/config.js     lê e valida o config.json; parte técnica dos 10 instrumentos
js/app.js        orquestração: galeria → legenda → exploração, atalhos, ARIA, voz, idioma
js/a11y.js       leitor embutido: lê os controles ao navegar com Tab
js/voz.js        narrador com fila (uma fala por vez): MP3 neural do tutorial ou a melhor voz do navegador
js/scales.js     escalas de cada mapa, cor → valor, paletas acessíveis
js/colormaps.js  barras GMAO amostradas (gerado)
js/sampler.js    leitura robusta de pixels, gradiente, recoloração
js/geo.js        projeções, máscara terra/oceano, países, regiões e paisagem sonora (landscapeAt)
js/audio.js      motor Tone.js: instrumento do mapa, sons dos lugares, coração, gravação, pré-escuta
js/haptics.js    PeerJS + QR Code
js/receiver.js   página do celular (inglês ou português)
js/gallery.js    os seis mapas da galeria
js/tutorial.js   tutorial guiado em áudio e teclado (atalhos, demonstrações, desafios no mapa)
js/passeio.js    passeios: caminhos, resumo da travessia e exportação WAV
js/sinfonia.js   sinfonia do mapa: lê o mapa em colunas e compõe a peça
assets/tutorial/ roteiros e MP3 do tutorial, em en/ e pt/
assets/countries.geojson  fronteiras dos países (Natural Earth, 1:50m)
tools/gerar_audio_tutorial.py  roteiros → MP3 com voz neural (edge-tts), nos dois idiomas
tools/extrair_escalas.py     legendas → js/colormaps.js (+ --validar)
tools/gerar_mascara_terra.py frames de vento → assets/landmask.png
```

## Créditos

NASA GMAO (GEOS), NASA Scientific Visualization Studio (ECCO2 <https://svs.gsfc.nasa.gov/3912>, GEDI <https://svs.gsfc.nasa.gov/4950>). Fronteiras dos países (`assets/countries.geojson`, camada *Admin 0 – Countries* 1:50m): Natural Earth <https://www.naturalearthdata.com/>, domínio público. Amostras: Salamander Grand Piano (Alexander Holm, CC-BY 3.0) e *tonejs-instruments* (Nicholaus Brosowsky).
