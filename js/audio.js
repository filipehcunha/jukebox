// Motor de sonificação polifônica em camadas (Tone.js).
//
//   low  (grave)    ─┐
//   mid  (médio)    ─┤→ filtro passa-baixas (brilho) → panner (eixo X) → reverb → volume
//   high (agudo)    ─┤     → pausa/ducking (voz) → compressor → limitador
//   arp  (arpejos)  ─┘
//
// O instrumento de cada camada, o volume de cada instrumento (dB) e os demais parâmetros
// vêm de config.json (lido por js/config.js). Todas as notas são quantizadas na escala pentatônica maior (Dó ou
// Sol), então qualquer combinação de camadas é consonante. Volumes, filtro e panorama mudam
// sempre com rampas (rampTo) para evitar estalos.

import { SAMPLE_SET, LAYER_ORDER, SETTINGS, dbToGain, layerInstruments } from "./config.js";

const T = () => window.Tone;
const NOTE_NAMES = ["Dó", "Dó♯", "Ré", "Ré♯", "Mi", "Fá", "Fá♯", "Sol", "Sol♯", "Lá", "Lá♯", "Si"];
const PENTATONIC = [0, 2, 4, 7, 9];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Ganho dos instrumentos enquanto a narração fala: silêncio total (narracao.pausarMusica)
// ou só uma redução de narracao.reducaoDb decibéis.
const duckedGain = () => (SETTINGS.narration.pauseMusic ? 0 : dbToGain(SETTINGS.narration.duckDb));

export const MUSICAL_KEYS = {
  C: { label: "Pentatônica Maior de Dó", root: 0 },
  G: { label: "Pentatônica Maior de Sol", root: 7 },
};

export function midiName(midi) {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
const midiToNote = (m) => T().Frequency(m, "midi").toNote();
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

// ---------------------------------------------------------------------------
// Timbres sintetizados (funcionam offline e enquanto as amostras carregam)
// Retornam { node: saída a conectar, voice: o que recebe as notas, mono }
// ---------------------------------------------------------------------------
function makeSynth(type) {
  const Tone = T();
  const bowed = (opts, vib) => {
    const v = new Tone.Vibrato(...vib);
    const voice = new Tone.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", Q: 0.8, rolloff: -24 },
      envelope: { attack: 0.3, decay: 0.3, sustain: 0.85, release: 1.6 },
      portamento: 0.14,
      ...opts,
    }).connect(v);
    return { node: v, voice, mono: true };
  };
  switch (type) {
    case "bowed":
      return bowed({ filterEnvelope: { attack: 0.25, decay: 0.4, sustain: 0.6, release: 1.4, baseFrequency: 160, octaves: 2.4 }, volume: -6 }, [4.8, 0.06]);
    case "bowedLow":
      return bowed({ filterEnvelope: { attack: 0.3, decay: 0.4, sustain: 0.6, release: 1.4, baseFrequency: 90, octaves: 2.2 }, volume: -3 }, [4.2, 0.05]);
    case "bowedHigh":
      return bowed({ filterEnvelope: { attack: 0.2, decay: 0.3, sustain: 0.7, release: 1.2, baseFrequency: 420, octaves: 3 }, envelope: { attack: 0.2, decay: 0.2, sustain: 0.85, release: 1.2 }, volume: -11 }, [5.6, 0.09]);
    case "keys":
      return {
        voice: new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 3.01,
          modulationIndex: 6,
          oscillator: { type: "sine" },
          envelope: { attack: 0.003, decay: 1.3, sustain: 0, release: 1.2 },
          modulation: { type: "sine" },
          modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.4 },
          volume: -4,
        }),
        mono: false,
      };
    case "mallet": // marimba: fundamental + 4º harmônico (duas oitavas) com decaimento rápido
      return {
        voice: new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 4,
          modulationIndex: 2.2,
          oscillator: { type: "sine" },
          envelope: { attack: 0.001, decay: 0.6, sustain: 0, release: 0.5 },
          modulation: { type: "sine" },
          modulationEnvelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.1 },
          volume: -2,
        }),
        mono: false,
      };
    case "steel": // steel drum: parciais metálicos, ataque brilhante
      return {
        voice: new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 2,
          modulationIndex: 4.5,
          oscillator: { type: "sine" },
          envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.8 },
          modulation: { type: "sine" },
          modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.3 },
          volume: -7,
        }),
        mono: false,
      };
    case "flute": {
      const v = new Tone.Vibrato(5.4, 0.1);
      const voice = new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.28, decay: 0.2, sustain: 0.85, release: 1.3 }, portamento: 0.12, volume: -8 }).connect(v);
      return { node: v, voice, mono: true };
    }
    case "reed": {
      const voice = new Tone.MonoSynth({
        oscillator: { type: "square" },
        filter: { type: "lowpass", Q: 1, rolloff: -24 },
        filterEnvelope: { attack: 0.06, decay: 0.3, sustain: 0.7, release: 0.6, baseFrequency: 300, octaves: 2.5 },
        envelope: { attack: 0.06, decay: 0.2, sustain: 0.8, release: 0.7 },
        portamento: 0.08,
        volume: -13,
      });
      return { voice, mono: true };
    }
    case "pad": {
      const f = new Tone.Filter({ type: "lowpass", frequency: 1800, Q: 0.3 });
      const voice = new Tone.Synth({
        oscillator: { type: "fatsawtooth", count: 3, spread: 28 },
        envelope: { attack: 0.9, decay: 0.4, sustain: 0.8, release: 2.2 },
        portamento: 0.3,
        volume: -17,
      }).connect(f);
      return { node: f, voice, mono: true };
    }
    case "pluck":
    default:
      return {
        voice: new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.9 }, volume: -5 }),
        mono: false,
      };
  }
}

