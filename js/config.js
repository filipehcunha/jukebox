// ===========================================================================
// CONFIGURAÇÃO: tudo o que é ajustável vem de config.json (na raiz do projeto)
// ===========================================================================
//
// Este módulo só LÊ o config.json, valida e entrega os valores ao resto do app.
// Para mudar instrumentos, volumes (dB), narração etc., edite o config.json à mão e
// recarregue a página. Nada aqui é gravado pela interface.
//
// Valor ausente ou inválido no JSON não quebra o app: usa-se o padrão indicado aqui e o
// problema aparece em CONFIG_PROBLEMS (mostrado na tela e no console).

import { t } from "./i18n.js";

export const CONFIG_PROBLEMS = [];
const problem = (msg) => { CONFIG_PROBLEMS.push(msg); console.warn(`[config.json] ${msg}`); };

let raw = {};
try {
  const res = await fetch(new URL("../config.json", import.meta.url), { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  raw = await res.json();
} catch (err) {
  problem(`Não foi possível ler o config.json (${err.message}). Usando os valores padrão.`);
}

// --- leitura com validação --------------------------------------------------
const section = (name) => (raw[name] && typeof raw[name] === "object" ? raw[name] : {});
// remove as chaves de comentário (_comentario, _sobre...)
const clean = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !k.startsWith("_")));

function num(sec, key, fallback, min = -Infinity, max = Infinity) {
  const v = section(sec)[key];
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    problem(`${sec}.${key} deve ser um número; usando ${fallback}.`);
    return fallback;
  }
  if (v < min || v > max) {
    problem(`${sec}.${key} = ${v} está fora da faixa ${min} a ${max}; usando ${fallback}.`);
    return fallback;
  }
  return v;
}
// objeto { escala: número } (ex.: alerta.limites); chaves desconhecidas ou não numéricas são avisadas
function limits(sec, key, allowed) {
  const v = section(sec)[key];
  if (v === undefined) return {};
  if (!v || typeof v !== "object") {
    problem(`${sec}.${key} deve ser um objeto como { "temp": 35 }; usando os limites padrão.`);
    return {};
  }
  const out = {};
  for (const [k, n] of Object.entries(clean(v))) {
    if (!allowed.includes(k)) problem(`${sec}.${key}.${k}: escala desconhecida (use ${allowed.join(", ")}).`);
    else if (typeof n !== "number" || !Number.isFinite(n)) problem(`${sec}.${key}.${k} deve ser um número.`);
    else out[k] = n;
  }
  return out;
}
// número dentro de um subobjeto (ex.: paisagem.mar.volumeDb)
function sub(sec, key, field, fallback, min, max) {
  const o = section(sec)[key];
  const v = o && typeof o === "object" ? o[field] : undefined;
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    problem(`${sec}.${key}.${field} deve ser um número entre ${min} e ${max}; usando ${fallback}.`);
    return fallback;
  }
  return v;
}
function bool(sec, key, fallback) {
  const v = section(sec)[key];
  if (v === undefined) return fallback;
  if (typeof v !== "boolean") {
    problem(`${sec}.${key} deve ser true ou false; usando ${fallback}.`);
    return fallback;
  }
  return v;
}
function oneOf(sec, key, options, fallback) {
  const v = section(sec)[key];
  if (v === undefined) return fallback;
  if (!options.includes(v)) {
    problem(`${sec}.${key} deve ser um de: ${options.join(", ")}; usando ${fallback}.`);
    return fallback;
  }
  return v;
}

export const dbToGain = (db) => 10 ** (db / 20);

// ---------------------------------------------------------------------------
// Instrumentos: a parte técnica (timbre, amostras) fica aqui; nome, volume em dB e
// faixa de notas vêm de config.json → "instrumentos"
// ---------------------------------------------------------------------------
//   sustain → true: nota longa com legato/glide; false: nota percutida/pinçada
//   synth   → timbre sintetizado (usado offline, enquanto as amostras carregam ou sem amostras)
//   samples → gravações reais (opcional). Nota "A#1" vira o arquivo "As1.mp3".
const TONEJS_INSTRUMENTS = "https://nbrosowsky.github.io/tonejs-instruments/samples/";
const notes = (list) => Object.fromEntries(list.map((n) => [n, `${n.replace("#", "s")}.mp3`]));

