// Tutorial guiado por áudio e teclado, pensado para pessoas cegas ou com baixa visão.
// Os passos explicativos aparecem como um guia modal no centro da tela; nos desafios,
// o painel encolhe para a base da tela e o foco vai para o mapa.
//
// O primeiro passo depois das boas-vindas é o guia de atalhos (montado a partir de
// js/shortcuts.js). Textos em assets/tutorial/roteiro.json, um bloco por idioma; gravações
// em MP3 opcionais (tools/gerar_audio_tutorial.py), com a voz do navegador como alternativa.

import { CHARACTERISTICS, instrumentFor } from "./config.js";
import { SHORTCUTS, SHORTCUT_ORDER } from "./shortcuts.js";
import { t, getLang, keyName, joinList } from "./i18n.js";
import { narrator } from "./voz.js";

const $ = (id) => document.getElementById(id);
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
 * @param {() => Promise<void>} api.openPractice  abre o mapa de temperatura sem a legenda e foca o mapa
 * @param {() => boolean} api.hasTimeline
 * @param {() => void} api.focusMap
 * @param {() => void} api.backToGallery
 * @param {() => boolean} api.inExplore
 * @param {(msg: string) => void} api.toast
 * @param {() => boolean} api.voiceOn       a voz do site está ligada?
 * @param {(on: boolean) => void} api.setVoice
 * @param {() => object} api.voiceOpts      { rate, volume } da narração
 */
