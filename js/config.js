// ===========================================================================
// CONSTANTES DE MAPEAMENTO (edite aqui para trocar os instrumentos)
// ===========================================================================
//
// Cada variável de dado terrestre toca um instrumento do SAMPLE_SET abaixo.
// Basta trocar o nome (ex.: TEMPERATURE: 'DOUBLE_BASS') e recarregar a página.

export const MAPPING_CONFIG = {
  TEMPERATURE: "CELLO", //          Águas frias a quentes
  HUMIDITY: "FLUTE", //             Nuvens e umidade atmosférica
  VEGETATION_DENSITY: "MARIMBA", // Altura do dossel (GEDI)
  OCEAN_CURRENTS: "HARP", //        Velocidade e fluxo de água
  ALTITUDE_ELEVATION: "PIANO", //   Relevo
};

// Apelidos aceitos no MAPPING_CONFIG
export const INSTRUMENT_ALIASES = { PIANO: "GRAND_PIANO", BASS: "DOUBLE_BASS", CONTRABASS: "DOUBLE_BASS", PAD: "SYNTH_PAD" };

// ---------------------------------------------------------------------------
// Camadas da sonificação
// ---------------------------------------------------------------------------
// A música tem 4 camadas fixas. Cada escala de cores decide quanto cada camada soa
// (scales.js → roles); o MAPPING_CONFIG decide QUAL instrumento toca em cada camada.
//
//   low  → grave: frio, seco, calmo
//   mid  → médio: valores intermediários
//   high → agudo: úmido, quente, dossel alto, pixels claros
//   arp  → arpejos: correntes, ventos fortes, frentes (gradientes)
export const LAYER_ORDER = ["low", "mid", "high", "arp"];

// Variável de dado associada a cada camada, por escala. "default" vale para todas;
// as outras chaves sobrescrevem só as camadas indicadas.
export const SCALE_LAYER_MAPPING = {
  default: { low: "TEMPERATURE", mid: "ALTITUDE_ELEVATION", high: "HUMIDITY", arp: "OCEAN_CURRENTS" },
  gedi: { mid: "VEGETATION_DENSITY" }, // vegetação moderada → marimba
};

// ---------------------------------------------------------------------------
// SAMPLE_SET: todos os instrumentos disponíveis
// ---------------------------------------------------------------------------
//   range   → faixa MIDI tocada (as notas são sempre da pentatônica maior)
//   sustain → true: nota longa com legato/glide; false: nota percutida/pinçada
//   level   → nível relativo no mix
//   synth   → timbre sintetizado (usado offline, enquanto as amostras carregam ou sem amostras)
//   samples → gravações reais (opcional). Nota "A#1" vira o arquivo "As1.mp3".
const TONEJS_INSTRUMENTS = "https://nbrosowsky.github.io/tonejs-instruments/samples/";
const notes = (list) => Object.fromEntries(list.map((n) => [n, `${n.replace("#", "s")}.mp3`]));

