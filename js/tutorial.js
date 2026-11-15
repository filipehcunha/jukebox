// Tutorial guiado por áudio e teclado, pensado para pessoas cegas ou com baixa visão.
// Os passos explicativos aparecem como um guia modal no centro da tela; nos desafios,
// o painel encolhe para a base da tela e o foco vai para o mapa.
// Textos em assets/tutorial/roteiro.json; falas fixas em MP3 neural (tools/gerar_audio_tutorial.py),
// com a voz do navegador como alternativa (js/voz.js).

import { LAYER_ORDER, SAMPLE_SET, SETTINGS, layerInstruments } from "./config.js";
import { narrator } from "./voz.js";

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const VOICE_KEY = "sinfonia-tutorial-voice";
const SEEN_KEY = "sinfonia-tutorial-visto";
const BASE = "assets/tutorial/";

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* sem armazenamento */ }
}
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/**
 * @param {object} api
 * @param {import("./audio.js").SonificationEngine} api.engine
 * @param {() => boolean} api.isLowSensory
 * @param {() => Promise<void>} api.openPractice  abre o mapa de temperatura sem a legenda e foca o mapa
 * @param {() => boolean} api.hasTimeline
 * @param {() => void} api.focusMap
 * @param {() => void} api.backToGallery
 * @param {() => boolean} api.inExplore
 * @param {(msg: string) => void} api.toast
 * @param {(info: { started: boolean, voice: boolean }) => void} [api.onClose]  started: passou da tela inicial
 */
