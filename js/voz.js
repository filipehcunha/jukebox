// Narrador único do app: UMA fala por vez. Toda descrição falada (tutorial, legenda, lugar
// clicado, avisos, leitor embutido) passa por esta fila, então duas narrações nunca tocam ao
// mesmo tempo: uma fala nova cancela a anterior, ou espera na fila (queue: true).
// Toca gravações em MP3 (voz neural gerada por tools/gerar_audio_tutorial.py) quando existem
// e, no resto, usa a voz mais natural instalada no navegador, no idioma do site.

import { locale } from "./i18n.js";

const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
let voices = [];
function loadVoices() { voices = synth?.getVoices() || []; }
loadVoices();
synth?.addEventListener?.("voiceschanged", loadVoices);

// Prefere vozes neurais ("Natural"/"Online" no Edge, "Google" no Chrome) às vozes locais antigas.
// loc = "pt-BR" ou "en-US" (padrão: idioma do site).
export function bestVoice(loc = locale()) {
  if (!voices.length) loadVoices();
  const [base] = loc.toLowerCase().split("-");
  let list = voices.filter((v) => v.lang?.toLowerCase().replace("_", "-") === loc.toLowerCase());
  if (!list.length) list = voices.filter((v) => v.lang?.toLowerCase().startsWith(base));
  const score = (v) =>
    (/natural|neural/i.test(v.name) ? 8 : 0) +
    (/online/i.test(v.name) ? 4 : 0) +
    (/google/i.test(v.name) ? 3 : 0) +
    (/francisca|thalita|antonio|jenny|aria|ava|guy/i.test(v.name) ? 1 : 0);
  return list.sort((a, b) => score(b) - score(a))[0] || null;
}

// Junta frases em blocos de até ~220 caracteres: fala fluida, sem o corte de ~15 s
// que o Chrome aplica a falas longas em algumas vozes.
function chunks(text, max = 220) {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) || [];
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + " " + s).length > max) { out.push(cur); cur = s; } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

class Narrator {
  constructor() {
    this.queue = [];
    this.current = null;
    this.audio = null;
    this.clips = {}; // id -> { src, texto }
    this.onBusyChange = null; // (falando: boolean) => void — o app pausa a música enquanto true
    this._wasBusy = false;
  }

  // avisa quando a narração começa ou termina (uma vez por mudança)
  _emit() {
    const b = this.busy();
    if (b === this._wasBusy) return;
    this._wasBusy = b;
    try { this.onBusyChange?.(b); } catch (err) { console.error(err); }
  }

  /** Registra as gravações disponíveis: id -> { src, texto }. */
  setClips(map) { this.clips = map || {}; }

  hasClip(id, text) {
    const c = this.clips[id];
    return !!c && (text === undefined || c.texto === text);
  }

  /** Fala um texto com a voz do navegador. onstart/onend: avisos quando ESTE item começa e
   *  quando termina por completo (não dispara se ele for cancelado). */
  say(text, { queue = false, rate = 1, volume = 1, tag = null, onstart = null, onend = null, lang = null } = {}) {
    if (!text) return;
    if (!queue) this._clear();
    this.queue.push({ kind: "tts", text, rate, volume, tag, onstart, onend, lang });
    this._next();
    this._emit();
  }

  /** Toca a gravação `id` se ela corresponder ao texto; senão fala o texto.
   *  lang: idioma da fala, quando não é o do site (ex.: o aviso "Para português, aperte I"). */
  clip(id, text, { queue = false, rate = 1, volume = 1, tag = null, lang = null } = {}) {
    if (!this.hasClip(id, text)) return this.say(text, { queue, rate, volume, tag, lang });
    if (!queue) this._clear();
    this.queue.push({ kind: "clip", src: this.clips[id].src, text, rate, volume, tag, lang });
    this._next();
    this._emit();
  }

  /** Tira da fila (sem interromper a fala atual) os itens com esta etiqueta. */
  drop(tag) {
    this.queue = this.queue.filter((q) => q.tag !== tag);
  }

  cancel() {
    this._clear();
    this._emit();
  }

  _clear() {
    this.queue = [];
    this.current = null;
    if (this.audio) { this.audio.pause(); this.audio = null; }
    synth?.cancel();
  }

  busy() { return !!this.current || this.queue.length > 0; }

  _next() {
    if (this.current || !this.queue.length) return;
    const item = this.queue.shift();
    this.current = item;
    const done = () => {
      if (this.current !== item) return; // item antigo (cancelado)
      this.current = null;
      try { item.onend?.(); } catch (err) { console.error(err); }
      this._next();
      this._emit();
    };
    try { item.onstart?.(); } catch (err) { console.error(err); }
    if (item.kind === "clip") this._playClip(item, done);
    else this._speak(item, done);
  }

  _playClip(item, done) {
    const audio = new Audio(item.src);
    this.audio = audio;
    audio.volume = Math.min(1, item.volume);
    audio.playbackRate = item.rate;
    audio.onended = done;
    audio.onerror = () => { if (this.current === item) this._speak(item, done); };
    audio.play().catch(() => {
      // sem gesto do usuário (ou arquivo ausente): tenta a voz do navegador
      if (this.current === item && this.audio === audio) this._speak(item, done);
    });
  }

  _speak(item, done) {
    if (!synth) { setTimeout(done, 0); return; }
    const parts = chunks(item.text);
    if (!parts.length) { setTimeout(done, 0); return; }
    const loc = item.lang || locale();
    const voice = bestVoice(loc);
    let left = parts.length;
    parts.forEach((part) => {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = loc;
      if (voice) u.voice = voice;
      u.rate = item.rate;
      u.volume = item.volume;
      let finished = false;
      const fin = () => { if (!finished) { finished = true; if (--left === 0) done(); } };
      u.onend = fin;
      u.onerror = fin;
      setTimeout(fin, 3000 + part.length * 95); // segurança: onend às vezes não dispara
      synth.speak(u);
    });
  }
}

export const narrator = new Narrator();
