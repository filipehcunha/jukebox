# A Sinfonia da Terra: Earth Jukebox Multissensorial

Experiência web que transforma mapas de dados terrestres da NASA (ou imagens enviadas pelo usuário) em **música instrumental em tempo real**, **vibração no smartphone** e **narração acessível**. É HTML, CSS e JavaScript puros (módulos ES), com Tone.js, PeerJS e QRCode.js via CDN. Não há etapa de build.

## Como executar

```bash
python3 servidor.py          # serve em http://localhost:8000 e na rede local
```

Abra `http://localhost:8000`. O `servidor.py` escuta em todas as interfaces e mostra o endereço da rede (ex.: `http://192.168.0.10:8000`). O app consulta esse endereço sozinho para montar o QR Code do celular. Também dá para usar `python3 -m http.server 8000`. Nesse caso, digite o IP do computador no painel do smartphone.

> **WSL2:** o IP detectado é o da máquina virtual, que o celular não alcança. Rode o servidor pelo Python do Windows, ative o *mirrored networking* do WSL ou passe o IP do Windows: `python3 servidor.py 8000 --url http://IP-DO-WINDOWS:8000`.

Na primeira execução é preciso internet: Tone.js, PeerJS, QRCode.js e as amostras dos instrumentos vêm de CDNs. Sem as amostras, o app usa instrumentos sintetizados.

### Dados GMAO (pasta `dados/`)

Descompacte `dados.zip` na raiz para obter `dados/{temp,humidity,wind,co}_frames/frame_000000.jpg … frame_000371.jpg`. São 372 frames horários, de 30/out/2026 09:00 UTC a 14/nov/2026 20:00 UTC. Se a pasta existir, os cartões GMAO da galeria abrem a **sequência completa com linha do tempo**. Sem ela, abrem um frame de amostra (`assets/gmao_*.jpg`). A pasta e o zip ficam fora do git por causa do tamanho.

## Fluxo da experiência

1. **Galeria de escolha:** traz 6 mapas pré-carregados: ECCO2 (temperatura dos oceanos), GEDI (altura das florestas) e quatro mapas GMAO (temperatura, umidade, vento e CO). Também é possível carregar uma pasta (`webkitdirectory`), selecionar várias imagens ou arrastar e soltar. Cada pasta vira um grupo de miniaturas clicáveis com o nome do arquivo, carregadas sob demanda.
2. **Legenda auditiva e sensorial (obrigatória):** é um diálogo modal que mostra a barra de cores da escala e os 4 instrumentos. Cada instrumento tem um botão **Ouvir** e a explicação de quais cores ou valores o acionam naquela imagem. O botão **Iniciar Experiência Multissensorial** abre o mapa.
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
- As amostras são gravações reais (piano Salamander e violoncelo, flauta e harpa do *tonejs-instruments*), com fallback sintetizado.

## Smartphone (vibração tátil)

O painel **Conectar Smartphone** gera um peer PeerJS com ID aleatório e um QR Code para `receiver.html#<id>`. O servidor público do PeerJS só faz a sinalização: os dados seguem via WebRTC, peer-to-peer. O computador envia até ~16 pacotes/s. O celular vibra com pulsos proporcionais ao valor, dá um pulso duplo ao cruzar zonas (ex.: "Ameno" → "Quente") e um pulso em frentes térmicas ou bordas de plumas. No iPhone/Safari, que não suporta `navigator.vibrate`, o receptor mostra pulsos visuais.

## Acessibilidade

- **Modo de baixa sensibilidade:** limitador em −18 dB, volume −10 dB, filtro até 1,7 kHz, rampas lentas, arpejos mais lentos, vibração a 45% e animações desligadas.
- **Teclado:** setas movem o cursor focal (Shift = passo maior), `Enter` anuncia, `Espaço` liga/pausa, `[` `]` trocam a hora, `P` reproduz a linha do tempo, `L` abre a legenda e `Home` centraliza.
- **ARIA live + narração por voz** (`speechSynthesis`, pt-BR). Exemplo: "Atlântico Norte: Violoncelo e Piano. Temperatura 22,0 °C, quente."
- **Alto contraste** (respeita `prefers-contrast`) e **filtros de cor**: paletas seguras que recolorem a imagem *pelos dados decodificados* (Cividis, Viridis, cinza) e simulações de deuteranopia, protanopia e tritanopia.
- O layout é responsivo, respeita `prefers-reduced-motion` e usa um `<dialog>` modal com foco gerenciado.

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
js/app.js        orquestração: galeria → legenda → exploração, teclado, ARIA, voz
js/scales.js     escalas, cor → valor, papéis dos instrumentos, paletas acessíveis
js/colormaps.js  barras GMAO amostradas (gerado)
js/sampler.js    leitura robusta de pixels, gradiente, recoloração
js/geo.js        projeções, máscara terra/oceano, nomes de regiões
js/audio.js      motor Tone.js em 4 camadas
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