export function createTutorial(api) {
  const dlg = $("tutorialPanel");
  const titleEl = $("tutorialTitle");
  const stepEl = $("tutorialStep");
  const bodyEl = $("tutorialBody");
  const statusEl = $("tutorialStatus");
  const prevBtn = $("tutorialPrev");
  const nextBtn = $("tutorialNext");
  const repeatBtn = $("tutorialRepeat");
  const voiceBox = $("tutorialVoice");

  let roteiro = null;
  let active = false;
  let modal = false;
  let index = 0;
  let steps = [];
  let missionDone = false;
  let demoUntil = 0; // enquanto > agora, o app não sobrescreve o motor de áudio
  let lastFocus = null;
  let moveCount = 0;
  let started = false; // a pessoa passou da tela de boas-vindas (não pulou o tutorial)

  voiceBox.checked = load(VOICE_KEY) !== "0";

  const ready = fetch(`${BASE}roteiro.json`, { cache: "no-cache" })
    .then((r) => r.json())
    .then((data) => {
      roteiro = data;
      const clips = {};
      for (const [id, a] of Object.entries(data.audio || {})) clips[id] = { src: BASE + a.arquivo, texto: a.texto };
      narrator.setClips(clips);
    })
    .catch((err) => {
      console.error("Roteiro do tutorial indisponível", err);
      api.toast("Não foi possível carregar o roteiro do tutorial.");
    });

  // ---------------------------------------------------------------------------
  // Voz
  // ---------------------------------------------------------------------------
  function wantsVoice() {
    return active && voiceBox.checked;
  }

  const voiceOpts = () => ({ rate: api.isLowSensory() ? SETTINGS.low.voiceRate : 1, volume: api.isLowSensory() ? SETTINGS.low.voiceVolume : 1 });

  // fala uma gravação do roteiro (ou o texto, com a voz do navegador)
  function speakId(id, text, { queue = false, tag = null } = {}) {
    if (!wantsVoice()) return;
    narrator.clip(id, text, { queue, tag, ...voiceOpts() });
  }

  function setStatus(text) {
    statusEl.textContent = "";
    requestAnimationFrame(() => { statusEl.textContent = text; });
  }

  function message(id, opts) {
    const text = roteiro.mensagens[id];
    setStatus(text);
    speakId(id, text, opts);
  }

  // ---------------------------------------------------------------------------
  // Demonstrações sonoras
  // ---------------------------------------------------------------------------
  async function ensureAudio() {
    try {
      await api.engine.start();
      api.engine.resume();
      return true;
    } catch (err) {
      api.toast(err.message || "Não foi possível iniciar o áudio.");
      message("sem-som");
      return false;
    }
  }

  async function playInstrument(id, btn) {
    if (!(await ensureAudio())) return;
    narrator.cancel();
    btn?.classList.add("is-playing");
    const secs = await api.engine.preview(id);
    demoUntil = performance.now() + secs * 1000;
    setTimeout(() => btn?.classList.remove("is-playing"), secs * 1000);
  }

  async function playPlace(id, btn) {
    if (!(await ensureAudio())) return;
    narrator.cancel();
    btn?.classList.add("is-playing");
    const secs = await api.engine.previewPlace(id, 5);
    demoUntil = performance.now() + secs * 1000;
    setTimeout(() => btn?.classList.remove("is-playing"), secs * 1000);
  }

  // Sequência de estados enviados ao motor, como se o cursor andasse pelo mapa.
  async function runDemo(frames, stepMs) {
    if (!(await ensureAudio())) return;
    narrator.cancel();
    demoUntil = performance.now() + frames.length * stepMs + 400;
    for (const f of frames) {
      if (!active) break;
      api.engine.update({ active: true, bright: 0.5, grad: 0, ...f });
      await wait(stepMs);
    }
    api.engine.update({ active: false, weights: { low: 0, mid: 0, high: 0, arp: 0 } });
  }

  function demoColdToHot() {
    const frames = [];
    for (let i = 0; i <= 16; i += 1) {
      const t = i / 16;
      frames.push({
        pan: 0,
        norm: t,
        weights: {
          low: Math.max(0, 1 - t * 2.2),
          mid: Math.min(1, Math.max(0, (t - 0.25) * 2.5)),
          high: Math.max(0, (t - 0.7) * 2),
          arp: 0,
        },
      });
    }
    return runDemo(frames, 330);
  }

  function demoLeftRight() {
    const melody = [0.45, 0.55, 0.62, 0.55, 0.45, 0.55, 0.62, 0.7, 0.62, 0.55, 0.45, 0.55];
    return runDemo(
      melody.map((norm, i) => ({ pan: -1 + (2 * i) / (melody.length - 1), norm, weights: { low: 0, mid: 1, high: 0, arp: 0 } })),
      420
    );
  }

  function demoHarp() {
    const frames = [];
    for (let i = 0; i <= 10; i += 1) {
      const w = i <= 5 ? i / 5 : (10 - i) / 5;
      frames.push({ pan: 0, norm: 0.55, weights: { low: 0, mid: 0.5, high: 0, arp: w } });
    }
    return runDemo(frames, 450);
  }

  // ---------------------------------------------------------------------------
  // Passos (textos no roteiro; aqui ficam botões e regras dos desafios)
  // ---------------------------------------------------------------------------
  function button(label, onClick, cls = "button button--ghost") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function buildSteps({ gate = false } = {}) {
    const list = [
      {
        id: "inicio",
        gate: true,
        actions: () => [
          button("Começar o tutorial", () => render(1), "button button--primary"),
          button("Pular e ir para a galeria", () => close()),
        ],
        focus: "action",
        hideNav: true,
      },
      { id: "boas-vindas" },
      {
        id: "instrumentos",
        actions: () => LAYER_ORDER.map((id) => {
          const inst = api.engine.layerInstrument(id) || layerInstruments("temp")[id];
          const b = button(`Ouvir ${(SAMPLE_SET[inst]?.label || id).toLowerCase()}`, () => playInstrument(id, b));
          return b;
        }),
      },
      { id: "grave-agudo", actions: () => [button("Ouvir do frio ao quente", demoColdToHot, "button button--primary")] },
      { id: "esquerda-direita", actions: () => [button("Ouvir da esquerda para a direita", demoLeftRight, "button button--primary")] },
      { id: "harpa", actions: () => [button("Ouvir a harpa", demoHarp, "button button--primary")] },
      {
        id: "lugares",
        actions: () => [["mar", "o mar"], ["gelo", "o gelo"], ["floresta", "a floresta"], ["deserto", "o deserto"], ["coracao", "o coração"]].map(([id, nome]) => {
          const bt = button(`Ouvir ${nome}`, () => playPlace(id, bt));
          return bt;
        }),
      },
      {
        id: "praticar",
        actions: () => [button("Abrir o mapa de temperatura", startPractice, "button button--primary")],
        nextLabel: "Abrir o mapa",
        onNext: startPractice,
      },
      {
        id: "desafio-mover",
        mission: true,
        onEnter: () => { moveCount = 0; },
        check: (type) => type === "move" && ++moveCount >= 4,
        success: "ok-mover",
      },
      { id: "desafio-onde", mission: true, check: (type) => type === "announce", success: "ok-onde" },
      {
        id: "desafio-frio",
        mission: true,
        check: (type, r) => type === "reading" && r?.valid && (r.weights?.low ?? 0) >= 0.6,
        success: "ok-frio",
      },
      { id: "desafio-centro", mission: true, check: (type) => type === "home", success: "ok-centro" },
      {
        id: "desafio-tempo",
        mission: true,
        optional: () => api.hasTimeline(),
        check: (type) => type === "frame",
        success: "ok-tempo",
      },
      {
        id: "fim",
        actions: () => [
          button("Explorar o mapa livremente", () => close({ focusMap: true }), "button button--primary"),
          button("Voltar à galeria", () => { close(); api.backToGallery(); }),
        ],
        nextLabel: "Concluir",
        onNext: () => close({ focusMap: api.inExplore() }),
      },
    ];
    return list.filter((s) => (gate || !s.gate) && (!s.optional || s.optional()));
  }

  async function startPractice() {
    message("abrindo");
    await api.openPractice();
    steps = buildSteps(); // a linha do tempo só é conhecida depois de abrir o mapa
    render(steps.findIndex((s) => s.mission));
  }

  const content = (step) => roteiro.passos[step.id];

  // mesmo texto que tools/gerar_audio_tutorial.py grava
  function spokenText(step) {
    const { titulo, texto } = content(step);
    const end = /[.!?]$/.test(titulo) ? "" : ".";
    return `${titulo}${end} ${texto.join(" ")}`;
  }

  // ---------------------------------------------------------------------------
  // Guia modal (centro) × painel de desafio (base, não modal)
  // ---------------------------------------------------------------------------
  function present(wantModal) {
    if (dlg.open && modal === wantModal) return;
    if (dlg.open) dlg.close();
    modal = wantModal;
    dlg.dataset.mode = wantModal ? "guide" : "mission";
    if (wantModal) dlg.showModal();
    else dlg.show();
  }

  // queue: a fala entra na fila (depois do retorno de um desafio); prefix: texto anunciado antes
  function render(i, { queue = false, prefix = "" } = {}) {
    index = Math.max(0, Math.min(steps.length - 1, i));
    const step = steps[index];
    const { titulo, texto } = content(step);
    missionDone = false;
    if (!step.gate) started = true;

    const missions = steps.filter((s) => s.mission);
    const guides = steps.filter((s) => !s.mission && !s.gate);
    stepEl.textContent = step.gate
      ? "Boas-vindas"
      : step.mission
        ? `Desafio ${missions.indexOf(step) + 1} de ${missions.length}`
        : `Passo ${guides.indexOf(step) + 1} de ${guides.length}`;
    titleEl.textContent = titulo;
    bodyEl.innerHTML = "";
    for (const p of texto) {
      const el = document.createElement("p");
      el.textContent = p;
      bodyEl.append(el);
    }
    const actions = step.actions?.() || [];
    let firstAction = null;
    if (actions.length) {
      const row = document.createElement("div");
      row.className = "tutorial__actions";
      row.append(...actions);
      bodyEl.append(row);
      firstAction = actions[0];
    }
    $("tutorialNav").hidden = !!step.hideNav;
    prevBtn.disabled = index === 0 || steps[index - 1]?.gate;
    nextBtn.textContent = step.nextLabel || (step.mission ? "Pular desafio" : "Próximo");
    step.onEnter?.();

    present(!step.mission);
    const text = spokenText(step);
    if (step.mission) {
      api.focusMap();
      setStatus(prefix ? `${prefix} ${text}` : text);
    } else {
      if (prefix) setStatus(prefix);
      else statusEl.textContent = "";
      if (step.focus === "action" && firstAction) firstAction.focus();
      else titleEl.focus();
    }
    speakId(step.id, text, { queue, tag: "instrucao" });
  }

  function next() {
    const step = steps[index];
    if (step.onNext) return step.onNext();
    if (index < steps.length - 1) render(index + 1);
  }

  function prev() {
    if (index === 0) return;
    let target = index - 1;
    // voltar de um desafio para "Hora de praticar" reabriria o mapa: pula para o passo anterior a ela
    if (steps[target].onNext === startPractice && api.inExplore()) target = Math.max(0, target - 1);
    if (steps[target].gate) return;
    render(target);
  }

  // ---------------------------------------------------------------------------
  // Eventos vindos do app (teclado no mapa, leituras, linha do tempo)
  // ---------------------------------------------------------------------------
  function notify(type, detail) {
    if (!active || missionDone) return;
    const step = steps[index];
    if (!step?.mission || !step.check(type, detail)) return;
    missionDone = true;
    // em fila: não corta a leitura do lugar que o app acabou de falar. O próximo passo
    // já fica valendo (teclas apertadas durante a fala contam), e sua instrução entra na fila.
    const ok = roteiro.mensagens[step.success];
    narrator.drop("instrucao"); // instrução de um desafio já cumprido não precisa mais tocar
    speakId(step.success, ok, { queue: true });
    render(index + 1, { queue: true, prefix: ok });
  }

  // ---------------------------------------------------------------------------
  // Abrir e fechar
  // ---------------------------------------------------------------------------
  async function open({ gate = false } = {}) {
    if (active) { titleEl.focus(); return; }
    await ready;
    if (!roteiro) return;
    if ($("legendDialog").open) $("legendDialog").close();
    lastFocus = document.activeElement;
    active = true;
    started = false;
    document.body.classList.add("tutorial-open");
    steps = buildSteps({ gate });
    render(0);
  }

  function close({ focusMap = false } = {}) {
    if (!active) return;
    active = false;
    store(SEEN_KEY, "1");
    if (dlg.open) dlg.close();
    document.body.classList.remove("tutorial-open");
    narrator.cancel();
    $("ariaLive").textContent = "Tutorial fechado.";
    if (focusMap && api.inExplore()) api.focusMap();
    else if (lastFocus && document.contains(lastFocus) && lastFocus !== document.body && !lastFocus.closest("#tutorialPanel")) lastFocus.focus();
    else $("main").focus({ preventScroll: true });
    api.onClose?.({ started, voice: voiceBox.checked });
  }

  function repeat() {
    const step = steps[index];
    if (!step) return;
    const text = spokenText(step);
    if (step.mission) setStatus(text);
    speakId(step.id, text);
  }

  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);
  repeatBtn.addEventListener("click", repeat);
  $("tutorialClose").addEventListener("click", () => close({ focusMap: api.inExplore() }));
  voiceBox.addEventListener("change", () => {
    store(VOICE_KEY, voiceBox.checked ? "1" : "0");
    if (!voiceBox.checked) narrator.cancel();
    else message("voz-ligada");
  });

  // Escape no modo guia (modal) dispara "cancel"; no modo desafio, tratamos no keydown.
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close({ focusMap: api.inExplore() }); });
  // o evento "close" chega depois (assíncrono): ao trocar de modo o diálogo já reabriu, então ignora
  dlg.addEventListener("close", () => { if (active && !dlg.open) close(); });

  document.addEventListener("keydown", (e) => {
    if (!active || $("legendDialog").open) return;
    if (e.key === "Escape" && !modal) {
      e.preventDefault();
      close({ focusMap: api.inExplore() });
      return;
    }
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      repeat();
    }
  });

  return {
    open,
    close,
    notify,
    wantsVoice,
    seen: () => load(SEEN_KEY) === "1",
    isActive: () => active,
    isSpeaking: () => active && narrator.busy(),
    isDemoPlaying: () => performance.now() < demoUntil,
  };
}
