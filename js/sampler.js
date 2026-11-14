// Leitura de pixels da imagem e conversão para valores físicos.

import { luminance, paletteColor } from "./scales.js";
import { project, regionName } from "./geo.js";

const MAX_WIDTH = 2048;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function loadBitmap(source) {
  // source: URL (string) ou File/Blob
  if (typeof source === "string") {
    const img = new Image();
    img.decoding = "async";
    img.src = source;
    await img.decode();
    return img;
  }
  return createImageBitmap(source);
}

export class ImageSampler {
  constructor(bitmap) {
    const w0 = bitmap.naturalWidth || bitmap.width;
    const h0 = bitmap.naturalHeight || bitmap.height;
    const k = Math.min(1, MAX_WIDTH / w0);
    this.width = Math.max(1, Math.round(w0 * k));
    this.height = Math.max(1, Math.round(h0 * k));
    const c = document.createElement("canvas");
    c.width = this.width;
    c.height = this.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, this.width, this.height);
    this.canvas = c;
    this.imageData = ctx.getImageData(0, 0, this.width, this.height);
    this.step = Math.max(1, Math.round(this.width / 1000));
    this.gradOffset = Math.max(3, Math.round(this.width / 150));
  }

  rgbAt(x, y) {
    x = clamp(Math.round(x), 0, this.width - 1);
    y = clamp(Math.round(y), 0, this.height - 1);
    const o = (y * this.width + x) * 4;
    const d = this.imageData.data;
    return [d[o], d[o + 1], d[o + 2]];
  }

  // Mediana dos valores válidos em uma janela (2r+1)² — remove linhas de costa,
  // fronteiras e ruído JPEG.
  patch(scale, x, y, r = 2, minFrac = 0.3) {
    const values = [];
    const lums = [];
    let invalid = 0;
    let calm = 0;
    for (let j = -r; j <= r; j += 1) {
      for (let i = -r; i <= r; i += 1) {
        const [R, G, B] = this.rgbAt(x + i * this.step, y + j * this.step);
        lums.push(luminance(R, G, B));
        const d = scale.decode(R, G, B);
        if (d.valid) {
          values.push(d.value);
          if (d.calm) calm += 1;
        } else invalid += 1;
      }
    }
    const value = median(values);
    const sortedLum = [...lums].sort((a, b) => a - b);
    const lumMean = lums.reduce((a, b) => a + b, 0) / lums.length;
    const lumStd = Math.sqrt(lums.reduce((a, b) => a + (b - lumMean) ** 2, 0) / lums.length);
    return {
      value,
      valid: values.length >= Math.max(1, Math.ceil(lums.length * minFrac)),
      coverage: values.length / lums.length,
      bright: median(lums),
      peak: sortedLum[Math.floor(sortedLum.length * 0.9)],
      texture: lumStd,
      calm: calm > values.length / 2,
      invalid,
    };
  }

  read(u, v, scale, projection) {
    const x = u * (this.width - 1);
    const y = v * (this.height - 1);
    const rgb = this.rgbAt(x, y);
    const geo = project(projection, u, v);
    const region = geo ? regionName(geo.lat, geo.lon) : null;

    const mask = scale.masks().find((m) => u >= m.u0 && u <= m.u1 && v >= m.v0 && v <= m.v1);
    if (mask) {
      return { u, v, rgb, valid: false, reason: mask.label, geo, region, bright: luminance(...rgb), grad: 0, texture: 0 };
    }
    if (projection?.type === "orthographic" && !geo) {
      return { u, v, rgb, valid: false, reason: "Fora do globo", geo, region, bright: 0, grad: 0, texture: 0 };
    }

    let p = this.patch(scale, x, y, scale.patchRadius || 2, scale.chroma ? 0.08 : 0.3);
    if (!p.valid && scale.fallbackRadius) p = this.patch(scale, x, y, scale.fallbackRadius, 0.04);
    if (!p.valid) {
      const reason = region?.land && scale.landLabel ? scale.landLabel : scale.invalidLabel || "Fora da escala (linha de costa, fronteira ou rótulo)";
      return { u, v, rgb, valid: false, reason, geo, region, bright: p.bright, peak: p.peak, grad: 0, texture: clamp(p.texture / 0.15) };
    }

    // gradiente: diferença de posição na barra entre vizinhos (frentes, bordas de plumas)
    const o = this.gradOffset;
    const at = (dx, dy) => {
      const q = this.patch(scale, x + dx, y + dy, scale.chroma ? 3 : 1, scale.chroma ? 0.05 : 0.3);
      return q.valid ? scale.posOf(q.value) : null;
    };
    const L = at(-o, 0);
    const R = at(o, 0);
    const U = at(0, -o);
    const D = at(0, o);
    const gx = L !== null && R !== null ? R - L : 0;
    const gy = U !== null && D !== null ? D - U : 0;
    const grad = clamp(Math.hypot(gx, gy) * 5);

    const norm = scale.posOf(p.value);
    return {
      u, v, rgb, valid: true, geo, region,
      value: p.value,
      norm,
      calm: p.calm,
      bright: p.bright,
      peak: p.peak,
      texture: clamp(p.texture / 0.15),
      grad,
      zone: scale.zoneOf(p.value),
    };
  }

  // Recolore a imagem inteira com uma paleta acessível usando a LUT da escala.
  recolor(scale, paletteName) {
    const lut = scale.lut();
    const src = this.imageData.data;
    const out = new ImageData(this.width, this.height);
    const dst = out.data;
    const colors = new Array(255);
    for (let i = 0; i < 255; i += 1) colors[i] = paletteColor(paletteName, i / 254);
    for (let o = 0; o < src.length; o += 4) {
      const key = ((src[o] >> 3) << 10) | ((src[o + 1] >> 3) << 5) | (src[o + 2] >> 3);
      const t = lut[key];
      if (t === 255) {
        const g = Math.round(luminance(src[o], src[o + 1], src[o + 2]) * 255 * 0.55);
        dst[o] = dst[o + 1] = dst[o + 2] = g;
      } else {
        const c = colors[t];
        dst[o] = c[0];
        dst[o + 1] = c[1];
        dst[o + 2] = c[2];
      }
      dst[o + 3] = 255;
    }
    const c = document.createElement("canvas");
    c.width = this.width;
    c.height = this.height;
    c.getContext("2d").putImageData(out, 0, 0);
    return c;
  }
}
