// Motor de sonificação (Tone.js): UM instrumento por característica.
//
//   instrumento do mapa ─→ filtro → panner (eixo X) → reverb → volume
//   sons dos lugares   ─┘                                       → pausa/ducking (voz) → compressor → limitador
//
// Cada mapa representa uma característica (temperatura, umidade, vento, CO...) e é tocado só
// pelo instrumento dela (config.json → mapeamento). Quanto mais intensa a característica no
// ponto do cursor, MAIS AGUDA a nota: o valor (0 a 1 na barra de cores) escolhe a nota dentro
// da faixa do instrumento, sempre na escala pentatônica maior (Dó ou Sol), então tudo soa
// consonante. Volumes e panorama mudam sempre com rampas (rampTo) para evitar estalos.
//
// As pré-escutas (legenda e tutorial) usam vozes separadas, para nunca brigar com o mapa.

import { SAMPLE_SET, SETTINGS, dbToGain } from "./config.js";

const T = () => window.Tone;
const PENTATONIC = [0, 2, 4, 7, 9];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// Ganho dos instrumentos enquanto a narração fala: silêncio total (narracao.pausarMusica)
// ou só uma redução de narracao.reducaoDb decibéis.
const duckedGain = () => (SETTINGS.narration.pauseMusic ? 0 : dbToGain(SETTINGS.narration.duckDb));

