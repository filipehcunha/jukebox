// Tutorial guiado por áudio e teclado, pensado para pessoas cegas ou com baixa visão.
// Os passos explicativos aparecem como um guia modal no centro da tela; nos desafios,
// o painel encolhe para a base da tela e o foco vai para o mapa.
//
// Textos: assets/tutorial/<idioma>/roteiro.json. Neles, {k:acao} vira o nome da tecla do
// atalho (js/atalhos.js) e {inst:mapa} o nome do instrumento do mapa (config.json).
// Falas fixas em MP3 neural (tools/gerar_audio_tutorial.py); sem gravação, a voz do navegador.

import { SAMPLE_SET, instrumentForScale, layerInstruments } from "./config.js";
import { narrator } from "./voz.js";
import { t, getLang, otherLang, setLang, onLangChange, LANGS } from "./i18n.js";
import { teclaDe, acaoDoEvento } from "./atalhos.js";

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const SEEN_KEY = "sinfonia-tutorial-visto";
const BASE = "assets/tutorial/";
const MAPS = ["temp", "humidity", "wind", "co", "sst", "gedi"];

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* sem armazenamento */ }
}
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Troca {k:acao} e {inst:mapa} pelos nomes no idioma do roteiro. */
export function fillPlaceholders(text, lang) {
  const tr = (key, vars) => t(key, vars, { in: lang });
  return text
    .replace(/\{k:(\w+)\}/g, (m, acao) => teclaDe(acao, tr) || m)
    .replace(/\{inst:(\w+)\}/g, (m, map) => tr(`instruments.${instrumentForScale(map)}`));
}

