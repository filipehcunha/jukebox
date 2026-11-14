const NOTE_NAMES = ["Dó", "Dó♯", "Ré", "Ré♯", "Mi", "Fá", "Fá♯", "Sol", "Sol♯", "Lá", "Lá♯", "Si"];

export const SCALES = {
  pentatonicC: {
    id: "pentatonicC",
    label: "Pentatônica Maior de Dó",
    root: 0,
    intervals: [0, 2, 4, 7, 9],
  },
  lydianC: {
    id: "lydianC",
    label: "Modo Lídio de Dó",
    root: 0,
    intervals: [0, 2, 4, 6, 7, 9, 11],
  },
  pentatonicMinorA: {
    id: "pentatonicMinorA",
    label: "Pentatônica Menor de Lá",
    root: 9,
    intervals: [0, 3, 5, 7, 10],
  },
};

export function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function frequencyToNoteName(frequency) {
  if (!Number.isFinite(frequency) || frequency <= 0) return "—";
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${name}${octave}`;
}

function buildScaleNotes(scale) {
  const notes = [];
  for (let octave = 1; octave <= 6; octave += 1) {
    for (const interval of scale.intervals) {
      const midi = 12 * (octave + 1) + scale.root + interval;
      const frequency = midiToFrequency(midi);
      if (frequency >= 92 && frequency <= 840) {
        notes.push({ midi, frequency });
      }
    }
  }

  notes.sort((a, b) => a.frequency - b.frequency);

  const unique = [];
  for (const note of notes) {
    if (!unique.length || Math.abs(unique[unique.length - 1].frequency - note.frequency) > 0.5) {
      unique.push(note);
    }
  }
  return unique;
}

const scaleCache = new Map();

export function getScaleNotes(scaleId = "pentatonicC") {
  if (!scaleCache.has(scaleId)) {
    const scale = SCALES[scaleId] || SCALES.pentatonicC;
    scaleCache.set(scaleId, buildScaleNotes(scale));
  }
  return scaleCache.get(scaleId);
}

export function quantizeNote(value01, scaleId = "pentatonicC") {
  const notes = getScaleNotes(scaleId);
  const normalized = Math.min(1, Math.max(0, Number.isFinite(value01) ? value01 : 0));
  const idealFrequency = 100 * Math.pow(8, normalized);

  let nearest = notes[0];
  let nearestDistance = Infinity;

  for (const note of notes) {
    const distance = Math.abs(Math.log(note.frequency / idealFrequency));
    if (distance < nearestDistance) {
      nearest = note;
      nearestDistance = distance;
    }
  }

  return {
    frequency: nearest.frequency,
    midi: nearest.midi,
    name: frequencyToNoteName(nearest.frequency),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rampParam(param, value, context, seconds = 0.08) {
  const now = context.currentTime;
  const safeValue = Number.isFinite(value) ? value : 0;

  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(now);
  } else {
    const current = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
  }

  param.linearRampToValueAtTime(safeValue, now + Math.max(0.012, seconds));
}

export class EarthAudioEngine {
  constructor() {
    this.context = null;
    this.started = false;
    this.playing = false;
    this.active = false;
    this.lowSensory = false;
    this.scaleId = "pentatonicC";
    this.lastParams = { valueNorm: 0.5, intensity: 0.2, pan: 0 };
    this.lastNote = quantizeNote(0.5, this.scaleId);
    this._scopeData = null;
  }

  async start() {
    if (!this.started) {
      await this._createGraph();
      this.started = true;
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    this.playing = true;
    this._applyOutputLevel();
    this._applyVoiceLevel();
    return true;
  }

  async _createGraph() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      throw new Error("A Web Audio API não está disponível neste navegador.");
    }

    this.context = new AudioContext({ latencyHint: "interactive" });
    const context = this.context;

    this.masterInput = context.createGain();
    this.masterInput.gain.value = 1;

    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -15;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 5.5;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.28;

    this.masterGain = context.createGain();
    this.masterGain.gain.value = 0;

    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.82;

    this.masterInput.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(context.destination);

    this._createReverb();

    this.voiceBus = context.createGain();
    this.voiceBus.gain.value = 1;

    this.voiceFilter = context.createBiquadFilter();
    this.voiceFilter.type = "lowpass";
    this.voiceFilter.frequency.value = 640;
    this.voiceFilter.Q.value = 1.2;

    this.voicePanner = context.createStereoPanner();
    this.voicePanner.pan.value = 0;

    this.voiceGain = context.createGain();
    this.voiceGain.gain.value = 0;

    this.dryGain = context.createGain();
    this.dryGain.gain.value = 0.82;

    this.wetSend = context.createGain();
    this.wetSend.gain.value = 0.34;

    this.voiceFilter.connect(this.voicePanner);
    this.voicePanner.connect(this.dryGain);
    this.voicePanner.connect(this.wetSend);
    this.dryGain.connect(this.voiceGain);
    this.wetSend.connect(this.reverb);
    this.voiceGain.connect(this.masterInput);

    this._createVoice();
    this._createDrone();

    this.filterCutoff = this.voiceFilter.frequency;
    this.filterResonance = this.voiceFilter.Q;

    this._scopeData = new Uint8Array(this.analyser.fftSize);
  }

  _createReverb() {
    const context = this.context;
    const seconds = 3.8;
    const decay = 3.3;
    const rate = context.sampleRate;
    const length = Math.max(1, Math.floor(rate * seconds));
    const impulse = context.createBuffer(2, length, rate);

    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const t = i / length;
        const envelope = Math.pow(1 - t, decay);
        const early = i < rate * 0.035 ? 1.4 : 1;
        data[i] = (Math.random() * 2 - 1) * envelope * early;
      }
    }

    this.reverb = context.createConvolver();
    this.reverb.buffer = impulse;

    this.reverbReturn = context.createGain();
    this.reverbReturn.gain.value = 0.42;
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.masterInput);
  }

  _createVoice() {
    const context = this.context;

    this.voiceMix = context.createGain();
    this.voiceMix.gain.value = 1;
    this.voiceMix.connect(this.voiceFilter);

    this.sineOsc = context.createOscillator();
    this.sineOsc.type = "sine";
    this.sineOsc.frequency.value = 220;
    this.sineGain = context.createGain();
    this.sineGain.gain.value = 0.72;
    this.sineOsc.connect(this.sineGain);
    this.sineGain.connect(this.voiceMix);

    this.triangleOsc = context.createOscillator();
    this.triangleOsc.type = "triangle";
    this.triangleOsc.frequency.value = 440;
    this.triangleOsc.detune.value = 3;
    this.triangleGain = context.createGain();
    this.triangleGain.gain.value = 0.17;
    this.triangleOsc.connect(this.triangleGain);
    this.triangleGain.connect(this.voiceMix);

    this.subOsc = context.createOscillator();
    this.subOsc.type = "sine";
    this.subOsc.frequency.value = 110;
    this.subGain = context.createGain();
    this.subGain.gain.value = 0.16;
    this.subOsc.connect(this.subGain);
    this.subGain.connect(this.voiceMix);

    this.chorusLfo = context.createOscillator();
    this.chorusLfo.type = "sine";
    this.chorusLfo.frequency.value = 0.055;
    this.chorusDepth = context.createGain();
    this.chorusDepth.gain.value = 2.4;
    this.chorusLfo.connect(this.chorusDepth);
    this.chorusDepth.connect(this.triangleOsc.detune);

    this.sineOsc.start();
    this.triangleOsc.start();
    this.subOsc.start();
    this.chorusLfo.start();
  }

  _createDrone() {
    const context = this.context;

    this.droneFilter = context.createBiquadFilter();
    this.droneFilter.type = "lowpass";
    this.droneFilter.frequency.value = 280;
    this.droneFilter.Q.value = 0.7;

    this.droneGain = context.createGain();
    this.droneGain.gain.value = 0.05;

    this.dronePanner = context.createStereoPanner();
    this.dronePanner.pan.value = -0.08;

    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.dronePanner);
    this.dronePanner.connect(this.masterInput);

    const droneWet = context.createGain();
    droneWet.gain.value = 0.16;
    this.dronePanner.connect(droneWet);
    droneWet.connect(this.reverb);

    this.droneOscA = context.createOscillator();
    this.droneOscA.type = "sine";
    this.droneOscA.frequency.value = 65.41;

    this.droneOscB = context.createOscillator();
    this.droneOscB.type = "triangle";
    this.droneOscB.frequency.value = 98;
    this.droneOscB.detune.value = -4;

    const droneGainA = context.createGain();
    droneGainA.gain.value = 0.62;
    const droneGainB = context.createGain();
    droneGainB.gain.value = 0.18;

    this.droneOscA.connect(droneGainA);
    this.droneOscB.connect(droneGainB);
    droneGainA.connect(this.droneFilter);
    droneGainB.connect(this.droneFilter);

    const lfo = context.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.037;
    const lfoDepth = context.createGain();
    lfoDepth.gain.value = 90;
    lfo.connect(lfoDepth);
    lfoDepth.connect(this.droneFilter.frequency);

    this.droneOscA.start();
    this.droneOscB.start();
    lfo.start();

    this._createSurf();
  }

  _createSurf() {
    const context = this.context;
    const seconds = 3;
    const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const data = buffer.getChannelData(0);

    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.935 + white * 0.065;
      data[i] = last;
    }

    this.surfSource = context.createBufferSource();
    this.surfSource.buffer = buffer;
    this.surfSource.loop = true;

    const surfFilter = context.createBiquadFilter();
    surfFilter.type = "lowpass";
    surfFilter.frequency.value = 480;
    surfFilter.Q.value = 0.4;

    this.surfGain = context.createGain();
    this.surfGain.gain.value = 0.008;

    this.surfSource.connect(surfFilter);
    surfFilter.connect(this.surfGain);
    this.surfGain.connect(this.masterInput);

    const surfLfo = context.createOscillator();
    surfLfo.type = "sine";
    surfLfo.frequency.value = 0.071;
    const surfLfoDepth = context.createGain();
    surfLfoDepth.gain.value = 0.0022;
    surfLfo.connect(surfLfoDepth);
    surfLfoDepth.connect(this.surfGain.gain);

    this.surfSource.start();
    surfLfo.start();
  }

  setPlaying(playing) {
    this.playing = Boolean(playing);
    if (!this.context) return;
    this._applyOutputLevel();

    if (!this.playing) {
      this.active = false;
      this._applyVoiceLevel();
    }
  }

  setLowSensory(enabled) {
    this.lowSensory = Boolean(enabled);
    if (!this.context) return;

    this._applyOutputLevel();
    this._applyVoiceLevel();

    if (this.active) {
      this._applyVoiceParameters(this.lastParams);
    }
  }

  setScale(scaleId) {
    if (!SCALES[scaleId]) return;
    this.scaleId = scaleId;
    this.lastNote = quantizeNote(this.lastParams.valueNorm, this.scaleId);
    if (this.active) {
      this._applyVoiceParameters(this.lastParams);
    }
  }

  setActive(active) {
    const next = Boolean(active) && this.playing;
    if (this.active === next) return;
    this.active = next;
    this._applyVoiceLevel();
  }

  update({ valueNorm, intensity, pan }, active = true) {
    if (!this.context) return this.lastNote;

    const params = {
      valueNorm: clamp(Number.isFinite(valueNorm) ? valueNorm : 0.5, 0, 1),
      intensity: clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1),
      pan: clamp(Number.isFinite(pan) ? pan : 0, -1, 1),
    };

    this.lastParams = params;
    this.lastNote = quantizeNote(params.valueNorm, this.scaleId);

    if (active) {
      this.setActive(true);
    }

    if (this.active) {
      this._applyVoiceParameters(params);
    }

    return this.lastNote;
  }

  _applyVoiceParameters(params) {
    const context = this.context;
    if (!context) return;

    const note = this.lastNote;
    const root = note.frequency;
    const fifth = root * 1.5;
    const sub = root * 0.5;

    const lowSensory = this.lowSensory;
    const cutoffMin = lowSensory ? 170 : 210;
    const cutoffMax = lowSensory ? 1450 : 5100;
    const maxResonance = lowSensory ? 1.4 : 7.6;
    const panAmount = lowSensory ? 0.62 : 1;

    const cutoff = cutoffMin * Math.pow(cutoffMax / cutoffMin, params.intensity);
    const resonance = 0.45 + params.intensity * maxResonance;
    const targetPan = params.pan * panAmount;

    rampParam(this.sineOsc.frequency, root, context, 0.085);
    rampParam(this.triangleOsc.frequency, fifth * 2, context, 0.095);
    rampParam(this.subOsc.frequency, sub, context, 0.11);
    rampParam(this.voiceFilter.frequency, cutoff, context, 0.17);
    rampParam(this.voiceFilter.Q, resonance, context, 0.19);
    rampParam(this.voicePanner.pan, targetPan, context, 0.08);
  }

  _applyVoiceLevel() {
    if (!this.context || !this.voiceGain) return;
    const active = this.active && this.playing;
    const level = active ? (this.lowSensory ? 0.17 : 0.38) : 0;
    rampParam(this.voiceGain.gain, level, this.context, active ? 0.42 : 0.95);

    const droneLevel = this.lowSensory ? 0.022 : 0.05;
    rampParam(this.droneGain.gain, droneLevel, this.context, 0.6);
    rampParam(this.surfGain.gain, this.lowSensory ? 0.003 : 0.008, this.context, 0.6);
    rampParam(this.reverbReturn.gain, this.lowSensory ? 0.28 : 0.44, this.context, 0.5);
  }

  _applyOutputLevel() {
    if (!this.context || !this.masterGain) return;
    const level = this.playing ? (this.lowSensory ? 0.44 : 0.98) : 0;
    rampParam(this.masterGain.gain, level, this.context, this.playing ? 0.4 : 0.28);
  }

  getScopeData() {
    if (!this.analyser || !this.started) return null;
    if (!this._scopeData || this._scopeData.length !== this.analyser.fftSize) {
      this._scopeData = new Uint8Array(this.analyser.fftSize);
    }
    this.analyser.getByteTimeDomainData(this._scopeData);
    return this._scopeData;
  }

  get state() {
    return {
      started: this.started,
      playing: this.playing,
      active: this.active,
      lowSensory: this.lowSensory,
      scaleId: this.scaleId,
      contextState: this.context ? this.context.state : "uninitialized",
    };
  }
}