export function createTutorial(api) {
  const dlg = $("tutorialPanel");
  const titleEl = $("tutorialTitle");
  const stepEl = $("tutorialStep");
  const bodyEl = $("tutorialBody");
  const actionsEl = $("tutorialActions");
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
  let lastFocus = null;
  let moveCount = 0;
  let welcomeStarted = false; // a fala das boas-vindas já começou a tocar?
  let welcomeKeyUsed = false; // a 1ª tecla já foi usada para destravar a leitura

  const ready = fetch(`${BASE}roteiro.json`, { cache: "no-cache" })
    .then((r) => r.json())
    .then((data) => { roteiro = data; useClips(); })
    .catch((err) => {
      console.error("Roteiro do tutorial indisponível", err);
      api.toast(t("tut.loadError"));
    });

  // gravações do idioma atual (id "en:inicio", "pt:inicio"...)
  function useClips() {
    if (!roteiro) return;
    const clips = {};
    for (const [lang, list] of Object.entries(roteiro.audio || {})) {
      for (const [id, a] of Object.entries(list || {})) clips[`${lang}:${id}`] = { src: BASE + a.arquivo, texto: a.texto };
    }
    narrator.setClips(clips);
  }

  const texts = () => roteiro[getLang()] || roteiro.en;

  // {tecla:nome} → nome falado da tecla do atalho (js/shortcuts.js)
  const fill = (s) => s.replace(/\{tecla:(\w+)\}/g, (_, n) => (SHORTCUTS[n] ? keyName(SHORTCUTS[n].key) : n));

  // ---------------------------------------------------------------------------
  // Voz
  // ---------------------------------------------------------------------------
  const wantsVoice = () => active && api.voiceOn();

  // fala uma gravação do roteiro (ou o texto, com a voz do navegador)
  function speakId(id, text, { queue = false, tag = null, onstart = null } = {}) {
    if (!wantsVoice()) return;
    narrator.clip(`${getLang()}:${id}`, text, { queue, tag, priority: true, onstart, ...api.voiceOpts() });
  }

  function setStatus(text) {
    statusEl.textContent = "";
    requestAnimationFrame(() => { statusEl.textContent = text; });
  }

  function message(id, opts) {
    const text = fill(texts().mensagens[id]);
    setStatus(text);
    speakId(id, text, opts);
  }

  // ---------------------------------------------------------------------------
  // Demonstrações sonoras (vozes de pré-escuta: não mexem no som do mapa)
  // ---------------------------------------------------------------------------
  async function ensureAudio() {
    try {
      await api.engine.start();
      api.engine.resume();
      return true;
    } catch {
      message("sem-som");
      return false;
    }
  }

  async function demo(btn, play) {
    if (!(await ensureAudio())) return;
    narrator.cancel();
    btn?.classList.add("is-playing");
    const secs = await play();
    setTimeout(() => btn?.classList.remove("is-playing"), secs * 1000);
  }

  const tempInstrument = () => instrumentFor("TEMPERATURE");

  // do valor mais baixo ao mais alto: a nota sobe junto
  const demoLowToHigh = (btn) => demo(btn, () => api.engine.playValues(tempInstrument(), Array.from({ length: 11 }, (_, i) => i / 10), 0.38));

  const demoLeftRight = (btn) => {
    const melody = [0.45, 0.55, 0.62, 0.55, 0.45, 0.55, 0.62, 0.7, 0.62, 0.55, 0.45, 0.55];
    return demo(btn, () => api.engine.playValues(tempInstrument(), melody.map((norm, i) => ({ norm, pan: -1 + (2 * i) / (melody.length - 1) })), 0.42));
  };

  // ---------------------------------------------------------------------------
  // Passos (textos no roteiro; aqui ficam botões e regras dos desafios)
  // ---------------------------------------------------------------------------
  function button(label, onClick, cls = "button button--ghost") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", () => onClick(b));
    return b;
  }

  function buildSteps({ gate = false } = {}) {
    const list = [
      {
        id: "inicio",
        gate: true,
        actions: () => [
          button(t("tut.start"), () => render(1), "button button--primary"),
          button(t("tut.skip"), () => close()),
        ],
        hideNav: true,
      },
      // o guia de atalhos é a primeira informação do tutorial
      { id: "atalhos" },
      { id: "como-funciona" },
      {
        id: "instrumentos",
        actions: () => CHARACTERISTICS.map((c) => {
          const inst = instrumentFor(c);
          return button(t("tut.hearInst", { char: t(`char.${c}`), inst: t(`inst.${inst}`) }), (b) => demo(b, () => api.engine.preview(inst)));
        }),
      },
      { id: "grave-agudo", actions: () => [button(t("tut.hearLowHigh"), demoLowToHigh, "button button--primary")] },
      { id: "esquerda-direita", actions: () => [button(t("tut.hearLeftRight"), demoLeftRight, "button button--primary")] },
      {
        id: "lugares",
        actions: () => ["mar", "gelo", "floresta", "deserto"].map((id) =>
          button(t("tut.hearPlace", { place: t(`placeName.${id}`) }), (b) => demo(b, () => api.engine.previewPlace(id, 5)))),
      },
      {
        id: "praticar",
        actions: () => [button(t("tut.openMap"), startPractice, "button button--primary")],
        nextLabel: () => t("tut.openMapShort"),
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
        check: (type, r) => type === "reading" && r?.valid && r.value <= -10,
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
          button(t("tut.explore"), () => close({ focusMap: true }), "button button--primary"),
          button(t("tut.toGallery"), () => { close(); api.backToGallery(); }),
        ],
        nextLabel: () => t("tut.finish"),
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

  // lista de atalhos: [{ key, text }] na ordem de SHORTCUT_ORDER
  const shortcutList = () => SHORTCUT_ORDER.map((n) => ({ key: SHORTCUTS[n].key, text: t(`sc.${n}`) }));

  // lista "característica: instrumento" do config.json
  const instrumentSentence = () =>
    `${joinList(CHARACTERISTICS.map((c) => `${t(`char.${c}`).toLowerCase()}, ${t(`inst.${instrumentFor(c)}`).toLowerCase()}`), "; ")}.`;

  // título e parágrafos do passo, já com as teclas e listas preenchidas
  function content(step) {
    const { titulo, texto } = texts().passos[step.id];
    return {
      titulo: fill(titulo),
      texto: texto.map((p) => (p === "{atalhos}" ? p : fill(p.replace("{instrumentos}", instrumentSentence())))),
    };
  }

  // o que a voz fala (mesmo texto que tools/gerar_audio_tutorial.py grava)
  function spokenText(step) {
    const { titulo, texto } = content(step);
    const end = /[.!?]$/.test(titulo) ? "" : ".";
    const parts = texto.map((p) => (p === "{atalhos}" ? shortcutList().map((s) => `${keyName(s.key)}: ${s.text}.`).join(" ") : p));
    return `${titulo}${end} ${parts.join(" ")}`;
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
  function render(i, { queue = false, prefix = "", speak = true } = {}) {
    index = Math.max(0, Math.min(steps.length - 1, i));
    const step = steps[index];
    const { titulo, texto } = content(step);
    missionDone = false;

    const missions = steps.filter((s) => s.mission);
    const guides = steps.filter((s) => !s.mission && !s.gate);
    stepEl.textContent = step.gate
      ? t("tut.welcome")
      : step.mission
        ? t("tut.challengeN", { n: missions.indexOf(step) + 1, total: missions.length })
        : t("tut.stepN", { n: guides.indexOf(step) + 1, total: guides.length });
    titleEl.textContent = titulo;
    bodyEl.innerHTML = "";
    for (const p of texto) {
      if (p === "{atalhos}") {
        const ul = document.createElement("ul");
        ul.className = "tutorial__keys";
        for (const s of shortcutList()) {
          const li = document.createElement("li");
          const kbd = document.createElement("kbd");
          kbd.textContent = keyName(s.key, { short: true });
          li.append(kbd, ` ${s.text}`);
          ul.append(li);
        }
        bodyEl.append(ul);
        continue;
      }
      const el = document.createElement("p");
      el.textContent = p;
      bodyEl.append(el);
    }
    // os botões ficam fora do corpo: o leitor de tela lê o corpo inteiro como descrição do diálogo
    actionsEl.innerHTML = "";
    const actions = step.actions?.() || [];
    actionsEl.append(...actions);
    actionsEl.hidden = !actions.length;
    $("tutorialNav").hidden = !!step.hideNav;
    prevBtn.disabled = index === 0 || steps[index - 1]?.gate;
    nextBtn.textContent = step.nextLabel?.() || t(step.mission ? "tut.skipChallenge" : "tut.next");
    step.onEnter?.();

    present(!step.mission);
    const text = spokenText(step);
    if (step.mission) {
      api.focusMap();
      setStatus(prefix ? `${prefix} ${text}` : text);
    } else {
      if (prefix) setStatus(prefix);
      else statusEl.textContent = "";
      // o foco vai para o título: com o aria-describedby do diálogo, o leitor de tela lê o
      // título e o texto inteiro (inclusive a janela de boas-vindas na primeira visita)
      titleEl.focus();
    }
    if (speak) speakId(step.id, text, { queue, tag: "instrucao", onstart: step.gate ? () => { welcomeStarted = true; } : null });
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
    // em fila: não corta a leitura do lugar que o app acabou de falar
    const ok = fill(texts().mensagens[step.success]);
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
    if ($("helpDialog").open) $("helpDialog").close();
    lastFocus = document.activeElement;
    active = true;
    welcomeStarted = false;
    welcomeKeyUsed = false;
    voiceBox.checked = api.voiceOn();
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
    $("ariaLive").textContent = t("tut.closed");
    if (focusMap && api.inExplore()) api.focusMap();
    else if (lastFocus && document.contains(lastFocus) && lastFocus !== document.body && !lastFocus.closest("#tutorialPanel")) lastFocus.focus();
    else $("main").focus({ preventScroll: true });
  }

  function repeat() {
    const step = steps[index];
    if (!step) return;
    const text = spokenText(step);
    if (step.mission) setStatus(text);
    speakId(step.id, text);
  }

  // idioma trocado: redesenha e fala o passo atual no novo idioma
  function refresh() {
    useClips();
    if (active && steps.length) render(index);
  }

  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);
  repeatBtn.addEventListener("click", repeat);
  $("tutorialClose").addEventListener("click", () => close({ focusMap: api.inExplore() }));
  voiceBox.addEventListener("change", () => {
    api.setVoice(voiceBox.checked);
    if (voiceBox.checked) message("voz-ligada");
  });

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
    const step = steps[index];
    const onControl = e.target.closest?.("button, a, input, select, textarea");
    // Primeira visita: o navegador só libera a voz depois de um gesto. Se a primeira tecla for
    // Enter ou Espaço, ela serve para COMEÇAR A LEITURA das boas-vindas (que dizem o que fazer),
    // e não para pular a tela sem que a pessoa tenha ouvido nada.
    // (só a primeira vez: a segunda tecla Enter começa o tutorial normalmente)
    if (step?.gate && !welcomeStarted && !welcomeKeyUsed && api.voiceOn() && (e.key === "Enter" || e.key === " ") && !onControl) {
      welcomeKeyUsed = true;
      e.preventDefault();
      return;
    }
    // boas-vindas: Enter começa o tutorial (o foco está no título, para a leitura completa)
    if (step?.gate && e.key === "Enter" && !onControl) {
      e.preventDefault();
      render(1);
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
    refresh,
    syncVoice: () => { voiceBox.checked = api.voiceOn(); },
    seen: () => load(SEEN_KEY) === "1",
    isActive: () => active,
    isModal: () => active && modal,
    isSpeaking: () => active && narrator.busy(),
    isDemoPlaying: () => api.engine.previewing,
  };
}
