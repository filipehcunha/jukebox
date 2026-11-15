// A Sinfonia da Terra · Earth Jukebox Multissensorial
// Orquestra galeria, legenda, leitura de pixels, áudio, háptica, idioma e acessibilidade.
//
// Princípios:
//  - Cada mapa tem a sua escala própria (fixa) e representa uma característica do planeta,
//    tocada por UM instrumento (config.json → mapeamento): valor mais alto = nota mais aguda.
//  - A voz só fala quando a pessoa pede: clique no mapa, Espaço, atalhos, tutorial e legenda.
//  - Nenhum atalho usa tecla modificadora; o dicionário tecla → botão fica em js/shortcuts.js.
//  - Todos os textos (tela e voz) vêm de js/i18n.js, no idioma escolhido (inglês por padrão).

import { SCALES, GMAO_T0_UTC, paletteColor } from "./scales.js";
import { MAPPING_CONFIG, SAMPLE_SET, SETTINGS, CONFIG_PROBLEMS, instrumentFor } from "./config.js";
import { loadLandMask, loadCountries, formatCoord, landscapeAt } from "./geo.js";
import { ImageSampler } from "./sampler.js";
import { SonificationEngine } from "./audio.js";
import { HapticBridge, renderQr, guessReceiverBase, checkPublicReceiver, PUBLIC_RECEIVER_BASE } from "./haptics.js";
import { presetGroups, upgradeGmaoSequences, renderPresets, groupTitle } from "./gallery.js";
import { createTutorial } from "./tutorial.js";
import { narrator } from "./voz.js";
import { initFocusEcho } from "./a11y.js";
import { createWander, stepWander } from "./passeio.js";
import { SHORTCUTS, SHORTCUT_ORDER, matches, ariaKey } from "./shortcuts.js";
import { t, getLang, setLang, onLangChange, applyI18n, speechLang, locale, keyName } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const canvas = $("mapCanvas");
const ctx = canvas.getContext("2d");

const engine = new SonificationEngine();
window.sinfonia = { engine, narrator, MAPPING_CONFIG, SAMPLE_SET, SETTINGS, SHORTCUTS }; // acesso para depuração no console
const haptics = new HapticBridge({ onStatus: onPhoneStatus });

// ---------------------------------------------------------------------------
// Preferências (só conveniências deste navegador; os padrões vêm do config.json)
// ---------------------------------------------------------------------------
const prefs = (() => {
  try { return JSON.parse(localStorage.getItem("sinfonia-prefs") || "{}"); } catch { return {}; }
})();
// Se o config.json mudou desde a última visita, ele vence as escolhas salvas desses itens.
const CONFIG_SIGNATURE = JSON.stringify([
  SETTINGS.audio.volumeDb, SETTINGS.narration.onAtStart, SETTINGS.a11y.textSize, SETTINGS.a11y.highContrast, SETTINGS.a11y.lang,
]);
if (prefs.cfg !== CONFIG_SIGNATURE) {
  for (const k of ["volume", "voice", "text", "hc", "lang"]) delete prefs[k];
}
function savePrefs() {
  try {
    localStorage.setItem("sinfonia-prefs", JSON.stringify({
      voice: $("voiceToggle").checked, hc: $("highContrast").checked, color: $("colorMode").value,
      volume: Number($("volumeSlider").value), lan: $("lanInput").value, receiver: $("receiverMode").value,
      text: $("textSize").value, lang: getLang(), cfg: CONFIG_SIGNATURE, v: 3,
    }));
  } catch { /* armazenamento indisponível */ }
}

// o idioma vem antes de tudo: os módulos leem os textos na hora de desenhar
setLang(prefs.lang || SETTINGS.a11y.lang);
narrator.setLang(speechLang());

// ---------------------------------------------------------------------------
// Voz e anúncios
// ---------------------------------------------------------------------------
const voiceOn = () => $("voiceToggle").checked;
const voiceOpts = () => ({ rate: SETTINGS.narration.rate, volume: SETTINGS.narration.volume });

// A VOZ TEM PRIORIDADE: enquanto a narração fala, a música para e volta sozinha no fim
// (config.json → narracao). Só uma fala toca por vez (js/voz.js).
narrator.onBusyChange = (speaking) => engine.duck(speaking);

function speak(text, { queue = false, force = false, priority = false } = {}) {
  if (!text || !(force || voiceOn())) return;
  narrator.say(text, { queue, priority, ...voiceOpts() });
}

// Anuncia para o leitor de tela (região ARIA live) e para a voz do site
function announce(text, { speak: toVoice = true, live: toLive = true, queue = false } = {}) {
  if (toLive) {
    const live = $("ariaLive");
    live.textContent = "";
    requestAnimationFrame(() => { live.textContent = text; });
  }
  if (toVoice) speak(text, { queue });
}

let toastTimer;
function toast(msg, ms = 3800) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), ms);
  speak(msg, { queue: true }); // o leitor de tela já lê o role=alert
}

// as funções do app usadas aqui são declarações, então já existem (hoisting)
const tutorial = createTutorial({
  engine,
  openPractice,
  hasTimeline: () => (state.group?.frames.length ?? 0) > 1,
  focusMap: () => { canvas.focus({ preventScroll: true }); state.keyboardActive = true; state.readingDirty = true; },
  backToGallery,
  inExplore: () => !$("exploreView").hidden,
  toast,
  voiceOn,
  setVoice: (on) => applyVoice(on, { quiet: true }),
  voiceOpts,
});

const state = {
  presets: presetGroups(),
  group: null,
  index: 0,
  scale: null,
  projection: null,
  sampler: null,
  baseCanvas: null, // imagem exibida (original ou recolorida)
  u: 0.5,
  v: 0.5,
  pointerInside: false,
  keyboardActive: false,
  reading: null,
  readingDirty: false,
  lastMove: 0,
  trail: [],
  playing: false,
  loadToken: 0,
  colorMode: "none",
  legendHover: null, // posição 0..1 sob o mouse na barra de cores (pré-escuta da escala)
};

// passeio sonoro (tecla V): ver a seção "Passeio sonoro" mais abaixo
const tour = { on: false, t0: 0, last: 0, wander: null };

const title = () => (state.group ? groupTitle(state.group) : "");

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function updateDocTitle() {
  const gallery = $("exploreView").hidden || !state.group;
  document.title = gallery ? `${t("doc.gallery")} · ${t("brand.title")}` : `${title()} · ${t("brand.title")}`;
}

function showView(name) {
  const gallery = name === "gallery";
  $("galleryView").hidden = !gallery;
  $("exploreView").hidden = gallery;
  document.body.dataset.view = name;
  updateDocTitle();
  if (gallery) {
    stopTour({ silent: true });
    stopTimeline();
    engine.update({ active: false });
    haptics.send(null, { active: false });
  }
}

function backToGallery() {
  for (const id of ["helpDialog", "legendDialog"]) if ($(id).open) $(id).close("stay");
  showView("gallery");
  $("main").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
  announce(t("gallery.announce", { n: state.presets.length }));
}

function renderGallery() {
  renderPresets($("presetGrid"), state.presets, selectGroup);
  $("presetsNote").textContent = state.presets.some((g) => g.sequence) ? t("gallery.noteSeq") : t("gallery.note");
}

// ---------------------------------------------------------------------------
// Seleção de mapa -> Legenda -> Exploração
// ---------------------------------------------------------------------------
async function selectGroup(group, index = 0, { skipLegend = false } = {}) {
  // o clique na galeria é um gesto do usuário: libera o áudio já aqui
  if (engine.available) engine.start().then(updateAudioUI).catch(() => {});
  state.group = group;
  state.index = index;
  state.scale = SCALES[group.scaleId];
  state.u = 0.5;
  state.v = 0.5;
  state.trail = [];
  engine.setInstrument(instrumentFor(state.scale.characteristic));
  preloadFrames(group, index); // todos os quadros do mapa começam a baixar já
  const loading = loadFrame(index, { initial: true });
  if (skipLegend) {
    await loading;
    await startExperience();
    return;
  }
  openLegend();
  await loading;
}

const instName = () => t(`inst.${instrumentFor(state.scale.characteristic)}`);

// ---------------------------------------------------------------------------
// Legenda: a escala do mapa, o instrumento dele e os sons dos lugares
// ---------------------------------------------------------------------------
const PLACE_ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const PLACES = [
  { id: "mar", color: "#38bdf8", icon: '<path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M6 10c1.5-3 4-5 8-5"/>' },
  { id: "gelo", color: "#bae6fd", icon: '<path d="M12 2v20M4.9 6l14.2 12M19.1 6 4.9 18"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>' },
  { id: "floresta", color: "#4ade80", icon: '<path d="M12 22v-6"/><path d="M12 2 6 11h3l-4 6h14l-4-6h3Z"/>' },
  { id: "deserto", color: "#fbbf24", icon: '<circle cx="17" cy="7" r="3"/><path d="M2 19c3-4 6-5 9-3s6 1 11-3"/>' },
];

