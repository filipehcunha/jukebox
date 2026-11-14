// Escalas de cores -> valores físicos.
//
// Cada escala sabe:
//   - decodificar uma cor RGB em valor físico (cor mais próxima na barra, em CIELAB);
//   - converter valor <-> posição na barra (0..1), usada para a música (a barra é perceptual,
//     inclusive a de CO, que não é linear);
//   - dizer quais instrumentos soam e com que peso (papéis da legenda sensorial).
//
// As barras GMAO foram amostradas pixel a pixel das legendas oficiais
// (referencias/escalas/*.jpeg) por tools/extrair_escalas.py -> js/colormaps.js.

import { GMAO_COLORMAPS } from "./colormaps.js";

// ---------------------------------------------------------------------------
// Utilidades de cor
// ---------------------------------------------------------------------------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
// sobe de a->b, platô b->c, desce c->d
const bell = (x, a, b, c, d) => Math.min(smooth(a, b, x), 1 - smooth(c, d, x));

function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab(r, g, b) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const fy = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const fz = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// remove o brilho: escala o RGB para que o maior canal seja 255
function chromaNorm(r, g, b) {
  const m = Math.max(r, g, b) || 1;
  return [(r * 255) / m, (g * 255) / m, (b * 255) / m];
}

export function luminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