const INSTRUMENT_TECH = {
  CELLO: {
    family: "Cordas friccionadas", icon: "bowed", sustain: true, synth: "bowed",
    samples: { baseUrl: `${TONEJS_INSTRUMENTS}cello/`, urls: notes(["C2", "E2", "G2", "A2", "C3", "E3", "G3", "A3", "C4", "E4"]), attack: 0.12, release: 1.6 },
  },
  DOUBLE_BASS: {
    family: "Cordas friccionadas", icon: "bowed", sustain: true, synth: "bowedLow",
    samples: { baseUrl: `${TONEJS_INSTRUMENTS}contrabass/`, urls: notes(["F#1", "G1", "A#1", "C2", "D2", "E2", "F#2", "G#2", "A2", "C#3", "E3", "G#3", "B3"]), attack: 0.1, release: 1.4 },
  },
  GRAND_PIANO: {
    family: "Teclas", icon: "keys", sustain: false, synth: "keys",
    samples: {
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      urls: notes(["A1", "C2", "D#2", "F#2", "A2", "C3", "D#3", "F#3", "A3", "C4", "D#4", "F#4", "A4", "C5", "D#5", "F#5", "A5", "C6"]),
      release: 1.6,
    },
  },
  MARIMBA: { family: "Percussão de teclas", icon: "mallet", sustain: false, synth: "mallet" },
  FLUTE: {
    family: "Sopros de madeira", icon: "wind", sustain: true, synth: "flute",
    samples: { baseUrl: `${TONEJS_INSTRUMENTS}flute/`, urls: notes(["C4", "E4", "A4", "C5", "E5", "A5", "C6", "E6", "A6", "C7"]), attack: 0.15, release: 1.4 },
  },
  HARP: {
    family: "Cordas pinçadas", icon: "harp", sustain: false, synth: "pluck",
    samples: {
      baseUrl: `${TONEJS_INSTRUMENTS}harp/`,
      urls: notes(["B1", "D2", "F2", "A2", "C3", "E3", "G3", "B3", "D4", "F4", "A4", "C5", "E5", "G5", "B5", "D6"]),
      release: 1.8,
    },
  },
  VIOLIN: {
    family: "Cordas friccionadas", icon: "bowed", sustain: true, synth: "bowedHigh",
    samples: { baseUrl: `${TONEJS_INSTRUMENTS}violin/`, urls: notes(["G3", "A3", "C4", "E4", "G4", "A4", "C5", "E5", "G5", "A5", "C6", "E6", "G6"]), attack: 0.1, release: 1.3 },
  },
  CLARINET: {
    family: "Sopros de madeira", icon: "wind", sustain: true, synth: "reed",
    samples: { baseUrl: `${TONEJS_INSTRUMENTS}clarinet/`, urls: notes(["D3", "F3", "A#3", "D4", "F4", "A#4", "D5", "F5", "A#5", "D6"]), attack: 0.08, release: 1.0 },
  },
  SYNTH_PAD: { family: "Eletrônico", icon: "pad", sustain: true, synth: "pad" },
  STEEL_DRUM: { family: "Percussão metálica", icon: "mallet", sustain: false, synth: "steel" },
};

// padrões usados só quando o config.json não traz o instrumento ou o campo
// padrões usados só quando o config.json não traz o instrumento ou o campo: [volumeDb, grave, aguda]
const INSTRUMENT_DEFAULTS = {
  CELLO: [-9, 36, 64],
  DOUBLE_BASS: [-4, 28, 52],
  GRAND_PIANO: [-1.5, 48, 84],
  MARIMBA: [1, 48, 84],
  FLUTE: [-12, 60, 93],
  HARP: [-10, 48, 86],
  VIOLIN: [-8, 55, 91],
  CLARINET: [-10, 50, 86],
  SYNTH_PAD: [4, 48, 84],
  STEEL_DRUM: [6, 57, 86],
};