const INSTRUMENT_ICONS = {
  bowed: `<svg viewBox="0 0 48 48"><path d="M24 4v10M20 6h8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M24 14c-5 0-8 3-7 8 .6 2.6-3 3.5-3 9 0 6.5 4.5 11 10 11s10-4.5 10-11c0-5.5-3.6-6.4-3-9 1-5-2-8-7-8Z" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M21 27c1 1 5 1 6 0M21 33c1-1 5-1 6 0" stroke="currentColor" stroke-width="2"/><path d="M24 14v28" stroke="currentColor" stroke-width="1.6"/></svg>`,
  keys: `<svg viewBox="0 0 48 48"><rect x="5" y="12" width="38" height="26" rx="3" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12.5 12v26M20 12v26M27.5 12v26M35 12v26" stroke="currentColor" stroke-width="1.8"/><path d="M10 12h5v14h-5zM17.5 12h5v14h-5zM32.5 12h5v14h-5z" fill="currentColor"/></svg>`,
  wind: `<svg viewBox="0 0 48 48"><path d="M8 38 40 8" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="18" cy="28" r="1.8" fill="var(--bg-deep, #000)"/><circle cx="23" cy="23" r="1.8" fill="var(--bg-deep, #000)"/><circle cx="28" cy="18" r="1.8" fill="var(--bg-deep, #000)"/><path d="M36 30c3 1 5 3 6 6M33 35c2 .5 3.5 2 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`,
  harp: `<svg viewBox="0 0 48 48"><path d="M12 42V8c10 0 14 6 18 12s8 8 8 8l-26 14Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M17 13v26M22 15v21M27 19v15M32 25v6" stroke="currentColor" stroke-width="1.6"/></svg>`,
  mallet: `<svg viewBox="0 0 48 48"><path d="M6 30h36" stroke="currentColor" stroke-width="2"/><rect x="7" y="18" width="5" height="16" rx="1.5" fill="currentColor"/><rect x="14" y="19" width="5" height="14" rx="1.5" fill="currentColor"/><rect x="21" y="20" width="5" height="12" rx="1.5" fill="currentColor"/><rect x="28" y="21" width="5" height="10" rx="1.5" fill="currentColor"/><rect x="35" y="22" width="5" height="8" rx="1.5" fill="currentColor"/><path d="M14 6l8 10M34 6l-6 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="23" cy="17" r="2.6" fill="currentColor"/><circle cx="27.5" cy="18" r="2.6" fill="currentColor"/></svg>`,
  pad: `<svg viewBox="0 0 48 48"><rect x="5" y="10" width="38" height="28" rx="4" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M10 26c3-8 6-8 9 0s6 8 9 0 6-8 9 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
};

const PLAY_ICON = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor"/></svg>`;

function makeCard({ id, color, iconSvg, register, name, text, aria, play, stop }) {
  const li = document.createElement("li");
  li.className = "instrument";
  li.style.setProperty("--inst", color);
  li.innerHTML = `
    <span class="instrument__icon" aria-hidden="true">${iconSvg}</span>
    <div class="instrument__body">
      ${register ? `<p class="instrument__register"></p>` : ""}
      <h3 class="instrument__name" id="card-${id}"></h3>
      <p class="instrument__role" id="card-${id}-text"></p>
    </div>
    <div class="instrument__actions"></div>`;
  if (register) li.querySelector(".instrument__register").textContent = register;
  li.querySelector(".instrument__name").textContent = name;
  li.querySelector(".instrument__role").textContent = text;
  // o botão carrega o nome e a explicação: é ele que o teclado e o leitor de tela encontram
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "button button--ghost instrument__play";
  btn.setAttribute("aria-label", aria);
  btn.setAttribute("aria-describedby", `card-${id}-text`);
  btn.innerHTML = `${PLAY_ICON} <span></span>`;
  btn.querySelector("span").textContent = t("legend.listen");
  li.querySelector(".instrument__actions").append(btn);
  bindLegendCard(li, btn, { play, stop });
  return li;
}

function openLegend() {
  const scale = state.scale;
  if (!scale) return;
  const dlg = $("legendDialog");
  engine.update({ active: false });
  const instId = instrumentFor(scale.characteristic);
  const inst = SAMPLE_SET[instId];
  $("legendDialogTitle").textContent = t("legend.title", { map: title() });
  $("legendDialogIntro").textContent = t("legend.intro", { char: scale.characteristicName, inst: instName() });
  $("dlgScaleLabel").textContent = scale.label;
  $("dlgScaleUnit").textContent = scale.unit;
  $("dlgGradient").style.background = scale.gradientCss();
  renderTicks($("dlgTicks"), scale);

  const list = $("instrumentList");
  list.innerHTML = "";
  list.append(makeCard({
    id: "inst",
    color: "#f4c76b",
    iconSvg: INSTRUMENT_ICONS[inst.icon],
    register: scale.characteristicName,
    name: instName(),
    text: t("legend.instText", { char: scale.characteristicName.toLowerCase(), lo: scale.format(scale.min), hi: scale.format(scale.max) }),
    aria: t("legend.instAria", { inst: instName() }),
    play: () => engine.preview(instId),
    stop: () => engine.stopPreview(),
  }));

  const places = $("placeList");
  places.innerHTML = "";
  // os sons dos lugares ficam escondidos até a pessoa pedir para rever essa parte do tutorial
  // (redesenhar a legenda aberta, ao trocar o idioma, mantém o que estava aberto)
  setPlacesOpen(dlg.open && placesOpen());
  for (const p of PLACES) {
    const name = t(`placeName.${p.id}`);
    places.append(makeCard({
      id: `place-${p.id}`,
      color: p.color,
      iconSvg: PLACE_ICON(p.icon),
      name,
      text: t(`placeText.${p.id}`),
      aria: t("legend.placeAria", { place: name.toLowerCase() }),
      play: () => engine.previewPlace(p.id),
      stop: () => engine.stopPlacePreview(),
    }));
  }

  engine.stopPreview();
  engine.stopPlacePreview();
  legendHover.current = null;
  legendHover.openedAt = performance.now();
  stopLegendVoice();
  if (!dlg.open) dlg.showModal();
  $("legendDialogTitle").focus();
  // ao abrir, a voz lê a legenda inteira (config.json → narracao.lerLegendaAoAbrir)
  if (voiceOn() && SETTINGS.narration.readLegend) setTimeout(() => { if (dlg.open) startLegendVoice(); }, 250);
}

// ---------------------------------------------------------------------------
// Legenda falada e pré-escutas sem atropelo
// Passar o mouse num cartão pausa a voz e toca o som com fade; ao sair, o som some e a voz
// retoma da frase em que parou. Nunca tocam dois sons juntos, e rolar a legenda (os cartões
// passando sob o cursor parado) não dispara nada: só um movimento real do mouse.
// ---------------------------------------------------------------------------
const legendVoice = { parts: [], idx: 0, active: false, held: false, timer: 0 };
const legendHover = { openedAt: 0, scrolledAt: 0, current: null, stop: null };

function legendSpeechParts() {
  const scale = state.scale;
  const parts = [
    $("legendDialogTitle").textContent + ".",
    $("legendDialogIntro").textContent,
    t("legend.speakHow"),
    t("legend.instText", { char: scale.characteristicName.toLowerCase(), lo: scale.spoken(scale.min), hi: scale.spoken(scale.max) }),
  ];
  if (placesOpen()) parts.push(...placesSpeechParts());
  else parts.push(t("legend.speakReview"));
  parts.push(t("legend.speakEnd"));
  return parts.map((s) => s.replace(/\.(\s*\.)+/g, "."));
}

const placesSpeechParts = () => [t("legend.speakPlaces"), ...PLACES.map((p) => `${t(`placeName.${p.id}`)}: ${t(`placeText.${p.id}`)}`)];

// ---------------------------------------------------------------------------
// "Rever o tutorial dos sons dos lugares": mostra (e lê) os cartões dos lugares na legenda
// ---------------------------------------------------------------------------
const placesOpen = () => $("placesToggle").getAttribute("aria-expanded") === "true";

function setPlacesOpen(open) {
  $("placesToggle").setAttribute("aria-expanded", String(open));
  $("placesToggle").textContent = t(open ? "legend.hidePlaces" : "legend.reviewPlaces");
  $("placesSection").hidden = !open;
}

function togglePlaces() {
  const open = !placesOpen();
  stopLegendVoice();
  endLegendPreview({ resume: false });
  engine.stopPlacePreview();
  setPlacesOpen(open);
  if (!open || !voiceOn()) return;
  // com a voz ligada, ela explica os sons dos lugares, como no tutorial
  legendVoice.parts = placesSpeechParts();
  legendVoice.idx = 0;
  legendVoice.active = true;
  legendVoice.held = false;
  queueLegendFrom(0);
  updateReadAloudBtn();
}

function updateReadAloudBtn() {
  const b = $("dlgReadAloud");
  b.setAttribute("aria-pressed", String(legendVoice.active));
  b.textContent = t(legendVoice.active ? "legend.stopReading" : "legend.read");
}

function queueLegendFrom(i) {
  const { parts } = legendVoice;
  if (i >= parts.length) {
    legendVoice.active = false;
    updateReadAloudBtn();
    return;
  }
  parts.slice(i).forEach((text, k) => narrator.say(text, {
    ...voiceOpts(),
    queue: k > 0,
    tag: "legenda",
    priority: true,
    onstart: () => { legendVoice.idx = i + k; },
    onend: () => { if (i + k === parts.length - 1) { legendVoice.active = false; updateReadAloudBtn(); } },
  }));
}

function startLegendVoice() {
  clearTimeout(legendVoice.timer);
  legendVoice.parts = legendSpeechParts();
  legendVoice.idx = 0;
  legendVoice.active = true;
  legendVoice.held = !!legendHover.current; // abriu com um som tocando: começa quando ele acabar
  if (!legendVoice.held) queueLegendFrom(0);
  else releaseLegendVoice();
  updateReadAloudBtn();
}

function stopLegendVoice() {
  clearTimeout(legendVoice.timer);
  const was = legendVoice.active;
  legendVoice.active = false;
  legendVoice.held = false;
  if (was) {
    narrator.drop("legenda");
    if (narrator.current?.tag === "legenda") narrator.cancel();
  }
  updateReadAloudBtn();
}

// pausa a leitura (a frase atual é interrompida e será repetida ao retomar)
function holdLegendVoice() {
  clearTimeout(legendVoice.timer);
  if (legendVoice.active && !legendVoice.held) {
    legendVoice.held = true;
    narrator.cancel();
  } else if (!legendVoice.active) {
    narrator.cancel(); // outra fala qualquer: o som da pré-escuta tem a vez
  }
}

// retoma depois que o som terminou de sumir
function releaseLegendVoice(delay = 700) {
  clearTimeout(legendVoice.timer);
  if (!legendVoice.active || !legendVoice.held) return;
  legendVoice.timer = setTimeout(() => {
    if (!legendVoice.active || legendHover.current) return;
    legendVoice.held = false;
    queueLegendFrom(legendVoice.idx);
  }, delay);
}

const legendSettled = () => performance.now() - Math.max(legendHover.openedAt, legendHover.scrolledAt) > 450;

// encerra a pré-escuta em andamento (cartão ou barra de cores), com fade
function endLegendPreview({ resume = true } = {}) {
  const cur = legendHover.current;
  if (!cur) return;
  legendHover.current = null;
  clearTimeout(cur._t);
  cur.classList?.remove("is-playing");
  try { legendHover.stop?.(); } catch { /* noop */ }
  legendHover.stop = null;
  if (resume) releaseLegendVoice();
}

function bindLegendCard(li, btn, { play, stop }) {
  let timer = 0;
  let armed = false;
  const begin = async () => {
    if (legendHover.current === li) return;
    endLegendPreview({ resume: false });
    stopScale();
    holdLegendVoice();
    legendHover.current = li;
    legendHover.stop = stop;
    li.classList.add("is-playing");
    try {
      const secs = await play();
      updateAudioUI();
      clearTimeout(li._t);
      // o som acabou: com o mouse ainda em cima, a voz espera; pelo teclado, ela retoma
      li._t = setTimeout(() => {
        li.classList.remove("is-playing");
        if (legendHover.current === li && !li.matches(":hover")) endLegendPreview();
      }, secs * 1000);
    } catch {
      endLegendPreview();
      toast(t("audio.error"));
    }
  };
  const arm = () => { clearTimeout(timer); timer = setTimeout(begin, 280); };
  li.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse") return;
    if (legendSettled()) arm();
    else armed = true; // entrou porque a página rolou ou acabou de abrir: espera o mouse mexer
  });
  li.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || !armed || !legendSettled()) return;
    armed = false;
    arm();
  });
  li.addEventListener("pointerleave", () => {
    clearTimeout(timer);
    armed = false;
    if (legendHover.current === li) endLegendPreview();
  });
  btn.addEventListener("click", begin);
}

