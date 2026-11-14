const SST_PALETTE = [
  { value: 0, color: [52, 92, 250] },
  { value: 2, color: [50, 125, 227] },
  { value: 4, color: [50, 154, 204] },
  { value: 6, color: [51, 182, 181] },
  { value: 8, color: [53, 208, 159] },
  { value: 10, color: [56, 230, 137] },
  { value: 12, color: [58, 250, 116] },
  { value: 14, color: [61, 255, 95] },
  { value: 16, color: [76, 255, 74] },
  { value: 18, color: [115, 255, 54] },
  { value: 20, color: [169, 255, 40] },
  { value: 22, color: [221, 255, 34] },
  { value: 24, color: [251, 255, 33] },
  { value: 26, color: [250, 215, 31] },
  { value: 28, color: [248, 157, 28] },
  { value: 30, color: [247, 88, 25] },
  { value: 32, color: [247, 0, 24] },
];

const GEDI_PALETTE = [
  { value: 0, color: [77, 70, 42] },
  { value: 9.4, color: [77, 83, 45] },
  { value: 14.1, color: [77, 99, 52] },
  { value: 18.8, color: [84, 111, 56] },
  { value: 23.4, color: [96, 122, 59] },
  { value: 28.1, color: [105, 131, 60] },
  { value: 32.8, color: [119, 142, 62] },
  { value: 37.5, color: [133, 151, 67] },
  { value: 42.2, color: [148, 162, 75] },
  { value: 46.9, color: [161, 170, 87] },
  { value: 51.6, color: [182, 186, 110] },
  { value: 56.2, color: [203, 203, 143] },
  { value: 60.9, color: [223, 218, 178] },
  { value: 65.6, color: [241, 230, 208] },
  { value: 70.3, color: [253, 239, 228] },
  { value: 75, color: [255, 250, 241] },
];

