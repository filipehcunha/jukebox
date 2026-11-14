// Motor de sonificação polifônica em camadas (Tone.js).
//
//   Violoncelo (grave)  ─┐
//   Piano     (médio)   ─┤→ filtro passa-baixas (brilho) → panner (eixo X) → reverb → volume → limitador
//   Flauta    (agudo)   ─┤
//   Harpa     (arpejos) ─┘
//
// Todas as notas são quantizadas na escala pentatônica maior (Dó ou Sol), então qualquer
// combinação de camadas é consonante. Volumes, filtro e panorama mudam sempre com rampas
// (rampTo) para evitar estalos.

const T = () => window.Tone;
const NOTE_NAMES = ["Dó", "Dó♯", "Ré", "Ré♯", "Mi", "Fá", "Fá♯", "Sol", "Sol♯", "Lá", "Lá♯", "Si"];
const PENTATONIC = [0, 2, 4, 7, 9];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const MUSICAL_KEYS = {
  C: { label: "Pentatônica Maior de Dó", root: 0 },
  G: { label: "Pentatônica Maior de Sol", root: 7 },
};

export function midiName(midi) {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
const midiToNote = (m) => T().Frequency(m, "midi").toNote();

// Faixas (MIDI) de cada camada
const RANGES = {
  cello: [36, 57], // Dó2–Lá3
  piano: [55, 84], // Sol3–Dó6
  flute: [72, 93], // Dó5–Lá6
  harp: [55, 88], // Sol3–Mi6
};
// Nível relativo de cada camada no mix
const LEVEL = { cello: 0.9, piano: 0.85, flute: 0.55, harp: 0.6 };

const SAMPLE_SETS = {
  piano: {
    baseUrl: "https://tonejs.github.io/audio/salamander/",
    urls: { A1: "A1.mp3", C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3", A2: "A2.mp3", C3: "C3.mp3",
      "D#3": "Ds3.mp3", "F#3": "Fs3.mp3", A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
      A4: "A4.mp3", C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", A5: "A5.mp3", C6: "C6.mp3" },
    release: 1.6,
  },
  cello: {
    baseUrl: "https://nbrosowsky.github.io/tonejs-instruments/samples/cello/",
    urls: Object.fromEntries(["C2", "E2", "G2", "A2", "C3", "E3", "G3", "A3", "C4", "E4"].map((n) => [n, `${n}.mp3`])),
    attack: 0.12,
    release: 1.6,
  },
  flute: {
    baseUrl: "https://nbrosowsky.github.io/tonejs-instruments/samples/flute/",
    urls: Object.fromEntries(["C4", "E4", "A4", "C5", "E5", "A5", "C6", "E6", "A6", "C7"].map((n) => [n, `${n}.mp3`])),
    attack: 0.15,
    release: 1.4,
  },
  harp: {
    baseUrl: "https://nbrosowsky.github.io/tonejs-instruments/samples/harp/",
    urls: Object.fromEntries(["B1", "D2", "F2", "A2", "C3", "E3", "G3", "B3", "D4", "F4", "A4", "C5", "E5", "G5", "B5", "D6"].map((n) => [n, `${n}.mp3`])),
    release: 1.8,
  },
};

export class SonificationEngine {
  constructor() {
    this.started = false;
    this.paused = false;
    this.low = false;
    this.key = "C";
    this.userVolumeDb = 0;
    this.useSamples = true;
    this.samplesLoaded = false;
    this.samplesState = "idle"; // idle | loading | ready | failed
    this.onSamplesState = null;
    this.layers = {};
    this.state = { active: false, weights: { cello: 0, piano: 0, flute: 0, harp: 0 }, norm: 0.5 };
    this.idx = {};
    this.lastStrike = {};
    this.notes = {};
    this.arpStep = 0;
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
    this._loadSamples();
    this._timer = setInterval(() => this._tick(), 100);
  }

  _build() {
    const Tone = T();
    // saída: volume do usuário -> compressor -> ganho de compensação -> limitador
    // (o compressor nivela camadas fracas e fortes; o limitador impede clipping)
    this.limiter = new Tone.Limiter(-3).toDestination();
    this.makeup = new Tone.Gain(Tone.dbToGain(9)).connect(this.limiter);
    this.compressor = new Tone.Compressor({ threshold: -26, ratio: 3.5, attack: 0.01, release: 0.25, knee: 8 }).connect(this.makeup);
    this.volume = new Tone.Volume(this.userVolumeDb).connect(this.compressor);
    this.reverb = new Tone.Reverb({ decay: 5, preDelay: 0.03, wet: 0.3 }).connect(this.volume);
    this.panner = new Tone.Panner(0).connect(this.reverb);
    this.filter = new Tone.Filter({ type: "lowpass", frequency: 6000, rolloff: -12, Q: 0.4 }).connect(this.panner);
    this.waveform = new Tone.Waveform(512);
    this.volume.connect(this.waveform);
    this.meter = new Tone.Meter({ smoothing: 0.6 });
    this.limiter.connect(this.meter);

    const mk = (id, synth) => {
      const out = new Tone.Gain(0).connect(this.filter);
      synth.connect(out);
      this.layers[id] = { out, synth, sampler: null, sustaining: null };
    };

    // --- vozes sintetizadas (funcionam offline e enquanto as amostras carregam) ---
    const celloVib = new Tone.Vibrato(4.8, 0.06);
    const cello = new Tone.MonoSynth({
      oscillator: { type: "sawtooth" },
      filter: { type: "lowpass", Q: 0.8, rolloff: -24 },
      filterEnvelope: { attack: 0.25, decay: 0.4, sustain: 0.6, release: 1.4, baseFrequency: 160, octaves: 2.4 },
      envelope: { attack: 0.3, decay: 0.3, sustain: 0.85, release: 1.6 },
      portamento: 0.14,
      volume: -6,
    }).connect(celloVib);
    mk("cello", celloVib);
    this.layers.cello.voice = cello;

    const piano = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3.01,
      modulationIndex: 6,
      oscillator: { type: "sine" },
      envelope: { attack: 0.003, decay: 1.3, sustain: 0, release: 1.2 },
      modulation: { type: "sine" },
      modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.4 },
      volume: -4,
    });
    mk("piano", piano);
    this.layers.piano.voice = piano;

    const fluteVib = new Tone.Vibrato(5.4, 0.1);
    const flute = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.28, decay: 0.2, sustain: 0.85, release: 1.3 },
      portamento: 0.12,
      volume: -8,
    }).connect(fluteVib);
    mk("flute", fluteVib);
    this.layers.flute.voice = flute;

    const harp = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.002, decay: 0.9, sustain: 0, release: 0.9 },
      volume: -5,
    });
    mk("harp", harp);
    this.layers.harp.voice = harp;

    // arpejo da harpa: intervalo varia com a intensidade (ventos/correntes)
    const transport = Tone.getTransport ? Tone.getTransport() : Tone.Transport;
    this.arpLoop = new Tone.Loop((time) => this._arp(time), 0.3).start(0);
    transport.start();
    this.transport = transport;
    this._applyLow();
  }

  _loadSamples() {
    const Tone = T();
    this.samplesState = "loading";
    this.onSamplesState?.(this.samplesState);
    const pending = Object.entries(SAMPLE_SETS).map(
      ([id, cfg]) =>
        new Promise((resolve) => {
          const sampler = new Tone.Sampler({
            urls: cfg.urls,
            baseUrl: cfg.baseUrl,
            attack: cfg.attack || 0,
            release: cfg.release || 1,
            volume: cfg.volume ?? 4,
            onload: () => resolve(true),
            onerror: () => resolve(false),
          });
          sampler.connect(this.layers[id].out);
          this.layers[id].sampler = sampler;
        })
    );
    const timeout = new Promise((r) => setTimeout(() => r("timeout"), 15000));
    Promise.race([Promise.all(pending), timeout]).then((res) => {
      const ok = Array.isArray(res) && res.every(Boolean);
      this.samplesLoaded = ok;
      this.samplesState = ok ? "ready" : "failed";
      if (ok) this._releaseAll();
      this.onSamplesState?.(this.samplesState);
    });
  }

  _sampling(id) {
    return this.useSamples && this.samplesLoaded && this.layers[id]?.sampler;
  }

  setUseSamples(on) {
    this._releaseAll();
    this.useSamples = on;
  }

  _releaseAll() {
    for (const id of Object.keys(this.layers)) {
      const L = this.layers[id];
      try {
        L.sampler?.releaseAll?.();
        if (L.voice?.releaseAll) L.voice.releaseAll();
        else L.voice?.triggerRelease?.();
      } catch { /* noop */ }
      L.sustaining = null;
    }
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

  // norm 0..1 -> índice na escala da camada, com histerese para não oscilar na fronteira
  _quantize(id, norm) {
    const notes = this.scaleNotes(...RANGES[id]);
    const x = clamp(norm) * (notes.length - 1);
    const prev = this.idx[id];
    let i = Math.round(x);
    if (prev !== undefined && Math.abs(x - prev) < 0.62) i = prev;
    this.idx[id] = i;
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
    this.limiter.threshold.rampTo(low ? -16 : -3, 0.3);
    this.reverb.wet.rampTo(low ? 0.42 : 0.3, 0.5);
    this.volume.volume.rampTo(this.paused ? -Infinity : this.userVolumeDb + (low ? -10 : 0), 0.4);
  }

  setVolume(db) {
    this.userVolumeDb = db;
    if (this.started && !this.paused) this.volume.volume.rampTo(db + (this.low ? -10 : 0), 0.15);
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
    this.volume.volume.rampTo(this.userVolumeDb + (this.low ? -10 : 0), 0.3);
  }

  // ---------------- atualização contínua ----------------
  // s = { active, pan (-1..1), norm (0..1), weights {cello,piano,flute,harp}, bright, grad }
  update(s) {
    if (!this.started || this.paused) return;
    const prev = this.state;
    this.state = { ...prev, ...s };
    const ramp = this.low ? 0.6 : 0.12;
    const now = T().now();

    this.panner.pan.rampTo(clamp(s.pan ?? 0, -1, 1) * 0.85, this.low ? 0.4 : 0.08);
    const bright = clamp(s.bright ?? 0.5);
    const cutoff = this.low ? lerp(700, 1700, bright) : lerp(2000, 12000, bright ** 0.8);
    this.filter.frequency.rampTo(cutoff, this.low ? 0.8 : 0.2);

    for (const id of Object.keys(this.layers)) {
      const w = s.active ? Math.sqrt(clamp(s.weights?.[id] ?? 0)) : 0;
      this.layers[id].out.gain.rampTo(w * LEVEL[id] * (this.low && id === "harp" ? 0.6 : 1), s.active ? ramp : 0.5);
    }

    if (!s.active) {
      if (prev.active) this._inactiveSince = now;
      return;
    }
    this._inactiveSince = null;

    // camadas sustentadas: violoncelo e flauta
    for (const id of ["cello", "flute"]) {
      const w = s.weights[id] ?? 0;
      const midi = this._quantize(id, s.norm);
      this._sustain(id, midi, w, now);
    }
    // piano: toca quando a nota muda
    const pm = this._quantize("piano", s.norm);
    const wp = s.weights.piano ?? 0;
    if (wp > 0.05 && pm !== this.notes.piano) this._strikePiano(pm, wp, now);
    // harpa: o loop lê o estado; ajusta a velocidade do arpejo
    const wh = clamp(s.weights.harp ?? 0);
    this.arpLoop.interval = this.low ? lerp(0.7, 0.36, wh) : lerp(0.48, 0.085, wh ** 0.8);
  }

  _strikePiano(midi, w, now) {
    const minGap = this.low ? 0.28 : 0.09;
    if (now - (this.lastStrike.piano || 0) < minGap) return;
    this.lastStrike.piano = now;
    this.notes.piano = midi;
    const vel = clamp((0.5 + 0.45 * w) * (this.low ? 0.6 : 1), 0.1, 1);
    const v = this._sampling("piano") ? this.layers.piano.sampler : this.layers.piano.voice;
    v.triggerAttackRelease(midiToNote(midi), this.low ? 2.2 : 1.4, now, vel);
  }

  _sustain(id, midi, w, now) {
    const L = this.layers[id];
    const sampling = this._sampling(id);
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
      const restrike = now - (L.sustainTime || 0) > (id === "cello" ? 2.6 : 3.0);
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
    const w = s.weights?.harp ?? 0;
    if (w < 0.05) return;
    const notes = this.scaleNotes(...RANGES.harp);
    const base = Math.round(clamp(s.norm) * (notes.length - 6));
    const pattern = [0, 1, 2, 3, 4, 3, 2, 1];
    const n = notes[clamp(base + pattern[this.arpStep % pattern.length], 0, notes.length - 1)];
    this.arpStep += 1;
    const vel = clamp((0.4 + 0.5 * w) * (this.low ? 0.55 : 1), 0.1, 0.9);
    const v = this._sampling("harp") ? this.layers.harp.sampler : this.layers.harp.voice;
    v.triggerAttackRelease(midiToNote(n), 0.6, time, vel);
  }

  _tick() {
    if (!this.started || this.paused) return;
    const s = this.state;
    const now = T().now();
    if (s.active) {
      // re-toque suave do piano quando o cursor repousa (o mapa continua "cantando")
      const wp = s.weights.piano ?? 0;
      const rest = this.low ? 3.2 : 1.8;
      if (wp > 0.12 && now - (this.lastStrike.piano || 0) > rest) {
        this.notes.piano = null;
        this._strikePiano(this._quantize("piano", s.norm), wp * 0.85, now);
      }
      for (const id of ["cello", "flute"]) {
        if (this._sampling(id)) this._sustain(id, this._quantize(id, s.norm), s.weights[id] ?? 0, now);
      }
    } else if (this._inactiveSince && now - this._inactiveSince > 1.2) {
      this._releaseAll();
      this._inactiveSince = null;
      this.notes = {};
    }
  }

  currentNoteName() {
    const m = this.idx.piano !== undefined ? this.scaleNotes(...RANGES.piano)[this.idx.piano] : null;
    return m ? midiName(m) : "—";
  }

  noteFor(id, norm) {
    const notes = this.scaleNotes(...RANGES[id]);
    return notes[Math.round(clamp(norm) * (notes.length - 1))];
  }

  // ---------------- teste individual (Tela de Legenda) ----------------
  async preview(id) {
    await this.start();
    if (this.paused) this.resume();
    const Tone = T();
    const L = this.layers[id];
    const now = Tone.now() + 0.05;
    const voice = this._sampling(id) ? L.sampler : L.voice;
    L.out.gain.cancelScheduledValues(now);
    L.out.gain.rampTo(LEVEL[id], 0.05);
    const scale = this.scaleNotes(...RANGES[id]);
    const phrase = {
      cello: [[0, 0, 1.6], [2, 1.2, 1.6], [4, 2.4, 2.2]],
      piano: [[2, 0, 0.8], [4, 0.35, 0.8], [6, 0.7, 0.8], [7, 1.05, 0.8], [9, 1.4, 1.6]],
      flute: [[3, 0, 1.2], [4, 1.0, 1.2], [6, 2.0, 2.0]],
      harp: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k, i) => [k + 2, i * 0.14, 1.2]),
    }[id];
    const mono = !this._sampling(id) && (id === "cello" || id === "flute");
    phrase.forEach(([deg, t, dur]) => {
      const note = midiToNote(scale[Math.min(scale.length - 1, deg)]);
      if (mono) voice.triggerAttackRelease(note, dur * 0.85, now + t, 0.85);
      else voice.triggerAttackRelease(note, dur, now + t, 0.85);
    });
    const total = phrase[phrase.length - 1][1] + phrase[phrase.length - 1][2] + 0.6;
    setTimeout(() => {
      if (!this.state.active) L.out.gain.rampTo(0, 0.6);
    }, total * 1000);
    return total;
  }

  // nível de saída em dBFS (após o limitador)
  getLevel() {
    return this.started ? this.meter.getValue() : -Infinity;
  }

  getWaveform() {
    return this.started ? this.waveform.getValue() : null;
  }
}