async function startExperience() {
  showView("explore");
  try {
    await engine.start();
    engine.resume();
  } catch {
    toast(t("audio.noTone"));
  }
  updateAudioUI();
  canvas.focus({ preventScroll: true });
  state.keyboardActive = true;
  state.readingDirty = true;
  layoutCanvas();
  // sem instruções faladas a cada mapa aberto: como usar o mapa é ensinado no tutorial (tecla T)
}

// Tutorial: abre o mapa de temperatura direto (a legenda é ensinada pelo próprio tutorial)
async function openPractice() {
  const group = state.presets.find((g) => g.id === "gmao-temp") || state.presets[0];
  await selectGroup(group, group.startIndex ?? 0, { skipLegend: true });
  canvas.scrollIntoView({ block: "center", behavior: reducedMotion.matches ? "auto" : "smooth" });
}

// ---------------------------------------------------------------------------
// Carregamento de quadros
// Ao escolher um mapa, TODOS os quadros dele começam a baixar (6 por vez, a partir da hora
// inicial). Eles ficam na memória como JPEG comprimido (~200 a 400 MB por mapa) e cada um só
// é decodificado quando aparece na tela: decodificar os 372 de uma vez passaria de 3 GB.
// Trocar de mapa libera os quadros do anterior e cancela os downloads pendentes.
// ---------------------------------------------------------------------------
const PRELOAD_WORKERS = 6;
const store = { key: null, group: null, blobs: [], done: 0, abort: null };

function preloadFrames(g, first = 0) {
  const key = `${g.id}:${g.frames.length}`;
  if (store.key === key) return;
  store.abort?.abort();
  const abort = new AbortController();
  Object.assign(store, { key, group: g, blobs: new Array(g.frames.length), done: 0, abort });
  updateFramesUI();
  const n = g.frames.length;
  const queue = Array.from({ length: n }, (_, k) => (first + k) % n);
  const worker = async () => {
    while (!abort.signal.aborted && queue.length) {
      const i = queue.shift();
      try { await frameBlob(g, i); } catch { /* tenta de novo quando o quadro for pedido */ }
    }
  };
  for (let k = 0; k < Math.min(PRELOAD_WORKERS, n); k += 1) worker();
}

// JPEG (Blob) do quadro i: já baixado, baixando, ou começa agora (pedido da tela tem a vez)
function frameBlob(g, i) {
  if (store.group !== g) preloadFrames(g, i);
  if (!store.blobs[i]) {
    const { abort } = store;
    store.blobs[i] = fetch(g.frames[i].src, { signal: abort.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (store.abort === abort) { store.done += 1; updateFramesUI(); }
        return blob;
      })
      .catch((err) => {
        if (store.abort === abort) store.blobs[i] = null;
        throw err;
      });
  }
  return store.blobs[i];
}

function updateFramesUI() {
  const g = store.group;
  const total = g?.frames.length ?? 0;
  const box = $("framesLoad");
  box.hidden = total < 2 || store.done >= total;
  $("framesProgress").max = total || 1;
  $("framesProgress").value = store.done;
  $("framesText").textContent = t("time.loading", { done: store.done, n: total });
}

async function loadFrame(index, { initial = false } = {}) {
  const g = state.group;
  if (!g) return;
  const token = ++state.loadToken;
  const frame = g.frames[index];
  if (initial || !state.playing) $("loadingVeil").hidden = false;
  try {
    const blob = await frameBlob(g, index);
    if (token !== state.loadToken) return;
    const bmp = await createImageBitmap(blob);
    if (token !== state.loadToken) { bmp.close?.(); return; }
    state.sampler = new ImageSampler(bmp);
    bmp.close?.(); // o sampler guardou a sua cópia em canvas
    state.index = index;
    state.projection = g.projection;
    if (initial) setupExplorerFor(g);
    rebuildBase();
    updateTimelineUI();
    state.readingDirty = true;
  } catch (err) {
    if (token !== state.loadToken) return;
    console.error(err);
    toast(t("map.loadError", { name: frame.name }));
  } finally {
    if (token === state.loadToken) $("loadingVeil").hidden = true;
  }
}

function setupExplorerFor(g) {
  const scale = state.scale;
  $("exploreKicker").textContent = `${g.source} · ${scale.characteristicName} · ${instName()}`;
  $("exploreHeading").textContent = groupTitle(g);
  updateLegendBar();
  $("timeline").hidden = g.frames.length < 2;
  $("frameSlider").max = String(g.frames.length - 1);
  canvas.setAttribute("aria-label", t("map.aria", { map: groupTitle(g), inst: instName() }));
  renderCanvasHelp();
  updateDocTitle();
  layoutCanvas();
}

function updateLegendBar() {
  const s = state.scale;
  if (!s) return;
  $("legendTitle").textContent = s.label;
  $("legendUnit").textContent = s.unit;
  const pal = ["cividis", "viridis", "gray"].includes(state.colorMode) ? state.colorMode : null;
  $("legendGradient").style.background = pal
    ? `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => `rgb(${paletteColor(pal, p).join(" ")})`).join(", ")})`
    : s.gradientCss();
  renderTicks($("legendTicks"), s);
  $("legendEnds").innerHTML = "";
  for (const e of s.ends) {
    const span = document.createElement("span");
    span.textContent = e;
    $("legendEnds").append(span);
  }
  $("readValueLabel").textContent = s.characteristicName;
}