function buildInstrument(id) {
  const [dDb, dLo, dHi] = INSTRUMENT_DEFAULTS[id];
  const user = clean(section("instrumentos")[id]);
  const field = (key, fallback, min, max) => {
    const v = user[key];
    if (v === undefined) return fallback;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
      problem(`instrumentos.${id}.${key} deve ser um número entre ${min} e ${max}; usando ${fallback}.`);
      return fallback;
    }
    return v;
  };
  const volumeDb = field("volumeDb", dDb, -60, 12);
  let lo = Math.round(field("notaMaisGrave", dLo, 12, 108));
  let hi = Math.round(field("notaMaisAguda", dHi, 12, 108));
  if (hi - lo < 12) {
    problem(`instrumentos.${id}: a faixa de notas precisa ter pelo menos uma oitava (12); usando ${dLo} a ${dHi}.`);
    lo = dLo;
    hi = dHi;
  }
  return {
    ...INSTRUMENT_TECH[id],
    id,
    // nome no idioma atual (lang/*.json → instruments)
    get label() { return t(`instruments.${id}`); },
    volumeDb,
    level: dbToGain(volumeDb), // ganho linear usado pelo motor de áudio
    range: [lo, hi],
  };
}

/** Todos os instrumentos disponíveis, já com volume (dB) e faixa do config.json. */
export const SAMPLE_SET = Object.fromEntries(Object.keys(INSTRUMENT_TECH).map((id) => [id, buildInstrument(id)]));
export const SAMPLE_SET_NAMES = Object.keys(SAMPLE_SET);
for (const id of Object.keys(clean(section("instrumentos")))) {
  if (!SAMPLE_SET[id]) problem(`instrumentos.${id} não existe. Instrumentos disponíveis: ${SAMPLE_SET_NAMES.join(", ")}.`);
}

// Apelidos aceitos
export const INSTRUMENT_ALIASES = { PIANO: "GRAND_PIANO", BASS: "DOUBLE_BASS", CONTRABASS: "DOUBLE_BASS", PAD: "SYNTH_PAD" };

export function resolveInstrument(name) {
  const key = String(name || "").toUpperCase();
  const id = INSTRUMENT_ALIASES[key] || key;
  return SAMPLE_SET[id] ? id : null;
}

// ---------------------------------------------------------------------------
// Um instrumento por mapa (config.json → "instrumentoPorMapa")
// ---------------------------------------------------------------------------
// Cada mapa mostra uma característica (temperatura, umidade, vento...) e ela é tocada por um
// único instrumento: quanto maior o valor, mais aguda a nota.
const DEFAULT_BY_MAP = { temp: "GRAND_PIANO", humidity: "FLUTE", wind: "VIOLIN", co: "CELLO", sst: "MARIMBA", gedi: "HARP" };

export const INSTRUMENT_BY_MAP = { ...DEFAULT_BY_MAP };
for (const [scaleId, inst] of Object.entries(clean(section("instrumentoPorMapa")))) {
  if (!(scaleId in DEFAULT_BY_MAP)) {
    problem(`instrumentoPorMapa.${scaleId} não é um mapa conhecido (${Object.keys(DEFAULT_BY_MAP).join(", ")}).`);
    continue;
  }
  const id = resolveInstrument(inst);
  if (id) INSTRUMENT_BY_MAP[scaleId] = id;
  else problem(`instrumentoPorMapa.${scaleId}: instrumento "${inst}" não existe; usando ${DEFAULT_BY_MAP[scaleId]}. Disponíveis: ${SAMPLE_SET_NAMES.join(", ")}.`);
}