export const MUSICAL_KEYS = {
  C: { root: 0 },
  G: { root: 7 },
};

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
    this.key = SETTINGS.audio.key;
    this.userVolumeDb = SETTINGS.audio.volumeDb;
    this.useSamples = SETTINGS.audio.useSamples;
    this.instrument = "GRAND_PIANO"; // instrumento do mapa aberto
    this.live = null; // voz do mapa
    this.previews = {}; // vozes das pré-escutas, por instrumento
    this.state = { active: false, norm: 0.5 };
    this.idx = null;
    this.lastStrike = 0;
    this.lastNote = null;
    this.ducked = false;
    this._previewTimers = [];
  }

  get available() {
    return typeof window.Tone !== "undefined";
  }

  async start() {
    if (!this.available) throw new Error("Tone.js");
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
    this.limiter = new Tone.Limiter(SETTINGS.audio.limiterDb).toDestination();
    this.makeup = new Tone.Gain(Tone.dbToGain(3)).connect(this.limiter);
    this.compressor = new Tone.Compressor({ threshold: -24, ratio: 2, attack: 0.02, release: 0.3, knee: 10 }).connect(this.makeup);
    this.duckGain = new Tone.Gain(this.ducked ? duckedGain() : 1).connect(this.compressor);
    this.volume = new Tone.Volume(this.userVolumeDb).connect(this.duckGain);
    this.reverb = new Tone.Reverb({ decay: 5, preDelay: 0.03, wet: SETTINGS.audio.reverb }).connect(this.volume);
    this.panner = new Tone.Panner(0).connect(this.reverb);
    this.filter = new Tone.Filter({ type: "lowpass", frequency: 7000, rolloff: -12, Q: 0.4 }).connect(this.panner);
    this.previewPanner = new Tone.Panner(0).connect(this.reverb);

    this.live = this._makeVoice(this.instrument, this.filter);
    this._buildAmbience();
    const transport = Tone.getTransport ? Tone.getTransport() : Tone.Transport;
    transport.start();
  }

  // ---------------- vozes (sintetizador + gravações) ----------------
  // { id, cfg, out (ganho), synth, mono, sampler, samplerState, sustaining, sustainTime }
  _makeVoice(instId, dest) {
    const Tone = T();
    const cfg = SAMPLE_SET[instId];
    const out = new Tone.Gain(0).connect(dest);
    const { node, voice, mono } = makeSynth(cfg.synth);
    (node || voice).connect(out);
    const V = { id: instId, cfg, out, node, synth: voice, mono, sampler: null, samplerState: cfg.samples ? "idle" : "none", sustaining: null, sustainTime: 0 };
    if (this.useSamples && cfg.samples) this._loadSampler(V);
    return V;
  }

  _loadSampler(V) {
    const Tone = T();
    const s = V.cfg.samples;
    V.samplerState = "loading";
    const done = (ok) => {
      if (V.samplerState !== "loading") return;
      V.samplerState = ok ? "ready" : "failed";
      if (ok) {
        // troca o sintetizador pela gravação sem deixar nota presa
        try { V.mono ? V.synth.triggerRelease() : V.synth.releaseAll(); } catch { /* noop */ }
        V.sustaining = null;
      }
    };
    V.sampler = new Tone.Sampler({
      urls: s.urls,
      baseUrl: s.baseUrl,
      attack: s.attack || 0,
      release: s.release || 1,
      volume: s.volume ?? 4,
      onload: () => done(true),
      onerror: () => done(false),
    }).connect(V.out);
    setTimeout(() => done(false), 15000);
  }

  _sampling(V) {
    return !!V && V.samplerState === "ready";
  }

  _player(V) {
    return this._sampling(V) ? V.sampler : V.synth;
  }

  _release(V) {
    if (!V) return;
    try {
      V.sampler?.releaseAll?.();
      if (V.synth?.releaseAll) V.synth.releaseAll();
      else V.synth?.triggerRelease?.();
    } catch { /* noop */ }
    V.sustaining = null;
  }

  _dispose(V) {
    if (!V) return;
    this._release(V);
    const trash = [V.synth, V.node, V.sampler, V.out].filter(Boolean);
    setTimeout(() => trash.forEach((n) => { try { n.dispose(); } catch { /* noop */ } }), 3000);
  }

  // ---------------- instrumento do mapa ----------------
  /** Troca o instrumento do mapa (um por característica: config.json → mapeamento). */
  setInstrument(instId) {
    if (!SAMPLE_SET[instId] || instId === this.instrument) return;
    this.instrument = instId;
    this.idx = null;
    this.lastNote = null;
    if (!this.started) return;
    const old = this.live;
    old.out.gain.rampTo(0, 0.3);
    this._dispose(old);
    this.live = this._makeVoice(instId, this.filter);
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

  // valor 0..1 → nota da pentatônica na faixa do instrumento (0 = mais grave, 1 = mais aguda),
  // com histerese para não oscilar na fronteira entre duas notas
  _quantize(norm) {
    const notes = this.scaleNotes(...SAMPLE_SET[this.instrument].range);
    const x = clamp(norm) * (notes.length - 1);
    let i = Math.round(x);
    if (this.idx !== null && Math.abs(x - this.idx) < 0.62) i = this.idx;
    this.idx = i;
    return notes[i];
  }

  /** Nota (MIDI) de um valor 0..1 em qualquer instrumento, sem histerese. */
  noteFor(instId, norm) {
    const notes = this.scaleNotes(...SAMPLE_SET[instId].range);
    return notes[Math.round(clamp(norm) * (notes.length - 1))];
  }

  // ---------------- controles ----------------
  setVolume(db) {
    this.userVolumeDb = db;
    if (this.started && !this.paused) this.volume.volume.rampTo(db, 0.15);
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
    setTimeout(() => this.paused && this._release(this.live), 300);
  }

  resume() {
    if (!this.started) return;
    this.paused = false;
    this.volume.volume.rampTo(this.userVolumeDb, 0.3);
    // a pausa soltou as notas: esquece a última, para a próxima atualização tocar de novo na
    // hora (sem isso, um instrumento percutido só voltava quando a nota mudasse)
    this.lastNote = null;
    this.lastStrike = 0;
    this._inactiveSince = null;
    if (this.live) this.live.sustaining = null;
  }

  // ---------------- atualização contínua ----------------
  // s = { active, pan (-1..1), norm (0..1: posição do valor na barra), amb }
  update(s) {
    if (!this.started || this.paused) return;
    const prev = this.state;
    this.state = { ...prev, ...s };
    const now = T().now();
    const V = this.live;

    this.panner.pan.rampTo(clamp(s.pan ?? 0, -1, 1) * 0.85, 0.08);
    this.setAmbience(s.amb || {});
    V.out.gain.rampTo(s.active ? V.cfg.level : 0, s.active ? 0.12 : 0.5);

    if (!s.active) {
      if (prev.active) this._inactiveSince = now;
      return;
    }
    this._inactiveSince = null;
    const midi = this._quantize(s.norm);
    if (V.cfg.sustain) this._sustain(V, midi, now);
    else if (midi !== this.lastNote) this._strike(V, midi, now);
  }

  // instrumentos percutidos/pinçados: toca quando a nota muda
  _strike(V, midi, now, vel = 0.75) {
    if (now - this.lastStrike < 0.09) return;
    this.lastStrike = now;
    this.lastNote = midi;
    this._player(V).triggerAttackRelease(midiToNote(midi), 1.4, now, vel);
  }

  // instrumentos sustentados: legato com amostras, glide com sintetizador
  _sustain(V, midi, now) {
    const vel = 0.75;
    if (this._sampling(V)) {
      // amostra: troca de nota com sobreposição (legato); re-arco periódico mantém o som vivo
      const restrike = now - (V.sustainTime || 0) > 2.8;
      const changed = midi !== V.sustaining;
      if ((changed && now - (V.sustainTime || 0) > 0.2) || restrike) {
        if (V.sustaining !== null) V.sampler.triggerRelease(midiToNote(V.sustaining), now + 0.05);
        V.sampler.triggerAttack(midiToNote(midi), now, vel);
        V.sustaining = midi;
        V.sustainTime = now;
      }
    } else if (V.sustaining === null) {
      V.synth.triggerAttack(midiToNote(midi), now, vel);
      V.sustaining = midi;
      V.sustainTime = now;
    } else if (midi !== V.sustaining) {
      V.synth.setNote(midiToNote(midi), now); // glide (portamento)
      V.sustaining = midi;
    }
  }

  _tick() {
    if (!this.started || this.paused) return;
    const s = this.state;
    const V = this.live;
    const now = T().now();
    if (s.active) {
      if (V.cfg.sustain) {
        if (this._sampling(V)) this._sustain(V, this._quantize(s.norm), now);
      } else if (now - this.lastStrike > 1.8) {
        // re-toque suave quando o cursor repousa (o mapa continua "cantando")
        this.lastNote = null;
        this._strike(V, this._quantize(s.norm), now, 0.6);
      }
    } else if (this._inactiveSince && now - this._inactiveSince > 1.2) {
      this._release(V);
      this._inactiveSince = null;
      this.lastNote = null;
    }
  }

  // ---------------- pré-escutas (legenda e tutorial) ----------------
  // Toca uma sequência de valores (0..1) num instrumento: cada valor vira a nota que ele teria
  // no mapa. Ex.: [0, 0.25, 0.5, 0.75, 1] sobe do valor mais baixo ao mais alto.
  // Usa temporizadores JS para poder ser interrompida na hora (mouse sai do cartão).
  // steps = [{ norm, pan? }] ou números; stepS = segundos entre notas. Retorna a duração.
  async playValues(instId, steps, stepS = 0.45) {
    await this.start();
    if (this.paused) this.resume();
    this.stopPreview();
    const V = (this.previews[instId] ||= this._makeVoice(instId, this.previewPanner));
    const now = T().now();
    V.out.gain.cancelScheduledValues(now);
    V.out.gain.rampTo(V.cfg.level * 0.7, 0.15);
    const list = steps.map((x) => (typeof x === "number" ? { norm: x } : x));
    const dur = V.cfg.sustain ? stepS * 1.15 : Math.max(0.8, stepS * 2);
    this._previewVoice = V;
    this._previewTimers = list.map((st, i) =>
      setTimeout(() => {
        if (this._previewVoice !== V || this.paused) return;
        this.previewPanner.pan.rampTo(clamp(st.pan ?? 0, -1, 1) * 0.85, 0.05);
        const note = midiToNote(this.noteFor(instId, st.norm));
        this._player(V).triggerAttackRelease(note, dur, T().now(), 0.7);
      }, i * stepS * 1000)
    );
    const total = list.length * stepS + dur * 0.6 + 0.3;
    this._previewTimers.push(setTimeout(() => this.stopPreview({ soft: true }), total * 1000));
    return total;
  }

  /** Pré-escuta padrão de um instrumento: do valor mais baixo (grave) ao mais alto (agudo). */
  preview(instId = this.instrument) {
    return this.playValues(instId, [0, 0.2, 0.4, 0.6, 0.8, 1], 0.42);
  }

  stopPreview({ soft = false } = {}) {
    this._previewTimers.forEach(clearTimeout);
    this._previewTimers = [];
    const V = this._previewVoice;
    this._previewVoice = null;
    if (!V || !this.started) return;
    if (!soft) this._release(V);
    V.out.gain.rampTo(0, soft ? 0.6 : 0.3);
  }

  get previewing() {
    return !!this._previewVoice;
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
        a.out.gain.rampTo(target * dbToGain(a.db), 0.9, now);
      } else {
        a.out.gain.rampTo(0, 0.8, now);
        a.stopTimer = setTimeout(() => {
          if (a.level > 0) return;
          for (const n of a.nodes) if (n.state === "started") n.stop();
          a.running = false;
        }, 1800);
      }
    }
  }

  // pré-escuta na legenda e no tutorial: "mar", "gelo", "floresta" ou "deserto"
  async previewPlace(name, secs = 5) {
    await this.start();
    if (this.paused) this.resume();
    this.stopPlacePreview();
    this.setAmbience({ [name]: 1 });
    this._placeTimers = [setTimeout(() => this.stopPlacePreview(), secs * 1000)];
    return secs;
  }

  stopPlacePreview() {
    (this._placeTimers || []).forEach(clearTimeout);
    this._placeTimers = [];
    if (this.started && !this.state.active) this.setAmbience({});
  }
}