function renderTicks(el, scale) {
  el.innerHTML = scale.ticks
    .map((tk) => `<span style="left:${(tk.pos * 100).toFixed(2)}%">${String(tk.value).replace("-", "−")}</span>`)
    .join("");
}

// ---------------------------------------------------------------------------
// Barra de cores tocável: passar o mouse (ou usar as setas) toca o valor daquela posição
// com o mesmo instrumento, nota e vibração que um pixel dessa cor no mapa
// ---------------------------------------------------------------------------
function legendReading(scale, pos) {
  const value = scale.valueAtPos(pos);
  const r = { valid: true, value, norm: pos, grad: 0, u: pos };
  r.valueText = scale.format(value);
  r.zone = scale.zoneOf(value);
  const m = scale.colorAtPos(pos).match(/[\d.]+/g);
  r.rgb = m ? m.slice(0, 3).map(Number) : [255, 255, 255];
  return r;
}

const scaleSentence = (r) => `${state.scale.sentence(state.scale.spoken(r.value))}, ${r.zone.label.toLowerCase()}.`;

async function playScaleAt(pos) {
  state.legendHover = clamp(pos);
  if (!engine.started) {
    try { await engine.start(); updateAudioUI(); } catch { toast(t("audio.noTone")); return null; }
  }
  if (state.legendHover === null || !state.scale) return null;
  const r = legendReading(state.scale, state.legendHover);
  engine.stopPreview();
  engine.update({ active: true, pan: state.legendHover * 2 - 1, norm: state.legendHover });
  haptics.send(r, { active: true });
  return r;
}

function stopScale() {
  if (state.legendHover === null) return;
  state.legendHover = null;
  engine.update({ active: false });
  haptics.send(null, { active: false });
  state.readingDirty = true;
}

function attachScaleHover(track, marker, tip) {
  track.tabIndex = 0;
  track.setAttribute("role", "slider");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  let raf = 0;
  let pending = null;
  let kbPos = 0.5;
  const show = (pos) => {
    if (!state.scale) return;
    const r = legendReading(state.scale, pos);
    marker.hidden = false;
    marker.style.left = `${(pos * 100).toFixed(2)}%`;
    tip.hidden = false;
    tip.textContent = `${r.valueText} · ${r.zone.label}`;
    tip.style.left = `${(pos * 100).toFixed(2)}%`;
    tip.dataset.edge = pos < 0.12 ? "start" : pos > 0.88 ? "end" : "";
    track.setAttribute("aria-valuenow", String(Math.round(pos * 100)));
    track.setAttribute("aria-valuetext", scaleSentence(r));
  };
  const at = (e) => {
    const rect = track.getBoundingClientRect();
    return clamp((e.clientX - rect.left) / rect.width);
  };
  const inDialog = track.id === "dlgTrack";
  const move = (e) => {
    if (inDialog && e.type !== "pointerdown") {
      if (!legendSettled()) return;
      if (legendHover.current !== track) {
        endLegendPreview({ resume: false });
        holdLegendVoice();
        legendHover.current = track;
        legendHover.stop = null;
      }
    }
    pending = at(e);
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (pending === null) return;
      show(pending);
      playScaleAt(pending);
    });
  };
  const leave = () => {
    pending = null;
    tip.hidden = true;
    if (inDialog) marker.hidden = true;
    stopScale();
    if (inDialog && legendHover.current === track) endLegendPreview();
  };
  track.addEventListener("pointerenter", move);
  track.addEventListener("pointermove", move);
  track.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") track.setPointerCapture(e.pointerId);
    move(e);
  });
  track.addEventListener("pointerleave", leave);
  track.addEventListener("pointercancel", leave);
  track.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") leave(); });
  track.addEventListener("keydown", async (e) => {
    // setas: passo pequeno; Page Up/Down: passo grande (sem tecla modificadora)
    const keys = { ArrowLeft: -0.025, ArrowDown: -0.025, ArrowRight: 0.025, ArrowUp: 0.025, PageDown: -0.1, PageUp: 0.1, Home: -1, End: 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    e.stopPropagation();
    kbPos = clamp(kbPos + keys[e.key]);
    show(kbPos);
    const r = await playScaleAt(kbPos);
    if (r) announce(scaleSentence(r), { live: false }); // o leitor de tela já lê o aria-valuetext
  });
  track.addEventListener("focus", () => show(kbPos));
  track.addEventListener("blur", leave);
}

function rebuildBase() {
  const s = state.sampler;
  if (!s) return;
  const pal = ["cividis", "viridis", "gray"].includes(state.colorMode) ? state.colorMode : null;
  state.baseCanvas = pal ? s.recolor(state.scale, pal) : s.canvas;
  canvas.dataset.filter = ["deuteranopia", "protanopia", "tritanopia"].includes(state.colorMode) ? state.colorMode : "";
}

