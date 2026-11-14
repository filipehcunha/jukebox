# A Sinfonia da Terra: Earth Jukebox Interativo

Experiência web multissensorial que transforma visualizações científicas da NASA em som, imagem e navegação acessível. O projeto usa HTML, CSS e JavaScript puros, Canvas 2D e Web Audio API, sem build, dependências externas ou arquivos de áudio.

## Como executar

O projeto precisa ser servido por HTTP, pois usa módulos JavaScript e leitura de pixels do Canvas. Abra um terminal na pasta do projeto e execute:

```bash
python3 -m http.server 8000
```

Depois acesse:

```text
http://localhost:8000
```

Também é possível usar qualquer servidor HTTP estático de sua preferência. Abrir o `index.html` diretamente como arquivo pode bloquear os módulos e a leitura das imagens.

## Como explorar

1. Clique em **Ativar áudio e explorar**. O áudio só inicia após um gesto do usuário, conforme as regras dos navegadores.
2. Mova o ponteiro, toque ou arraste sobre o mapa.
3. Use o botão **Pausar áudio** ou **Retomar áudio** no topo para controlar o som.
4. Troque entre os datasets **ECCO2** e **GEDI** no painel lateral.
5. Em **Imagem analisada**, escolha entre as nove cenas NASA: três do ECCO2 e seis do GEDI.
6. Ajuste a escala musical, o modo de baixa sensibilidade, o alto contraste e os filtros de cor.

### Teclado

| Tecla | Ação |
| --- | --- |
| `Tab` | Navega até o mapa e os controles |
| Setas | Move a grade focal virtual sobre o mapa |
| `Shift` + setas | Move a grade focal mais rápido |
| `Espaço` | Ativa, pausa ou retoma o áudio |
| `Enter` | Repete a leitura sonora e o anúncio atual |

## Mapeamento sonoro

| Entrada | Saída |
| --- | --- |
| Cor/temperatura ou altura do dossel sob o cursor | Pitch quantizado entre aproximadamente 100 Hz e 800 Hz |
| Posição horizontal (X) | Panorama estéreo, da esquerda para a direita |
| Brilho/intensidade das correntes ou densidade do dossel | Cutoff do filtro passa-baixas e ressonância |
| Transições de posição | Rampas suaves com `linearRampToValueAtTime`, sem cliques |
| Textura | Osciladores senoidal, triangular e sub, reverb convolucional, drone e ruído de surfe |

As notas são quantizadas em uma das escalas disponíveis:

- Pentatônica Maior de Dó
- Modo Lídio de Dó
- Pentatônica Menor de Lá

O modo de baixa sensibilidade reduz volume, abertura de filtro, ressonância e intensidade da vibração. A preferência do sistema por movimento reduzido também é respeitada. O volume padrão foi calibrado para escuta em alto-falantes; o modo de baixa sensibilidade reduz os níveis para ambientes mais silenciosos.

## Datasets

### ECCO2: Temperatura e Correntes

- Título NASA: *Global Sea Surface Currents and Temperature*
- Faixa de leitura: 0–32 °C
- Página de origem: <https://svs.gsfc.nasa.gov/3912>
- Cenas disponíveis:
  - **Global · 2008** — visual equirretangular global, `assets/ecco2_sst.jpg`
  - **Atlântico Norte** — recorte regional das correntes, `assets/ecco2_atlantic.jpg`
  - **Pacífico Oriental** — recorte regional das correntes, `assets/ecco2_pacific.jpg`
- Áreas continentais são identificadas como **Continente** e não geram nota, pois o dataset representa apenas o oceano.
- Nas cenas regionais, a área é fixa e o app mostra **Cena regional** em vez de coordenadas geográficas inventadas.

### GEDI: Altura das Florestas

- Título NASA: *GEDI Global Forest Canopy Height*
- Faixa de leitura: 0–75 m
- Página de origem: <https://svs.gsfc.nasa.gov/4950>
- Cenas disponíveis:
  - **Globo global** — globo ortográfico, `assets/gedi_forest.jpg`
  - **Califórnia, EUA** — closeup regional, `assets/gedi_california.jpg`
  - **Flórida, EUA** — closeup regional, `assets/gedi_florida.jpg`
  - **Goddard, Maryland** — closeup regional, `assets/gedi_goddard.jpg`
  - **Laurentides, Canadá** — closeup regional, `assets/gedi_laurentides.jpg`
  - **Senegal** — closeup regional, `assets/gedi_senegal.jpg`

No globo global, as coordenadas e regiões do GEDI são aproximadas, calculadas a partir da projeção ortográfica. O globo da imagem original está centralizado sobre a África/Eurásia; por isso, partes das Américas não aparecem na face visível. Nos closeups regionais, a região é fixa e não há cálculo de latitude/longitude.

## Acessibilidade

- Navegação completa por teclado com grade focal virtual.
- Região `aria-live="polite"` que anuncia região, valor, intensidade e nota musical.
- Texto alternativo e descrição do mapa no Canvas.
- Foco visível, link para pular ao conteúdo e controles com rótulos.
- Alto contraste.
- Filtros para deuteranopia, protanopia e tritanopia.
- Feedback tátil opcional em dispositivos compatíveis com a Vibration API.
- Respeito a `prefers-reduced-motion`.
- Modo de baixa sensibilidade auditiva.

O feedback tátil depende de suporte do navegador/dispositivo, especialmente em navegadores móveis baseados em Chromium. Em desktop, a API de vibração normalmente não está disponível.

## Estrutura do projeto

```text
jukebox/
├── index.html
├── requisitos.txt
├── README.md
├── assets/
│   ├── ecco2_sst.jpg
│   ├── ecco2_atlantic.jpg
│   ├── ecco2_pacific.jpg
│   ├── gedi_forest.jpg
│   ├── gedi_california.jpg
│   ├── gedi_florida.jpg
│   ├── gedi_goddard.jpg
│   ├── gedi_laurentides.jpg
│   └── gedi_senegal.jpg
├── css/
│   └── styles.css
└── js/
    ├── app.js
    ├── audio.js
    └── datasets.js
```

- `index.html`: estrutura da interface, controles, regiões ARIA e filtros SVG.
- `css/styles.css`: tema visual, layout responsivo, alto contraste, baixa sensibilidade e filtros de cor.
- `js/audio.js`: síntese Web Audio, escalas, quantização, filtros, reverb, drone e análise do sinal.
- `js/datasets.js`: carregamento das imagens, cenas, renderização, paletas, grade de dados, projeções e amostragem.
- `js/app.js`: integração da interface, interação por ponteiro/teclado, anúncios, vibração e loop de desenho.

## Créditos

Dados e visualizações:

- NASA Scientific Visualization Studio, ECCO2: <https://svs.gsfc.nasa.gov/3912>
- NASA Scientific Visualization Studio, GEDI: <https://svs.gsfc.nasa.gov/4950>
- As nove imagens locais são recortes e visualizações derivadas dessas duas fontes públicas.

A sonificação, a interface e a síntese de áudio foram criadas para este projeto com a Web Audio API. Nenhum arquivo de áudio externo é utilizado.
