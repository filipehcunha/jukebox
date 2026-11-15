// Narrador único do app: UMA fila de falas, e só uma fala toca por vez.
//
// Toca gravações em MP3 (voz neural gerada por tools/gerar_audio_tutorial.py) quando existem
// e, no resto, usa a voz mais natural instalada no navegador (speechSynthesis) no idioma
// escolhido (inglês ou português).
//
// Garantias:
//  - Nunca há duas descrições ao mesmo tempo: antes de começar uma fala, a anterior (MP3 ou
//    voz do navegador) é parada, e o fim de uma fala só é dado quando ela realmente acabou.
//  - Navegadores bloqueiam som antes do primeiro gesto (clique ou tecla). Se a fala for
//    bloqueada, ela fica guardada e começa DO INÍCIO no primeiro gesto (é assim que a janela
//    de boas-vindas é lida por inteiro na primeira visita).
//  - Falas importantes (priority: instruções do tutorial, legenda, ajuda) não são cortadas
//    pela leitura dos controles ao navegar com Tab: essa leitura espera na fila.

const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
let voices = [];
function loadVoices() { voices = synth?.getVoices() || []; }
loadVoices();
synth?.addEventListener?.("voiceschanged", loadVoices);

// Prefere vozes neurais ("Natural"/"Online" no Edge, "Google" no Chrome) às vozes locais antigas.
export function bestVoice(lang = "pt-BR") {
  if (!voices.length) loadVoices();
  const base = lang.slice(0, 2).toLowerCase();
  let list = voices.filter((v) => v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase());
  if (!list.length) list = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const score = (v) =>
    (/natural|neural/i.test(v.name) ? 8 : 0) +
    (/online/i.test(v.name) ? 4 : 0) +
    (/google/i.test(v.name) ? 3 : 0) +
    (/francisca|thalita|antonio|jenny|aria|guy/i.test(v.name) ? 1 : 0);
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

// O navegador já recebeu um gesto do usuário (clique, toque ou tecla)?
const hasActivation = () => navigator.userActivation?.hasBeenActive ?? null;

class Narrator {
  constructor() {
    this.queue = [];
    this.current = null;
    this.audio = null;
    this.clips = {}; // id -> { src, texto }
    this.lang = "en-US";
    this.onBusyChange = null; // (falando: boolean) => void — o app pausa a música enquanto true
    this._wasBusy = false;
    this._token = 0; // muda a cada fala iniciada ou cancelada: callbacks antigos são ignorados
    this.blocked = hasActivation() === false; // sem gesto ainda: espera para falar
    const unlock = () => {
      if (!this.blocked) return;
      this.blocked = false;
      // dá tempo de o próprio gesto (ex.: Enter num botão) trocar a fala antes de começar
      setTimeout(() => this._next(), 30);
    };
    for (const type of ["pointerdown", "keydown", "touchend"]) window.addEventListener(type, unlock, { capture: true });
  }

  // avisa quando a narração começa ou termina (uma vez por mudança)
  _emit() {
    const b = this.busy();
    if (b === this._wasBusy) return;
    this._wasBusy = b;
    try { this.onBusyChange?.(b); } catch (err) { console.error(err); }
  }

  /** Idioma da voz do navegador ("en-US" ou "pt-BR"). */
  setLang(lang) { this.lang = lang; }

  /** Registra as gravações disponíveis: id -> { src, texto }. */
  setClips(map) { this.clips = map || {}; }

  hasClip(id, text) {
    const c = this.clips[id];
    return !!c && (text === undefined || c.texto === text);
  }

  /** Fala um texto com a voz do navegador. onstart/onend: avisos quando ESTE item começa e
   *  quando termina por completo (não dispara se ele for cancelado). priority: não é cortado
   *  pela leitura de controles (sayLow). */
  say(text, { queue = false, rate = 1, volume = 1, tag = null, priority = false, onstart = null, onend = null } = {}) {
    if (!text) return;
    if (!queue) this._clear();
    this.queue.push({ kind: "tts", text, rate, volume, tag, priority, onstart, onend, lang: this.lang });
    this._next();
    this._emit();
  }

  /** Toca a gravação `id` se ela corresponder ao texto; senão fala o texto. */
  clip(id, text, { queue = false, rate = 1, volume = 1, tag = null, priority = false } = {}) {
    if (!this.hasClip(id, text)) return this.say(text, { queue, rate, volume, tag, priority });
    if (!queue) this._clear();
    this.queue.push({ kind: "clip", src: this.clips[id].src, text, rate, volume, tag, priority, lang: this.lang });
    this._next();
    this._emit();
  }

  /** Fala de baixa prioridade (leitura dos controles ao navegar): se uma fala importante
   *  estiver tocando, espera por ela na fila (fica só a mais recente); senão, fala na hora. */
  sayLow(text, opts = {}) {
    if (!text) return;
    if (this.current?.priority || this.queue.some((q) => q.priority)) {
      this.drop("baixa");
      this.say(text, { ...opts, queue: true, tag: "baixa" });
    } else {
      this.say(text, { ...opts, tag: "baixa" });
    }
  }

  /** Tira da fila (sem interromper a fala atual) os itens com esta etiqueta. */
  drop(tag) {
    this.queue = this.queue.filter((q) => q.tag !== tag);
  }

  cancel() {
    this._clear();
    this._emit();
  }

  _stopOutput() {
    if (this.audio) {
      this.audio.onended = this.audio.onerror = null;
      this.audio.pause();
      this.audio = null;
    }
    synth?.cancel();
  }

  _clear() {
    this.queue = [];
    this.current = null;
    this._token += 1;
    this._stopOutput();
  }

  busy() { return !!this.current || this.queue.length > 0; }

  _next() {
    if (this.current || !this.queue.length || this.blocked) return;
    const item = this.queue.shift();
    this.current = item;
    const token = ++this._token;
    let finished = false;
    const done = () => {
      if (finished || token !== this._token || this.current !== item) return; // item antigo (cancelado)
      finished = true;
      this.current = null;
      try { item.onend?.(); } catch (err) { console.error(err); }
      this._next();
      this._emit();
    };
    // bloqueado pelo navegador (sem gesto): devolve o item ao início da fila e espera o gesto
    const blocked = () => {
      if (finished || token !== this._token) return;
      finished = true;
      this._stopOutput();
      this.current = null;
      this.blocked = true;
      this.queue.unshift(item);
    };
    this._stopOutput(); // nunca duas falas ao mesmo tempo
    try { item.onstart?.(); } catch (err) { console.error(err); }
    if (item.kind === "clip") this._playClip(item, token, done, blocked);
    else this._speak(item, token, done, blocked);
  }

  _playClip(item, token, done, blocked) {
    const audio = new Audio(item.src);
    this.audio = audio;
    audio.volume = Math.min(1, item.volume);
    audio.playbackRate = item.rate;
    let fellBack = false;
    // arquivo ausente ou com erro: usa a voz do navegador (uma vez só)
    const fallback = () => {
      if (fellBack || token !== this._token) return;
      fellBack = true;
      if (this.audio === audio) { audio.onended = audio.onerror = null; audio.pause(); this.audio = null; }
      this._speak(item, token, done, blocked);
    };
    audio.onended = done;
    audio.onerror = fallback;
    audio.play().catch((err) => {
      if (token !== this._token) return;
      if (err?.name === "NotAllowedError") blocked();
      else fallback();
    });
  }

  _speak(item, token, done, blocked) {
    if (!synth) { setTimeout(done, 0); return; }
    const parts = chunks(item.text);
    if (!parts.length) { setTimeout(done, 0); return; }
    const voice = bestVoice(item.lang);
    let left = parts.length;
    let failed = false;
    parts.forEach((part) => {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = item.lang;
      if (voice) u.voice = voice;
      u.rate = item.rate;
      u.volume = item.volume;
      let over = false;
      const fin = () => {
        if (over) return;
        over = true;
        if (--left === 0) done();
      };
      u.onend = fin;
      u.onerror = (e) => {
        if (e.error === "not-allowed" && !failed) { failed = true; blocked(); return; }
        if (e.error === "interrupted" || e.error === "canceled") return; // cancelado de propósito
        fin();
      };
      // segurança: alguns navegadores não disparam onend. Só encerra quando a voz realmente
      // parou de falar, para a próxima fala não começar por cima desta.
      const limit = performance.now() + 8000 + part.length * 260;
      const watch = () => {
        if (over || token !== this._token) return;
        if (!synth.speaking && !synth.pending) fin();
        else if (performance.now() > limit) fin();
        else setTimeout(watch, 400);
      };
      setTimeout(watch, 2500 + part.length * 70);
      synth.speak(u);
    });
  }
}

export const narrator = new Narrator();