// ---------------------------------------------------------------------------
// Linha do tempo (sequências horárias)
// ---------------------------------------------------------------------------
function frameTimeText(frame) {
  if (frame?.gmaoIndex === undefined) return frame?.name || "—";
  const d = new Date(GMAO_T0_UTC + frame.gmaoIndex * 3600 * 1000);
  const fmt = (tz) => new Intl.DateTimeFormat(locale(), { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
  return t("time.when", { utc: fmt("UTC"), br: fmt("America/Sao_Paulo").split(", ").pop() });
}

function updateTimelineUI() {
  const g = state.group;
  if (!g) return;
  const f = g.frames[state.index];
  $("frameSlider").value = String(state.index);
  $("frameSlider").setAttribute("aria-valuetext", t("time.valuetext", { i: state.index + 1, n: g.frames.length, when: frameTimeText(f) }));
  $("frameLabel").textContent = `${f.name} · ${state.index + 1}/${g.frames.length}`;
  $("frameTime").textContent = frameTimeText(f);
}

let playTimer = null;
function startTimeline() {
  const g = state.group;
  if (!g || g.frames.length < 2) return;
  state.playing = true;
  $("playTimeline").setAttribute("aria-pressed", "true");
  $("playTimeline").setAttribute("aria-label", t("time.pause"));
  const step = async () => {
    if (!state.playing) return;
    const t0 = performance.now();
    await loadFrame((state.index + 1) % g.frames.length);
    const interval = 1000 / Number($("speedSelect").value);
    playTimer = setTimeout(step, Math.max(0, interval - (performance.now() - t0)));
  };
  step();
}
function toggleTimeline() {
  if (!state.group || state.group.frames.length < 2) {
    announce(t("time.none"));
    return;
  }
  if (state.playing) {
    stopTimeline();
    announce(t("time.paused", { when: frameTimeText(state.group.frames[state.index]) }));
  } else {
    announce(t("time.playing", { n: $("speedSelect").value, key: keyName(SHORTCUTS.timeline.key) }));
    startTimeline();
  }
}
function stopTimeline() {
  state.playing = false;
  clearTimeout(playTimer);
  $("playTimeline").setAttribute("aria-pressed", "false");
  $("playTimeline").setAttribute("aria-label", t("time.play"));
}
function stepFrame(delta) {
  const g = state.group;
  if (!g) return;
  if (g.frames.length < 2) {
    announce(t("time.none"));
    return;
  }
  stopTimeline();
  loadFrame((state.index + delta + g.frames.length) % g.frames.length).then(() => {
    announce(frameTimeText(g.frames[state.index]));
    tutorial.notify("frame");
  });
}

// ---------------------------------------------------------------------------
// Leitura e sonificação
// ---------------------------------------------------------------------------
// O mapa toca quando o mouse está sobre ele, quando ele tem o foco, durante o passeio ou
// logo depois de ligar/retomar o som (state.listening): quem clica em "Retomar o som" está
// com o foco no botão, e a música precisa voltar mesmo assim, no ponto onde o cursor estava.
function isActive() {
  return !$("exploreView").hidden && (state.pointerInside || state.keyboardActive || tour.on || state.listening) && !$("legendDialog").open && !$("helpDialog").open;
}

// leitura completa (valor, lugar, paisagem) em qualquer ponto do mapa
function readAt(u, v) {
  const { sampler, scale } = state;
  if (!sampler || !scale) return null;
  const r = sampler.read(u, v, scale, state.projection);
  r.valueText = r.valid ? scale.format(r.value) : t("read.noData");
  // paisagem sonora: mar, gelo, floresta ou deserto (geo.js)
  r.env = r.geo && r.region ? landscapeAt(r.geo.lat, r.geo.lon, r.region, { scaleId: scale.id, value: r.value, valid: r.valid }) : null;
  return r;
}

function processReading() {
  const r = readAt(state.u, state.v);
  if (!r) return;
  state.reading = r;
  const active = isActive();
  tutorial.notify("reading", r);
  // a barra de cores (pré-escuta da escala) e a legenda aberta têm prioridade sobre o mapa
  if (state.legendHover !== null || $("legendDialog").open) {
    updateReadingUI(r);
    return;
  }
  engine.update({
    active: active && r.valid,
    pan: state.u * 2 - 1,
    norm: r.valid ? r.norm : 0.5,
    // sons dos lugares: mar, gelo, floresta, deserto (valem mesmo sem dado)
    amb: active ? r.env?.levels ?? {} : {},
  });
  haptics.send(r, { active });
  updateReadingUI(r);
}

function updateReadingUI(r) {
  $("readRegion").textContent = r.region?.name || "—";
  $("readCoord").textContent = (r.geo ? formatCoord(r.geo.lat, r.geo.lon) : "—") + (r.env?.label ? ` · ${r.env.label}` : "");
  $("readValue").textContent = r.valid ? r.valueText : t("read.noData");
  $("readZone").textContent = r.valid ? r.zone.label : r.reason;
  if (state.legendHover === null) {
    const marker = $("legendMarker");
    marker.hidden = !r.valid;
    if (r.valid) marker.style.left = `${(r.norm * 100).toFixed(2)}%`;
  }
}

// O que a voz fala ao clicar no mapa ou apertar Espaço: o país e a característica do mapa
// (temperatura, umidade, vento...). Ex.: "Brasil. Temperatura 27,3 graus Celsius."
function readingSentence(r) {
  const place = r.region?.name || title();
  if (!r.valid) return t("read.sentenceNoData", { place });
  return t("read.sentence", { place, value: state.scale.sentence(state.scale.spoken(r.value)) });
}

function readHere() {
  if ($("exploreView").hidden) return;
  state.readingDirty = true;
  processReading();
  if (state.reading) announce(readingSentence(state.reading));
  tutorial.notify("announce");
}

// ---------------------------------------------------------------------------
// Exploração sem ver o mapa: visão geral, posição e saltos entre regiões
// ---------------------------------------------------------------------------
function placeWords(u, v) {
  const vert = v < 1 / 3 ? "top" : v > 2 / 3 ? "bottom" : "";
  const horiz = u < 1 / 3 ? "left" : u > 2 / 3 ? "right" : "";
  if (!vert && !horiz) return t("pos.center");
  return t(`pos.${vert || "middle"}_${horiz || "center"}`);
}

// Tecla O: percorre o mapa numa grade e diz onde estão os valores mais alto e mais baixo
function mapOverview() {
  const { sampler, scale, projection } = state;
  if ($("exploreView").hidden || !sampler || !scale) { announce(t("map.none")); return; }
  const COLS = 24;
  const ROWS = 12;
  let hi = null;
  let lo = null;
  let sum = 0;
  let n = 0;
  for (let j = 0; j < ROWS; j += 1) {
    for (let i = 0; i < COLS; i += 1) {
      const r = sampler.read((i + 0.5) / COLS, (j + 0.5) / ROWS, scale, projection);
      if (!r.valid) continue;
      n += 1;
      sum += r.value;
      if (!hi || r.value > hi.value) hi = r;
      if (!lo || r.value < lo.value) lo = r;
    }
  }
  if (!n) {
    announce(t("overview.none", { map: title() }));
    return;
  }
  const where = (r) => `${r.region?.name ? `${r.region.name}, ` : ""}${placeWords(r.u, r.v)}`;
  announce(t("overview.text", {
    map: title(),
    hi: scale.sentence(scale.spoken(hi.value)), hiWhere: where(hi),
    lo: scale.sentence(scale.spoken(lo.value)), loWhere: where(lo),
    mean: scale.spoken(sum / n),
  }));
}

// Tecla C: onde o cursor está
function announcePosition() {
  if ($("exploreView").hidden) { announce(t("map.none")); return; }
  processReading();
  const r = state.reading;
  const place = r?.region?.name || title();
  const coord = r?.geo ? `${formatCoord(r.geo.lat, r.geo.lon)}. ` : "";
  announce(t("pos.text", { place, coord, where: placeWords(state.u, state.v), x: Math.round(state.u * 100), y: Math.round(state.v * 100) }));
}

// Teclas 1 a 9: nove regiões, como um teclado de telefone (1 = em cima à esquerda)
function jumpToCell(n) {
  state.u = ((n - 1) % 3 + 0.5) / 3;
  state.v = (Math.floor((n - 1) / 3) + 0.5) / 3;
  moveFocal(0, 0);
  readHere();
}

function changeVolume(delta) {
  const slider = $("volumeSlider");
  const db = clamp(Number(slider.value) + delta, Number(slider.min), Number(slider.max));
  slider.value = String(db);
  setVolume(db);
  announce(t("sound.volumeNow", { db }));
}

function setVolume(db) {
  $("volumeOut").textContent = `${db} dB`;
  $("volumeSlider").setAttribute("aria-valuetext", t("sound.db", { db }));
  engine.setVolume(db);
  savePrefs();
}

// ---------------------------------------------------------------------------
// Passeio sonoro: o cursor passeia sozinho pelo mapa, em movimentos aleatórios e contínuos
// (js/passeio.js). O som começa NA HORA: nenhuma fala antes (a voz pausaria a música) e
// nenhum relatório no fim. Quem usa leitor de tela recebe o aviso pela região ARIA.
// ---------------------------------------------------------------------------
function setTourUI(running) {
  const btn = $("tourButton");
  btn.setAttribute("aria-pressed", String(running));
  btn.classList.toggle("is-on", running);
  $("tourLabel").textContent = t(running ? "tour.stop" : "tour.play");
}

function toggleTour() {
  if (tour.on) stopTour();
  else startTour();
}

function startTour() {
  if ($("exploreView").hidden || !state.sampler) {
    announce(t("map.none"));
    return;
  }
  stopScale();
  // uma fala em andamento (ex.: a leitura do botão) deixaria a música pausada: cala a voz
  narrator.cancel();
  // o clique é um gesto do usuário: liga o som sem esperar (o passeio já começa a andar)
  if (!engine.started) {
    engine.start().then(updateAudioUI).catch(() => { toast(t("audio.noTone")); stopTour({ silent: true }); });
  } else if (engine.paused) {
    engine.resume();
    updateAudioUI();
  }
  const aspect = state.sampler.width / state.sampler.height;
  // sem duração: o passeio segue até a pessoa pedir para parar
  tour.wander = createWander({ u: state.u, v: state.v }, { aspect, speed: SETTINGS.sweep.speed });
  tour.t0 = tour.last = performance.now();
  tour.on = true;
  state.readingDirty = true;
  setTourUI(true);
  announce(t("tour.started", { key: keyName(SHORTCUTS.tour.key) }), { speak: false });
}

function tickTour(now) {
  // som pausado ou janela aberta: o passeio só espera (não termina) e continua de onde parou
  if (engine.paused || $("legendDialog").open || $("helpDialog").open) {
    tour.last = now;
    return;
  }
  const { u, v } = stepWander(tour.wander, (now - tour.last) / 1000);
  tour.last = now;
  state.u = u;
  state.v = v;
  state.lastMove = now;
  state.readingDirty = true;
  state.trail.push({ u, v, t: now });
  if (state.trail.length > 28) state.trail.shift();
}

function stopTour({ silent = false } = {}) {
  if (!tour.on) return;
  tour.on = false;
  tour.wander = null;
  state.readingDirty = true;
  setTourUI(false);
  if (!silent) announce(t("tour.stopped"));
}

// ---------------------------------------------------------------------------
// Canvas: layout, ponteiro, teclado e desenho
// ---------------------------------------------------------------------------
function layoutCanvas() {
  const s = state.sampler;
  const shell = $("canvasShell");
  const aspect = s ? s.width / s.height : 2;
  const maxH = Math.max(260, window.innerHeight * 0.66);
  const cssW = Math.min(shell.clientWidth, maxH * aspect);
  const cssH = cssW / aspect;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
}

function setFromPointer(e) {
  if (tour.on) return; // durante o passeio o cursor anda sozinho
  const rect = canvas.getBoundingClientRect();
  state.u = clamp((e.clientX - rect.left) / rect.width);
  state.v = clamp((e.clientY - rect.top) / rect.height);
  state.lastMove = performance.now();
  state.readingDirty = true;
  state.trail.push({ u: state.u, v: state.v, t: state.lastMove });
  if (state.trail.length > 28) state.trail.shift();
}

function moveFocal(du, dv) {
  state.u = clamp(state.u + du);
  state.v = clamp(state.v + dv);
  state.keyboardActive = true;
  state.lastMove = performance.now();
  state.readingDirty = true;
  state.trail.push({ u: state.u, v: state.v, t: state.lastMove });
  if (state.trail.length > 28) state.trail.shift();
}

const CURSOR_SCALE = { normal: 1, grande: 1.35, enorme: 1.7 };

function draw(time) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (state.baseCanvas) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(state.baseCanvas, 0, 0, w, h);
  }
  const hc = document.documentElement.classList.contains("hc");
  const dpr = w / canvas.clientWidth || 1;
  const x = state.u * w;
  const y = state.v * h;

  // rastro
  const now = performance.now();
  ctx.lineCap = "round";
  for (let i = 1; i < state.trail.length; i += 1) {
    const a = state.trail[i - 1];
    const b = state.trail[i];
    const age = (now - b.t) / 1200;
    if (age > 1) continue;
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - age)})`;
    ctx.lineWidth = 2 * dpr * (1 - age);
    ctx.beginPath();
    ctx.moveTo(a.u * w, a.v * h);
    ctx.lineTo(b.u * w, b.v * h);
    ctx.stroke();
  }

  // retícula do cursor focal
  const active = isActive();
  const pulse = reducedMotion.matches ? 0 : Math.sin(time / 380) * 2;
  const R = (14 + pulse) * dpr * CURSOR_SCALE[$("textSize").value]; // retícula maior com texto grande (baixa visão)
  ctx.lineWidth = (hc ? 3 : 2) * dpr;
  ctx.strokeStyle = hc ? "#ffff00" : "rgba(255,255,255,.95)";
  ctx.shadowColor = "rgba(0,0,0,.7)";
  ctx.shadowBlur = 6 * dpr;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(x + dx * (R + 4 * dpr), y + dy * (R + 4 * dpr));
    ctx.lineTo(x + dx * (R + 14 * dpr), y + dy * (R + 14 * dpr));
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (state.reading?.valid) {
    ctx.fillStyle = `rgb(${state.reading.rgb.join(",")})`;
    ctx.beginPath();
    ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  // etiqueta com o valor
  if (state.reading && (active || hc)) {
    const r = state.reading;
    const label = r.valid ? `${r.valueText} · ${r.region?.name || r.zone.label}` : t("read.noData");
    ctx.font = `600 ${12.5 * dpr}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width + 16 * dpr;
    const th = 24 * dpr;
    let lx = x + R + 12 * dpr;
    let ly = y - R - th;
    if (lx + tw > w - 4) lx = x - R - 12 * dpr - tw;
    if (ly < 4) ly = y + R + 8 * dpr;
    ctx.fillStyle = hc ? "#000" : "rgba(3,8,15,.82)";
    ctx.strokeStyle = hc ? "#ffff00" : "rgba(255,255,255,.25)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.roundRect?.(lx, ly, tw, th, 8 * dpr);
    if (!ctx.roundRect) ctx.rect(lx, ly, tw, th);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = hc ? "#ffff00" : "#eef8ff";
    ctx.fillText(label, lx + 8 * dpr, ly + 16.5 * dpr);
  }
}

