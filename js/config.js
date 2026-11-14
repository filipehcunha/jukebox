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
const INSTRUMENT_DEFAULTS = {
  CELLO: ["Violoncelo", -1, 36, 57],
  DOUBLE_BASS: ["Contrabaixo", -0.5, 28, 50],
  GRAND_PIANO: ["Piano de cauda", -1.5, 55, 84],
  MARIMBA: ["Marimba", -1, 48, 84],
  FLUTE: ["Flauta", -5, 72, 93],
  HARP: ["Harpa", -4.5, 55, 88],
  VIOLIN: ["Violino", -5, 62, 88],
  CLARINET: ["Clarinete", -4.5, 52, 81],
  SYNTH_PAD: ["Sintetizador (pad)", -6, 48, 72],
  STEEL_DRUM: ["Steel drum", -3, 57, 81],
};

function buildInstrument(id) {
  const [dName, dDb, dLo, dHi] = INSTRUMENT_DEFAULTS[id];
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
    label: typeof user.nome === "string" && user.nome.trim() ? user.nome.trim() : dName,
    volumeDb,
    level: dbToGain(volumeDb), // ganho linear usado pelo motor de áudio
    range: [lo, hi],
  };
}

/** Todos os instrumentos disponíveis, já com nome, volume (dB) e faixa do config.json. */
export const SAMPLE_SET = Object.fromEntries(Object.keys(INSTRUMENT_TECH).map((id) => [id, buildInstrument(id)]));
export const SAMPLE_SET_NAMES = Object.keys(SAMPLE_SET);
for (const id of Object.keys(clean(section("instrumentos")))) {
  if (!SAMPLE_SET[id]) problem(`instrumentos.${id} não existe. Instrumentos disponíveis: ${SAMPLE_SET_NAMES.join(", ")}.`);
}

// Apelidos aceitos no mapeamento
export const INSTRUMENT_ALIASES = { PIANO: "GRAND_PIANO", BASS: "DOUBLE_BASS", CONTRABASS: "DOUBLE_BASS", PAD: "SYNTH_PAD" };

export function resolveInstrument(name) {
  const key = String(name || "").toUpperCase();
  const id = INSTRUMENT_ALIASES[key] || key;
  return SAMPLE_SET[id] ? id : null;
}

// ---------------------------------------------------------------------------
// Mapeamento: característica do planeta → instrumento (config.json → "mapeamento")
// ---------------------------------------------------------------------------
// Nomes em português das características
export const VARIABLE_LABELS = {
  TEMPERATURE: "Temperatura",
  HUMIDITY: "Umidade",
  VEGETATION_DENSITY: "Densidade da vegetação",
  OCEAN_CURRENTS: "Correntes oceânicas",
  ALTITUDE_ELEVATION: "Altitude e relevo",
};
const DEFAULT_MAPPING = {
  TEMPERATURE: "CELLO",
  HUMIDITY: "FLUTE",
  VEGETATION_DENSITY: "MARIMBA",
  OCEAN_CURRENTS: "HARP",
  ALTITUDE_ELEVATION: "GRAND_PIANO",
};

export const MAPPING_CONFIG = { ...DEFAULT_MAPPING };
for (const [variable, inst] of Object.entries(clean(section("mapeamento")))) {
  if (!(variable in DEFAULT_MAPPING)) {
    problem(`mapeamento.${variable} não é uma característica conhecida (${Object.keys(DEFAULT_MAPPING).join(", ")}).`);
    continue;
  }
  const id = resolveInstrument(inst);
  if (id) MAPPING_CONFIG[variable] = id;
  else problem(`mapeamento.${variable}: instrumento "${inst}" não existe; usando ${DEFAULT_MAPPING[variable]}. Disponíveis: ${SAMPLE_SET_NAMES.join(", ")}.`);
}

// ---------------------------------------------------------------------------
// Camadas da sonificação (config.json → "camadasPorEscala")
// ---------------------------------------------------------------------------
// A música tem 4 camadas fixas. Cada escala de cores decide quanto cada camada soa
// (scales.js → roles); o mapeamento decide QUAL instrumento toca em cada camada.
//
//   low  → grave: frio, seco, calmo
//   mid  → médio: valores intermediários
//   high → agudo: úmido, quente, dossel alto, pixels claros
//   arp  → arpejos: correntes, ventos fortes, frentes (gradientes)
export const LAYER_ORDER = ["low", "mid", "high", "arp"];

const DEFAULT_LAYERS = { low: "TEMPERATURE", mid: "ALTITUDE_ELEVATION", high: "HUMIDITY", arp: "OCEAN_CURRENTS" };
export const SCALE_LAYER_MAPPING = { default: { ...DEFAULT_LAYERS } };
for (const [scaleId, layers] of Object.entries(clean(section("camadasPorEscala")))) {
  const target = (SCALE_LAYER_MAPPING[scaleId] ||= {});
  for (const [layer, variable] of Object.entries(clean(layers))) {
    if (!LAYER_ORDER.includes(layer)) problem(`camadasPorEscala.${scaleId}.${layer}: as camadas são ${LAYER_ORDER.join(", ")}.`);
    else if (!(variable in MAPPING_CONFIG)) problem(`camadasPorEscala.${scaleId}.${layer}: característica "${variable}" desconhecida.`);
    else target[layer] = variable;
  }
}

// Característica (chave do mapeamento) de cada camada para uma escala
export function layerVariable(scaleId, layer) {
  return SCALE_LAYER_MAPPING[scaleId]?.[layer] || SCALE_LAYER_MAPPING.default[layer];
}

// Instrumento (chave do SAMPLE_SET) de cada camada para uma escala
export function layerInstruments(scaleId) {
  return Object.fromEntries(LAYER_ORDER.map((l) => [l, MAPPING_CONFIG[layerVariable(scaleId, l)]]));
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
  narration: {
    onAtStart: bool("narracao", "ligadaAoAbrir", false),
    pauseMusic: bool("narracao", "pausarMusica", true),
    duckDb: num("narracao", "reducaoDb", -15, -60, 0),
    fadeOutS: num("narracao", "tempoParaSilenciarS", 0.12, 0.01, 5),
    fadeInS: num("narracao", "tempoParaVoltarS", 0.5, 0.01, 5),
    rate: num("narracao", "velocidade", 1.05, 0.5, 2),
    volume: num("narracao", "volume", 1, 0, 1),
    restMs: num("narracao", "esperaParadoMs", 700, 200, 10000),
    readControls: bool("narracao", "lerControlesAoFocar", true),
  },
  low: {
    reduceDb: num("baixaSensibilidade", "reducaoDb", -10, -40, 0),
    limiterDb: num("baixaSensibilidade", "limitadorDb", -16, -40, 0),
    filterMinHz: num("baixaSensibilidade", "filtroMinHz", 700, 100, 20000),
    filterMaxHz: num("baixaSensibilidade", "filtroMaxHz", 1700, 100, 20000),
    voiceRate: num("baixaSensibilidade", "velocidadeVoz", 0.94, 0.5, 2),
    voiceVolume: num("baixaSensibilidade", "volumeVoz", 0.7, 0, 1),
    hapticStrength: num("baixaSensibilidade", "forcaVibracao", 0.45, 0, 1),
  },
  keyboard: {
    step: num("teclado", "passo", 0.0125, 0.001, 0.5),
    bigStep: num("teclado", "passoComShift", 0.05, 0.001, 0.5),
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