/**
 * @param {object} api
 * @param {import("./audio.js").SonificationEngine} api.engine
 * @param {() => Promise<void>} api.openPractice  abre o mapa de temperatura sem a legenda e foca o mapa
 * @param {() => void} api.focusMap
 * @param {() => void} api.backToGallery
 * @param {() => boolean} api.inExplore
 * @param {(msg: string) => void} api.toast
 * @param {() => boolean} api.voiceOn         voz do site ligada?
 * @param {(on: boolean) => void} api.setVoice
 * @param {() => {rate:number, volume:number}} api.voiceOpts
 * @param {(info: { started: boolean, voice: boolean }) => void} [api.onClose]
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

  const roteiros = {};
  let active = false;
  let modal = false;
  let index = 0;
  let steps = [];
  let missionDone = false;
  let demoUntil = 0; // enquanto > agora, o app não sobrescreve o motor de áudio
  let lastFocus = null;
  let moveCount = 0;
  let started = false; // a pessoa passou da tela de boas-vindas (não pulou o tutorial)
  let welcomeHeard = false;

  const ready = Promise.all(LANGS.map(async (l) => {
    try {
      const res = await fetch(`${BASE}${l}/roteiro.json`, { cache: "no-cache" });
      roteiros[l] = await res.json();
    } catch (err) {
      console.error(`Roteiro do tutorial (${l}) indisponível`, err);
    }
  })).then(() => {
    const clips = {};
    for (const [l, r] of Object.entries(roteiros)) {
      for (const [id, a] of Object.entries(r?.audio || {})) clips[`${l}:${id}`] = { src: `${BASE}${l}/${a.arquivo}`, texto: a.texto };
    }
    narrator.setClips(clips);
  });

  const roteiro = () => roteiros[getLang()] || roteiros.en;

  // ---------------------------------------------------------------------------
  // Voz (sempre pelo narrador do app: uma fala por vez)
  // ---------------------------------------------------------------------------
  const wantsVoice = () => active && api.voiceOn();

  // id = fala do roteiro do idioma atual; speechLang = idioma da fala, quando é outro
  // (o aviso "Para português, aperte I" fica no roteiro inglês, gravado com voz em português)
  function speakId(id, text, { queue = false, tag = null, speechLang = null } = {}) {
    if (!wantsVoice()) return;
    const lang = speechLang ? (speechLang === "pt" ? "pt-BR" : "en-US") : null;
    narrator.clip(`${getLang()}:${id}`, text, { queue, tag, lang, ...api.voiceOpts() });
  }

  function setStatus(text) {
    statusEl.textContent = "";
    requestAnimationFrame(() => { statusEl.textContent = text; });
  }

  const msgText = (id) => {
    const m = roteiro().mensagens[id];
    return fillPlaceholders(typeof m === "string" ? m : m.texto, getLang());
  };

  function message(id, opts) {
    const text = msgText(id);
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
      api.toast(err.message || t("audio.unavailable"));
      message("sem-som");
      return false;
    }
  }

  // um instrumento por mapa: toca a escala do instrumento, do grave (valor baixo) ao agudo
  async function playMapInstrument(map, btn) {
    if (!(await ensureAudio())) return;
    narrator.cancel();
    api.engine.setLayerInstruments(layerInstruments(map));
    btn?.classList.add("is-playing");
    const secs = await api.engine.previewSweep("mid");
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
  async function runDemo(frames, stepMs, map = "temp") {
    if (!(await ensureAudio())) return;
    narrator.cancel();
    api.engine.setLayerInstruments(layerInstruments(map));
    demoUntil = performance.now() + frames.length * stepMs + 400;
    for (const f of frames) {
      if (!active) break;
      api.engine.update({ active: true, bright: 0.5, grad: 0, weights: { low: 0, mid: 1, high: 0, arp: 0 }, ...f });
      await wait(stepMs);
    }
    api.engine.update({ active: false, weights: { low: 0, mid: 0, high: 0, arp: 0 } });
  }

  // do valor mais baixo ao mais alto: a nota sobe junto
  const demoLowToHigh = () => runDemo(Array.from({ length: 15 }, (_, i) => ({ pan: 0, norm: i / 14 })), 360);

  function demoLeftRight() {
    const melody = [0.45, 0.55, 0.62, 0.55, 0.45, 0.55, 0.62, 0.7, 0.62, 0.55, 0.45, 0.55];
    return runDemo(melody.map((norm, i) => ({ pan: -1 + (2 * i) / (melody.length - 1), norm })), 420);
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
          button(t("tutorial.start"), () => render(1), "button button--primary"),
          button(t("lang.switchLabel"), () => setLang(otherLang())),
          button(t("tutorial.skip"), () => close()),
        ],
        hideNav: true,
      },
      { id: "atalhos" }, // o guia de atalhos é a primeira informação do tutorial
      { id: "boas-vindas" },
      {
        id: "um-instrumento",
        actions: () => MAPS.map((map) => {
          const b = button(t("tutorial.hearMap", { map: t(`scales.${map}.short`), inst: SAMPLE_SET[instrumentForScale(map)].label }), () => playMapInstrument(map, b));
          return b;
        }),
      },
      { id: "grave-agudo", actions: () => [button(t("tutorial.hearLowHigh"), demoLowToHigh, "button button--primary")] },
      { id: "esquerda-direita", actions: () => [button(t("tutorial.hearLeftRight"), demoLeftRight, "button button--primary")] },
      {
        id: "lugares",
        actions: () => ["mar", "gelo", "floresta", "deserto", "coracao"].map((id) => {
          const bt = button(t("legend.hearPlace", { name: t(`soundsOfPlaces.${id}.name`).toLocaleLowerCase() }), () => playPlace(id, bt));
          return bt;
        }),
      },
      {
        id: "praticar",
        actions: () => [button(t("tutorial.openMap"), startPractice, "button button--primary")],
        nextLabel: () => t("tutorial.openMapShort"),
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
        // frio de verdade (−10 °C ou menos): ali as notas ficam bem graves
        check: (type, r) => type === "reading" && r?.valid && r.value <= -10,
        success: "ok-frio",
      },
      { id: "desafio-centro", mission: true, check: (type) => type === "home", success: "ok-centro" },
      {
        id: "fim",
        actions: () => [
          button(t("tutorial.explore"), () => close({ focusMap: true }), "button button--primary"),
          button(t("legend.back"), () => { close(); api.backToGallery(); }),
        ],
        nextLabel: () => t("tutorial.finish"),
        onNext: () => close({ focusMap: api.inExplore() }),
      },
    ];
    return list.filter((s) => gate || !s.gate);
  }

  async function startPractice() {
    message("abrindo");
    await api.openPractice();
    steps = buildSteps();
    render(steps.findIndex((s) => s.mission));
  }

  const content = (step) => {
    const p = roteiro().passos[step.id];
    const l = getLang();
    return { titulo: fillPlaceholders(p.titulo, l), texto: p.texto.map((x) => fillPlaceholders(x, l)) };
  };

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
      ? t("tutorial.welcomeKicker")
      : step.mission
        ? t("tutorial.challengeN", { n: missions.indexOf(step) + 1, total: missions.length })
        : t("tutorial.stepN", { n: guides.indexOf(step) + 1, total: guides.length });
    titleEl.textContent = titulo;
    bodyEl.innerHTML = "";
    for (const p of texto) {
      const el = document.createElement("p");
      el.textContent = p;
      bodyEl.append(el);
    }
    const actions = step.actions?.() || [];
    if (actions.length) {
      const row = document.createElement("div");
      row.className = "tutorial__actions";
      row.append(...actions);
      bodyEl.append(row);
    }
    $("tutorialNav").hidden = !!step.hideNav;
    prevBtn.disabled = index === 0 || steps[index - 1]?.gate;
    nextBtn.textContent = step.nextLabel ? step.nextLabel() : step.mission ? t("tutorial.skipChallenge") : t("tutorial.next");
    step.onEnter?.();

    present(!step.mission);
    const text = spokenText(step);
    if (step.mission) {
      api.focusMap();
      setStatus(prefix ? `${prefix} ${text}` : text);
    } else {
      if (prefix) setStatus(prefix);
      else statusEl.textContent = "";
      // boas-vindas: o foco vai para a própria janela, e o leitor de tela lê o título e o
      // texto inteiro (aria-describedby); nos outros passos, para o título
      if (step.gate) dlg.focus();
      else titleEl.focus();
    }
    if (step.gate) speakWelcome();
    else speakId(step.id, text, { queue, tag: "instrucao" });
  }

  // As boas-vindas são lidas por inteiro, seguidas do aviso de idioma no outro idioma
  // ("Para português, aperte I"). Na primeira visita o navegador só libera áudio depois de um
  // gesto: se ainda não houve nenhum, a leitura começa no primeiro toque de tecla ou clique.
  function speakWelcome() {
    welcomeHeard = false;
    const go = () => {
      if (!active || !steps[index]?.gate) return;
      welcomeHeard = true;
      speakId("inicio", spokenText(steps[index]), { tag: "instrucao" });
      const hint = roteiro().mensagens["idioma-dica"];
      if (hint) speakId("idioma-dica", fillPlaceholders(hint.texto, hint.idioma), { queue: true, speechLang: hint.idioma });
    };
    if (navigator.userActivation?.hasBeenActive !== false) go();
    else {
      const once = () => {
        document.removeEventListener("keydown", once, true);
        document.removeEventListener("pointerdown", once, true);
        // deixa o clique/tecla agir primeiro (Enter em "Começar" troca de passo)
        setTimeout(() => { if (!welcomeHeard) go(); }, 0);
      };
      document.addEventListener("keydown", once, true);
      document.addEventListener("pointerdown", once, true);
    }
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
  // Eventos vindos do app (teclado no mapa, leituras)
  // ---------------------------------------------------------------------------
  function notify(type, detail) {
    if (!active || missionDone) return;
    const step = steps[index];
    if (!step?.mission || !step.check(type, detail)) return;
    missionDone = true;
    // em fila: não corta a leitura do lugar que o app acabou de falar. O próximo passo
    // já fica valendo, e sua instrução entra na fila.
    const ok = msgText(step.success);
    narrator.drop("instrucao");
    speakId(step.success, ok, { queue: true });
    render(index + 1, { queue: true, prefix: ok });
  }

  // ---------------------------------------------------------------------------
  // Abrir e fechar
  // ---------------------------------------------------------------------------
  async function open({ gate = false } = {}) {
    if (active) { (modal ? titleEl : $("mapCanvas")).focus(); return; }
    await ready;
    if (!roteiro()) return;
    if ($("legendDialog").open) $("legendDialog").close();
    if ($("helpDialog").open) $("helpDialog").close();
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
    $("ariaLive").textContent = t("tutorial.closed");
    if (focusMap && api.inExplore()) api.focusMap();
    else if (lastFocus && document.contains(lastFocus) && lastFocus !== document.body && !lastFocus.closest("#tutorialPanel")) lastFocus.focus();
    else $("main").focus({ preventScroll: true });
    api.onClose?.({ started, voice: api.voiceOn() });
  }

  function repeat() {
    const step = steps[index];
    if (!step) return;
    if (step.gate) { speakWelcome(); return; }
    const text = spokenText(step);
    if (step.mission) setStatus(text);
    speakId(step.id, text);
  }

  // troca de idioma com o tutorial aberto: refaz o passo atual no novo idioma
  onLangChange(() => {
    if (!active) return;
    narrator.cancel();
    steps = buildSteps({ gate: steps[0]?.gate });
    render(index);
  });

  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);
  repeatBtn.addEventListener("click", repeat);
  $("tutorialClose").addEventListener("click", () => close({ focusMap: api.inExplore() }));

  // Escape no modo guia (modal) dispara "cancel"; no modo desafio, tratamos no keydown.
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close({ focusMap: api.inExplore() }); });
  // o evento "close" chega depois (assíncrono): ao trocar de modo o diálogo já reabriu, então ignora
  dlg.addEventListener("close", () => { if (active && !dlg.open) close(); });

  document.addEventListener("keydown", (e) => {
    if (!active || $("legendDialog").open || $("helpDialog").open) return;
    if (e.key === "Escape" && !modal) {
      e.preventDefault();
      close({ focusMap: api.inExplore() });
      return;
    }
    // boas-vindas: o foco está na janela (para o leitor de tela ler tudo); Enter começa
    if (e.key === "Enter" && e.target === dlg && steps[index]?.gate) {
      e.preventDefault();
      render(1);
      return;
    }
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "checkbox";
    if (!typing && acaoDoEvento(e, "tutorial") === "repetir") {
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