export class SonificationEngine {
  constructor() {
    this.started = false;
    this.paused = false;
    this.low = false;
    this.key = SETTINGS.audio.key;
    this.userVolumeDb = SETTINGS.audio.volumeDb;
    this.useSamples = SETTINGS.audio.useSamples;
    this.samplesState = "idle"; // idle | loading | ready | partial | failed | none
    this.onSamplesState = null;
    this.layers = {};
    this.assignment = layerInstruments("default");
    this.state = { active: false, weights: { low: 0, mid: 0, high: 0, arp: 0 }, norm: 0.5 };
    this.idx = {};
    this.lastStrike = {};
    this.notes = {};
    this.arpStep = 0;
    this.ducked = false;
    this._previewTimers = [];
  }

  get available() {
    return typeof window.Tone !== "undefined";
  }

  async start() {
    if (!this.available) throw new Error("Tone.js não carregou (verifique a conexão).");
    await T().start();
    if (this.started) {
      this.resume();
      return;
    }
    this._build();
    this.started = true;
    this._timer = setInterval(() => this._tick(), 100);
  }

  _build() {
    const Tone = T();
    // saída: volume do usuário → pausa/ducking (voz) → compressor → ganho de compensação → limitador
    // (o compressor nivela camadas fracas e fortes; o limitador impede clipping)
    this.limiter = new Tone.Limiter(SETTINGS.audio.limiterDb).toDestination();
    // compressão leve (só cola as camadas) e pouco ganho de compensação: a mixagem respira e
    // nenhum instrumento salta na frente; o equilíbrio vem dos volumes medidos (config.json)
    this.makeup = new Tone.Gain(Tone.dbToGain(3)).connect(this.limiter);
    this.compressor = new Tone.Compressor({ threshold: -24, ratio: 2, attack: 0.02, release: 0.3, knee: 10 }).connect(this.makeup);
    this.duckGain = new Tone.Gain(this.ducked ? duckedGain() : 1).connect(this.compressor);
    this.volume = new Tone.Volume(this.userVolumeDb).connect(this.duckGain);
    this.reverb = new Tone.Reverb({ decay: 5, preDelay: 0.03, wet: SETTINGS.audio.reverb }).connect(this.volume);
    this.panner = new Tone.Panner(0).connect(this.reverb);
    this.filter = new Tone.Filter({ type: "lowpass", frequency: 6000, rolloff: -12, Q: 0.4 }).connect(this.panner);
    this.waveform = new Tone.Waveform(512);
    this.volume.connect(this.waveform);
    this.meter = new Tone.Meter({ smoothing: 0.6 });
    this.limiter.connect(this.meter);

    for (const layer of LAYER_ORDER) this._assign(layer, this.assignment[layer]);
    this._buildAmbience();
    this._buildHeart();

    // arpejo: intervalo varia com a intensidade (ventos/correntes)
    const transport = Tone.getTransport ? Tone.getTransport() : Tone.Transport;
    this.arpLoop = new Tone.Loop((time) => this._arp(time), 0.3).start(0);
    transport.start();
    this.transport = transport;
    this._applyLow();
  }