let lastReadingTime = 0;
function frame(time) {
  if (!$("exploreView").hidden) {
    if (tour.on) tickTour(performance.now());
    if (state.readingDirty || time - lastReadingTime > 250) {
      state.readingDirty = false;
      lastReadingTime = time;
      processReading();
    }
    draw(time);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Áudio UI
// ---------------------------------------------------------------------------
function updateAudioUI() {
  const on = engine.started && !engine.paused;
  const btn = $("audioToggle");
  btn.setAttribute("aria-pressed", String(on));
  btn.classList.toggle("is-on", on);
  $("audioToggleLabel").textContent = t(on ? "audio.pause" : engine.started ? "audio.resume" : "audio.on");
  $("audioStatus").textContent = !engine.available ? t("audio.noTone") : "";
}

async function toggleAudio() {
  try {
    if (!engine.started) await engine.start();
    else if (engine.paused) engine.resume();
    else engine.pause();
  } catch {
    toast(t("audio.noTone"));
  }
  // ligou ou retomou: a música do mapa volta a tocar (até o mouse sair do mapa)
  state.listening = engine.started && !engine.paused;
  updateAudioUI();
  state.readingDirty = true;
  if (engine.started) announce(t(engine.paused ? "audio.paused" : "audio.playing"));
}

// ---------------------------------------------------------------------------
// Smartphone
// ---------------------------------------------------------------------------
let phoneState = { kind: null, info: null };
function onPhoneStatus(kind, info) {
  if (kind !== "caps" && kind !== "ice") phoneState = { kind, info };
  const st = $("phoneStatus");
  const dot = $("phoneDot");
  dot.className = "status-dot";
  if (kind === "waiting") { st.textContent = t("phone.waiting"); dot.classList.add("is-wait"); }
  if (kind === "connected") { st.textContent = t("phone.connected"); dot.classList.add("is-on"); announce(t("phone.connectedAnnounce")); }
  if (kind === "caps" && info && info.vibrate === false) toast(t("phone.noVibrate"), 6000);
  if (kind === "reconnecting") st.textContent = t("phone.reconnecting");
  if (kind === "error") { st.textContent = t("phone.error", { e: info }); dot.classList.add("is-err"); }
  if (kind === "closed") st.textContent = t("phone.closed");
}

// O celular precisa abrir receiver.html de algum lugar:
//  - "lan":    servidor deste computador na rede Wi-Fi (endereço detectado automaticamente)
//  - "public": cópia pública em HTTPS (GitHub Pages), se estiver publicada
// Nos dois casos a ligação de dados é a mesma: PeerJS (sinalização) + WebRTC (P2P).
function receiverUrl() {
  const id = haptics.peer?.id;
  if (!id) return null;
  let base;
  if ($("receiverMode").value === "public") {
    base = PUBLIC_RECEIVER_BASE;
  } else {
    const sel = $("lanSelect").value;
    if (sel === "__manual") {
      const lan = $("lanInput").value.trim();
      if (!lan) return null;
      try { base = new URL(/^https?:\/\//.test(lan) ? lan : `http://${lan}`).href; } catch { return null; }
      if (!/\/$/.test(base)) base += "/";
    } else {
      base = sel;
    }
  }
  if (!base) return null;
  return `${new URL("receiver.html", base).href}#${id}`;
}

let lanWarning = null;
function refreshQr() {
  const mode = $("receiverMode").value;
  const manual = $("lanSelect").value === "__manual";
  $("lanField").hidden = mode !== "lan";
  $("lanInput").hidden = !manual;
  const url = receiverUrl();
  const warn = $("qrWarn");
  if (!url) {
    $("qrBox").innerHTML = "";
    $("qrUrl").textContent = "";
    warn.hidden = !haptics.peer?.id;
    warn.textContent = t("phone.noAddress");
    return;
  }
  const host = new URL(url).hostname;
  const internal = mode === "lan" && /^(localhost|127\.|\[::1\])/.test(host);
  warn.hidden = !(internal || (mode === "lan" && lanWarning));
  warn.textContent = internal ? t("phone.internal") : lanWarning || "";
  renderQr($("qrBox"), url);
  $("qrUrl").textContent = url;
  $("receiverLink").href = url;
}

let lastAddressInfo = null;
// Detecta (de novo) os endereços: chamado ao gerar o QR e quando a rede muda
async function detectAddresses() {
  const [info, pub] = await Promise.all([guessReceiverBase(), checkPublicReceiver()]);
  lastAddressInfo = { info, pub };
  lanWarning = info.warning || null;
  renderAddressOptions();
  if (!pub && $("receiverMode").value === "public") $("receiverMode").value = "lan";
  if (!info.candidates.length && pub) $("receiverMode").value = "public";
  refreshQr();
}

function renderAddressOptions() {
  if (!lastAddressInfo) return;
  const { info, pub } = lastAddressInfo;
  const pubOpt = $("receiverMode").querySelector('option[value="public"]');
  pubOpt.disabled = !pub;
  pubOpt.textContent = t(pub ? "phone.public" : "phone.publicOff");
  const sel = $("lanSelect");
  const prevValue = sel.value;
  sel.innerHTML = "";
  for (const c of info.candidates) sel.add(new Option(c.label, c.url));
  sel.add(new Option(t("phone.manual"), "__manual"));
  const keep = [...sel.options].some((o) => o.value === prevValue) && prevValue !== "__manual";
  sel.value = keep ? prevValue : info.candidates.length ? info.candidates[0].url : "__manual";
  $("lanHelp").textContent = info.fromServer
    ? t(info.candidates.length > 1 ? "phone.fromServerMany" : "phone.fromServer")
    : !info.local
      ? t("phone.samePage")
      : t(info.candidates.length ? "phone.byBrowserHelp" : "phone.noDetect");
}

async function connectPhone() {
  $("phoneBox").hidden = false;
  $("phoneStatus").textContent = t("phone.connecting");
  try {
    if (prefs.lan && !$("lanInput").value) $("lanInput").value = prefs.lan;
    await haptics.open();
    await detectAddresses();
    $("phoneConnectLabel").textContent = t("phone.newQr");
  } catch (err) {
    $("phoneStatus").textContent = t("phone.peerError", { e: err?.type || err?.message || err });
  }
}

// ---------------------------------------------------------------------------
// Acessibilidade
// ---------------------------------------------------------------------------
// Voz do site: fala o país e o valor quando a pessoa pede (clique, Espaço, atalhos) e lê os
// controles ao navegar com Tab. Não há narração automática ao passar o mouse.
function applyVoice(on, { quiet = false } = {}) {
  $("voiceToggle").checked = on;
  tutorial.syncVoice();
  savePrefs();
  if (on) { if (!quiet) speak(t("voice.on")); }
  else {
    narrator.cancel();
    announce(t("voice.off"), { speak: false });
  }
}

// Tamanho do texto (baixa visão)
function applyTextSize(size) {
  if (!(size in CURSOR_SCALE)) size = "normal";
  $("textSize").value = size;
  document.documentElement.classList.toggle("text-grande", size === "grande");
  document.documentElement.classList.toggle("text-enorme", size === "enorme");
  if (!$("exploreView").hidden) layoutCanvas();
  savePrefs();
}

function applyColorMode(mode) {
  state.colorMode = mode;
  if (state.sampler) {
    $("loadingVeil").hidden = false;
    // deixa o véu aparecer antes de recolorir (pode levar ~100 ms na 1ª vez)
    setTimeout(() => {
      rebuildBase();
      updateLegendBar();
      $("loadingVeil").hidden = true;
    }, 16);
  }
  savePrefs();
}

// ---------------------------------------------------------------------------
// Idioma
// ---------------------------------------------------------------------------
function toggleLanguage() {
  const next = getLang() === "en" ? "pt" : "en";
  setLang(next);
}

onLangChange(() => {
  narrator.cancel();
  narrator.setLang(speechLang());
  applyI18n();
  renderShortcutHints();
  renderHelp();
  renderGallery();
  updateAudioUI();
  setTourUI(tour.on);
  updateFramesUI();
  stopTimeline();
  if (state.group && state.scale) {
    setupExplorerFor(state.group);
    if (state.reading) updateReadingUI(readAt(state.u, state.v) || state.reading);
    state.readingDirty = true;
  }
  updateDocTitle();
  renderAddressOptions();
  if (phoneState.kind) onPhoneStatus(phoneState.kind, phoneState.info);
  if (haptics.peer?.id) $("phoneConnectLabel").textContent = t("phone.newQr");
  savePrefs();
  // janelas abertas são redesenhadas no novo idioma
  if (tutorial.isActive()) tutorial.refresh();
  else if ($("legendDialog").open) openLegend();
  else announce(t("lang.changed"));
});

// ---------------------------------------------------------------------------
// Ajuda e atalhos (montados a partir de js/shortcuts.js)
// ---------------------------------------------------------------------------
function renderHelp() {
  const body = $("helpBody");
  body.innerHTML = "";
  const section = (heading, build) => {
    const s = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = heading;
    s.append(h);
    build(s);
    body.append(s);
  };
  const para = (text) => { const p = document.createElement("p"); p.textContent = text; return p; };
  const keyItem = (keys, text) => {
    const li = document.createElement("li");
    keys.forEach((k, i) => {
      if (i) li.append(` ${t("help.or")} `);
      const kbd = document.createElement("kbd");
      kbd.textContent = keyName(k, { short: true });
      li.append(kbd);
    });
    li.append(`: ${text}`);
    return li;
  };
  section(t("help.how"), (s) => s.append(para(t("help.howText"))));
  section(t("help.keys"), (s) => {
    const ul = document.createElement("ul");
    for (const n of SHORTCUT_ORDER) {
      const sc = SHORTCUTS[n];
      ul.append(keyItem([sc.key, ...(sc.alt || [])], `${t(`sc.${n}`)}${sc.scope === "map" ? ` ${t("help.mapOnly")}` : ""}`));
    }
    ul.append(keyItem(["Arrows"], t("help.arrows")));
    ul.append(keyItem(["1–9"], t("help.digits")));
    ul.append(keyItem(["Escape"], t("help.escape")));
    s.append(ul);
  });
  section(t("help.scaleTitle"), (s) => s.append(para(t("help.scaleText"))));
  section(t("help.srTitle"), (s) => s.append(para(t("help.srText"))));
}

// Texto da ajuda para a voz, com os nomes das teclas por extenso. Cada parte é uma fala
// separada na fila do narrador (js/voz.js), então a leitura vai até o fim sem cortes.
function helpSpeechParts() {
  const sentence = (s) => s.replace(/[.\s]*$/, ".");
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const parts = [sentence(t("help.title")), t("help.intro"), sentence(t("help.how")), t("help.howText"), sentence(t("help.keys"))];
  for (const n of SHORTCUT_ORDER) parts.push(`${keyName(SHORTCUTS[n].key)}: ${sentence(t(`sc.${n}`))}`);
  parts.push(
    `${t("key.arrows")}: ${sentence(t("help.arrows"))}`,
    `${t("key.digits")}: ${sentence(t("help.digits"))}`,
    `${keyName("Escape")}: ${sentence(t("help.escape"))}`,
    sentence(t("help.scaleTitle")), t("help.scaleText"),
    sentence(t("help.srTitle")), t("help.srText"),
  );
  return parts.map(cap);
}

function readHelp() {
  helpSpeechParts().forEach((text, k) => narrator.say(text, { ...voiceOpts(), queue: k > 0, tag: "ajuda", priority: true }));
}

function openHelp() {
  const dlg = $("helpDialog");
  if (!dlg.open) dlg.showModal();
  $("helpTitle").focus();
  // com a voz ligada, a ajuda é lida inteira ao abrir (como a legenda)
  if (voiceOn()) readHelp();
}

// dica <kbd> e aria-keyshortcuts em cada botão que tem atalho
function renderShortcutHints() {
  for (const sc of Object.values(SHORTCUTS)) {
    const btn = sc.button && $(sc.button);
    if (!btn) continue;
    btn.setAttribute("aria-keyshortcuts", [sc.key, ...(sc.alt || [])].map(ariaKey).join(" "));
    let hint = btn.querySelector(".kbd-hint");
    if (!hint) {
      hint = document.createElement("kbd");
      hint.className = "kbd-hint";
      hint.setAttribute("aria-hidden", "true");
      btn.append(hint);
    }
    hint.textContent = keyName(sc.key, { short: true });
  }
}

function renderCanvasHelp() {
  $("canvasHelp").textContent = t("map.help", {
    read: keyName(SHORTCUTS.read.key, { short: true }),
    help: keyName(SHORTCUTS.help.key, { short: true }),
  });
}

function focusMapShortcut() {
  if ($("exploreView").hidden) {
    announce(t("map.none"));
    return;
  }
  canvas.focus({ preventScroll: true });
  canvas.scrollIntoView({ block: "center", behavior: "auto" });
}

// Ações dos atalhos que não têm botão (js/shortcuts.js → button: null)
const ACTIONS = {
  focusMap: focusMapShortcut,
  overview: mapOverview,
  position: announcePosition,
  prevHour: () => stepFrame(-1),
  nextHour: () => stepFrame(1),
  volumeUp: () => changeVolume(2),
  volumeDown: () => changeVolume(-2),
  read: readHere,
  center: () => {
    state.u = 0.5;
    state.v = 0.5;
    moveFocal(0, 0);
    tutorial.notify("home");
  },
};

// Aviso quando o botão do atalho não está disponível na tela atual
const UNAVAILABLE = {
  gallery: () => announce(t("gallery.already")),
  legend: () => announce(t("map.none")),
  tour: () => announce(t("map.none")),
  timeline: () => announce($("exploreView").hidden ? t("map.none") : t("time.none")),
};

function runShortcut(name) {
  const sc = SHORTCUTS[name];
  if (sc.button) {
    const btn = $(sc.button);
    // botão escondido (outra tela) ou desativado: avisa em vez de apertar
    if (!btn || btn.disabled || btn.closest("[hidden]")) { UNAVAILABLE[name]?.(); return; }
    btn.click();
    return;
  }
  ACTIONS[name]?.();
}

// ---------------------------------------------------------------------------
// Janelas: fechar com Escape (nativo) ou com um clique fora delas
// ---------------------------------------------------------------------------
function closeOnBackdrop(dlg, value = "") {
  let downOutside = false;
  const outside = (e) => {
    if (e.target !== dlg) return false;
    const r = dlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  dlg.addEventListener("pointerdown", (e) => { downOutside = outside(e); });
  dlg.addEventListener("click", (e) => {
    if (downOutside && outside(e)) dlg.close(value);
    downOutside = false;
  });
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
function setupEvents() {
  $("brandLink").addEventListener("click", (e) => { e.preventDefault(); backToGallery(); });
  $("backButton").addEventListener("click", backToGallery);
  $("audioToggle").addEventListener("click", toggleAudio);
  $("langToggle").addEventListener("click", toggleLanguage);
  $("reviewLegend").addEventListener("click", openLegend);
  attachScaleHover($("legendTrack"), $("legendMarker"), $("legendTip"));
  attachScaleHover($("dlgTrack"), $("dlgMarker"), $("dlgTip"));
  $("tutorialOpen").addEventListener("click", () => tutorial.open());

  // ajuda
  $("helpOpen").addEventListener("click", openHelp);
  $("helpClose").addEventListener("click", () => $("helpDialog").close());
  $("helpDialog").addEventListener("close", () => {
    narrator.drop("ajuda");
    if (narrator.current?.tag === "ajuda") narrator.cancel();
  });
  $("helpSpeak").addEventListener("click", readHelp);
  closeOnBackdrop($("helpDialog"));

  // ATALHOS: nenhuma tecla modificadora. O dicionário tecla → botão está em js/shortcuts.js.
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    // Escape: para o passeio; senão, cala a voz (diálogos e tutorial tratam o próprio Escape)
    if (e.key === "Escape") {
      if (tour.on && !document.querySelector("dialog[open]:modal")) { e.preventDefault(); stopTour(); return; }
      if (narrator.busy() && !tutorial.isActive() && !document.querySelector("dialog[open]:modal")) narrator.cancel();
      return;
    }
    const el = e.target;
    // dentro de campos de texto e listas, as teclas são da própria caixa
    if (el.closest?.("input:not([type=checkbox]):not([type=range]), textarea, select, [contenteditable='true']")) return;
    const onMap = el === canvas;
    // com uma janela modal aberta, só a ajuda e a troca de idioma valem (o resto é da janela)
    const modalOpen = !!document.querySelector("dialog[open]:modal");
    for (const [name, sc] of Object.entries(SHORTCUTS)) {
      if (!matches(sc, e)) continue;
      if (sc.scope === "map" && !onMap) continue;
      if (modalOpen && name !== "language" && name !== "help") continue;
      e.preventDefault();
      runShortcut(name);
      return;
    }
  });

  // diálogo da legenda (fecha com Escape ou clique fora: volta à galeria se o mapa não abriu)
  const dlg = $("legendDialog");
  closeOnBackdrop(dlg);
  const markScroll = () => { legendHover.scrolledAt = performance.now(); };
  dlg.addEventListener("scroll", markScroll, { passive: true, capture: true });
  dlg.addEventListener("wheel", markScroll, { passive: true });
  $("dlgReadAloud").addEventListener("click", () => (legendVoice.active ? stopLegendVoice() : startLegendVoice()));
  $("placesToggle").addEventListener("click", togglePlaces);
  dlg.addEventListener("close", () => {
    stopLegendVoice();
    endLegendPreview({ resume: false });
    engine.stopPreview();
    engine.stopPlacePreview();
    if (dlg.returnValue === "start") startExperience();
    else if (dlg.returnValue === "back" || dlg.returnValue === "") {
      if ($("exploreView").hidden) backToGallery();
      else canvas.focus({ preventScroll: true });
    }
    dlg.returnValue = "";
  });
  dlg.addEventListener("cancel", () => { dlg.returnValue = ""; });

  // canvas: ponteiro. Clique (ou toque) diz o país e o valor do ponto.
  canvas.addEventListener("pointerenter", (e) => { state.pointerInside = true; setFromPointer(e); });
  canvas.addEventListener("pointermove", (e) => {
    state.pointerInside = true;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    setFromPointer(events[events.length - 1] || e);
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (tour.on) stopTour({ silent: true });
    canvas.focus({ preventScroll: true });
    if (!engine.started) engine.start().then(updateAudioUI).catch(() => {});
    if (e.pointerType !== "mouse") canvas.setPointerCapture(e.pointerId);
    state.pointerInside = true;
    setFromPointer(e);
    readHere();
  });
  canvas.addEventListener("pointerleave", () => { state.pointerInside = false; state.listening = false; state.readingDirty = true; });
  canvas.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") { state.pointerInside = false; state.readingDirty = true; } });
  canvas.addEventListener("focus", () => { state.keyboardActive = true; state.readingDirty = true; });
  canvas.addEventListener("blur", () => { state.keyboardActive = false; state.readingDirty = true; });

  // canvas: setas (segurar a seta anda mais rápido, sem Shift) e teclas 1 a 9
  canvas.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.repeat ? SETTINGS.keyboard.holdStep : SETTINGS.keyboard.step;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step * 2], ArrowDown: [0, step * 2] };
    if (map[e.key]) {
      e.preventDefault();
      if (tour.on) stopTour({ silent: true }); // a pessoa retoma o controle
      const [u0, v0] = [state.u, state.v];
      moveFocal(...map[e.key]);
      tutorial.notify("move");
      // chegou à borda: avisa, para a pessoa não ficar apertando a seta sem sair do lugar
      if (state.u === u0 && state.v === v0 && !tutorial.isSpeaking()) announce(t(`edge.${e.key}`));
      return;
    }
    if (/^[1-9]$/.test(e.key)) { e.preventDefault(); jumpToCell(Number(e.key)); }
  });

  // passeio sonoro
  $("tourButton").addEventListener("click", toggleTour);

  // linha do tempo
  let sliderTimer;
  $("frameSlider").addEventListener("input", (e) => {
    stopTimeline();
    const i = Number(e.target.value);
    $("frameLabel").textContent = `${state.group.frames[i].name} · ${i + 1}/${state.group.frames.length}`;
    $("frameTime").textContent = frameTimeText(state.group.frames[i]);
    clearTimeout(sliderTimer);
    // só voz: o leitor de tela lê o próprio controle deslizante
    sliderTimer = setTimeout(() => loadFrame(i).then(() => announce(frameTimeText(state.group.frames[state.index]), { live: false })), 60);
  });
  $("playTimeline").addEventListener("click", toggleTimeline);

  // áudio
  $("volumeSlider").addEventListener("input", (e) => setVolume(Number(e.target.value)));

  // smartphone
  $("phoneConnect").addEventListener("click", connectPhone);
  $("phoneDisconnect").addEventListener("click", () => {
    haptics.close();
    $("phoneBox").hidden = true;
    $("phoneConnectLabel").textContent = t("phone.connect");
  });
  $("lanInput").addEventListener("input", () => { refreshQr(); savePrefs(); });
  $("lanSelect").addEventListener("change", () => {
    refreshQr();
    if ($("lanSelect").value === "__manual") $("lanInput").focus();
  });
  $("receiverMode").addEventListener("change", () => { refreshQr(); savePrefs(); });
  // alternativa ao QR Code para quem não enxerga a tela
  $("copyReceiver").addEventListener("click", async () => {
    const url = receiverUrl();
    if (!url) { toast(t("phone.noLink")); return; }
    try {
      await navigator.clipboard.writeText(url);
      announce(t("phone.copied"));
    } catch {
      toast(t("phone.copyFail"));
    }
  });
  // rede mudou (outro Wi-Fi, cabo, VPN): refaz a detecção se o painel estiver aberto
  const redetect = () => { if (!$("phoneBox").hidden && haptics.peer?.id) detectAddresses(); };
  window.addEventListener("online", redetect);
  navigator.connection?.addEventListener?.("change", redetect);

  // acessibilidade
  $("highContrast").addEventListener("change", (e) => { document.documentElement.classList.toggle("hc", e.target.checked); savePrefs(); });
  $("voiceToggle").addEventListener("change", (e) => applyVoice(e.target.checked));
  $("textSize").addEventListener("change", (e) => applyTextSize(e.target.value));
  $("colorMode").addEventListener("change", (e) => applyColorMode(e.target.value));

  window.addEventListener("resize", () => { if (!$("exploreView").hidden) layoutCanvas(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && engine.started && !engine.paused) { engine.pause(); updateAudioUI(); }
  });
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
async function init() {
  applyI18n();
  setupEvents();
  // valores iniciais: config.json; as escolhas salvas no navegador vêm por cima
  if (prefs.receiver) $("receiverMode").value = prefs.receiver;
  const volume = prefs.volume !== undefined ? prefs.volume : SETTINGS.audio.volumeDb;
  $("volumeSlider").value = volume;
  setVolume(volume);
  $("voiceToggle").checked = prefs.voice ?? SETTINGS.narration.onAtStart;
  tutorial.syncVoice();
  const hc = prefs.hc ?? SETTINGS.a11y.highContrast ?? window.matchMedia("(prefers-contrast: more)").matches;
  $("highContrast").checked = !!hc;
  document.documentElement.classList.toggle("hc", !!hc);
  applyTextSize(prefs.text || SETTINGS.a11y.textSize);
  if (prefs.color) { $("colorMode").value = prefs.color; state.colorMode = prefs.color; }
  if (prefs.lan) $("lanInput").value = prefs.lan;

  // com a voz do site ligada, ela lê cada controle que recebe o foco pelo teclado (js/a11y.js).
  // Ao navegar com Tab, o botão selecionado é SEMPRE lido na hora, interrompendo qualquer fala
  // (legenda, ajuda, tutorial), como faz um leitor de tela. Um foco movido pelo próprio app
  // (abrir uma janela, por exemplo) espera as descrições importantes terminarem.
  initFocusEcho({
    enabled: () => SETTINGS.narration.readControls && voiceOn(),
    speak: (text, { navigating = false } = {}) => {
      if (!navigating) { narrator.sayLow(text, voiceOpts()); return; }
      if (legendVoice.active) stopLegendVoice();
      narrator.say(text, voiceOpts());
    },
    skip: (el) => ["tutorialTitle", "legendDialogTitle", "helpTitle"].includes(el.id) || el.tagName === "DIALOG",
  });

  renderShortcutHints();
  renderHelp();
  showView("gallery");
  renderGallery();
  updateAudioUI();
  requestAnimationFrame(frame);
  if (CONFIG_PROBLEMS.length) {
    toast(`config.json: ${CONFIG_PROBLEMS.length} × ${CONFIG_PROBLEMS[0]}`, 12000);
  }
  // primeira visita: as boas-vindas do tutorial são a primeira coisa na tela, no leitor de
  // tela e na voz (que começa no primeiro gesto, se o navegador bloquear o som antes)
  if (!tutorial.seen()) tutorial.open({ gate: true });

  await Promise.all([loadLandMask(), loadCountries()]);
  await upgradeGmaoSequences(state.presets);
  if (state.presets.some((g) => g.sequence)) renderGallery();
  if (!engine.available) toast(t("audio.noTone"), 6000);
}

init();
