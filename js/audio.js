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
    this.makeup = new Tone.Gain(Tone.dbToGain(9)).connect(this.limiter);
    this.compressor = new Tone.Compressor({ threshold: -26, ratio: 3.5, attack: 0.01, release: 0.25, knee: 8 }).connect(this.makeup);
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

    // arpejo: intervalo varia com a intensidade (ventos/correntes)
    const transport = Tone.getTransport ? Tone.getTransport() : Tone.Transport;
    this.arpLoop = new Tone.Loop((time) => this._arp(time), 0.3).start(0);
    transport.start();
    this.transport = transport;
    this._applyLow();
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
    if (!this.started || this.paused) return;
    const prev = this.state;
    this.state = { ...prev, ...s };
    const ramp = this.low ? 0.6 : 0.12;
    const now = T().now();

    this.panner.pan.rampTo(clamp(s.pan ?? 0, -1, 1) * 0.85, this.low ? 0.4 : 0.08);
    const bright = clamp(s.bright ?? 0.5);
    const cutoff = this.low ? lerp(SETTINGS.low.filterMinHz, SETTINGS.low.filterMaxHz, bright) : lerp(2000, 12000, bright ** 0.8);
    this.filter.frequency.rampTo(cutoff, this.low ? 0.8 : 0.2);

    if (this._previewLayer && s.active) this.stopPreview();
    for (const layer of LAYER_ORDER) {
      if (layer === this._previewLayer) continue; // não abafa a pré-escuta em andamento
      const L = this.layers[layer];
      const w = s.active ? Math.sqrt(clamp(s.weights?.[layer] ?? 0)) : 0;
      L.out.gain.rampTo(w * L.cfg.level * (this.low && layer === "arp" ? 0.6 : 1), s.active ? ramp : 0.5);
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
    const wa = clamp(s.weights.arp ?? 0);
    this.arpLoop.interval = this.low ? lerp(0.7, 0.36, wa) : lerp(0.48, 0.085, wa ** 0.8);
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
    L.out.gain.rampTo(cfg.level, 0.05);
    const scale = this.scaleNotes(...cfg.range);
    const mid = Math.floor(scale.length / 2);
    let phrase;
    if (layer === "arp") phrase = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k, i) => [k + 1, i * 0.14, 1.2]);
    else if (cfg.sustain) phrase = [[mid - 3, 0, 1.6], [mid - 1, 1.2, 1.6], [mid + 1, 2.4, 2.2]];
    else phrase = [[mid - 3, 0, 0.8], [mid - 1, 0.35, 0.8], [mid, 0.7, 0.8], [mid + 1, 1.05, 0.8], [mid + 3, 1.4, 1.6]];
    this._previewLayer = layer;
    this._previewTimers = phrase.map(([deg, t, dur]) =>
      setTimeout(() => {
        if (this._previewLayer !== layer || this.paused) return;
        const note = midiToNote(scale[clamp(deg, 0, scale.length - 1)]);
        const mono = !this._sampling(layer) && L.mono;
        this._voice(layer).triggerAttackRelease(note, mono ? dur * 0.85 : dur, T().now(), 0.85);
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
    if (!this.state.active) this.layers[layer].out.gain.rampTo(0, soft ? 0.6 : 0.25);
  }

  // nível de saída em dBFS (após o limitador)
  getLevel() {
    return this.started ? this.meter.getValue() : -Infinity;
  }

  getWaveform() {
    return this.started ? this.waveform.getValue() : null;
  }
}