export const instrumentForScale = (scaleId) => INSTRUMENT_BY_MAP[scaleId] || DEFAULT_BY_MAP.temp;

// O motor de áudio tem 4 vozes (usadas juntas pela sinfonia do mapa). Todas recebem o MESMO
// instrumento do mapa: a exploração toca só a voz média; a sinfonia faz harmonia com ele.
export const LAYER_ORDER = ["low", "mid", "high", "arp"];
export function layerInstruments(scaleId) {
  const inst = instrumentForScale(scaleId);
  return Object.fromEntries(LAYER_ORDER.map((l) => [l, inst]));
}

// ---------------------------------------------------------------------------
// Demais parâmetros
// ---------------------------------------------------------------------------
export const SETTINGS = {
  audio: {
    volumeDb: num("audio", "volumeGeralDb", 0, -30, 6),
    key: oneOf("audio", "tonalidade", ["C", "G"], "C"),
    useSamples: bool("audio", "usarAmostrasGravadas", true),
    limiterDb: num("audio", "limitadorDb", -3, -40, 0),
    reverb: num("audio", "reverberacao", 0.3, 0, 1),
  },
  alert: {
    enabled: bool("alerta", "ativo", true),
    volumeDb: num("alerta", "volumeDb", -19, -60, 6),
    limits: limits("alerta", "limites", ["temp", "sst", "co", "wind"]),
  },
  sweep: {
    durationS: num("passeio", "duracaoS", 45, 10, 600),
    rows: Math.round(num("passeio", "linhasMapaInteiro", 5, 1, 20)),
  },
  ambience: {
    enabled: bool("paisagem", "ativo", true),
    mar: { volumeDb: sub("paisagem", "mar", "volumeDb", -5, -60, 12), waveS: sub("paisagem", "mar", "periodoOndaS", 7, 2, 30) },
    gelo: { volumeDb: sub("paisagem", "gelo", "volumeDb", 5, -60, 12) },
    floresta: { volumeDb: sub("paisagem", "floresta", "volumeDb", 0, -60, 12) },
    deserto: { volumeDb: sub("paisagem", "deserto", "volumeDb", -13, -60, 12) },
    fronteira: { volumeDb: sub("paisagem", "fronteira", "volumeDb", -8, -60, 12) },
  },
  narration: {
    onAtStart: bool("narracao", "vozLigadaAoAbrir", true),
    readControls: bool("narracao", "lerControlesAoNavegar", false),
    pauseMusic: bool("narracao", "pausarMusica", true),
    duckDb: num("narracao", "reducaoDb", -15, -60, 0),
    fadeOutS: num("narracao", "tempoParaSilenciarS", 0.12, 0.01, 5),
    fadeInS: num("narracao", "tempoParaVoltarS", 0.5, 0.01, 5),
    rate: num("narracao", "velocidade", 1.05, 0.5, 2),
    volume: num("narracao", "volume", 1, 0, 1),
    readLegend: bool("narracao", "lerLegendaAoAbrir", true),
  },
  keyboard: {
    step: num("teclado", "passo", 0.025, 0.001, 0.5),
  },
  haptics: {
    pulseColdMs: num("vibracao", "pulsoFrioMs", 240, 5, 2000),
    pulseHotMs: num("vibracao", "pulsoQuenteMs", 22, 5, 2000),
    gapColdMs: num("vibracao", "intervaloFrioMs", 560, 5, 5000),
    gapHotMs: num("vibracao", "intervaloQuenteMs", 38, 5, 5000),
    strengthCold: num("vibracao", "forcaFrio", 0.35, 0, 1),
    strengthHot: num("vibracao", "forcaQuente", 1, 0, 1),
  },
  a11y: {
    textSize: oneOf("acessibilidade", "tamanhoTexto", ["normal", "grande", "enorme"], "normal"),
    highContrast: section("acessibilidade").altoContraste === true ? true : section("acessibilidade").altoContraste === false ? false : null,
  },
};