  // ---------------- sons dos lugares (paisagem sonora) ----------------
  // Cada tipo de lugar tem uma assinatura sonora própria, sintetizada na hora e sempre na
  // tonalidade da música, para dizer ONDE o cursor está sem precisar de palavras:
  //   mar       ondas: rumor grave (ruído marrom) + espuma (ruído rosa) num ciclo lento
  //   gelo      vento gelado assobiando + cristais (sinos agudos raros, na pentatônica)
  //   floresta  trilo de insetos + cantos curtos de pássaros (notas da pentatônica)
  //   deserto   vento seco em rajadas + areia fina + bordão grave em quinta (vastidão)
  // A mistura (0 a 1 para cada lugar) vem de geo.js → landscapeAt. Tudo passa pelo panner
  // (acompanha o cursor no estéreo) e pela saída da música (volume, pausa, voz). As fontes
  // só rodam enquanto o som está audível.
  _buildAmbience() {
    const Tone = T();
    const A = SETTINGS.ambience;
    this.amb = {};
    if (!A.enabled) return;
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const add = (name, build) => {
      const out = new Tone.Gain(0).connect(this.panner);
      this.amb[name] = { out, db: A[name].volumeDb, level: 0, running: false, stopTimer: null, ...build(out) };
    };

    add("mar", (out) => {
      const hz = 1 / A.mar.waveS;
      const swell = new Tone.Gain(0.6).connect(out);
      const rumble = new Tone.Filter({ type: "lowpass", frequency: 420, rolloff: -24 }).connect(swell);
      const surf = new Tone.Filter({ type: "bandpass", frequency: 1200, Q: 0.6 });
      surf.connect(new Tone.Gain(0.45).connect(swell));
      return {
        nodes: [
          new Tone.Noise({ type: "brown", volume: -8 }).connect(rumble),
          new Tone.Noise({ type: "pink", volume: -14 }).connect(surf),
          new Tone.LFO({ frequency: hz, min: 0.18, max: 1 }).connect(swell.gain),
          new Tone.LFO({ frequency: hz, min: 600, max: 2600 }).connect(surf.frequency),
        ],
      };
    });

    add("gelo", (out) => {
      const gust = new Tone.Gain(0.5).connect(out);
      const wind = new Tone.Filter({ type: "bandpass", frequency: 1200, Q: 4 }).connect(gust);
      const whistle = new Tone.Filter({ type: "bandpass", frequency: 1800, Q: 16 });
      whistle.connect(new Tone.Gain(0.9).connect(gust));
      const bell = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3, modulationIndex: 7, oscillator: { type: "sine" }, modulation: { type: "sine" },
        envelope: { attack: 0.002, decay: 2.2, sustain: 0, release: 2 },
        modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.5 },
        volume: -12,
      }).connect(out);
      const crystals = new Tone.Loop((time) => {
        if (Math.random() > 0.3) return;
        bell.triggerAttackRelease(midiToNote(pick(this.scaleNotes(84, 100))), 0.1, time, 0.12 + Math.random() * 0.18);
      }, 0.8);
      return {
        nodes: [
          new Tone.Noise({ type: "white", volume: -12 }).connect(wind),
          new Tone.Noise({ type: "pink", volume: -6 }).connect(whistle),
          new Tone.LFO({ frequency: 0.05, min: 700, max: 2000 }).connect(wind.frequency),
          new Tone.LFO({ frequency: 0.037, min: 1300, max: 2600 }).connect(whistle.frequency),
          new Tone.LFO({ frequency: 0.12, min: 0.2, max: 1 }).connect(gust.gain),
          crystals,
        ],
      };
    });

    add("floresta", (out) => {
      // insetos: ruído agudo modulado a 24 Hz (o trilo) e pulsando 3 vezes por segundo
      const swell = new Tone.Gain(0.6).connect(out);
      const pulse = new Tone.Gain(0).connect(swell);
      const trill = new Tone.Gain(0).connect(pulse);
      const bug = new Tone.Filter({ type: "bandpass", frequency: 5200, Q: 5 }).connect(trill);
      // pássaros: grupos de 2 a 4 notas curtas que deslizam entre graus da pentatônica
      const birdPan = new Tone.Panner(0).connect(out);
      const bird = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.004, decay: 0.05, sustain: 0.5, release: 0.05 }, volume: -14 }).connect(birdPan);
      const songs = new Tone.Loop((time) => {
        if (Math.random() > 0.25) return;
        const n = this.scaleNotes(86, 103);
        birdPan.pan.setValueAtTime(Math.random() * 1.4 - 0.7, time);
        let t = time;
        for (let i = 0, k = 2 + Math.floor(Math.random() * 3); i < k; i += 1) {
          const ia = Math.floor(Math.random() * n.length);
          const ib = clamp(ia + (Math.random() < 0.5 ? 2 : -2), 0, n.length - 1);
          bird.triggerAttackRelease(midiHz(n[ia]), 0.07, t, 0.5);
          bird.frequency.exponentialRampToValueAtTime(midiHz(n[ib]), t + 0.07);
          t += 0.11;
        }
      }, 0.5);
      return {
        nodes: [
          new Tone.Noise({ type: "white", volume: -10 }).connect(bug),
          new Tone.LFO({ frequency: 24, min: 0, max: 1 }).connect(trill.gain),
          new Tone.LFO({ frequency: 3, min: 0, max: 1 }).connect(pulse.gain),
          new Tone.LFO({ frequency: 0.15, min: 0.25, max: 1 }).connect(swell.gain),
          songs,
        ],
      };
    });

    add("deserto", (out) => {
      const gust = new Tone.Gain(0.5).connect(out);
      const gust2 = new Tone.Gain(0.7).connect(gust);
      const wind = new Tone.Filter({ type: "lowpass", frequency: 650, Q: 0.8 }).connect(gust2);
      const sand = new Tone.Filter({ type: "highpass", frequency: 4500 });
      sand.connect(new Tone.Gain(0.25).connect(gust2));
      // bordão: tônica e quinta da tonalidade atual (Dó3/Sol3 ou Sol3/Ré4), bem baixo
      const drone = new Tone.Gain(0.08).connect(out);
      const osc = [new Tone.Oscillator(130.8, "sine").connect(drone), new Tone.Oscillator(196, "sine").connect(drone)];
      return {
        onStart: () => {
          const root = 48 + MUSICAL_KEYS[this.key].root;
          osc[0].frequency.value = midiHz(root);
          osc[1].frequency.value = midiHz(root + 7);
        },
        nodes: [
          new Tone.Noise({ type: "pink", volume: -4 }).connect(wind),
          new Tone.Noise({ type: "white", volume: -16 }).connect(sand),
          new Tone.LFO({ frequency: 0.07, min: 0.15, max: 1 }).connect(gust.gain),
          new Tone.LFO({ frequency: 0.19, min: 0.5, max: 1 }).connect(gust2.gain),
          new Tone.LFO({ frequency: 0.09, min: 450, max: 900 }).connect(wind.frequency),
          ...osc,
        ],
      };
    });

    // fronteira: sino suave (tônica e quinta) ao passar de um país para outro
    this.borderBell = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 2, modulationIndex: 2.5, oscillator: { type: "sine" }, modulation: { type: "sine" },
      envelope: { attack: 0.002, decay: 1.0, sustain: 0, release: 0.8 },
      modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.2 },
    }).connect(new Tone.Volume(A.fronteira.volumeDb).connect(this.panner));
  }

  // levels = { mar, gelo, floresta, deserto } de 0 a 1; o que não vier vai a zero
  setAmbience(levels = {}) {
    if (!this.amb) return;
    for (const [name, a] of Object.entries(this.amb)) {
      const target = clamp(levels[name] ?? 0);
      if (Math.abs(target - a.level) < 0.03 && target > 0 === a.level > 0) continue;
      a.level = target;
      const now = T().now();
      clearTimeout(a.stopTimer);
      a.out.gain.cancelScheduledValues(now);
      if (target > 0) {
        if (!a.running) {
          a.onStart?.();
          for (const n of a.nodes) if (n.state !== "started") n.start();
          a.running = true;
        }
        a.out.gain.rampTo(target * dbToGain(a.db), this.low ? 1.6 : 0.9, now);
      } else {
        a.out.gain.rampTo(0, this.low ? 1.4 : 0.8, now);
        a.stopTimer = setTimeout(() => {
          if (a.level > 0) return;
          for (const n of a.nodes) if (n.state === "started") n.stop();
          a.running = false;
        }, 1800);
      }
    }
  }

  borderCue() {
    if (!this.borderBell || !this.started || this.paused || this.scoring) return;
    const now = T().now();
    if (now - (this._lastBorder || 0) < 0.6) return;
    this._lastBorder = now;
    const root = 72 + MUSICAL_KEYS[this.key].root;
    this.borderBell.triggerAttackRelease(midiToNote(root), 0.2, now, 0.5);
    this.borderBell.triggerAttackRelease(midiToNote(root + 7), 0.3, now + 0.12, 0.4);
  }

  // pré-escuta na legenda: "mar", "gelo", "floresta", "deserto", "coracao" ou "fronteira"
  async previewPlace(name, secs = 5) {
    await this.start();
    if (this.paused) this.resume();
    this.stopPlacePreview();
    if (name === "coracao") {
      this._heartPreview = T().now() + secs;
      if (this.heartLoop) this.heartLoop.interval = 0.85;
    } else if (name === "fronteira") {
      this._lastBorder = 0;
      this.borderCue();
      this._placeTimers = [setTimeout(() => { this._lastBorder = 0; this.borderCue(); }, 1300)];
      secs = 2.8;
    } else {
      this.setAmbience({ [name]: 1 });
    }
    (this._placeTimers ||= []).push(setTimeout(() => this.stopPlacePreview(), secs * 1000));
    return secs;
  }

  stopPlacePreview() {
    (this._placeTimers || []).forEach(clearTimeout);
    this._placeTimers = [];
    this._heartPreview = 0;
    if (this.started && !this.state.active) this.setAmbience({});
  }

  // ---------------- batimento de alerta ----------------
  // Nos valores extremos (calor extremo, mar muito quente, CO muito alto, tempestade) soa um
  // coração grave, "tum-tum", no centro e sem eco: de ~57 bpm no limite a ~110 bpm no máximo
  // da escala. É a urgência dos dados dita sem palavras. Limites: scales.js / config.json.
  _buildHeart() {
    const Tone = T();
    if (!SETTINGS.alert.enabled) return;
    this.heartOut = new Tone.Volume(SETTINGS.alert.volumeDb).connect(this.volume);
    const lp = new Tone.Filter({ type: "lowpass", frequency: 420, rolloff: -24 }).connect(this.heartOut);
    this.heart = new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 2.5,
      oscillator: { type: "sine" },
      envelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.12 },
    }).connect(lp);
    this.heartLoop = new Tone.Loop((time) => this._beat(time), 1).start(0);
  }

  _beat(time) {
    const s = this.state;
    const preview = this._heartPreview && T().now() < this._heartPreview;
    const a = preview ? 0.6 : s.alert || 0;
    if (!this.heart || !this.started || this.paused || (!preview && (!s.active || a <= 0))) return;
    const vel = (0.55 + 0.45 * a) * (this.low ? 0.6 : 1);
    this.heart.triggerAttackRelease("A1", 0.12, time, vel);
    this.heart.triggerAttackRelease("G1", 0.1, time + 0.2, vel * 0.7);
  }

  // ---------------- modo partitura (Sinfonia do mapa) ----------------
  // O app agenda as notas (js/sinfonia.js); o motor só toca. Enquanto dura, update() é ignorado.
  beginScore() {
    this.stopPreview();
    this.stopPlacePreview();
    this._releaseAll();
    this.scoring = true;
    this.notes = {};
    this.state = { ...this.state, active: true, weights: { low: 0, mid: 0, high: 0, arp: 0 }, alert: 0 };
    const mix = { low: 0.55, mid: 1.6, high: 0.6, arp: 1.15 }; // a melodia na frente, o baixo como chão
    for (const layer of LAYER_ORDER) this.layers[layer].out.gain.rampTo(this.layers[layer].cfg.level * mix[layer], 0.4);
    this.filter.frequency.rampTo(this.low ? SETTINGS.low.filterMaxHz : 7000, 0.5);
  }

  isPoly(layer) {
    return this._sampling(layer) || !this.layers[layer].mono;
  }

  scoreNote(layer, midi, dur, vel, time) {
    if (!this.scoring || this.paused) return;
    this._voice(layer).triggerAttackRelease(midiToNote(midi), dur, time, clamp(vel, 0.02, 1));
  }

  scoreState({ pan = 0, amb = {}, alert = 0 }) {
    if (!this.scoring) return;
    this.panner.pan.rampTo(clamp(pan, -1, 1) * 0.8, 0.3);
    this.setAmbience(amb);
    this.state.alert = alert;
    if (this.heartLoop) this.heartLoop.interval = this.low ? lerp(1.25, 0.85, alert) : lerp(1.05, 0.55, alert);
  }

  // tail = segundos para o último acorde se apagar
  endScore(tail = 0.6) {
    if (!this.scoring) return;
    this.scoring = false;
    this.state = { ...this.state, active: false, alert: 0 };
    this.setAmbience({});
    this.panner.pan.rampTo(0, Math.max(0.3, tail));
    for (const layer of LAYER_ORDER) this.layers[layer].out.gain.rampTo(0, Math.max(0.3, tail));
    if (tail < 1) this._releaseAll();
  }

  // ---------------- gravação (exportar o áudio) ----------------
  // Grava a saída final (depois do limitador): exatamente o que a pessoa ouve, sem a voz.
  get canRecord() {
    return this.available && typeof window.MediaRecorder !== "undefined" && !!T().Recorder;
  }

  async startRecording() {
    if (!this.started) await this.start();
    if (this.recorder) return;
    this.recorder = new (T().Recorder)();
    this.limiter.connect(this.recorder);
    await this.recorder.start();
  }

  async stopRecording() {
    const rec = this.recorder;
    if (!rec) return null;
    this.recorder = null;
    const blob = await rec.stop();
    this.limiter.disconnect(rec);
    rec.dispose();
    return blob;
  }

  // ---------------- instrumentos por camada ----------------
  layerInstrument(layer) {
    return this.assignment[layer];
  }

  // { low: 'CELLO', mid: 'GRAND_PIANO', ... } — troca só as camadas que mudaram
  setLayerInstruments(map) {
    for (const layer of LAYER_ORDER) if (map[layer]) this.setLayerInstrument(layer, map[layer]);
  }

  setLayerInstrument(layer, instId) {
    if (!SAMPLE_SET[instId] || this.assignment[layer] === instId) return;
    this.assignment[layer] = instId;
    if (this.started) this._assign(layer, instId);
  }

  _assign(layer, instId) {
    const Tone = T();
    const cfg = SAMPLE_SET[instId];
    const old = this.layers[layer];
    const out = old?.out || new Tone.Gain(0).connect(this.filter);
    if (old) {
      this._releaseLayer(layer);
      const trash = [old.voice, old.node, old.sampler].filter(Boolean);
      setTimeout(() => trash.forEach((n) => { try { n.dispose(); } catch { /* noop */ } }), 3000);
    }
    const { node, voice, mono } = makeSynth(cfg.synth);
    (node || voice).connect(out);
    const L = { out, inst: instId, cfg, node, voice, mono, sampler: null, samplerState: cfg.samples ? "idle" : "none", sustaining: null, sustainTime: 0 };
    this.layers[layer] = L;
    delete this.idx[layer];
    this.notes[layer] = null;
    if (this.useSamples && cfg.samples) this._loadSampler(layer);
    else this._emitSamples();
  }

  _loadSampler(layer) {
    const Tone = T();
    const L = this.layers[layer];
    const s = L.cfg.samples;
    if (!s || L.sampler) return;
    L.samplerState = "loading";
    this._emitSamples();
    const done = (ok) => {
      if (L.samplerState !== "loading") return;
      L.samplerState = ok ? "ready" : "failed";
      if (ok && this.layers[layer] === L) {
        // troca o sintetizador pela gravação sem deixar nota presa
        try { L.mono ? L.voice.triggerRelease() : L.voice.releaseAll(); } catch { /* noop */ }
        L.sustaining = null;
      }
      this._emitSamples();
    };
    L.sampler = new Tone.Sampler({
      urls: s.urls,
      baseUrl: s.baseUrl,
      attack: s.attack || 0,
      release: s.release || 1,
      volume: s.volume ?? 4,
      onload: () => done(true),
      onerror: () => done(false),
    }).connect(L.out);
    setTimeout(() => done(false), 15000);
  }

  _emitSamples() {
    const ls = LAYER_ORDER.map((l) => this.layers[l]).filter((L) => L && L.cfg.samples);
    let st;
    if (!this.useSamples || !ls.length) st = "none";
    else if (ls.some((L) => L.samplerState === "loading" || L.samplerState === "idle")) st = "loading";
    else if (ls.every((L) => L.samplerState === "ready")) st = "ready";
    else if (ls.some((L) => L.samplerState === "ready")) st = "partial";
    else st = "failed";
    this.samplesState = st;
    const labels = LAYER_ORDER.map((l) => this.layers[l]).filter(Boolean).map((L) => `${L.cfg.label}${L.cfg.samples && this._ready(L) ? "" : " (sintetizado)"}`);
    this.onSamplesState?.(st, labels);
  }

  _ready(L) {
    return this.useSamples && L.samplerState === "ready";
  }

  _sampling(layer) {
    const L = this.layers[layer];
    return !!L && this._ready(L);
  }

  _voice(layer) {
    const L = this.layers[layer];
    return this._sampling(layer) ? L.sampler : L.voice;
  }

  setUseSamples(on) {
    this._releaseAll();
    this.useSamples = on;
    if (on && this.started) for (const l of LAYER_ORDER) this._loadSampler(l);
    this._emitSamples();
  }

  _releaseLayer(layer) {
    const L = this.layers[layer];
    if (!L) return;
    try {
      L.sampler?.releaseAll?.();
      if (L.voice?.releaseAll) L.voice.releaseAll();
      else L.voice?.triggerRelease?.();
    } catch { /* noop */ }
    L.sustaining = null;
  }

  _releaseAll() {
    for (const l of Object.keys(this.layers)) this._releaseLayer(l);
  }

  // ---------------- escala musical ----------------
  scaleNotes(lo, hi) {
    const root = MUSICAL_KEYS[this.key].root;
    const out = [];
    for (let m = lo; m <= hi; m += 1) {
      if (PENTATONIC.includes((((m - root) % 12) + 12) % 12)) out.push(m);
    }
    return out;
  }

  _range(layer) {
    return SAMPLE_SET[this.assignment[layer]].range;
  }

  // norm 0..1 → índice na escala da camada, com histerese para não oscilar na fronteira
  _quantize(layer, norm) {
    const notes = this.scaleNotes(...this._range(layer));
    const x = clamp(norm) * (notes.length - 1);
    const prev = this.idx[layer];
    let i = Math.round(x);
    if (prev !== undefined && Math.abs(x - prev) < 0.62) i = prev;
    this.idx[layer] = i;
    return notes[i];
  }

  setKey(key) {
    if (!MUSICAL_KEYS[key]) return;
    this.key = key;
    this.idx = {};
  }

  // ---------------- controles ----------------
  setLowSensory(on) {
    this.low = on;
    if (this.started) this._applyLow();
  }

  _applyLow() {
    const low = this.low;
    this.limiter.threshold.rampTo(low ? SETTINGS.low.limiterDb : SETTINGS.audio.limiterDb, 0.3);
    this.reverb.wet.rampTo(low ? Math.min(1, SETTINGS.audio.reverb + 0.12) : SETTINGS.audio.reverb, 0.5);
    this.volume.volume.rampTo(this.paused ? -Infinity : this._outDb(), 0.4);
  }

  // volume de saída: controle do usuário + redução do modo de baixa sensibilidade
  _outDb() {
    return this.userVolumeDb + (this.low ? SETTINGS.low.reduceDb : 0);
  }

  setVolume(db) {
    this.userVolumeDb = db;
    if (this.started && !this.paused) this.volume.volume.rampTo(this._outDb(), 0.15);
  }

  // A voz tem prioridade: enquanto a narração fala, a música para por completo (ou só
  // abaixa, conforme config.json → narracao) e volta com uma rampa quando a fala termina.
  duck(on) {
    if (this.ducked === on) return;
    this.ducked = on;
    if (!this.started) return;
    const g = this.duckGain.gain;
    g.cancelScheduledValues(T().now());
    g.rampTo(on ? duckedGain() : 1, on ? SETTINGS.narration.fadeOutS : SETTINGS.narration.fadeInS);
  }

  pause() {
    if (!this.started) return;
    this.paused = true;
    this.volume.volume.rampTo(-60, 0.25);
    setTimeout(() => this.paused && this._releaseAll(), 300);
  }

  resume() {
    if (!this.started) return;
    this.paused = false;
    this.volume.volume.rampTo(this._outDb(), 0.3);
  }

  // ---------------- atualização contínua ----------------
  // s = { active, pan (-1..1), norm (0..1), weights {low,mid,high,arp}, bright, grad }
  update(s) {
    if (!this.started || this.paused || this.scoring) return;
    const prev = this.state;
    this.state = { ...prev, ...s, alert: s.alert ?? 0 };
    const ramp = this.low ? 0.6 : 0.12;
    const now = T().now();

    this.panner.pan.rampTo(clamp(s.pan ?? 0, -1, 1) * 0.85, this.low ? 0.4 : 0.08);
    this.setAmbience(s.amb || {});
    const bright = clamp(s.bright ?? 0.5);
    const cutoff = this.low ? lerp(SETTINGS.low.filterMinHz, SETTINGS.low.filterMaxHz, bright) : lerp(2000, 12000, bright ** 0.8);
    this.filter.frequency.rampTo(cutoff, this.low ? 0.8 : 0.2);

    if (this._previewLayer && s.active) this.stopPreview();
    // teto para a soma das camadas: quando várias soam juntas, todas descem um pouco, e o
    // conjunto fica com o mesmo peso de uma ou duas camadas (harmonia em vez de acúmulo)
    const ws = Object.fromEntries(LAYER_ORDER.map((l) => [l, s.active ? Math.sqrt(clamp(s.weights?.[l] ?? 0)) : 0]));
    const sum = LAYER_ORDER.reduce((a, l) => a + ws[l], 0);
    const k = sum > 1.5 ? 1.5 / sum : 1;
    for (const layer of LAYER_ORDER) {
      if (layer === this._previewLayer) continue; // não abafa a pré-escuta em andamento
      const L = this.layers[layer];
      L.out.gain.rampTo(ws[layer] * k * L.cfg.level * (this.low && layer === "arp" ? 0.6 : 1), s.active ? ramp : 0.5);
    }

    if (!s.active) {
      if (prev.active) this._inactiveSince = now;
      return;
    }
    this._inactiveSince = null;

    for (const layer of ["low", "mid", "high"]) {
      const w = s.weights[layer] ?? 0;
      const midi = this._quantize(layer, s.norm);
      if (this.layers[layer].cfg.sustain) this._sustain(layer, midi, w, now);
      else if (w > 0.05 && midi !== this.notes[layer]) this._strike(layer, midi, w, now);
    }
    // arpejo: o loop lê o estado; ajusta a velocidade
    if (this.heartLoop) {
      const al = clamp(s.alert ?? 0);
      this.heartLoop.interval = this.low ? lerp(1.25, 0.85, al) : lerp(1.05, 0.55, al);
    }
    const wa = clamp(s.weights.arp ?? 0);
    this.arpLoop.interval = this.low ? lerp(0.75, 0.42, wa) : lerp(0.6, 0.17, wa);
  }

  // instrumentos percutidos/pinçados: toca quando a nota muda
  _strike(layer, midi, w, now) {
    const minGap = this.low ? 0.28 : 0.09;
    if (now - (this.lastStrike[layer] || 0) < minGap) return;
    this.lastStrike[layer] = now;
    this.notes[layer] = midi;
    const vel = clamp((0.5 + 0.45 * w) * (this.low ? 0.6 : 1), 0.1, 1);
    this._voice(layer).triggerAttackRelease(midiToNote(midi), this.low ? 2.2 : 1.4, now, vel);
  }

  // instrumentos sustentados: legato com amostras, glide com sintetizador
  _sustain(layer, midi, w, now) {
    const L = this.layers[layer];
    const sampling = this._sampling(layer);
    if (w < 0.03) {
      if (L.sustaining !== null && now - (L.sustainTime || 0) > 0.6) {
        if (sampling) L.sampler.triggerRelease(midiToNote(L.sustaining), now);
        else L.voice.triggerRelease(now);
        L.sustaining = null;
      }
      return;
    }
    const vel = clamp(0.55 + 0.4 * w, 0.2, 0.95) * (this.low ? 0.65 : 1);
    if (sampling) {
      // amostra: troca de nota com sobreposição (legato); re-arco periódico mantém o som vivo
      const restrike = now - (L.sustainTime || 0) > (layer === "low" ? 2.6 : 3.0);
      const changed = midi !== L.sustaining;
      const gap = this.low ? 0.45 : 0.2;
      if ((changed && now - (L.sustainTime || 0) > gap) || restrike) {
        if (L.sustaining !== null) L.sampler.triggerRelease(midiToNote(L.sustaining), now + 0.05);
        L.sampler.triggerAttack(midiToNote(midi), now, vel);
        L.sustaining = midi;
        L.sustainTime = now;
      }
    } else if (L.sustaining === null) {
      L.voice.triggerAttack(midiToNote(midi), now, vel);
      L.sustaining = midi;
      L.sustainTime = now;
    } else if (midi !== L.sustaining) {
      L.voice.setNote(midiToNote(midi), now); // glide (portamento)
      L.sustaining = midi;
    }
  }

  _arp(time) {
    const s = this.state;
    if (!this.started || this.paused || !s.active) return;
    const w = s.weights?.arp ?? 0;
    if (w < 0.05) return;
    const notes = this.scaleNotes(...this._range("arp"));
    const base = Math.round(clamp(s.norm) * Math.max(0, notes.length - 6));
    const pattern = [0, 1, 2, 3, 4, 3, 2, 1];
    const n = notes[clamp(base + pattern[this.arpStep % pattern.length], 0, notes.length - 1)];
    this.arpStep += 1;
    const vel = clamp((0.4 + 0.5 * w) * (this.low ? 0.55 : 1), 0.1, 0.9);
    this._voice("arp").triggerAttackRelease(midiToNote(n), 0.6, time, vel);
  }

  _tick() {
    if (!this.started || this.paused) return;
    const s = this.state;
    const now = T().now();
    if (s.active) {
      for (const layer of ["low", "mid", "high"]) {
        const w = s.weights[layer] ?? 0;
        if (this.layers[layer].cfg.sustain) {
          if (this._sampling(layer)) this._sustain(layer, this._quantize(layer, s.norm), w, now);
        } else {
          // re-toque suave quando o cursor repousa (o mapa continua "cantando")
          const rest = this.low ? 3.2 : 1.8;
          if (w > 0.12 && now - (this.lastStrike[layer] || 0) > rest) {
            this.notes[layer] = null;
            this._strike(layer, this._quantize(layer, s.norm), w * 0.85, now);
          }
        }
      }
    } else if (this._inactiveSince && !this._previewLayer && now - this._inactiveSince > 1.2) {
      this._releaseAll();
      this._inactiveSince = null;
      this.notes = {};
    }
  }

  currentNoteName() {
    const m = this.idx.mid !== undefined ? this.scaleNotes(...this._range("mid"))[this.idx.mid] : null;
    return m ? midiName(m) : "—";
  }

  noteFor(layer, norm) {
    const notes = this.scaleNotes(...this._range(layer));
    return notes[Math.round(clamp(norm) * (notes.length - 1))];
  }

  // ---------------- pré-escuta (Tela de Legenda) ----------------
  // Usa temporizadores JS (e não agendamento no futuro do Tone) para poder ser
  // interrompida na hora quando o mouse sai do card.
  async preview(layer) {
    await this.start();
    if (this.paused) this.resume();
    this.stopPreview();
    const L = this.layers[layer];
    const cfg = L.cfg;
    const now = T().now();
    L.out.gain.cancelScheduledValues(now);
    // entra com fade e um pouco abaixo da música, sem susto; notas longas se sobrepõem, então descem mais
    L.out.gain.rampTo(cfg.level * (cfg.sustain ? 0.5 : 0.6), 0.25);
    const scale = this.scaleNotes(...cfg.range);
    const mid = Math.floor(scale.length / 2);
    let phrase;
    if (layer === "arp") phrase = [0, 1, 2, 3, 4, 5, 6, 7].map((k, i) => [k + 1, i * 0.2, 1.2]);
    else if (cfg.sustain) phrase = [[mid - 3, 0, 1.6], [mid - 1, 1.2, 1.6], [mid + 1, 2.4, 2.2]];
    else phrase = [[mid - 3, 0, 0.8], [mid - 1, 0.35, 0.8], [mid, 0.7, 0.8], [mid + 1, 1.05, 0.8], [mid + 3, 1.4, 1.6]];
    this._previewLayer = layer;
    this._previewTimers = phrase.map(([deg, t, dur]) =>
      setTimeout(() => {
        if (this._previewLayer !== layer || this.paused) return;
        const note = midiToNote(scale[clamp(deg, 0, scale.length - 1)]);
        const mono = !this._sampling(layer) && L.mono;
        this._voice(layer).triggerAttackRelease(note, mono ? dur * 0.85 : dur, T().now(), layer === "arp" ? 0.55 : 0.7);
      }, t * 1000)
    );
    const total = phrase[phrase.length - 1][1] + phrase[phrase.length - 1][2] + 0.6;
    this._previewTimers.push(setTimeout(() => this.stopPreview({ soft: true }), total * 1000));
    return total;
  }

  stopPreview({ soft = false } = {}) {
    this._previewTimers.forEach(clearTimeout);
    this._previewTimers = [];
    const layer = this._previewLayer;
    this._previewLayer = null;
    if (!layer || !this.started) return;
    if (!soft) this._releaseLayer(layer);
    if (!this.state.active) this.layers[layer].out.gain.rampTo(0, soft ? 0.6 : 0.45);
  }

  // nível de saída em dBFS (após o limitador)
  getLevel() {
    return this.started ? this.meter.getValue() : -Infinity;
  }

  getWaveform() {
    return this.started ? this.waveform.getValue() : null;
  }
}
