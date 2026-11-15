// Escalas de cores -> valores físicos.
//
// Cada escala sabe:
//   - decodificar uma cor RGB em valor físico (cor mais próxima na barra, em CIELAB);
//   - converter valor <-> posição na barra (0..1), usada para a música (a barra é perceptual,
//     inclusive a de CO, que não é linear);
//   - dizer qual característica do planeta ela representa (e, portanto, qual instrumento a
//     toca: config.json → mapeamento). Cada mapa tem a sua escala própria e fixa.
//
// Os textos (nome, unidade, zonas, frases faladas) ficam em js/i18n.js → "scale.<id>.*",
// para mudarem junto com o idioma escolhido.
//
// As barras GMAO foram amostradas pixel a pixel das legendas oficiais
// (referencias/escalas/*.jpeg) por tools/extrair_escalas.py -> js/colormaps.js.

import { GMAO_COLORMAPS } from "./colormaps.js";
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

export function luminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Áreas sobrepostas pelo logotipo GMAO e pelo carimbo de data/hora (coordenadas 0..1)
const GMAO_MASKS = [
  { u0: 0, v0: 0, u1: 0.176, v1: 0.075, key: "reason.logo" },
  { u0: 0, v0: 0.898, u1: 0.247, v1: 1, key: "reason.stamp" },
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

// Textos de cada escala em js/i18n.js: scale.<id>.label, .short, .unit (falada), .ends, .zones
const RAW = {
  temp: {
    characteristic: "TEMPERATURE",
    family: "gmao",
    unit: "°C",
    decimals: 1,
    min: -40,
    max: 40,
    stops: GMAO_COLORMAPS.temp,
    ticks: linearTicks(-40, 40, [-40, -30, -20, -10, 0, 10, 20, 30, 40]),
    maxDist: 16,
    zoneMax: [-10, 0, 18, 30, Infinity],
  },
  humidity: {
    characteristic: "HUMIDITY",
    family: "gmao",
    unit: "g/kg",
    decimals: 1,
    min: 0,
    max: 22,
    stops: GMAO_COLORMAPS.humidity,
    ticks: linearTicks(0, 22, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]),
    maxDist: 12,
    zoneMax: [4, 10, 16, Infinity],
  },
  wind: {
    characteristic: "WIND_SPEED",
    family: "gmao",
    unit: "m/s",
    decimals: 1,
    min: 0,
    max: 40,
    stops: GMAO_COLORMAPS.wind,
    ticks: linearTicks(0, 40, [0, 5, 10, 15, 20, 25, 30, 35, 40]),
    maxDist: 20,
    // Na legenda, 0 a 3,4 m/s é transparente: no frame aparece o relevo cinza dos
    // continentes ou o fundo escuro do oceano. Pixels quase neutros = calmaria.
    neutralChroma: 18,
    calmValue: 2,
    zoneMax: [4, 10, 17, 25, 33, Infinity],
  },
  co: {
    characteristic: "CARBON_MONOXIDE",
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
    maxDist: 14,
    zoneMax: [80, 130, 200, Infinity],
  },
};

// ---------------------------------------------------------------------------
// Classe Scale
// ---------------------------------------------------------------------------
export class Scale {
  constructor(id, def) {
    Object.assign(this, def);
    this.id = id;
    this.labs = this.stops.map(([, r, g, b]) => rgbToLab(r, g, b));
    this._lut = null;
  }

  // ---- textos no idioma atual (js/i18n.js) ----
  get label() { return t(`scale.${this.id}.label`); }
  get short() { return t(`scale.${this.id}.short`); }
  /** Nome da característica do planeta (Temperatura, Umidade...) */
  get characteristicName() { return t(`char.${this.characteristic}`); }
  /** Rótulos sob as pontas e o meio da barra */
  get ends() { return t(`scale.${this.id}.ends`); }

  /** Frase falada/exibida com o valor já formatado: "Temperatura 27,3 °C" */
  sentence(valueText) { return `${this.short} ${valueText}`; }

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
    const [L, A, B] = rgbToLab(r, g, b);
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
    let idx = this.zoneMax.findIndex((max) => value <= max);
    if (idx < 0) idx = this.zoneMax.length - 1;
    const scale = this;
    // o rótulo é lido na hora: muda junto com o idioma
    return { index: idx, get label() { return t(`scale.${scale.id}.zones`)[idx]; } };
  }

  // valor na tela, com o símbolo da unidade: "27,3 °C" / "27.3 °C"
  format(value) {
    if (!Number.isFinite(value)) return "—";
    let text = num(value, this.decimals);
    if (this.id === "wind" && value <= this.calmValue + 0.01) text = "< 4";
    if (this.id === "temp" && value >= 39.9) text = "≥ 40";
    if (this.id === "co" && value >= 499) text = "≥ 500";
    return `${text} ${this.unit}`;
  }

  // valor para a voz, com a unidade por extenso: "27,3 graus Celsius" / "27.3 degrees Celsius"
  spoken(value) {
    if (!Number.isFinite(value)) return t("read.noData");
    const unit = t(`scale.${this.id}.unit`);
    if (this.id === "wind" && value <= this.calmValue + 0.01) return t("spoken.lessThan", { n: num(4, 0), unit });
    if (this.id === "temp" && value >= 39.9) return t("spoken.orMore", { n: num(40, 0), unit });
    if (this.id === "co" && value >= 499) return t("spoken.orMore", { n: num(500, 0), unit });
    return `${num(value, this.decimals)} ${unit}`;
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
}

export const SCALE_LIST = Object.entries(RAW).map(([id, def]) => new Scale(id, def));
export const SCALES = Object.fromEntries(SCALE_LIST.map((s) => [s.id, s]));

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