export const DATASET_CONFIGS = {
  sst: {
    id: "sst",
    title: "Temperatura e Correntes",
    kicker: "ECCO2 · NASA/JPL",
    meta: "Global Sea Surface Currents and Temperature",
    sourceUrl: "https://svs.gsfc.nasa.gov/3912",
    sourceLabel: "NASA Scientific Visualization Studio · ECCO2",
    palette: SST_PALETTE,
    valueLabel: "Temperatura",
    valueUnit: "°C",
    valueMin: 0,
    valueMax: 32,
    valueDecimals: 1,
    intensityLabel: "Corrente",
    legendTitle: "Temperatura da superfície do mar",
    legendRange: "0–32 °C",
    legendTicks: [0, 8, 16, 24, 32],
    defaultScene: "global",
    scenes: [
      {
        id: "global",
        label: "Global · 2008",
        title: "Temperatura e Correntes",
        meta: "Global Sea Surface Currents and Temperature",
        image: "assets/ecco2_sst.jpg",
        projection: "equirectangular",
        ariaSubject: "mapa global da temperatura e das correntes oceânicas",
        description: "Visão global do oceano, com temperatura e correntes do modelo ECCO2 entre 2007 e 2008.",
      },
      {
        id: "atlantic",
        label: "Atlântico Norte",
        title: "Correntes do Atlântico Norte",
        meta: "ECCO2 · recorte do Atlântico Norte",
        image: "assets/ecco2_atlantic.jpg",
        projection: "local",
        regionLabel: "Atlântico Norte",
        ariaSubject: "cena regional das correntes e temperaturas do Atlântico Norte",
        description: "Recorte de alta resolução das correntes e temperaturas do Atlântico Norte.",
      },
      {
        id: "pacific",
        label: "Pacífico Oriental",
        title: "Correntes do Pacífico Oriental",
        meta: "ECCO2 · recorte do Pacífico Oriental",
        image: "assets/ecco2_pacific.jpg",
        projection: "local",
        regionLabel: "Pacífico Oriental",
        ariaSubject: "cena regional das correntes e temperaturas do Pacífico Oriental",
        description: "Detalhe das correntes e temperaturas superficiais do Pacífico Oriental.",
      },
    ],
  },
  gedi: {
    id: "gedi",
    title: "Altura das Florestas",
    kicker: "GEDI · NASA / ISS",
    meta: "GEDI Global Forest Canopy Height",
    sourceUrl: "https://svs.gsfc.nasa.gov/4950",
    sourceLabel: "NASA Scientific Visualization Studio · GEDI",
    palette: GEDI_PALETTE,
    valueLabel: "Altura do dossel",
    valueUnit: "m",
    valueMin: 0,
    valueMax: 75,
    valueDecimals: 0,
    intensityLabel: "Densidade",
    legendTitle: "Altura do dossel florestal",
    legendRange: "0–75 m",
    legendTicks: [0, 15, 30, 45, 60, 75],
    defaultScene: "global",
    scenes: [
      {
        id: "global",
        label: "Globo global",
        title: "Altura das Florestas",
        meta: "GEDI Global Forest Canopy Height",
        image: "assets/gedi_forest.jpg",
        projection: "globe",
        ariaSubject: "globo global da altura do dossel florestal medido pelo GEDI",
        description: "Visão global da altura do dossel florestal medida pelo GEDI entre 2018 e 2019.",
      },
      {
        id: "california",
        label: "Califórnia, EUA",
        title: "Costa Oeste dos EUA",
        meta: "GEDI · closeup da Califórnia",
        image: "assets/gedi_california.jpg",
        projection: "local",
        regionLabel: "Califórnia, EUA",
        ariaSubject: "cena regional da altura do dossel na Califórnia",
        description: "Closeup do dossel florestal da costa oeste dos Estados Unidos, na Califórnia.",
      },
      {
        id: "florida",
        label: "Flórida, EUA",
        title: "Flórida, EUA",
        meta: "GEDI · closeup da Flórida",
        image: "assets/gedi_florida.jpg",
        projection: "local",
        regionLabel: "Flórida, EUA",
        ariaSubject: "cena regional da altura do dossel na Flórida",
        description: "Closeup do dossel florestal da Flórida, com cobertura de dados por passagem do satélite.",
      },
      {
        id: "goddard",
        label: "Goddard, Maryland",
        title: "Goddard Space Flight Center",
        meta: "GEDI · closeup de Maryland",
        image: "assets/gedi_goddard.jpg",
        projection: "local",
        regionLabel: "Maryland, EUA",
        ariaSubject: "cena regional da altura do dossel no Goddard Space Flight Center",
        description: "Closeup do dossel ao redor do Goddard Space Flight Center, em Maryland.",
      },
      {
        id: "laurentides",
        label: "Laurentides, Canadá",
        title: "Laurentides, Quebec",
        meta: "GEDI · closeup do Canadá",
        image: "assets/gedi_laurentides.jpg",
        projection: "local",
        regionLabel: "Quebec, Canadá",
        ariaSubject: "cena regional da altura do dossel na região de Laurentides, Quebec",
        description: "Closeup do dossel da região de Laurentides, ao redor de Quebec, no Canadá.",
      },
      {
        id: "senegal",
        label: "Senegal",
        title: "Senegal",
        meta: "GEDI · closeup do Senegal",
        image: "assets/gedi_senegal.jpg",
        projection: "local",
        regionLabel: "Senegal",
        ariaSubject: "cena regional da altura do dossel no Senegal",
        description: "Closeup do dossel florestal e da vegetação do Senegal.",
      },
    ],
  },
};

export function getSceneConfig(datasetId, sceneId) {
  const dataset = DATASET_CONFIGS[datasetId];
  if (!dataset) return null;

  const scene =
    dataset.scenes.find((item) => item.id === sceneId) ||
    dataset.scenes.find((item) => item.id === dataset.defaultScene) ||
    dataset.scenes[0];

  return {
    ...dataset,
    ...scene,
    id: dataset.id,
    datasetId: dataset.id,
    sceneId: scene.id,
    palette: dataset.palette,
    valueLabel: dataset.valueLabel,
    valueUnit: dataset.valueUnit,
    valueMin: dataset.valueMin,
    valueMax: dataset.valueMax,
    valueDecimals: dataset.valueDecimals,
    intensityLabel: dataset.intensityLabel,
    legendTitle: dataset.legendTitle,
    legendRange: dataset.legendRange,
    legendTicks: dataset.legendTicks,
  };
}

