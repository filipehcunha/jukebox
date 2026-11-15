// Escalas de cores -> valores físicos.
//
// Cada mapa tem a SUA escala (não há troca de escala na interface). Cada escala sabe:
//   - decodificar uma cor RGB em valor físico (cor mais próxima na barra, em CIELAB);
//   - converter valor <-> posição na barra (0..1). A posição escolhe a nota do instrumento
//     do mapa: quanto maior o valor, mais aguda (a barra é perceptual, inclusive a de CO,
//     que não é linear).
// Os textos (nome, zonas, frases) ficam em lang/*.json → scales.<id>.
//
// As barras GMAO foram amostradas pixel a pixel das legendas oficiais
// (referencias/escalas/*.jpeg) por tools/extrair_escalas.py -> js/colormaps.js.

import { GMAO_COLORMAPS } from "./colormaps.js";
import { SETTINGS } from "./config.js";
import { t, num } from "./i18n.js";

// ---------------------------------------------------------------------------
// Utilidades de cor
// ---------------------------------------------------------------------------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

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

// Áreas sobrepostas pelo logotipo GMAO e pelo carimbo de data/hora (coordenadas 0..1)
const GMAO_MASKS = [
  { u0: 0, v0: 0, u1: 0.176, v1: 0.075, key: "reasons.logo" },
  { u0: 0, v0: 0.898, u1: 0.247, v1: 1, key: "reasons.stamp" },
];

// ---------------------------------------------------------------------------
// Definição das escalas (só números; os textos estão em lang/*.json)
// ---------------------------------------------------------------------------
function linearTicks(min, max, values) {
  return values.map((v) => ({ value: v, pos: (v - min) / (max - min) }));
}

const RAW = {
  temp: {
    family: "gmao", unit: "°C", decimals: 1, min: -40, max: 40,
    stops: GMAO_COLORMAPS.temp,
    ticks: linearTicks(-40, 40, [-40, -30, -20, -10, 0, 10, 20, 30, 40]),
    maxDist: 16,
    zones: [-10, 0, 18, 30, Infinity],
  },
  humidity: {
    family: "gmao", unit: "g/kg", decimals: 1, min: 0, max: 22,
    stops: GMAO_COLORMAPS.humidity,
    ticks: linearTicks(0, 22, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]),
    maxDist: 12,
    zones: [4, 10, 16, Infinity],
  },
  wind: {
    family: "gmao", unit: "m/s", decimals: 1, min: 0, max: 40,
    stops: GMAO_COLORMAPS.wind,
    ticks: linearTicks(0, 40, [0, 5, 10, 15, 20, 25, 30, 35, 40]),
    maxDist: 20,
    // Na legenda, 0 a 3,4 m/s é transparente: no frame aparece o relevo cinza dos
    // continentes ou o fundo escuro do oceano. Pixels quase neutros = calmaria.
    neutralChroma: 18,
    calmValue: 2,
    zones: [4, 10, 17, 25, 33, Infinity],
  },
  co: {
    family: "gmao", unit: "ppbv", decimals: 0, min: 40, max: 500,
    stops: GMAO_COLORMAPS.co,
    // Barra não linear: posições das marcas medidas na legenda
    ticks: [
      { value: 40, pos: 0 },
      { value: 100, pos: (188.5 - 72.5) / 391 },
      { value: 130, pos: (279.5 - 72.5) / 391 },
      { value: 200, pos: (370.5 - 72.5) / 391 },
      { value: 500, pos: 1 },
    ],
    maxDist: 14,
    zones: [80, 130, 200, Infinity],
  },
  sst: {
    family: "nasa", unit: "°C", decimals: 1, min: 0, max: 32,
    stops: densify(SST_PALETTE),
    ticks: linearTicks(0, 32, [0, 8, 16, 24, 32]),
    maxDist: 22,
    // ECCO2 desenha as correntes como estrias: a matiz é a temperatura e o brilho é a
    // velocidade da corrente. Decodifica só a cromaticidade (RGB normalizado pelo maior canal).
    chroma: { minMax: 40, minSat: 0.4 },
    patchRadius: 4,
    fallbackRadius: 9,
    hasLandReason: true,
    zones: [8, 18, 26, Infinity],
  },
  gedi: {
    family: "nasa", unit: "m", decimals: 0, min: 0, max: 75,
    stops: densify(GEDI_PALETTE),
    ticks: linearTicks(0, 75, [0, 15, 30, 45, 60, 75]),
    maxDist: 18,
    rejectBlue: true, // oceano e lagos azuis do globo não têm dado de dossel
    zones: [5, 25, 45, Infinity],
  },
};