export const SAMPLE_SET = {
  CELLO: {
    label: "Violoncelo",
    family: "Cordas friccionadas",
    icon: "bowed",
    range: [36, 57], // Dó2–Lá3
    sustain: true,
    level: 0.9,
    synth: "bowed",
    samples: { baseUrl: `${TONEJS_INSTRUMENTS}cello/`, urls: notes(["C2", "E2", "G2", "A2", "C3", "E3", "G3", "A3", "C4", "E4"]), attack: 0.12, release: 1.6 },
  },
  DOUBLE_BASS: {
    label: "Contrabaixo",
    family: "Cordas friccionadas",
    icon: "bowed",
    range: [28, 50], // Mi1–Ré3
    sustain: true,
    level: 0.95,
    synth: "bowedLow",
    samples: { baseUrl: `${TONEJS_INSTRUMENTS}contrabass/`, urls: notes(["F#1", "G1", "A#1", "C2", "D2", "E2", "F#2", "G#2", "A2", "C#3", "E3", "G#3", "B3"]), attack: 0.1, release: 1.4 },
  },
  GRAND_PIANO: {
    label: "Piano de cauda",
    family: "Teclas",
    icon: "keys",
    range: [55, 84], // Sol3–Dó6
    sustain: false,
    level: 0.85,
    synth: "keys",
    samples: {
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      urls: notes(["A1", "C2", "D#2", "F#2", "A2", "C3", "D#3", "F#3", "A3", "C4", "D#4", "F#4", "A4", "C5", "D#5", "F#5", "A5", "C6"]),
      release: 1.6,
    },
  },
  MARIMBA: {
    label: "Marimba",
    family: "Percussão de teclas",
    icon: "mallet",
    range: [48, 84], // Dó3–Dó6
    sustain: false,
    level: 0.9,
    synth: "mallet",
  },
  FLUTE: {
    label: "Flauta",
    family: "Sopros de madeira",
    icon: "wind",
    range: [72, 93], // Dó5–Lá6
    sustain: true,
    level: 0.55,
    synth: "flute",
    samples: { baseUrl: `${TONEJS_INSTRUMENTS}flute/`, urls: notes(["C4", "E4", "A4", "C5", "E5", "A5", "C6", "E6", "A6", "C7"]), attack: 0.15, release: 1.4 },
  },
  HARP: {
    label: "Harpa",
    family: "Cordas pinçadas",
    icon: "harp",
    range: [55, 88], // Sol3–Mi6
    sustain: false,
    level: 0.6,
    synth: "pluck",
    samples: {
      baseUrl: `${TONEJS_INSTRUMENTS}harp/`,
      urls: notes(["B1", "D2", "F2", "A2", "C3", "E3", "G3", "B3", "D4", "F4", "A4", "C5", "E5", "G5", "B5", "D6"]),
      release: 1.8,
    },
  },
  VIOLIN: {
    label: "Violino",
    family: "Cordas friccionadas",
    icon: "bowed",
    range: [62, 88], // Ré4–Mi6
    sustain: true,
    level: 0.55,
    synth: "bowedHigh",
    samples: { baseUrl: `${TONEJS_INSTRUMENTS}violin/`, urls: notes(["G3", "A3", "C4", "E4", "G4", "A4", "C5", "E5", "G5", "A5", "C6", "E6", "G6"]), attack: 0.1, release: 1.3 },
  },
  CLARINET: {
    label: "Clarinete",
    family: "Sopros de madeira",
    icon: "wind",
    range: [52, 81], // Mi3–Lá5
    sustain: true,
    level: 0.6,
    synth: "reed",
    samples: { baseUrl: `${TONEJS_INSTRUMENTS}clarinet/`, urls: notes(["D3", "F3", "A#3", "D4", "F4", "A#4", "D5", "F5", "A#5", "D6"]), attack: 0.08, release: 1.0 },
  },
  SYNTH_PAD: {
    label: "Sintetizador (pad)",
    family: "Eletrônico",
    icon: "pad",
    range: [48, 72], // Dó3–Dó5
    sustain: true,
    level: 0.5,
    synth: "pad",
  },
  STEEL_DRUM: {
    label: "Steel drum",
    family: "Percussão metálica",
    icon: "mallet",
    range: [57, 81], // Lá3–Lá5
    sustain: false,
    level: 0.7,
    synth: "steel",
  },
};

export const SAMPLE_SET_NAMES = Object.keys(SAMPLE_SET);

export function resolveInstrument(name) {
  const key = String(name || "").toUpperCase();
  const id = INSTRUMENT_ALIASES[key] || key;
  if (!SAMPLE_SET[id]) {
    console.warn(`[MAPPING_CONFIG] Instrumento desconhecido "${name}". Use um de: ${SAMPLE_SET_NAMES.join(", ")}`);
    return "GRAND_PIANO";
  }
  return id;
}

// Variável (chave do MAPPING_CONFIG) de cada camada para uma escala
export function layerVariable(scaleId, layer) {
  return SCALE_LAYER_MAPPING[scaleId]?.[layer] || SCALE_LAYER_MAPPING.default[layer];
}

// Instrumento (chave do SAMPLE_SET) de cada camada para uma escala
export function layerInstruments(scaleId) {
  return Object.fromEntries(LAYER_ORDER.map((l) => [l, resolveInstrument(MAPPING_CONFIG[layerVariable(scaleId, l)])]));
}

// Nomes em português das variáveis do MAPPING_CONFIG
export const VARIABLE_LABELS = {
  TEMPERATURE: "Temperatura",
  HUMIDITY: "Umidade",
  VEGETATION_DENSITY: "Densidade da vegetação",
  OCEAN_CURRENTS: "Correntes oceânicas",
  ALTITUDE_ELEVATION: "Altitude e relevo",
};