const GRID_WIDTH = 480;
const GRID_HEIGHT = 240;
const VISUAL_WIDTH = 1600;
const VISUAL_HEIGHT = 800;
const GLOBE_CENTER = { x: 804, y: 399, radius: 391, lon0: 46 };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function randomSeeded(seed) {
  let state = seed >>> 0;
  return function next() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Não foi possível carregar a imagem: ${url}`));
    image.src = url;
  });
}

function rgbToHsl(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;

  if (max !== min) {
    const delta = max - min;
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    if (max === red) {
      hue = (green - blue) / delta + (green < blue ? 6 : 0);
    } else if (max === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }
    hue /= 6;
  }

  return { hue: hue * 360, saturation, lightness };
}

function nearestPaletteColor(palette, r, g, b) {
  let best = palette[0];
  let bestDistance = Infinity;

  for (const stop of palette) {
    const [pr, pg, pb] = stop.color;
    const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = stop;
    }
  }

  return { value: best.value, distance: Math.sqrt(bestDistance) };
}

function colorAt(palette, value) {
  const min = palette[0].value;
  const max = palette[palette.length - 1].value;
  const target = clamp(value, min, max);

  if (target <= min) return palette[0].color;
  if (target >= max) return palette[palette.length - 1].color;

  for (let i = 1; i < palette.length; i += 1) {
    const previous = palette[i - 1];
    const current = palette[i];
    if (target <= current.value) {
      const t = (target - previous.value) / (current.value - previous.value);
      return [
        Math.round(lerp(previous.color[0], current.color[0], t)),
        Math.round(lerp(previous.color[1], current.color[1], t)),
        Math.round(lerp(previous.color[2], current.color[2], t)),
      ];
    }
  }

  return palette[palette.length - 1].color;
}

function latitudeTemperature(lat, nx, ny) {
  const polar = Math.pow(Math.abs(lat) / 90, 1.18);
  const base = 29.5 - 32.5 * polar;
  const ripple =
    0.75 * Math.sin(nx * Math.PI * 5.1 + 0.7) +
    0.48 * Math.sin(ny * Math.PI * 7.3 + 1.4) +
    0.3 * Math.sin((nx + ny) * Math.PI * 13.7);
  return clamp(base + ripple, -1.5, 31);
}

function smoothGrid(values, flags, width, height, passes = 1) {
  let source = values;
  let destination = new Float32Array(values.length);

  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!flags[index]) {
          destination[index] = 0;
          continue;
        }

        let sum = 0;
        let count = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          const py = y + oy;
          if (py < 0 || py >= height) continue;
          for (let ox = -1; ox <= 1; ox += 1) {
            const px = x + ox;
            if (px < 0 || px >= width) continue;
            const neighbor = py * width + px;
            if (!flags[neighbor]) continue;
            sum += source[neighbor];
            count += 1;
          }
        }
        destination[index] = count ? sum / count : source[index];
      }
    }

    const swap = source;
    source = destination;
    destination = swap;
  }

  return source;
}

function oceanRegion(lat, lon) {
  if (lat >= 66.5) return "Oceano Ártico";
  if (lat <= -60) return "Oceano Austral";

  const hemisphere = lat >= 0 ? "Norte" : "Sul";

  if (lon >= -70 && lon <= 20) {
    return `Atlântico ${hemisphere}`;
  }
  if (lon > 20 && lon < 120) {
    return `Índico ${hemisphere}`;
  }
  if (lat > 30) return "Pacífico Norte";
  if (lat < -30) return "Pacífico Sul";
  return "Pacífico Equatorial";
}

function landRegion(lat, lon) {
  if (lat >= 66.5) return "Ártico";
  if (lat <= -60) return "Antártida";

  if (lon >= -170 && lon < -25) {
    if (lat >= 15) return "América do Norte";
    if (lat >= 7) return "América Central";
    return "América do Sul";
  }

  if (lon >= -25 && lon < 52) {
    if (lat >= 35) return "Europa";
    return "África";
  }

  if (lon >= 52) {
    if (lon >= 110 && lat < -10) return "Oceania";
    if (lon < 155 && lat < 10) return "Sudeste Asiático";
    return "Ásia";
  }

  if (lon < -170) {
    return lat >= 0 ? "Ásia" : "Oceania";
  }

  return "Terra";
}

function formatCoordinate(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "—";
  const latHemisphere = lat >= 0 ? "N" : "S";
  const lonHemisphere = lon >= 0 ? "L" : "O";
  const latText = Math.abs(lat).toFixed(1).replace(".", ",");
  const lonText = Math.abs(lon).toFixed(1).replace(".", ",");
  return `${latText}° ${latHemisphere} · ${lonText}° ${lonHemisphere}`;
}

function makeLegendGradient(palette) {
  const min = palette[0].value;
  const max = palette[palette.length - 1].value;
  const stops = palette.map((stop) => {
    const percentage = ((stop.value - min) / (max - min)) * 100;
    return `rgb(${stop.color.join(" ")}) ${percentage.toFixed(2)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export class EarthMapDataset {
  constructor(config) {
    this.config = config;
    this.image = null;
    this.visualCanvas = null;
    this.dataWidth = GRID_WIDTH;
    this.dataHeight = GRID_HEIGHT;
    this.values = null;
    this.intensities = null;
    this.flags = null;
    this.waterFlags = null;
    this.reasons = null;
    this.drawRect = { x: 0, y: 0, width: VISUAL_WIDTH, height: VISUAL_HEIGHT };
    this.legendGradient = makeLegendGradient(config.palette);
  }

  async load() {
    this.image = await loadImage(this.config.image);
    this._prepareProjection();
    this._buildVisual();
    this._buildDataGrid();
    return this;
  }

  _prepareProjection() {
    if (this.config.projection === "globe") {
      const scale = VISUAL_HEIGHT / this.image.height;
      const width = this.image.width * scale;
      this.drawRect = {
        x: (VISUAL_WIDTH - width) / 2,
        y: 0,
        width,
        height: VISUAL_HEIGHT,
      };
    } else if (this.config.projection === "local") {
      const scale = Math.min(
        VISUAL_WIDTH / this.image.width,
        VISUAL_HEIGHT / this.image.height
      );
      const width = this.image.width * scale;
      const height = this.image.height * scale;
      this.drawRect = {
        x: (VISUAL_WIDTH - width) / 2,
        y: (VISUAL_HEIGHT - height) / 2,
        width,
        height,
      };
    } else {
      this.drawRect = { x: 0, y: 0, width: VISUAL_WIDTH, height: VISUAL_HEIGHT };
    }
  }

  _buildVisual() {
    const canvas = document.createElement("canvas");
    canvas.width = VISUAL_WIDTH;
    canvas.height = VISUAL_HEIGHT;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    if (this.config.projection === "globe") {
      this._buildGlobeVisual(ctx);
    } else if (this.config.projection === "local") {
      this._buildLocalVisual(ctx);
    } else {
      this._buildEquirectangularVisual(ctx);
    }

    this.visualCanvas = canvas;
  }

  _buildEquirectangularVisual(ctx) {
    const background = ctx.createLinearGradient(0, 0, 0, VISUAL_HEIGHT);
    background.addColorStop(0, "#02080f");
    background.addColorStop(0.38, "#041622");
    background.addColorStop(0.68, "#04121c");
    background.addColorStop(1, "#02080f");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, VISUAL_WIDTH, VISUAL_HEIGHT);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.filter = "saturate(1.32) contrast(1.08) brightness(1.28)";
    ctx.drawImage(this.image, 0, 0, VISUAL_WIDTH, VISUAL_HEIGHT);
    ctx.restore();

    const bloom = ctx.createRadialGradient(
      VISUAL_WIDTH * 0.5,
      VISUAL_HEIGHT * 0.47,
      VISUAL_HEIGHT * 0.05,
      VISUAL_WIDTH * 0.5,
      VISUAL_HEIGHT * 0.5,
      VISUAL_HEIGHT * 0.76
    );
    bloom.addColorStop(0, "rgba(82, 206, 255, 0.07)");
    bloom.addColorStop(0.48, "rgba(51, 179, 216, 0.025)");
    bloom.addColorStop(1, "rgba(0, 0, 0, 0.34)");
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, VISUAL_WIDTH, VISUAL_HEIGHT);
  }

  _buildLocalVisual(ctx) {
    const background = ctx.createRadialGradient(
      VISUAL_WIDTH * 0.5,
      VISUAL_HEIGHT * 0.48,
      VISUAL_HEIGHT * 0.08,
      VISUAL_WIDTH * 0.5,
      VISUAL_HEIGHT * 0.5,
      VISUAL_HEIGHT * 0.78
    );
    background.addColorStop(0, "#071923");
    background.addColorStop(0.55, "#030d16");
    background.addColorStop(1, "#01050a");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, VISUAL_WIDTH, VISUAL_HEIGHT);

    const random = randomSeeded(31771);
    for (let i = 0; i < 170; i += 1) {
      const x = random() * VISUAL_WIDTH;
      const y = random() * VISUAL_HEIGHT;
      const radius = random() * 1.15 + 0.12;
      const alpha = random() * 0.3 + 0.04;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(190, 236, 255, ${alpha.toFixed(3)})`;
      ctx.fill();
    }

    const { x, y, width, height } = this.drawRect;
    ctx.save();
    ctx.shadowColor = "rgba(50, 207, 235, 0.22)";
    ctx.shadowBlur = 34;
    ctx.fillStyle = "rgba(2, 9, 16, 0.62)";
    ctx.fillRect(x - 10, y - 10, width + 20, height + 20);
    ctx.restore();

    ctx.save();
    ctx.filter = "brightness(1.22) contrast(1.08) saturate(1.2)";
    ctx.drawImage(this.image, x, y, width, height);
    ctx.restore();

    const vignette = ctx.createRadialGradient(
      VISUAL_WIDTH * 0.5,
      VISUAL_HEIGHT * 0.5,
      Math.min(width, height) * 0.42,
      VISUAL_WIDTH * 0.5,
      VISUAL_HEIGHT * 0.5,
      Math.max(width, height) * 0.74
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.34)");
    ctx.fillStyle = vignette;
    ctx.fillRect(x, y, width, height);

    ctx.strokeStyle = "rgba(144, 232, 255, 0.2)";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  }

  _buildGlobeVisual(ctx) {
    const background = ctx.createLinearGradient(0, 0, 0, VISUAL_HEIGHT);
    background.addColorStop(0, "#01040a");
    background.addColorStop(0.5, "#030b14");
    background.addColorStop(1, "#010307");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, VISUAL_WIDTH, VISUAL_HEIGHT);

    const random = randomSeeded(90210);
    for (let i = 0; i < 260; i += 1) {
      const x = random() * VISUAL_WIDTH;
      const y = random() * VISUAL_HEIGHT;
      const radius = random() * 1.35 + 0.15;
      const alpha = random() * 0.45 + 0.08;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200, 238, 255, ${alpha.toFixed(3)})`;
      ctx.fill();
    }

    const { x: cx, y: cy, radius } = GLOBE_CENTER;
    const halo = ctx.createRadialGradient(cx, cy, radius * 0.72, cx, cy, radius * 1.17);
    halo.addColorStop(0, "rgba(52, 211, 235, 0.1)");
    halo.addColorStop(0.55, "rgba(19, 103, 133, 0.08)");
    halo.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, VISUAL_WIDTH, VISUAL_HEIGHT);

    ctx.save();
    ctx.filter = "brightness(1.3) contrast(1.1) saturate(1.08)";
    ctx.drawImage(
      this.image,
      this.drawRect.x,
      this.drawRect.y,
      this.drawRect.width,
      this.drawRect.height
    );
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, radius + 2, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(144, 232, 255, 0.2)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    const glow = ctx.createRadialGradient(cx, cy, radius * 0.92, cx, cy, radius + 38);
    glow.addColorStop(0, "rgba(103, 232, 249, 0)");
    glow.addColorStop(0.5, "rgba(103, 232, 249, 0.11)");
    glow.addColorStop(1, "rgba(103, 232, 249, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 38, 0, Math.PI * 2);
    ctx.fill();
  }

  _buildDataGrid() {
    const width = GRID_WIDTH;
    const height = GRID_HEIGHT;
    const values = new Float32Array(width * height);
    const intensities = new Float32Array(width * height);
    const flags = new Uint8Array(width * height);
    const waterFlags = new Uint8Array(width * height);
    const reasons = new Uint8Array(width * height);

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = this.image.width;
    sourceCanvas.height = this.image.height;
    const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    sourceCtx.drawImage(this.image, 0, 0);
    const pixels = sourceCtx.getImageData(0, 0, this.image.width, this.image.height).data;

    for (let gy = 0; gy < height; gy += 1) {
      const ny = gy / (height - 1);
      for (let gx = 0; gx < width; gx += 1) {
        const nx = gx / (width - 1);
        const index = gy * width + gx;

        if (this.config.projection === "globe") {
          this._sampleGlobeCell(nx, ny, width, height, index, values, intensities, flags, waterFlags, reasons, pixels);
        } else if (this.config.projection === "local") {
          this._sampleLocalCell(nx, ny, index, values, intensities, flags, waterFlags, reasons, pixels);
        } else {
          this._sampleEquirectangularCell(nx, ny, index, values, intensities, flags, waterFlags, reasons, pixels);
        }
      }
    }

    this.values = smoothGrid(values, flags, width, height, 1);
    this.intensities = smoothGrid(intensities, flags, width, height, 1);
    this.flags = flags;
    this.waterFlags = waterFlags;
    this.reasons = reasons;
  }

  _sampleEquirectangularCell(nx, ny, index, values, intensities, flags, waterFlags, reasons, pixels) {
    const imageWidth = this.image.width;
    const imageHeight = this.image.height;
    const sx = Math.min(imageWidth - 1, Math.max(0, Math.floor(nx * imageWidth)));
    const sy = Math.min(imageHeight - 1, Math.max(0, Math.floor(ny * imageHeight)));
    const pixelIndex = (sy * imageWidth + sx) * 4;
    const r = pixels[pixelIndex];
    const g = pixels[pixelIndex + 1];
    const b = pixels[pixelIndex + 2];
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const hsl = rgbToHsl(r, g, b);
    const nearest = nearestPaletteColor(SST_PALETTE, r, g, b);
    const lat = 90 - ny * 180;
    const fallback = latitudeTemperature(lat, nx, ny);
    const channelSpread = Math.max(r, g, b) - Math.min(r, g, b);
    const isGrayLand = luminance > 0.13 && luminance < 0.34 && channelSpread <= 10;

    if (isGrayLand) {
      flags[index] = 0;
      reasons[index] = 1;
      return;
    }

    let temperature = fallback;
    const colorIsInformative =
      luminance > 0.075 &&
      hsl.saturation > 0.1 &&
      nearest.distance < 155;

    if (colorIsInformative) {
      temperature = nearest.value;
      if (luminance < 0.15) {
        temperature = lerp(fallback, temperature, 0.58);
      }
    }

    values[index] = clamp(temperature, 0, 32);
    intensities[index] = clamp(Math.max(0.045, Math.pow(clamp((luminance - 0.03) / 0.64, 0, 1), 0.82)), 0, 1);
    flags[index] = 1;
    waterFlags[index] = 0;
  }

  _sampleLocalCell(nx, ny, index, values, intensities, flags, waterFlags, reasons, pixels) {
    const canvasX = nx * VISUAL_WIDTH;
    const canvasY = ny * VISUAL_HEIGHT;
    const { x, y, width, height } = this.drawRect;

    if (canvasX < x || canvasX > x + width || canvasY < y || canvasY > y + height) {
      flags[index] = 0;
      reasons[index] = 2;
      return;
    }

    const imageWidth = this.image.width;
    const imageHeight = this.image.height;
    const sx = Math.min(
      imageWidth - 1,
      Math.max(0, Math.floor(((canvasX - x) / width) * imageWidth))
    );
    const sy = Math.min(
      imageHeight - 1,
      Math.max(0, Math.floor(((canvasY - y) / height) * imageHeight))
    );
    const pixelIndex = (sy * imageWidth + sx) * 4;
    const r = pixels[pixelIndex];
    const g = pixels[pixelIndex + 1];
    const b = pixels[pixelIndex + 2];
    const maxChannel = Math.max(r, g, b);
    const minChannel = Math.min(r, g, b);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const channelSpread = maxChannel - minChannel;

    if (maxChannel < 9) {
      flags[index] = 0;
      reasons[index] = 2;
      return;
    }

    if (this.config.id === "sst") {
      const isGrayLand = luminance > 0.13 && luminance < 0.34 && channelSpread <= 10;
      if (isGrayLand) {
        flags[index] = 0;
        reasons[index] = 1;
        return;
      }

      const nearest = nearestPaletteColor(SST_PALETTE, r, g, b);
      const hsl = rgbToHsl(r, g, b);
      const isColdWater =
        hsl.hue >= 170 && hsl.hue <= 260 && hsl.saturation > 0.2;
      if (nearest.distance > 190 && !isColdWater) {
        flags[index] = 0;
        reasons[index] = 2;
        return;
      }

      values[index] = clamp(nearest.value, 0, 32);
      intensities[index] = clamp(
        Math.max(0.045, Math.pow(clamp((luminance - 0.03) / 0.64, 0, 1), 0.82)),
        0,
        1
      );
      flags[index] = 1;
      waterFlags[index] = 0;
      return;
    }

    const isWater = b > r + 16 && b > g + 7 && maxChannel > 22;
    if (isWater) {
      values[index] = 0;
      intensities[index] = 0.06;
      flags[index] = 1;
      waterFlags[index] = 1;
      return;
    }

    const nearest = nearestPaletteColor(GEDI_PALETTE, r, g, b);
    values[index] = clamp(nearest.value, 0, 75);
    intensities[index] = clamp(
      Math.max(0.06, Math.pow(clamp((luminance - 0.05) / 0.66, 0, 1), 0.88)),
      0,
      1
    );
    flags[index] = 1;
    waterFlags[index] = 0;
  }

  _sampleGlobeCell(nx, ny, width, height, index, values, intensities, flags, waterFlags, reasons, pixels) {
    const canvasX = nx * VISUAL_WIDTH;
    const canvasY = ny * VISUAL_HEIGHT;
    const dx = (canvasX - GLOBE_CENTER.x) / GLOBE_CENTER.radius;
    const dy = (canvasY - GLOBE_CENTER.y) / GLOBE_CENTER.radius;
    const inside = dx * dx + dy * dy <= 1.005;

    if (!inside) {
      flags[index] = 0;
      reasons[index] = 2;
      return;
    }

    const srcX = Math.min(
      this.image.width - 1,
      Math.max(0, Math.floor(((canvasX - this.drawRect.x) / this.drawRect.width) * this.image.width))
    );
    const srcY = Math.min(
      this.image.height - 1,
      Math.max(0, Math.floor(((canvasY - this.drawRect.y) / this.drawRect.height) * this.image.height))
    );
    const pixelIndex = (srcY * this.image.width + srcX) * 4;
    const r = pixels[pixelIndex];
    const g = pixels[pixelIndex + 1];
    const b = pixels[pixelIndex + 2];
    const maxChannel = Math.max(r, g, b);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const isWater = b > r + 16 && b > g + 7 && maxChannel > 22;
    const nearest = nearestPaletteColor(GEDI_PALETTE, r, g, b);

    flags[index] = 1;

    if (isWater) {
      values[index] = 0;
      intensities[index] = 0.06;
      waterFlags[index] = 1;
      return;
    }

    if (maxChannel < 10) {
      values[index] = 0;
      intensities[index] = 0.025;
      waterFlags[index] = 0;
      return;
    }

    values[index] = clamp(nearest.value, 0, 75);
    intensities[index] = clamp(Math.max(0.06, Math.pow(clamp((luminance - 0.05) / 0.66, 0, 1), 0.88)), 0, 1);
    waterFlags[index] = 0;
  }

  _bilinear(array, nx, ny) {
    const width = this.dataWidth;
    const height = this.dataHeight;
    const x = clamp(nx, 0, 1) * (width - 1);
    const y = clamp(ny, 0, 1) * (height - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;

    const top = lerp(array[y0 * width + x0], array[y0 * width + x1], tx);
    const bottom = lerp(array[y1 * width + x0], array[y1 * width + x1], tx);
    return lerp(top, bottom, ty);
  }

  _flagAt(nx, ny) {
    const x = Math.round(clamp(nx, 0, 1) * (this.dataWidth - 1));
    const y = Math.round(clamp(ny, 0, 1) * (this.dataHeight - 1));
    return this.flags[y * this.dataWidth + x];
  }

  _waterAt(nx, ny) {
    const x = Math.round(clamp(nx, 0, 1) * (this.dataWidth - 1));
    const y = Math.round(clamp(ny, 0, 1) * (this.dataHeight - 1));
    return this.waterFlags[y * this.dataWidth + x];
  }

  reasonAt(nx, ny) {
    const x = Math.round(clamp(nx, 0, 1) * (this.dataWidth - 1));
    const y = Math.round(clamp(ny, 0, 1) * (this.dataHeight - 1));
    return this.reasons[y * this.dataWidth + x];
  }

  sample(nx, ny) {
    const safeX = clamp(nx, 0, 1);
    const safeY = clamp(ny, 0, 1);

    if (!this._flagAt(safeX, safeY)) {
      return null;
    }

    const value = this._bilinear(this.values, safeX, safeY);
    const intensity = clamp(this._bilinear(this.intensities, safeX, safeY), 0, 1);
    const config = this.config;
    const normalized = clamp(
      (value - config.valueMin) / (config.valueMax - config.valueMin),
      0,
      1
    );

    const location = this.locationAt(safeX, safeY);
    const isWater = Boolean(this._waterAt(safeX, safeY));

    return {
      x: safeX,
      y: safeY,
      value,
      normalized,
      intensity,
      lat: location ? location.lat : null,
      lon: location ? location.lon : null,
      coordinateLabel: location
        ? formatCoordinate(location.lat, location.lon)
        : this.config.projection === "local"
          ? "Cena regional"
          : "—",
      isWater,
      region: this.regionAt(safeX, safeY, location, isWater),
      color: colorAt(config.palette, value),
    };
  }

  coordinateAt(nx, ny) {
    if (this.config.projection === "local") {
      return "Cena regional";
    }
    const location = this.locationAt(nx, ny);
    return location ? formatCoordinate(location.lat, location.lon) : "—";
  }

  locationAt(nx, ny) {
    if (this.config.projection === "equirectangular") {
      return {
        lat: 90 - ny * 180,
        lon: nx * 360 - 180,
      };
    }

    if (this.config.projection === "local") {
      return null;
    }

    const canvasX = nx * VISUAL_WIDTH;
    const canvasY = ny * VISUAL_HEIGHT;
    const dx = (canvasX - GLOBE_CENTER.x) / GLOBE_CENTER.radius;
    const dy = (canvasY - GLOBE_CENTER.y) / GLOBE_CENTER.radius;

    if (dx * dx + dy * dy > 1.02) {
      return null;
    }

    const lat = Math.asin(clamp(-dy, -1, 1)) * (180 / Math.PI);
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const lonOffset = cosLat < 0.0001 ? 0 : Math.asin(clamp(dx / cosLat, -1, 1)) * (180 / Math.PI);
    let lon = GLOBE_CENTER.lon0 + lonOffset;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;

    return { lat, lon };
  }

  regionAt(nx, ny, location, isWater) {
    if (this.config.projection === "local") {
      return this.config.regionLabel || "Cena regional";
    }

    if (!location) return "Fora do globo";

    if (this.config.projection === "globe") {
      return isWater ? oceanRegion(location.lat, location.lon) : landRegion(location.lat, location.lon);
    }

    return oceanRegion(location.lat, location.lon);
  }
}

const datasetCache = new Map();

export function getCachedDataset(datasetId, sceneId) {
  const config = getSceneConfig(datasetId, sceneId);
  if (!config) return null;
  return datasetCache.get(`${config.id}:${config.sceneId}`) || null;
}

export function loadDataset(datasetId, sceneId) {
  const config = getSceneConfig(datasetId, sceneId);
  if (!config) {
    return Promise.reject(new Error(`Dataset desconhecido: ${datasetId}`));
  }

  const cacheKey = `${config.id}:${config.sceneId}`;
  if (datasetCache.has(cacheKey)) {
    return datasetCache.get(cacheKey);
  }

  const promise = new EarthMapDataset(config).load().then((dataset) => {
    datasetCache.set(cacheKey, dataset);
    return dataset;
  });

  datasetCache.set(cacheKey, promise);
  return promise;
}

export function colorForValue(config, value) {
  return colorAt(config.palette, value);
}

export function paletteGradient(config) {
  return makeLegendGradient(config.palette);
}