// ---------------------------------------------------------------------------
// Classe Scale
// ---------------------------------------------------------------------------
export class Scale {
  constructor(id, def) {
    Object.assign(this, def);
    this.id = id;
    this.zoneMax = def.zones;
    delete this.zones;
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

  // ---- textos no idioma atual (lang/*.json → scales.<id>) ----
  get label() { return t(`scales.${this.id}.label`); }
  get short() { return t(`scales.${this.id}.short`); }
  get ends() { return t(`scales.${this.id}.ends`); }
  get invalidLabel() { return t(`scales.${this.id}.invalid`); }
  get landLabel() { return this.hasLandReason ? t(`scales.${this.id}.land`) : null; }
  /** Frase falada com o valor: "Temperatura 27,3 °C" / "Temperature 27.3 °C". */
  sentence(valueText) { return t(`scales.${this.id}.sentence`, { v: valueText }); }
  /** Do grave ao agudo: o que significam a nota mais grave e a mais aguda neste mapa. */
  get pitchHint() {
    return t("legend.pitchHint", { low: `${this.format(this.min)} (${this.ends[0]})`, high: `${this.format(this.max)} (${this.ends[2] || this.ends[0]})` });
  }

  zoneOf(value) {
    if (!Number.isFinite(value)) return null;
    let idx = this.zoneMax.findIndex((max) => value <= max);
    if (idx < 0) idx = this.zoneMax.length - 1;
    return { index: idx, label: t(`scales.${this.id}.zones`)[idx] };
  }

  format(value) {
    if (!Number.isFinite(value)) return "—";
    let text = num(value, this.decimals);
    if (this.id === "wind" && value <= this.calmValue + 0.01) text = "< 4";
    if (this.id === "temp" && value >= 39.9) text = "≥ 40";
    if (this.id === "co" && value >= 499) text = "≥ 500";
    return `${text} ${this.unit}`;
  }

  // Peso de cada voz do motor: a exploração usa só a voz média, com o instrumento do mapa.
  roles(r) {
    return { low: 0, mid: r.valid === false ? 0 : 1, high: 0, arp: 0 };
  }

  // CSS linear-gradient com as cores reais da barra
  gradientCss() {
    const n = this.stops.length;
    const pick = this.stops.filter((_, i) => i % Math.max(1, Math.floor(n / 48)) === 0 || i === n - 1);
    return `linear-gradient(90deg, ${pick
      .map(([v, r, g, b]) => `rgb(${r} ${g} ${b}) ${(this.posOf(v) * 100).toFixed(1)}%`)
      .join(", ")})`;
  }

  // cor da barra numa posição 0..1
  colorAtPos(pos) {
    const v = this.valueAtPos(pos);
    let best = this.stops[0];
    for (const s of this.stops) if (Math.abs(s[0] - v) < Math.abs(best[0] - v)) best = s;
    return `rgb(${best[1]} ${best[2]} ${best[3]})`;
  }

  masks() {
    return this.family === "gmao" ? GMAO_MASKS : [];
  }

  // Quão extremo é o valor (0 = normal; 0,15 a 1 = dentro da faixa de alerta). O motor de
  // áudio transforma isso num batimento de coração, mais rápido quanto mais extremo.
  alertLevel(value) {
    const a = this.alert;
    if (!a || !Number.isFinite(value) || value < a.from) return 0;
    return clamp(0.15 + (0.85 * (value - a.from)) / Math.max(a.full - a.from, 1e-6));
  }

  /** Descrição da faixa de alerta ("calor extremo, acima de 35 °C"), ou null. */
  get alertLabel() {
    return this.alert ? t(`scales.${this.id}.alert`, { v: num(this.alert.from, this.decimals && this.alert.from % 1 ? 1 : 0) }) : null;
  }
}

// ---------------------------------------------------------------------------
// Alertas: valores extremos ganham um batimento de coração (a urgência dos dados).
// Os limites podem ser trocados em config.json → alerta.limites.
// ---------------------------------------------------------------------------
const ALERTS = {
  temp: { from: 35, full: 40 },
  sst: { from: 30, full: 32 },
  co: { from: 200, full: 500 },
  wind: { from: 25, full: 40 },
};
for (const [id, a] of Object.entries(ALERTS)) {
  if (!SETTINGS.alert.enabled) break;
  const from = SETTINGS.alert.limits[id] ?? a.from;
  RAW[id].alert = { from, full: Math.max(a.full, from + 1e-6) };
}

export const SCALE_LIST = Object.entries(RAW).map(([id, def]) => new Scale(id, def));
export const SCALES = Object.fromEntries(SCALE_LIST.map((s) => [s.id, s]));

// Paletas acessíveis para recolorir (seguras para daltonismo)
export const ACCESSIBLE_PALETTES = {
  cividis: [[0, 34, 78], [54, 74, 107], [112, 113, 115], [168, 157, 115], [229, 205, 92], [253, 234, 69]],
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  gray: [[16, 16, 16], [240, 240, 240]],
};

export function paletteColor(name, x0) {
  const p = ACCESSIBLE_PALETTES[name];
  const x = clamp(x0) * (p.length - 1);
  const i = Math.min(p.length - 2, Math.floor(x));
  const k = x - i;
  return p[i].map((c, j) => Math.round(c + (p[i + 1][j] - c) * k));
}