// Interpola uma paleta grosseira [{value, color}] em N passos para decodificação fina.
function densify(palette, steps = 120) {
  const out = [];
  const min = palette[0].value;
  const max = palette[palette.length - 1].value;
  for (let i = 0; i <= steps; i += 1) {
    const v = min + ((max - min) * i) / steps;
    let k = 0;
    while (k < palette.length - 2 && palette[k + 1].value < v) k += 1;
    const a = palette[k];
    const b = palette[k + 1];
    const t = clamp((v - a.value) / (b.value - a.value));
    out.push([v, ...a.color.map((c, j) => Math.round(c + (b.color[j] - c) * t))]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Paletas das imagens NASA pré-carregadas (ECCO2 e GEDI), herdadas da versão inicial
// ---------------------------------------------------------------------------
const SST_PALETTE = [
  { value: 0, color: [52, 92, 250] }, { value: 2, color: [50, 125, 227] },
  { value: 4, color: [50, 154, 204] }, { value: 6, color: [51, 182, 181] },
  { value: 8, color: [53, 208, 159] }, { value: 10, color: [56, 230, 137] },
  { value: 12, color: [58, 250, 116] }, { value: 14, color: [61, 255, 95] },
  { value: 16, color: [76, 255, 74] }, { value: 18, color: [115, 255, 54] },
  { value: 20, color: [169, 255, 40] }, { value: 22, color: [221, 255, 34] },
  { value: 24, color: [251, 255, 33] }, { value: 26, color: [250, 215, 31] },
  { value: 28, color: [248, 157, 28] }, { value: 30, color: [247, 88, 25] },
  { value: 32, color: [247, 0, 24] },
];

const GEDI_PALETTE = [
  { value: 0, color: [77, 70, 42] }, { value: 9.4, color: [77, 83, 45] },
  { value: 14.1, color: [77, 99, 52] }, { value: 18.8, color: [84, 111, 56] },
  { value: 23.4, color: [96, 122, 59] }, { value: 28.1, color: [105, 131, 60] },
  { value: 32.8, color: [119, 142, 62] }, { value: 37.5, color: [133, 151, 67] },
  { value: 42.2, color: [148, 162, 75] }, { value: 46.9, color: [161, 170, 87] },
  { value: 51.6, color: [182, 186, 110] }, { value: 56.2, color: [203, 203, 143] },
  { value: 60.9, color: [223, 218, 178] }, { value: 65.6, color: [241, 230, 208] },
  { value: 70.3, color: [253, 239, 228] }, { value: 75, color: [255, 250, 241] },
];

// ---------------------------------------------------------------------------
// Instrumentos (Tela de Legenda Auditiva)
// ---------------------------------------------------------------------------
export const INSTRUMENTS = {
  cello: {
    id: "cello",
    name: "Violoncelo / Contrabaixo",
    short: "Violoncelo",
    register: "Grave",
    role: "Águas frias, baixas temperaturas e regiões polares",
    color: "#6ea8ff",
  },
  piano: {
    id: "piano",
    name: "Piano de cauda / Marimba",
    short: "Piano",
    register: "Médio",
    role: "Temperaturas amenas e vegetação moderada",
    color: "#f4c76b",
  },
  flute: {
    id: "flute",
    name: "Flauta / Sopros de madeira",
    short: "Flauta",
    register: "Agudo",
    role: "Alta umidade, nuvens ou dossel florestal elevado",
    color: "#7fe0c4",
  },
  harp: {
    id: "harp",
    name: "Harpa / Percussão leve",
    short: "Harpa",
    register: "Arpejos e ritmo",
    role: "Intensidade de correntes marítimas ou ventos fortes",
    color: "#e59ad8",
  },
};
export const INSTRUMENT_ORDER = ["cello", "piano", "flute", "harp"];

// Áreas sobrepostas pelo logotipo GMAO e pelo carimbo de data/hora (coordenadas 0..1)
const GMAO_MASKS = [
  { u0: 0, v0: 0, u1: 0.176, v1: 0.075, label: "Logotipo NASA/GMAO" },
  { u0: 0, v0: 0.898, u1: 0.247, v1: 1, label: "Carimbo de data e hora" },
];

// Os frames GMAO são horários; o frame 0 mostra "30 Oct 2026 05:00:00 EDT" (= 09:00 UTC)
// e o 371 mostra "14 Nov 2026 15:00:00 EST" (= 20:00 UTC).
export const GMAO_T0_UTC = Date.UTC(2026, 9, 30, 9, 0, 0);

// ---------------------------------------------------------------------------
// Definição das escalas
// ---------------------------------------------------------------------------
function linearTicks(min, max, values) {
  return values.map((v) => ({ value: v, pos: (v - min) / (max - min) }));
}

const RAW = {
  temp: {
    label: "Temperatura do ar a 2 m (T2M)",
    short: "Temperatura",
    family: "gmao",
    unit: "°C",
    decimals: 1,
    min: -40,
    max: 40,
    stops: GMAO_COLORMAPS.temp,
    ticks: linearTicks(-40, 40, [-40, -30, -20, -10, 0, 10, 20, 30, 40]),
    ends: ["muito frio", "ponto de congelamento", "muito quente"],
    maxDist: 16,
    keywords: /temp|t2m|temperat/i,
    zones: [
      { max: -10, label: "Polar, muito frio" },
      { max: 0, label: "Frio, abaixo de zero" },
      { max: 18, label: "Ameno" },
      { max: 30, label: "Quente" },
      { max: Infinity, label: "Muito quente" },
    ],
    roles: (r) => ({
      cello: smooth(8, -12, r.value),
      piano: smooth(-4, 6, r.value) * (0.75 + 0.25 * smooth(28, 38, r.value)),
      flute: 0.4 * r.bright ** 1.6,
      harp: clamp(r.grad * 1.3),
    }),
    legend: {
      cello: "Abaixo de 0 °C: azuis-escuros, roxos e brancos polares",
      piano: "Acima de 5 °C: do ciano ao vermelho (amenos e quentes)",
      flute: "Camada de brilho: cresce nos pixels mais claros",
      harp: "Frentes térmicas: mudanças bruscas de temperatura",
    },
    sentence: (v) => `Temperatura ${v}`,
  },
  humidity: {
    label: "Umidade específica a 2 m (Q2M)",
    short: "Umidade",
    family: "gmao",
    unit: "g/kg",
    decimals: 1,
    min: 0,
    max: 22,
    stops: GMAO_COLORMAPS.humidity,
    ticks: linearTicks(0, 22, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]),
    ends: ["seco", "moderado", "úmido"],
    maxDist: 12,
    keywords: /humid|q2m|umid/i,
    zones: [
      { max: 4, label: "Ar seco" },
      { max: 10, label: "Umidade moderada" },
      { max: 16, label: "Úmido" },
      { max: Infinity, label: "Muito úmido, tropical" },
    ],
    roles: (r) => ({
      cello: smooth(6, 1, r.value),
      piano: bell(r.value, 2, 6, 13, 18),
      flute: smooth(9, 17, r.value),
      harp: clamp(r.grad * 1.4),
    }),
    legend: {
      cello: "Ar seco (menos de 5 g/kg): marrons, desertos e polos",
      piano: "Umidade moderada (5 a 14 g/kg): beges e verdes-claros",
      flute: "Ar muito úmido (acima de 12 g/kg): azuis tropicais",
      harp: "Bordas de massas de ar: mudanças bruscas de umidade",
    },
    sentence: (v) => `Umidade ${v}`,
  },
  wind: {
    label: "Velocidade do vento perto da superfície",
    short: "Vento",
    family: "gmao",
    unit: "m/s",
    decimals: 1,
    min: 0,
    max: 40,
    stops: GMAO_COLORMAPS.wind,
    ticks: linearTicks(0, 40, [0, 5, 10, 15, 20, 25, 30, 35, 40]),
    ends: ["calmo", "forte", "força de furacão"],
    maxDist: 20,
    // Na legenda, 0 a 3,4 m/s é transparente: no frame aparece o relevo cinza dos
    // continentes ou o fundo escuro do oceano. Pixels quase neutros = calmaria.
    neutralChroma: 18,
    calmValue: 2,
    keywords: /wind|vento/i,
    zones: [
      { max: 4, label: "Calmaria ou brisa leve" },
      { max: 10, label: "Vento moderado" },
      { max: 17, label: "Vento forte" },
      { max: 25, label: "Vendaval" },
      { max: 33, label: "Tempestade" },
      { max: Infinity, label: "Força de furacão" },
    ],
    roles: (r) => ({
      cello: smooth(7, 2, r.value) * 0.8,
      piano: bell(r.value, 2, 6, 14, 24),
      flute: 0.35 * r.bright ** 1.5,
      harp: smooth(4, 22, r.value),
    }),
    legend: {
      cello: "Calmaria (menos de 5 m/s): fundo escuro e relevo cinza",
      piano: "Ventos moderados (5 a 15 m/s): azuis e cianos",
      flute: "Camada de brilho: cresce nos tons claros e amarelos",
      harp: "Ventos fortes: arpejos mais rápidos e intensos até a força de furacão",
    },
    sentence: (v) => `Vento ${v}`,
  },
  co: {
    label: "Monóxido de carbono (CO)",
    short: "CO",
    family: "gmao",
    unit: "ppbv",
    decimals: 0,
    min: 40,
    max: 500,
    stops: GMAO_COLORMAPS.co,
    // Barra não linear: posições das marcas medidas na legenda
    ticks: [
      { value: 40, pos: 0 },
      { value: 100, pos: (188.5 - 72.5) / 391 },
      { value: 130, pos: (279.5 - 72.5) / 391 },
      { value: 200, pos: (370.5 - 72.5) / 391 },
      { value: 500, pos: 1 },
    ],
    ends: ["baixo", "", "alto"],
    maxDist: 14,
    keywords: /(^|[^a-z])co([^a-z]|$)|carbon|monox/i,
    zones: [
      { max: 80, label: "Ar limpo, nível de fundo" },
      { max: 130, label: "CO moderado" },
      { max: 200, label: "CO elevado" },
      { max: Infinity, label: "CO muito alto, queimadas ou indústria" },
    ],
    roles: (r) => ({
      cello: smooth(120, 260, r.value),
      piano: bell(r.value, 60, 90, 140, 220),
      flute: smooth(100, 55, r.value),
      harp: clamp(r.grad * 1.4),
    }),
    legend: {
      cello: "CO alto (acima de 150 ppbv): vermelhos escuros, ar denso",
      piano: "CO moderado (80 a 150 ppbv): laranjas",
      flute: "Ar limpo (menos de 80 ppbv): amarelos-claros",
      harp: "Bordas de plumas de poluição: mudanças bruscas",
    },
    sentence: (v) => `Monóxido de carbono ${v}`,
  },
  sst: {
    label: "Temperatura da superfície do mar (ECCO2)",
    short: "Temperatura do mar",
    family: "nasa",
    unit: "°C",
    decimals: 1,
    min: 0,
    max: 32,
    stops: densify(SST_PALETTE),
    ticks: linearTicks(0, 32, [0, 8, 16, 24, 32]),
    ends: ["águas frias", "", "águas quentes"],
    maxDist: 22,
    // ECCO2 desenha as correntes como estrias: a matiz é a temperatura e o brilho é a
    // velocidade da corrente. Decodifica só a cromaticidade (RGB normalizado pelo maior canal).
    chroma: { minMax: 40, minSat: 0.4 },
    patchRadius: 4,
    fallbackRadius: 9,
    invalidLabel: "Oceano sem corrente visível",
    landLabel: "Continente (sem dado oceânico)",
    keywords: /sst|ecco|ocean|mar/i,
    zones: [
      { max: 8, label: "Águas frias, polares" },
      { max: 18, label: "Águas temperadas" },
      { max: 26, label: "Águas amenas" },
      { max: Infinity, label: "Águas quentes, tropicais" },
    ],
    roles: (r) => ({
      cello: smooth(14, 3, r.value),
      piano: smooth(8, 16, r.value),
      flute: 0.3 * smooth(0.15, 0.5, r.peak),
      harp: clamp(smooth(0.04, 0.3, r.peak) + r.grad * 0.4),
    }),
    legend: {
      cello: "Águas frias (menos de 10 °C): azuis",
      piano: "Águas amenas e quentes (acima de 12 °C): verdes ao vermelho",
      flute: "Camada de brilho: tons mais claros",
      harp: "Correntes marítimas: as estrias de textura aceleram os arpejos",
    },
    sentence: (v) => `Temperatura do mar ${v}`,
  },
  gedi: {
    label: "Altura do dossel florestal (GEDI)",
    short: "Altura do dossel",
    family: "nasa",
    unit: "m",
    decimals: 0,
    min: 0,
    max: 75,
    stops: densify(GEDI_PALETTE),
    ticks: linearTicks(0, 75, [0, 15, 30, 45, 60, 75]),
    ends: ["solo", "", "dossel alto"],
    maxDist: 18,
    rejectBlue: true, // oceano e lagos azuis do globo não têm dado de dossel
    invalidLabel: "Oceano ou sem dado de dossel",
    keywords: /gedi|forest|floresta|canopy|dossel/i,
    zones: [
      { max: 5, label: "Solo ou vegetação rasteira" },
      { max: 25, label: "Vegetação moderada" },
      { max: 45, label: "Floresta alta" },
      { max: Infinity, label: "Dossel muito elevado" },
    ],
    roles: (r) => ({
      cello: smooth(10, 0, r.value) * 0.7,
      piano: bell(r.value, 3, 10, 28, 45),
      flute: smooth(22, 50, r.value),
      harp: clamp(r.texture * 2),
    }),
    legend: {
      cello: "Solo e vegetação baixa: oliva-escuro",
      piano: "Vegetação moderada (10 a 30 m): verdes",
      flute: "Dossel elevado (acima de 30 m): tons creme",
      harp: "Textura da floresta: bordas e clareiras",
    },
    sentence: (v) => `Dossel ${v}`,
  },
  generic: {
    label: "Cor livre (matiz → temperatura)",
    short: "Matiz",
    family: "generic",
    unit: "%",
    decimals: 0,
    min: 0,
    max: 100,
    stops: null,
    ticks: linearTicks(0, 100, [0, 25, 50, 75, 100]),
    ends: ["frio (azul)", "", "quente (vermelho)"],
    keywords: null,
    zones: [
      { max: 25, label: "Tons frios" },
      { max: 60, label: "Tons intermediários" },
      { max: Infinity, label: "Tons quentes" },
    ],
    roles: (r) => ({
      cello: smooth(0.45, 0.1, r.norm),
      piano: bell(r.norm, 0.15, 0.35, 0.7, 0.9),
      flute: Math.max(smooth(0.65, 0.95, r.norm) * 0.7, 0.5 * r.bright ** 1.4),
      harp: clamp(r.grad * 1.2 + r.texture),
    }),
    legend: {
      cello: "Matizes frios (azul, roxo)",
      piano: "Matizes intermediários (verde, amarelo)",
      flute: "Matizes quentes e pixels muito claros",
      harp: "Bordas e texturas fortes da imagem",
    },
    sentence: (v) => `Intensidade de cor ${v}`,
  },
};

// ---------------------------------------------------------------------------
// Classe Scale
// ---------------------------------------------------------------------------
export class Scale {
  constructor(id, def) {
    Object.assign(this, def);
    this.id = id;
    if (this.stops) {
      this.labs = this.stops.map(([, r, g, b]) => (this.chroma ? rgbToLab(...chromaNorm(r, g, b)) : rgbToLab(r, g, b)));
    }
    this._lut = null;
  }

  // valor físico -> posição 0..1 na barra (piecewise linear pelas marcas)
  posOf(value) {
    const t = this.ticks;
    if (value <= t[0].value) return 0;
    for (let i = 1; i < t.length; i += 1) {
      if (value <= t[i].value) {
        const k = (value - t[i - 1].value) / (t[i].value - t[i - 1].value);
        return t[i - 1].pos + k * (t[i].pos - t[i - 1].pos);
      }
    }
    return 1;
  }

  valueAtPos(pos) {
    const t = this.ticks;
    if (pos <= 0) return t[0].value;
    for (let i = 1; i < t.length; i += 1) {
      if (pos <= t[i].pos) {
        const k = (pos - t[i - 1].pos) / (t[i].pos - t[i - 1].pos);
        return t[i - 1].value + k * (t[i].value - t[i - 1].value);
      }
    }
    return t[t.length - 1].value;
  }

  // Decodificação exata de uma cor: { value, dist, valid, calm? }
  decode(r, g, b) {
    if (!this.stops) {
      const [h, s, l] = rgbToHsl(r, g, b);
      if (s < 0.12 || l < 0.06 || l > 0.96) return { value: NaN, dist: 99, valid: false };
      // azul (240°) = 0, vermelho (0°/360°) = 1; magentas contam como quentes
      const hh = h > 300 ? h - 360 : h;
      const norm = clamp((240 - hh) / 240);
      return { value: norm * 100, dist: 0, valid: true };
    }
    if (this.neutralChroma && Math.max(r, g, b) - Math.min(r, g, b) < this.neutralChroma) {
      return { value: this.calmValue, dist: 0, valid: true, calm: true };
    }
    if (this.rejectBlue && b > g * 0.95) return { value: NaN, dist: 99, valid: false };
    let L, A, B;
    if (this.chroma) {
      const max = Math.max(r, g, b);
      if (max < this.chroma.minMax || (max - Math.min(r, g, b)) / max < this.chroma.minSat) {
        return { value: NaN, dist: 99, valid: false };
      }
      [L, A, B] = rgbToLab(...chromaNorm(r, g, b));
    } else {
      [L, A, B] = rgbToLab(r, g, b);
    }
    const labs = this.labs;
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < labs.length; i += 1) {
      const l = labs[i];
      const d = (L - l[0]) ** 2 + (A - l[1]) ** 2 + (B - l[2]) ** 2;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    // refinamento: projeta no segmento vizinho mais próximo para obter valor contínuo
    let value = this.stops[bi][0];
    const nb = [bi - 1, bi + 1].filter((i) => i >= 0 && i < labs.length);
    let refined = null;
    for (const j of nb) {
      const p = labs[bi];
      const q = labs[j];
      const seg = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const len2 = seg[0] ** 2 + seg[1] ** 2 + seg[2] ** 2;
      if (!len2) continue;
      const t = clamp(((L - p[0]) * seg[0] + (A - p[1]) * seg[1] + (B - p[2]) * seg[2]) / len2);
      const d = (L - p[0] - t * seg[0]) ** 2 + (A - p[1] - t * seg[1]) ** 2 + (B - p[2] - t * seg[2]) ** 2;
      if (!refined || d < refined.d) refined = { d, v: value + t * (this.stops[j][0] - value) };
    }
    if (refined) {
      value = refined.v;
      best = Math.min(best, refined.d);
    }
    const dist = Math.sqrt(best);
    return { value, dist, valid: dist <= this.maxDist };
  }

  // Tabela RGB (5 bits por canal) -> posição na barra (0..1) ou 255 = inválido.
  // Usada para recolorir a imagem inteira com paletas acessíveis.
  lut() {
    if (this._lut) return this._lut;
    const lut = new Uint8Array(32 * 32 * 32);
    for (let r = 0; r < 32; r += 1) {
      for (let g = 0; g < 32; g += 1) {
        for (let b = 0; b < 32; b += 1) {
          const d = this.decode(r * 8 + 4, g * 8 + 4, b * 8 + 4);
          lut[(r << 10) | (g << 5) | b] = d.valid ? Math.round(this.posOf(d.value) * 254) : 255;
        }
      }
    }
    this._lut = lut;
    return lut;
  }

  zoneOf(value) {
    if (!Number.isFinite(value)) return null;
    const zones = this.zones;
    let idx = zones.findIndex((z) => value <= z.max);
    if (idx < 0) idx = zones.length - 1;
    return { index: idx, label: zones[idx].label };
  }

  format(value) {
    if (!Number.isFinite(value)) return "—";
    let text = value.toFixed(this.decimals).replace(".", ",");
    if (this.id === "wind" && value <= this.calmValue + 0.01) text = "< 4";
    if (this.id === "temp" && value >= 39.9) text = "≥ 40";
    if (this.id === "co" && value >= 499) text = "≥ 500";
    return `${text} ${this.unit}`;
  }

  // CSS linear-gradient com as cores reais da barra
  gradientCss() {
    if (!this.stops) {
      return "linear-gradient(90deg, hsl(240 85% 55%), hsl(180 80% 50%), hsl(120 75% 48%), hsl(60 90% 52%), hsl(0 85% 52%))";
    }
    const n = this.stops.length;
    const pick = this.stops.filter((_, i) => i % Math.max(1, Math.floor(n / 48)) === 0 || i === n - 1);
    return `linear-gradient(90deg, ${pick
      .map(([v, r, g, b]) => `rgb(${r} ${g} ${b}) ${(this.posOf(v) * 100).toFixed(1)}%`)
      .join(", ")})`;
  }

  // cor da barra numa posição 0..1
  colorAtPos(pos) {
    if (!this.stops) {
      const h = 240 - Math.min(1, Math.max(0, pos)) * 240;
      return `hsl(${h} 85% 52%)`;
    }
    const v = this.valueAtPos(pos);
    let best = this.stops[0];
    for (const s of this.stops) if (Math.abs(s[0] - v) < Math.abs(best[0] - v)) best = s;
    return `rgb(${best[1]} ${best[2]} ${best[3]})`;
  }

  masks() {
    return this.family === "gmao" ? GMAO_MASKS : [];
  }
}

export const SCALE_LIST = Object.entries(RAW).map(([id, def]) => new Scale(id, def));
export const SCALES = Object.fromEntries(SCALE_LIST.map((s) => [s.id, s]));

// Detecta a escala pelo nome da pasta/arquivo
export function scaleFromName(path) {
  if (!path) return null;
  const parts = path.split(/[\\/]/).reverse();
  for (const part of parts) {
    for (const s of SCALE_LIST) {
      if (s.keywords && s.keywords.test(part)) return s.id;
    }
  }
  return null;
}

// Detecta a escala pelas cores: mede a distância mediana de ~1500 pixels a cada barra
export function scaleFromPixels(imageData) {
  const { data, width, height } = imageData;
  const samples = [];
  for (let i = 0; i < 1500; i += 1) {
    const x = Math.floor(((i * 7919) % 1499) / 1499 * width);
    const y = Math.floor(((i * 104729) % 1493) / 1493 * height);
    const o = (y * width + x) * 4;
    samples.push([data[o], data[o + 1], data[o + 2]]);
  }
  let best = { id: "generic", score: Infinity };
  for (const s of SCALE_LIST) {
    if (!s.stops) continue;
    const d = samples.map(([r, g, b]) => s.decode(r, g, b).dist).sort((a, b) => a - b);
    const score = d[Math.floor(d.length * 0.6)];
    if (score < best.score) best = { id: s.id, score };
  }
  return best.score < 7 ? best.id : "generic";
}

// Paletas acessíveis para recolorir (seguras para daltonismo)
export const ACCESSIBLE_PALETTES = {
  cividis: [[0, 34, 78], [54, 74, 107], [112, 113, 115], [168, 157, 115], [229, 205, 92], [253, 234, 69]],
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  gray: [[16, 16, 16], [240, 240, 240]],
};

export function paletteColor(name, t) {
  const p = ACCESSIBLE_PALETTES[name];
  const x = clamp(t) * (p.length - 1);
  const i = Math.min(p.length - 2, Math.floor(x));
  const k = x - i;
  return p[i].map((c, j) => Math.round(c + (p[i + 1][j] - c) * k));
}
