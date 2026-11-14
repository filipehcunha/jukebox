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
2. **Legenda auditiva e sensorial (obrigatória):** é um diálogo modal que mostra a barra de cores da escala e as 4 camadas. **Passar o mouse sobre um card toca o instrumento na hora** (`mouseenter`, sem clicar). Focar o card pelo teclado também toca. Cada card mostra a constante do `MAPPING_CONFIG`, quais cores o acionam e um seletor para testar qualquer um dos 10 instrumentos do `SAMPLE_SET`. **Passar o mouse sobre a barra de cores toca o valor daquela posição.** O botão **Iniciar Experiência Multissensorial** abre o mapa.
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

## Constantes de mapeamento (`js/config.js`)

```js
const MAPPING_CONFIG = {
  TEMPERATURE: 'CELLO',          // Águas frias a quentes
  HUMIDITY: 'FLUTE',             // Nuvens e umidade atmosférica
  VEGETATION_DENSITY: 'MARIMBA', // Altura do dossel (GEDI)
  OCEAN_CURRENTS: 'HARP',        // Velocidade e fluxo de água
  ALTITUDE_ELEVATION: 'PIANO'    // Relevo
};
```

O `SAMPLE_SET` traz os 10 instrumentos: `CELLO`, `DOUBLE_BASS`, `GRAND_PIANO`, `MARIMBA`, `FLUTE`, `HARP`, `VIOLIN`, `CLARINET`, `SYNTH_PAD` e `STEEL_DRUM`. Cada um define a faixa de notas, se sustenta ou é percutido, o timbre sintetizado e, quando existem, as amostras gravadas (marimba, pad e steel drum são só sintetizados). Para trocar um instrumento, edite o nome no `MAPPING_CONFIG` e recarregue. `SCALE_LAYER_MAPPING` define qual variável alimenta cada camada (grave, médio, agudo, arpejo) em cada escala. Por exemplo, no GEDI a camada média usa `VEGETATION_DENSITY` (marimba).

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
- **Audio ducking:** enquanto a narração por voz fala, os instrumentos caem 15 dB (rampa de 0,15 s). Ao fim da frase, voltam ao normal com rampa de 0,9 s.

## Smartphone (vibração tátil)

O painel **Conectar Smartphone** gera um peer PeerJS com ID aleatório e um QR Code para `receiver.html#<id>`. O servidor público do PeerJS só faz a sinalização: os dados seguem via WebRTC, peer-to-peer. O computador envia até ~16 pacotes/s. **A vibração é proporcional à cor:** valores altos ou cores quentes (vermelho) dão pulsos curtos e rápidos (22 ms, ~16 por segundo), e valores baixos ou cores frias (azul) dão pulsos longos e lentos (240 ms, ~1,3 por segundo). O celular também dá um pulso duplo ao cruzar zonas (ex.: "Ameno" → "Quente") e um pulso em frentes térmicas ou bordas de plumas. No iPhone/Safari, que não suporta `navigator.vibrate`, o receptor mostra pulsos visuais.

## Acessibilidade

- **Modo de baixa sensibilidade:** limitador em −18 dB, volume −10 dB, filtro até 1,7 kHz, rampas lentas, arpejos mais lentos, vibração a 45% e animações desligadas.
- **Teclado:** setas movem o cursor focal (Shift = passo maior), `Enter` anuncia, `Espaço` liga/pausa, `[` `]` trocam a hora, `P` reproduz a linha do tempo, `L` abre a legenda e `Home` centraliza.
- **ARIA live + narração por voz** (`speechSynthesis`, pt-BR). Exemplo: "Atlântico Norte: Violoncelo e Piano. Temperatura 22,0 °C, quente."
- **Alto contraste** (respeita `prefers-contrast`) e **filtros de cor**: paletas seguras que recolorem a imagem *pelos dados decodificados* (Cividis, Viridis, cinza) e simulações de deuteranopia, protanopia e tritanopia.
- O layout é responsivo, respeita `prefers-reduced-motion` e usa um `<dialog>` modal com foco gerenciado.

## Estrutura

```text
index.html, receiver.html, servidor.py
css/styles.css
js/config.js     MAPPING_CONFIG, SAMPLE_SET (10 instrumentos) e camadas por escala
js/app.js        orquestração: galeria → legenda → exploração, teclado, ARIA, voz
js/scales.js     escalas, cor → valor, papéis dos instrumentos, paletas acessíveis
js/colormaps.js  barras GMAO amostradas (gerado)
js/sampler.js    leitura robusta de pixels, gradiente, recoloração
js/geo.js        projeções, máscara terra/oceano, nomes de regiões
js/audio.js      motor Tone.js em 4 camadas, instrumentos trocáveis, pré-escuta e ducking
js/haptics.js    PeerJS + QR Code
js/receiver.js   página do celular
js/gallery.js    pastas locais, presets, miniaturas
tools/extrair_escalas.py     legendas → js/colormaps.js (+ --validar)
tools/gerar_mascara_terra.py frames de vento → assets/landmask.png
referencias/escalas/         legendas oficiais usadas como referência
```

## Créditos

NASA GMAO (GEOS), NASA Scientific Visualization Studio (ECCO2 <https://svs.gsfc.nasa.gov/3912>, GEDI <https://svs.gsfc.nasa.gov/4950>). Amostras: Salamander Grand Piano (Alexander Holm, CC-BY 3.0) e *tonejs-instruments* (Nicholaus Brosowsky).
