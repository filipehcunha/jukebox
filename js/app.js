// A Sinfonia da Terra · Earth Jukebox Multissensorial
// Orquestra galeria, legenda, leitura de pixels, áudio, háptica, idioma e acessibilidade.
//
// Mapa de dependências: textos → i18n.js (lang/*.json) · atalhos → atalhos.js ·
// ajustes → config.json (config.js) · escalas → scales.js · som → audio.js.

import { SCALES, paletteColor } from "./scales.js";
import { SAMPLE_SET, SETTINGS, CONFIG_PROBLEMS, layerInstruments, instrumentForScale } from "./config.js";
import { loadLandMask, loadCountries, formatCoord, project, landscapeAt } from "./geo.js";
import { ImageSampler, loadBitmap } from "./sampler.js";
import { SonificationEngine, MUSICAL_KEYS } from "./audio.js";
import { HapticBridge, renderQr, guessReceiverBase, checkPublicReceiver, PUBLIC_RECEIVER_BASE } from "./haptics.js";
import { presetGroups, renderPresets } from "./gallery.js";
import { createTutorial } from "./tutorial.js";
import { narrator } from "./voz.js";
import { initFocusEcho } from "./a11y.js";
import { ROUTES, routeLabel, routePoint, createStats, addReading, summarize, toWav, fileName } from "./passeio.js";
import { analyze, compose, sectionAt, STEP_S, BAR } from "./sinfonia.js";
import { t, num, getLang, otherLang, setLang, applyI18n, onLangChange } from "./i18n.js";
import { ATALHOS, acaoDoEvento, ariaShortcut, teclaDe, nomeTecla } from "./atalhos.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const key = (acao) => teclaDe(acao, t); // nome da tecla de uma ação, no idioma atual

const canvas = $("mapCanvas");
const ctx = canvas.getContext("2d");

const engine = new SonificationEngine();
window.sinfonia = { engine, SAMPLE_SET, SETTINGS, ATALHOS }; // acesso para depuração no console
const haptics = new HapticBridge({ onStatus: onPhoneStatus });

// as funções do app usadas aqui são declarações, então já existem (hoisting)
const tutorial = createTutorial({
  engine,
  openPractice,
  focusMap: () => { canvas.focus({ preventScroll: true }); state.keyboardActive = true; state.readingDirty = true; },
  backToGallery,
  inExplore: () => !$("exploreView").hidden,
  toast,
  voiceOn,
  setVoice: applyVoice,
  voiceOpts,
  onClose: onTutorialClose,
});

// A VOZ TEM PRIORIDADE: enquanto qualquer narração fala, a música para (ou abaixa, conforme
// config.json → narracao) e volta sozinha quando a fala termina.
narrator.onBusyChange = (speaking) => engine.duck(speaking);

const state = {
  presets: presetGroups(),
  group: null,
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
  loadToken: 0,
  colorMode: "none",
  legendHover: null, // posição 0..1 sob o mouse na barra de cores (pré-escuta da escala)
};

// sinfonia e passeios (o cursor anda sozinho): ver a seção "Sinfonia e passeios"
const sweep = { on: false, preparing: false, route: "sinfonia", origin: null, t0: 0, dur: 0, rec: false, stats: null, token: 0, url: null, score: null };

// ---------------------------------------------------------------------------
// Preferências (salvas no navegador; os valores iniciais vêm do config.json)
// ---------------------------------------------------------------------------
const prefs = (() => {
  try { return JSON.parse(localStorage.getItem("sinfonia-prefs-v3") || "{}"); } catch { return {}; }
})();
function savePrefs() {
  try {
    localStorage.setItem("sinfonia-prefs-v3", JSON.stringify({
      voice: $("voiceToggle").checked, reader: $("readerToggle").checked, hc: $("highContrast").checked,
      color: $("colorMode").value, volume: Number($("volumeSlider").value), text: $("textSize").value,
      lan: $("lanInput").value, receiver: $("receiverMode").value,
    }));
  } catch { /* armazenamento indisponível */ }
}

// ---------------------------------------------------------------------------
// Voz, anúncios e avisos. Toda fala passa pelo narrador (uma por vez).
// ---------------------------------------------------------------------------
function voiceOn() {
  return $("voiceToggle").checked;
}
function voiceOpts() {
  return { rate: SETTINGS.narration.rate, volume: SETTINGS.narration.volume };
}

function speak(text, { queue = false, force = false } = {}) {
  if (!text || !(force || voiceOn())) return;
  narrator.say(text, { queue, ...voiceOpts() });
}

// leitor de tela (região ARIA live) + voz do site
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

// ---------------------------------------------------------------------------
// Telas
// ---------------------------------------------------------------------------
function showView(name) {
  const gallery = name === "gallery";
  $("galleryView").hidden = !gallery;
  $("exploreView").hidden = gallery;
  document.body.dataset.view = name;
  updateTitle();
  if (gallery) {
    stopSweep(false, { silent: true });
    engine.update({ active: false });
    haptics.send(null, { active: false });
  }
}

function updateTitle() {
  const app = t("brand.title");
  document.title = $("exploreView").hidden || !state.group ? `${t("gallery.kicker")} · ${app}` : `${state.group.title} · ${app}`;
}

function backToGallery() {
  for (const id of ["helpDialog", "legendDialog"]) if ($(id).open) $(id).close();
  showView("gallery");
  $("main").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
  announce(t("gallery.announce", { n: state.presets.length }));
}

function renderGallery() {
  renderPresets($("presetGrid"), state.presets, (g) => selectGroup(g));
}

// ---------------------------------------------------------------------------
// Escolha do mapa → legenda → exploração
// ---------------------------------------------------------------------------
async function selectGroup(group, { skipLegend = false } = {}) {
  // o clique na galeria é um gesto do usuário: libera o áudio já aqui, para a pré-escuta
  // da legenda tocar sem precisar de outro clique
  if (engine.available) engine.start().then(updateAudioUI).catch(() => {});
  state.group = group;
  state.scale = SCALES[group.scaleId];
  state.u = 0.5;
  state.v = 0.5;
  state.trail = [];
  engine.setLayerInstruments(layerInstruments(state.scale.id));
  const loading = loadImage();
  if (skipLegend) {
    await loading;
    await startExperience({ quiet: true });
    return;
  }
  openLegend();
  await loading;
}

const mapInstrument = () => SAMPLE_SET[instrumentForScale(state.scale?.id)];

async function startExperience({ quiet = false } = {}) {
  showView("explore");
  try {
    await engine.start();
    engine.resume();
  } catch (err) {
    toast(err.message || t("audio.unavailable"));
  }
  updateAudioUI();
  canvas.focus({ preventScroll: true });
  state.keyboardActive = true;
  state.readingDirty = true;
  layoutCanvas();
  if (!quiet) announce(t("explore.opened", { title: state.group.title, inst: mapInstrument().label, read: key("lerLugar"), help: key("ajuda") }));
}

// Tutorial: abre o mapa de temperatura direto (o tutorial ensina a legenda)
async function openPractice() {
  const group = state.presets.find((g) => g.id === "gmao-temp") || state.presets[0];
  await selectGroup(group, { skipLegend: true });
  canvas.scrollIntoView({ block: "center", behavior: reducedMotion.matches ? "auto" : "smooth" });
}

async function loadImage() {
  const g = state.group;
  if (!g) return;
  const token = ++state.loadToken;
  $("loadingVeil").hidden = false;
  try {
    const bmp = await loadBitmap(g.src);
    if (token !== state.loadToken) return;
    state.sampler = new ImageSampler(bmp);
    state.projection = g.projection;
    setupExplorer();
    rebuildBase();
    state.readingDirty = true;
  } catch (err) {
    console.error(err);
    toast(t("explore.loadError", { title: g.title }));
  } finally {
    if (token === state.loadToken) $("loadingVeil").hidden = true;
  }
}

function setupExplorer() {
  const g = state.group;
  if (!g) return;
  $("exploreKicker").textContent = g.source;
  $("exploreHeading").textContent = g.title;
  $("readInstrument").textContent = mapInstrument().label;
  updateLegendBar();
  canvas.setAttribute("aria-label", t("explore.canvasAria", { title: g.title, inst: mapInstrument().label, read: key("lerLugar"), help: key("ajuda") }));
  layoutCanvas();
}

// ---------------------------------------------------------------------------
// Legenda do mapa (diálogo): a escala, o instrumento e os sons dos lugares
// ---------------------------------------------------------------------------
const PLACE_ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const PLACES = [
  { id: "mar", color: "#38bdf8", icon: '<path d="M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/><path d="M6 10c1.5-3 4-5 8-5"/>' },
  { id: "gelo", color: "#bae6fd", icon: '<path d="M12 2v20M4.9 6l14.2 12M19.1 6 4.9 18"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>' },
  { id: "floresta", color: "#4ade80", icon: '<path d="M12 22v-6"/><path d="M12 2 6 11h3l-4 6h14l-4-6h3Z"/>' },
  { id: "deserto", color: "#fbbf24", icon: '<circle cx="17" cy="7" r="3"/><path d="M2 19c3-4 6-5 9-3s6 1 11-3"/>' },
  { id: "fronteira", color: "#c4b5fd", icon: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z"/><path d="M10 21h4"/>' },
  { id: "coracao", color: "#fb7185", icon: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>' },
];
const placeName = (p) => t(`soundsOfPlaces.${p.id}.name`);
function placeText(p, scale) {
  if (p.id !== "coracao") return t(`soundsOfPlaces.${p.id}.text`);
  return scale.alert ? t("soundsOfPlaces.coracao.textAlert", { label: scale.alertLabel }) : t("soundsOfPlaces.coracao.textNone");
}

const PLAY_ICON = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor"/></svg>`;
const INSTRUMENT_ICONS = {
  bowed: `<svg viewBox="0 0 48 48"><path d="M24 4v10M20 6h8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M24 14c-5 0-8 3-7 8 .6 2.6-3 3.5-3 9 0 6.5 4.5 11 10 11s10-4.5 10-11c0-5.5-3.6-6.4-3-9 1-5-2-8-7-8Z" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M21 27c1 1 5 1 6 0M21 33c1-1 5-1 6 0" stroke="currentColor" stroke-width="2"/><path d="M24 14v28" stroke="currentColor" stroke-width="1.6"/></svg>`,
  keys: `<svg viewBox="0 0 48 48"><rect x="5" y="12" width="38" height="26" rx="3" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12.5 12v26M20 12v26M27.5 12v26M35 12v26" stroke="currentColor" stroke-width="1.8"/><path d="M10 12h5v14h-5zM17.5 12h5v14h-5zM32.5 12h5v14h-5z" fill="currentColor"/></svg>`,
  wind: `<svg viewBox="0 0 48 48"><path d="M8 38 40 8" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="18" cy="28" r="1.8" fill="var(--bg-deep, #000)"/><circle cx="23" cy="23" r="1.8" fill="var(--bg-deep, #000)"/><circle cx="28" cy="18" r="1.8" fill="var(--bg-deep, #000)"/></svg>`,
  harp: `<svg viewBox="0 0 48 48"><path d="M12 42V8c10 0 14 6 18 12s8 8 8 8l-26 14Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M17 13v26M22 15v21M27 19v15M32 25v6" stroke="currentColor" stroke-width="1.6"/></svg>`,
  mallet: `<svg viewBox="0 0 48 48"><path d="M6 30h36" stroke="currentColor" stroke-width="2"/><rect x="7" y="18" width="5" height="16" rx="1.5" fill="currentColor"/><rect x="14" y="19" width="5" height="14" rx="1.5" fill="currentColor"/><rect x="21" y="20" width="5" height="12" rx="1.5" fill="currentColor"/><rect x="28" y="21" width="5" height="10" rx="1.5" fill="currentColor"/><rect x="35" y="22" width="5" height="8" rx="1.5" fill="currentColor"/></svg>`,
  pad: `<svg viewBox="0 0 48 48"><rect x="5" y="10" width="38" height="28" rx="4" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M10 26c3-8 6-8 9 0s6 8 9 0 6-8 9 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
};

function openLegend() {
  const scale = state.scale;
  const g = state.group;
  if (!scale || !g) return;
  engine.update({ active: false });
  const inst = mapInstrument();
  $("legendDialogTitle").textContent = t("legend.title", { title: g.title });
  $("legendDialogIntro").textContent = t("legend.intro", { inst: inst.label, what: scale.short.toLowerCase() });
  $("dlgScaleLabel").textContent = scale.label;
  $("dlgScaleUnit").textContent = scale.unit;
  $("dlgGradient").style.background = scale.gradientCss();
  renderTicks($("dlgTicks"), scale);

  // o instrumento do mapa: um só, do grave (valor baixo) ao agudo (valor alto)
  const list = $("instrumentList");
  list.innerHTML = "";
  const li = document.createElement("li");
  li.className = "instrument";
  li.style.setProperty("--inst", "#f4c76b");
  li.innerHTML = `
    <span class="instrument__icon" aria-hidden="true">${INSTRUMENT_ICONS[inst.icon] || INSTRUMENT_ICONS.keys}</span>
    <div class="instrument__body">
      <p class="instrument__register">${scale.short}</p>
      <h3 class="instrument__name" id="inst-name">${inst.label}</h3>
      <p class="instrument__role" id="inst-role">${scale.pitchHint}</p>
    </div>
    <div class="instrument__actions"></div>`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "button button--ghost instrument__play";
  btn.setAttribute("aria-describedby", "inst-name inst-role");
  btn.innerHTML = `${PLAY_ICON} ${t("legend.hearSweep")}`;
  li.querySelector(".instrument__actions").append(btn);
  bindLegendCard(li, btn, { play: () => engine.previewSweep("mid"), stop: () => engine.stopPreview() });
  list.append(li);
  renderPlaceList(scale);

  const dlg = $("legendDialog");
  engine.stopPreview();
  engine.stopPlacePreview();
  legendHover.current = null;
  legendHover.openedAt = performance.now();
  stopLegendVoice();
  updateReadAloudBtn();
  if (!dlg.open) dlg.showModal();
  $("legendDialogTitle").focus();
  if (voiceOn() && SETTINGS.narration.readLegend) setTimeout(() => { if (dlg.open) startLegendVoice(); }, 250);
}

function renderPlaceList(scale) {
  const list = $("placeList");
  list.innerHTML = "";
  for (const p of PLACES) {
    const li = document.createElement("li");
    li.className = "instrument instrument--place";
    li.style.setProperty("--inst", p.color);
    li.innerHTML = `
      <span class="instrument__icon" aria-hidden="true">${PLACE_ICON(p.icon)}</span>
      <div class="instrument__body">
        <h3 class="instrument__name" id="place-${p.id}">${placeName(p)}</h3>
        <p class="instrument__role" id="place-${p.id}-text">${placeText(p, scale)}</p>
      </div>
      <div class="instrument__actions"></div>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "button button--ghost instrument__play";
    btn.setAttribute("aria-label", t("legend.hearPlace", { name: placeName(p).toLowerCase() }));
    btn.setAttribute("aria-describedby", `place-${p.id}-text`);
    btn.innerHTML = `${PLAY_ICON} ${t("legend.hear")}`;
    li.querySelector(".instrument__actions").append(btn);
    bindLegendCard(li, btn, { play: () => engine.previewPlace(p.id), stop: () => engine.stopPlacePreview() });
    list.append(li);
  }
}

// ---- Legenda falada e pré-escutas sem atropelo ----
// A voz lê a legenda ao abrir. Passar o mouse num cartão pausa a voz e toca o som; ao sair,
// a voz retoma da frase em que parou. Nunca tocam duas coisas juntas.
const legendVoice = { parts: [], idx: 0, active: false, held: false, timer: 0 };
const legendHover = { openedAt: 0, scrolledAt: 0, current: null, stop: null };

function legendSpeechParts() {
  const scale = state.scale;
  const inst = mapInstrument();
  const parts = [
    $("legendDialogTitle").textContent + ".",
    t("legend.intro", { inst: inst.label, what: scale.short.toLowerCase() }),
    `${scale.label}. ${scale.pitchHint}`,
    t("legend.howToHear"),
    t("legend.placesIntro"),
  ];
  for (const p of PLACES) parts.push(`${placeName(p)}: ${placeText(p, scale)}`);
  parts.push(t("legend.whenReady", { close: nomeTecla("Escape", t) }));
  return parts.map((x) => x.replace(/\.(\s*\.)+/g, "."));
}

function updateReadAloudBtn() {
  const b = $("dlgReadAloud");
  b.setAttribute("aria-pressed", String(legendVoice.active));
  b.textContent = legendVoice.active ? t("legend.stopReading") : t("legend.readAloud");
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
    onstart: () => { legendVoice.idx = i + k; },
    onend: () => { if (i + k === parts.length - 1) { legendVoice.active = false; updateReadAloudBtn(); } },
  }));
}

function startLegendVoice() {
  clearTimeout(legendVoice.timer);
  legendVoice.parts = legendSpeechParts();
  legendVoice.idx = 0;
  legendVoice.active = true;
  legendVoice.held = !!legendHover.current;
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

function holdLegendVoice() {
  clearTimeout(legendVoice.timer);
  if (legendVoice.active && !legendVoice.held) legendVoice.held = true;
  narrator.cancel(); // o som da pré-escuta tem a vez
}

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
      li._t = setTimeout(() => {
        li.classList.remove("is-playing");
        if (legendHover.current === li && !li.matches(":hover")) endLegendPreview();
      }, secs * 1000);
    } catch (err) {
      endLegendPreview();
      toast(err.message || t("audio.unavailable"));
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

function updateLegendBar() {
  const s = state.scale;
  if (!s) return;
  $("legendTitle").textContent = s.label;
  $("legendUnit").textContent = s.unit;
  const pal = ["cividis", "viridis", "gray"].includes(state.colorMode) ? state.colorMode : null;
  $("legendGradient").style.background = pal ? paletteGradient(pal) : s.gradientCss();
  renderTicks($("legendTicks"), s);
  $("legendEnds").innerHTML = s.ends.map((e) => `<span>${e}</span>`).join("");
  $("readValueLabel").textContent = s.short;
}

function paletteGradient(pal) {
  return `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map((x) => `rgb(${paletteColor(pal, x).join(" ")})`).join(", ")})`;
}

function renderTicks(el, scale) {
  el.innerHTML = scale.ticks.map((tk) => `<span style="left:${(tk.pos * 100).toFixed(2)}%">${num(tk.value)}</span>`).join("");
}

// ---------------------------------------------------------------------------
// Barra de cores tocável: passar o mouse (ou as setas) toca o valor daquela posição
// ---------------------------------------------------------------------------
function legendReading(scale, pos) {
  const value = scale.valueAtPos(pos);
  const r = { valid: true, value, norm: pos, bright: 0.55, peak: 0.12, grad: 0, texture: 0, u: pos };
  r.weights = scale.roles(r);
  r.valueText = scale.format(value);
  r.zone = scale.zoneOf(value);
  const m = scale.colorAtPos(pos).match(/[\d.]+/g);
  r.rgb = m ? m.slice(0, 3).map(Number) : [255, 255, 255];
  return r;
}

const scaleSentence = (r) => `${state.scale.sentence(r.valueText)}, ${r.zone.label.toLocaleLowerCase()}.`;

async function playScaleAt(pos) {
  const scale = state.scale;
  if (!scale) return null;
  state.legendHover = clamp(pos);
  if (!engine.started) {
    try { await engine.start(); updateAudioUI(); } catch (err) { toast(err.message || t("audio.unavailable")); return null; }
  }
  if (state.legendHover === null) return null;
  const r = legendReading(scale, state.legendHover);
  engine.stopPreview();
  engine.update({ active: true, pan: state.legendHover * 2 - 1, norm: state.legendHover, weights: r.weights, bright: r.bright, grad: 0, alert: scale.alertLevel(r.value) });
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
    if (!state.scale) return;
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
    const step = 0.05;
    const keys = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, Home: -1, End: 1 };
    if (!(e.key in keys) || !state.scale) return;
    e.preventDefault();
    e.stopPropagation();
    kbPos = clamp(kbPos + keys[e.key]);
    show(kbPos);
    const r = await playScaleAt(kbPos);
    if (r) announce(scaleSentence(r), { live: false }); // o leitor de tela já lê o aria-valuetext
  });
  track.addEventListener("focus", () => { if (state.scale) show(kbPos); });
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
// Leitura e sonificação
// ---------------------------------------------------------------------------
function isActive() {
  return !$("exploreView").hidden && (state.pointerInside || state.keyboardActive || sweep.on) && !$("legendDialog").open && !$("helpDialog").open;
}

// leitura completa (valor, lugar, paisagem) em qualquer ponto do mapa
function readAt(u, v) {
  const { sampler, scale } = state;
  if (!sampler || !scale) return null;
  const r = sampler.read(u, v, scale, state.projection);
  r.weights = scale.roles(r);
  r.valueText = r.valid ? scale.format(r.value) : t("explore.noData");
  r.env = r.geo && r.region ? landscapeAt(r.geo.lat, r.geo.lon, r.region, { scaleId: scale.id, value: r.value, valid: r.valid }) : null;
  return r;
}

// O que se fala ao clicar no mapa ou apertar Espaço: o país (ou o oceano/região) e a
// característica principal do mapa, com o valor.
function placeSentence(r) {
  const place = r.region?.name || state.group?.title || "";
  if (!r.valid) return t("explore.placeNoData", { place, reason: r.reason });
  const alert = state.scale.alertLevel(r.value) > 0 ? ` ${t("explore.alert", { label: state.scale.alertLabel })}` : "";
  return `${place}. ${state.scale.sentence(r.valueText)}, ${r.zone.label.toLocaleLowerCase()}.${alert}`;
}

function readPlace() {
  state.readingDirty = true;
  processReading();
  if (!state.reading) return;
  announce(placeSentence(state.reading));
  tutorial.notify("announce");
}

function placeWords(u, v) {
  const vert = v < 1 / 3 ? "top" : v > 2 / 3 ? "bottom" : "";
  const horiz = u < 1 / 3 ? "left" : u > 2 / 3 ? "right" : "";
  if (!vert && !horiz) return t("position.center");
  return t(`position.${vert || "middle"}_${horiz || "center"}`);
}

// visão geral: percorre o mapa numa grade e diz onde estão o valor mais alto e o mais baixo
function mapOverview() {
  const { sampler, scale, projection, group } = state;
  if (!sampler || !scale) return;
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
    announce(t("overview.none", { title: group.title }));
    return;
  }
  const where = (r) => `${r.region?.name ? `${r.region.name}, ` : ""}${placeWords(r.u, r.v)}`;
  announce(t("overview.text", {
    title: group.title,
    hi: scale.sentence(scale.format(hi.value)), hiWhere: where(hi),
    lo: scale.sentence(scale.format(lo.value)), loWhere: where(lo),
    mean: scale.format(sum / n),
  }));
}

function announcePosition() {
  processReading();
  const r = state.reading;
  const place = r?.region?.name || state.group?.title || "";
  const coord = r?.geo ? `${formatCoord(r.geo.lat, r.geo.lon)}. ` : "";
  announce(t("position.text", { place, coord, where: placeWords(state.u, state.v), x: Math.round(state.u * 100), y: Math.round(state.v * 100) }));
}

// teclas 1 a 9: nove regiões, como um teclado de telefone (1 = em cima à esquerda)
function jumpToCell(n) {
  state.u = ((n - 1) % 3 + 0.5) / 3;
  state.v = (Math.floor((n - 1) / 3) + 0.5) / 3;
  moveFocal(0, 0);
  readPlace();
}

function changeVolume(delta) {
  const slider = $("volumeSlider");
  const db = clamp(Number(slider.value) + delta, Number(slider.min), Number(slider.max));
  slider.value = String(db);
  setVolume(db);
  announce(t("audio.volumeNow", { db: num(db) }));
}

function setVolume(db) {
  $("volumeOut").textContent = `${num(db)} dB`;
  $("volumeSlider").setAttribute("aria-valuetext", t("audio.volumeNow", { db: num(db) }));
  engine.setVolume(db);
  savePrefs();
}

function processReading() {
  const r = readAt(state.u, state.v);
  if (!r) return;
  const prev = state.reading;
  state.reading = r;
  const active = isActive();
  tutorial.notify("reading", r);
  // a barra de cores (pré-escuta) e a legenda aberta têm prioridade sobre o mapa
  if (state.legendHover !== null || $("legendDialog").open) {
    updateReadingUI(r);
    return;
  }
  if (!tutorial.isDemoPlaying()) engine.update({
    active: active && r.valid,
    pan: state.u * 2 - 1,
    norm: r.valid ? r.norm : 0.5,
    weights: r.weights,
    bright: r.bright ?? 0.5,
    grad: r.grad ?? 0,
    amb: active ? r.env?.levels ?? {} : {}, // sons dos lugares
    alert: r.valid ? state.scale.alertLevel(r.value) : 0, // coração nos valores extremos
  });
  if (sweep.on && sweep.stats && !sweep.score) addReading(sweep.stats, r, state.scale);
  // sino suave ao passar de um país para outro
  const c0 = prev?.region?.countryId;
  const c1 = r.region?.countryId;
  if (active && c0 && c1 && c0 !== c1 && !tutorial.isDemoPlaying()) engine.borderCue();
  haptics.send(r, { active });
  updateReadingUI(r);
}

function updateReadingUI(r) {
  $("readRegion").textContent = r.region?.name || "—";
  $("readCoord").textContent = (r.geo ? formatCoord(r.geo.lat, r.geo.lon) : "—") + (r.env?.label ? ` · ${r.env.label}` : "");
  $("readValue").textContent = r.valid ? r.valueText : t("explore.noData");
  $("readZone").textContent = r.valid ? r.zone.label : r.reason;
  if (state.legendHover === null) {
    const marker = $("legendMarker");
    marker.hidden = !r.valid;
    if (r.valid) marker.style.left = `${(r.norm * 100).toFixed(2)}%`;
  }
}

// ---------------------------------------------------------------------------
// Sinfonia e passeios: o cursor percorre o mapa sozinho; opcionalmente grava o áudio (WAV)
// ---------------------------------------------------------------------------
function sweepWhere(route) {
  if (state.projection?.type !== "equirectangular") return "";
  const g = project(state.projection, sweep.origin.u, sweep.origin.v);
  if (!g) return "";
  if (route === "volta") return Math.abs(g.lat) < 1.5 ? t("sweep.atEquator") : t("sweep.atLat", { n: Math.round(Math.abs(g.lat)), h: g.lat >= 0 ? t("geo.north") : t("geo.south") });
  if (route === "polos") return t("sweep.atLon", { n: Math.round(Math.abs(g.lon)), h: g.lon >= 0 ? t("geo.east") : t("geo.west") });
  return "";
}

function sweepIntro(route, secs) {
  const geo = state.projection && state.projection.type !== "none";
  const where = sweepWhere(route);
  const stop = key("sinfonia");
  let text;
  if (route === "sinfonia") text = t("sweep.introSymphony", { secs, inst: mapInstrument().label });
  else if (route === "volta") text = t("sweep.introVolta", { secs, where: where ? ` ${where}` : "" });
  else if (route === "polos") text = t("sweep.introPolos", { secs, where: where ? `, ${where}` : "" });
  else text = t("sweep.introMapa", { secs, rows: SETTINGS.sweep.rows });
  if (geo) text += ` ${t("sweep.introPlaces")}`;
  if (state.scale?.alert) text += ` ${t("sweep.introHeart", { label: state.scale.alertLabel })}`;
  if (sweep.rec) text += ` ${t("sweep.introRec")}`;
  return `${text} ${t(route === "sinfonia" ? "sweep.introStopSymphony" : "sweep.introStopWalk", { key: stop })}`;
}

function setSweepUI(mode) {
  const running = mode === "preparing" || mode === "running";
  const btn = $("sweepButton");
  btn.setAttribute("aria-pressed", String(running));
  const sinf = (running ? sweep.route : $("sweepRoute").value) === "sinfonia";
  btn.textContent = running ? t(sinf ? "sweep.stopSymphony" : "sweep.stopWalk") : t(sinf ? "sweep.playSymphony" : "sweep.startWalk");
  const hero = $("playSymphony");
  hero.setAttribute("aria-pressed", String(running));
  hero.classList.toggle("is-on", running);
  $("playSymphonyLabel").textContent = running ? t("symphony.stop") : t("symphony.play");
  for (const id of ["sweepRoute", "sweepDuration", "sweepRecord"]) $(id).disabled = running || mode === "saving";
  $("sweepProgress").hidden = mode !== "running";
  if (mode !== "running") $("sweepProgress").value = 0;
  $("sweepStatus").textContent = {
    preparing: t("sweep.preparing"),
    running: `${routeLabel(sweep.route)}${sweep.rec ? ` · ${t("sweep.recording")}` : ""}`,
    saving: t("sweep.saving"),
  }[mode] || "";
}

function fillSweepSelects() {
  const route = $("sweepRoute");
  const cur = route.value || "sinfonia";
  route.innerHTML = ROUTES.map((id) => `<option value="${id}">${t(`sweep.routeOptions.${id}`)}</option>`).join("");
  route.value = cur;
  const dur = $("sweepDuration");
  const curD = dur.value || String(SETTINGS.sweep.durationS);
  const opts = [...new Set([30, 45, 90, SETTINGS.sweep.durationS])].sort((a, b) => a - b);
  dur.innerHTML = opts.map((s) => `<option value="${s}">${t("sweep.seconds", { n: s })}</option>`).join("");
  dur.value = curD;
}

function placeSweep(p) {
  const pt = routePoint(sweep.route, p, sweep.origin, SETTINGS.sweep.rows);
  state.u = pt.u;
  state.v = pt.v;
  state.lastMove = performance.now();
  state.readingDirty = true;
  state.trail.push({ u: state.u, v: state.v, t: state.lastMove });
  if (state.trail.length > 28) state.trail.shift();
}

function tickSweep() {
  if (engine.paused || $("legendDialog").open || $("helpDialog").open) {
    stopSweep(false);
    return;
  }
  if (sweep.score) {
    tickScore();
    return;
  }
  const p = (performance.now() - sweep.t0) / sweep.dur;
  $("sweepProgress").value = Math.min(p, 1);
  if (p >= 1) stopSweep(true);
  else placeSweep(p);
}

// ---- Sinfonia do mapa: a faixa varre a imagem e o compositor (js/sinfonia.js) gera a peça ----
function buildScore() {
  const bars = Math.max(6, Math.round(sweep.dur / 1000 / (BAR * STEP_S)));
  const total = bars * BAR;
  const stats = createStats();
  const cols = analyze(readAt, state.scale, total, (r) => addReading(stats, r, state.scale));
  const ranges = Object.fromEntries(["low", "mid", "high", "arp"].map((l) => [l, SAMPLE_SET[engine.layerInstrument(l)].range]));
  const poly = Object.fromEntries(["low", "mid", "high", "arp"].map((l) => [l, engine.isPoly(l)]));
  const piece = compose(cols, { root: MUSICAL_KEYS[engine.key].root, notes: (lo, hi) => engine.scaleNotes(lo, hi), ranges, poly });
  sweep.stats = stats;
  sweep.dur = total * STEP_S * 1000;
  return { cols, ...piece, total, next: 0, t0: window.Tone.now() + 0.25, marks: [], finalDone: false, section: "" };
}

function tickScore() {
  const sc = sweep.score;
  const now = window.Tone.now();
  const play = (ev, time, u) => {
    engine.scoreNote(ev.layer, ev.midi, ev.dur, ev.vel, time + ev.off);
    if (ev.v !== undefined) sc.marks.push({ u, v: ev.v, t: time + ev.off, layer: ev.layer });
  };
  while (sc.next < sc.total && sc.t0 + sc.next * STEP_S < now + 0.2) {
    const k = sc.next;
    const col = sc.cols[k];
    const time = sc.t0 + k * STEP_S;
    for (const ev of sc.steps[k]) play(ev, time, col.u);
    const fade = k / sc.total > 0.9 ? 0.5 : 1;
    engine.scoreState({ pan: col.u * 2 - 1, alert: col.alert, amb: Object.fromEntries(Object.entries(col.amb).map(([n, x]) => [n, x * fade])) });
    sc.next += 1;
  }
  const tEnd = sc.t0 + sc.total * STEP_S + 0.3;
  if (sc.next >= sc.total && !sc.finalDone && tEnd < now + 0.2) {
    sc.finalDone = true;
    for (const ev of sc.final) play(ev, tEnd, 0.996);
    engine.scoreState({ pan: 0, alert: 0, amb: {} });
  }
  const p = clamp((now - sc.t0) / (sc.total * STEP_S));
  $("sweepProgress").value = p;
  const sec = sectionAt(p);
  if (sec !== sc.section) {
    sc.section = sec;
    $("sweepStatus").textContent = `${routeLabel("sinfonia")} · ${t(`symphony.sections.${sec}`)}${sweep.rec ? ` · ${t("sweep.recording")}` : ""}`;
  }
  const col = sc.cols[Math.min(sc.total - 1, Math.floor(p * sc.total))];
  state.u = col.u;
  state.v = col.hotV;
  state.lastMove = performance.now();
  state.readingDirty = true;
  if (sc.marks.length > 60) sc.marks.splice(0, sc.marks.length - 60);
  if (now > tEnd + 1.2) stopSweep(true);
}

// a faixa e as notas desenhadas sobre o mapa
function drawScore(w, h, dpr, hc) {
  const sc = sweep.score;
  const now = window.Tone.now();
  const p = clamp((now - sc.t0) / (sc.total * STEP_S));
  const x = p * w;
  const grad = ctx.createLinearGradient(x - 46 * dpr, 0, x, 0);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(1, hc ? "rgba(255,255,0,.28)" : "rgba(255,255,255,.2)");
  ctx.fillStyle = grad;
  ctx.fillRect(x - 46 * dpr, 0, 46 * dpr, h);
  ctx.strokeStyle = hc ? "#ffff00" : "rgba(255,255,255,.95)";
  ctx.lineWidth = (hc ? 3 : 2) * dpr;
  ctx.shadowColor = "rgba(0,0,0,.8)";
  ctx.shadowBlur = 6 * dpr;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, h);
  ctx.stroke();
  for (const m of sc.marks) {
    const age = now - m.t;
    if (age < 0 || age > 1.6) continue;
    const k = 1 - age / 1.6;
    ctx.globalAlpha = k;
    ctx.fillStyle = hc ? "#ffff00" : "#fcd34d";
    ctx.beginPath();
    ctx.arc(m.u * w, m.v * h, (3 + 7 * k) * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function toggleSweep() {
  if (sweep.on || sweep.preparing) stopSweep(false);
  else startSweep();
}

async function startSweep() {
  if ($("exploreView").hidden || !state.sampler) {
    announce(t("sweep.openFirst"));
    return;
  }
  const token = ++sweep.token;
  stopScale();
  sweep.preparing = true;
  sweep.route = $("sweepRoute").value;
  sweep.dur = Number($("sweepDuration").value) * 1000;
  sweep.origin = { u: state.u, v: state.v };
  sweep.rec = $("sweepRecord").checked;
  if (sweep.rec && !engine.canRecord) {
    sweep.rec = false;
    toast(t("sweep.cannotRecord"));
  }
  setSweepUI("preparing");
  try {
    if (!engine.started) await engine.start();
    else if (engine.paused) engine.resume();
    updateAudioUI();
  } catch (err) {
    toast(err.message || t("audio.unavailable"));
    sweep.preparing = false;
    setSweepUI("idle");
    return;
  }
  placeSweep(0);
  announce(sweepIntro(sweep.route, Math.round(sweep.dur / 1000)));
  // espera a voz terminar a apresentação: a gravação e o caminho começam depois dela
  await wait(200);
  const t0 = performance.now();
  while (narrator.busy() && performance.now() - t0 < 25000) {
    await wait(100);
    if (token !== sweep.token) return;
  }
  if (token !== sweep.token) return;
  if (sweep.rec) {
    try {
      await engine.startRecording();
    } catch {
      sweep.rec = false;
      toast(t("sweep.recordFailed"));
    }
    if (token !== sweep.token) {
      if (sweep.rec) engine.stopRecording();
      return;
    }
  }
  sweep.preparing = false;
  sweep.stats = createStats();
  sweep.score = null;
  if (sweep.route === "sinfonia") {
    engine.beginScore();
    sweep.score = buildScore();
  }
  sweep.on = true;
  sweep.t0 = performance.now();
  setSweepUI("running");
}

async function stopSweep(completed = false, { silent = false } = {}) {
  if (!sweep.on && !sweep.preparing) return;
  const wasRunning = sweep.on;
  const recording = wasRunning && sweep.rec;
  const secs = wasRunning ? Math.round(Math.min(performance.now() - sweep.t0, sweep.dur) / 1000) : 0;
  const stats = sweep.stats;
  const route = sweep.route;
  const wasScore = !!sweep.score;
  if (wasScore) engine.endScore(completed ? 3.5 : 0.6);
  sweep.score = null;
  sweep.token += 1;
  sweep.on = false;
  sweep.preparing = false;
  sweep.stats = null;
  state.readingDirty = true;
  if (!wasRunning) {
    setSweepUI("idle");
    if (!silent) announce(t("sweep.cancelled"));
    return;
  }
  const summary = stats ? summarize(stats, state.scale, { secs, completed, whole: wasScore }) : "";
  if (!recording) {
    setSweepUI("idle");
    if (wasScore && completed) await wait(2600); // deixa o último acorde soar
    if (!silent) announce(summary);
    return;
  }
  // gravação: espera o som se apagar antes de fechar o arquivo; depois fala o resumo
  setSweepUI("saving");
  await wait(wasScore && completed ? 3800 : 1800);
  let note = "";
  try {
    const blob = await engine.stopRecording();
    if (!blob || !blob.size) throw new Error("empty");
    let out = blob;
    let ext = /ogg/.test(blob.type) ? "ogg" : /mp4|aac/.test(blob.type) ? "m4a" : "webm";
    try {
      out = await toWav(blob, new OfflineAudioContext(2, 44100, 44100));
      ext = "wav";
    } catch { /* sem conversão: oferece o arquivo original do navegador */ }
    if (sweep.url) URL.revokeObjectURL(sweep.url);
    sweep.url = URL.createObjectURL(out);
    const a = $("sweepDownload");
    a.href = sweep.url;
    a.download = fileName(state.group?.title, route, ext);
    a.textContent = t("sweep.download", { ext: ext.toUpperCase(), secs: secs + 2, mb: num(out.size / 1048576, 1) });
    a.hidden = false;
    note = ` ${t("sweep.downloadReady")}`;
  } catch (err) {
    toast(t("sweep.saveFailed", { err: err.message }));
  }
  setSweepUI("idle");
  if (!silent) announce(summary + note);
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
  if (sweep.on || sweep.preparing) return; // durante o passeio o cursor anda sozinho
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

  if (sweep.on && sweep.score) drawScore(w, h, dpr, hc);

  // retícula do cursor focal (maior com texto grande, para baixa visão)
  const active = isActive();
  const pulse = reducedMotion.matches ? 0 : Math.sin(time / 380) * 2;
  const R = (14 + pulse) * dpr * CURSOR_SCALE[$("textSize").value];
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
    const label = r.valid ? `${r.valueText} · ${r.region?.name || r.zone.label}` : t("explore.noData");
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
    if (sweep.on) tickSweep();
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
// Som
// ---------------------------------------------------------------------------
function updateAudioUI() {
  const on = engine.started && !engine.paused;
  const btn = $("audioToggle");
  btn.setAttribute("aria-pressed", String(on));
  btn.classList.toggle("is-on", on);
  $("audioToggleLabel").textContent = on ? t("audio.pause") : engine.started ? t("audio.resume") : t("audio.start");
  $("audioDot").classList.toggle("is-on", on);
  $("audioStatus").textContent = !engine.available ? t("audio.noTone") : on ? t("audio.playing") : engine.started ? t("audio.paused") : t("audio.waiting");
}

async function toggleAudio() {
  try {
    if (!engine.started) await engine.start();
    else if (engine.paused) engine.resume();
    else engine.pause();
  } catch (err) {
    toast(err.message || t("audio.unavailable"));
  }
  updateAudioUI();
  state.readingDirty = true;
  if (engine.started) announce(engine.paused ? t("audio.pausedSay") : t("audio.onSay"), { live: false });
}

// ---------------------------------------------------------------------------
// Celular (vibração)
// ---------------------------------------------------------------------------
let phoneState = { kind: null, info: null };
function onPhoneStatus(kind, info) {
  if (kind !== "caps" && kind !== "ice") phoneState = { kind, info };
  renderPhoneStatus();
  if (kind === "connected") announce(t("phone.connectedSay"));
  if (kind === "caps" && info && info.vibrate === false) toast(t("phone.noVibration"), 6000);
}
function renderPhoneStatus() {
  const { kind, info } = phoneState;
  const st = $("phoneStatus");
  const dot = $("phoneDot");
  dot.className = "status-dot";
  if (kind === "waiting") { st.textContent = t("phone.waiting"); dot.classList.add("is-wait"); }
  if (kind === "connected") { st.textContent = t("phone.connected"); dot.classList.add("is-on"); }
  if (kind === "reconnecting") st.textContent = t("phone.reconnecting");
  if (kind === "error") { st.textContent = t("phone.error", { err: info }); dot.classList.add("is-err"); }
  if (kind === "closed") st.textContent = t("phone.closed");
}

// O celular abre receiver.html (no idioma do site) pela rede local ou pela cópia pública.
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
  return `${new URL(`receiver.html?lang=${getLang()}`, base).href}#${id}`;
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

// detecta (de novo) os endereços: ao gerar o QR e quando a rede muda
async function detectAddresses() {
  const [info, pub] = await Promise.all([guessReceiverBase(), checkPublicReceiver()]);
  lanWarning = info.warning || null;
  const pubOpt = $("receiverMode").querySelector('option[value="public"]');
  pubOpt.disabled = !pub;
  pubOpt.textContent = pub ? t("phone.public") : t("phone.publicOff");
  if (!pub && $("receiverMode").value === "public") $("receiverMode").value = "lan";
  const sel = $("lanSelect");
  const prevValue = sel.value;
  sel.innerHTML = info.candidates.map((c) => `<option value="${c.url}">${c.label}</option>`).join("") + `<option value="__manual">${t("phone.typeOther")}</option>`;
  const keep = [...sel.options].some((o) => o.value === prevValue) && prevValue !== "__manual";
  sel.value = keep ? prevValue : info.candidates.length ? info.candidates[0].url : "__manual";
  if (!info.candidates.length && pub) $("receiverMode").value = "public";
  $("lanHelp").textContent = info.fromServer
    ? t(info.candidates.length > 1 ? "phone.fromServerMany" : "phone.fromServer")
    : !info.local ? t("phone.pageAddress") : info.candidates.length ? t("phone.fromBrowser") : t("phone.notDetected");
  refreshQr();
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
    $("phoneStatus").textContent = t("phone.peerError", { err: err?.type || err?.message || err });
  }
}

// ---------------------------------------------------------------------------
// Acessibilidade
// ---------------------------------------------------------------------------
// Voz do site: lugar clicado, avisos, legenda e tutorial
function applyVoice(on, { say = true } = {}) {
  $("voiceToggle").checked = on;
  $("tutorialVoice").checked = on;
  savePrefs();
  if (!say) return;
  if (on) speak(t("a11y.voiceOn"));
  else {
    narrator.cancel();
    announce(t("a11y.voiceOff"), { speak: false });
  }
}

// Leitor embutido: lê os controles ao navegar com Tab
function applyReader(on, { say = true } = {}) {
  $("readerToggle").checked = on;
  savePrefs();
  if (say) speak(on ? t("a11y.readerOn") : t("a11y.readerOff"), { force: true });
}

// Quem fez o tutorial com voz segue com o leitor embutido ligado no resto do site:
// sem enxergar a tela, a pessoa não fica sem guia.
function onTutorialClose({ started, voice }) {
  // as demonstrações do tutorial trocam o instrumento: volta o do mapa aberto
  if (state.scale) engine.setLayerInstruments(layerInstruments(state.scale.id));
  if (!started || !voice || $("readerToggle").checked) return;
  applyReader(true, { say: false });
  speak(t("a11y.readerAfterTutorial", { key: key("ajuda") }), { queue: true });
}

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
    setTimeout(() => {
      rebuildBase();
      updateLegendBar();
      $("loadingVeil").hidden = true;
    }, 16);
  }
  savePrefs();
}

// ---------------------------------------------------------------------------
// Ajuda e atalhos (a lista é montada a partir do dicionário js/atalhos.js)
// ---------------------------------------------------------------------------
function kbdList(acao) {
  const a = ATALHOS[acao];
  return [a.tecla, ...(a.outras || [])].map((k) => `<kbd>${nomeTecla(k, t)}</kbd>`).join(` ${t("common.or")} `);
}

function buildHelp() {
  const item = (keys, text) => `<li>${keys}: ${text}</li>`;
  const section = (title, items) => `<section><h3>${title}</h3><ul>${items.join("")}</ul></section>`;
  const byWhere = (where) => Object.keys(ATALHOS).filter((n) => ATALHOS[n].onde === where).map((n) => item(kbdList(n), t(`shortcuts.${n}`)));
  const arrows = `<kbd>${t("keys.arrows")}</kbd>`;
  const digits = `<kbd>1</kbd> ${t("common.to")} <kbd>9</kbd>`;
  const esc = `<kbd>${nomeTecla("Escape", t)}</kbd>`;
  $("helpBody").innerHTML =
    `<section><h3>${t("help.howTitle")}</h3><p>${t("help.how", { read: key("lerLugar") })}</p></section>` +
    section(t("help.anywhere"), [...byWhere("global"), item(esc, t("shortcuts.escape"))]) +
    section(t("help.onMap"), [item(arrows, t("shortcuts.arrows")), ...byWhere("mapa"), item(digits, t("shortcuts.digits"))]) +
    section(t("help.inTutorial"), byWhere("tutorial")) +
    section(t("help.onScale"), [item(arrows, t("shortcuts.scale"))]) +
    `<section><h3>${t("help.srTitle")}</h3><p>${t("help.sr")}</p></section>`;
}

function buildCanvasHelp() {
  $("canvasHelp").innerHTML = t("explore.help", {
    read: kbdList("lerLugar"), overview: `<kbd>${key("visaoGeral")}</kbd>`, symphony: `<kbd>${key("sinfonia")}</kbd>`,
    legend: `<kbd>${key("legenda")}</kbd>`, help: `<kbd>${key("ajuda")}</kbd>`,
  });
}

// aria-keyshortcuts e dica no title dos botões que têm atalho
function bindShortcutHints() {
  for (const [nome, a] of Object.entries(ATALHOS)) {
    const el = a.botao && $(a.botao);
    if (!el) continue;
    el.setAttribute("aria-keyshortcuts", ariaShortcut(nome));
    el.title = t("common.shortcut", { key: teclaDe(nome, t) });
  }
}

function openHelp() {
  const dlg = $("helpDialog");
  if (!dlg.open) dlg.showModal();
  $("helpTitle").focus();
}

// texto da ajuda para a voz
function helpSpeech() {
  return [...$("helpBody").querySelectorAll("h3, p, li")]
    .map((el) => el.textContent.replace(/\s+/g, " ").trim())
    .map((x) => (/[.!?:]$/.test(x) ? x : `${x}.`))
    .join(" ");
}

function focusMap() {
  if ($("exploreView").hidden) {
    announce(t("explore.noMapOpen"));
    return;
  }
  for (const id of ["helpDialog", "legendDialog"]) if ($(id).open) $(id).close();
  canvas.focus({ preventScroll: true });
  canvas.scrollIntoView({ block: "center", behavior: "auto" });
}

// Ações dos atalhos sem botão (ou com comportamento próprio). As demais clicam no botão
// associado em js/atalhos.js.
const ACTIONS = {
  ajuda: openHelp,
  tutorial: () => tutorial.open(),
  idioma: toggleLang,
  voz: () => applyVoice(!$("voiceToggle").checked),
  som: toggleAudio,
  mapa: focusMap,
  galeria: () => { if (!$("exploreView").hidden || $("legendDialog").open) backToGallery(); },
  lerLugar: readPlace,
  visaoGeral: mapOverview,
  posicao: announcePosition,
  centro: () => { state.u = 0.5; state.v = 0.5; moveFocal(0, 0); tutorial.notify("home"); readPlace(); },
  sinfonia: () => { if (!sweep.on && !sweep.preparing) $("sweepRoute").value = "sinfonia"; toggleSweep(); },
  legenda: openLegend,
  volumeMais: () => changeVolume(2),
  volumeMenos: () => changeVolume(-2),
};

function runAction(nome) {
  if (ACTIONS[nome]) return ACTIONS[nome]();
  const el = ATALHOS[nome]?.botao && $(ATALHOS[nome].botao);
  if (el && !el.disabled) el.click();
}

const isTyping = (el) => el instanceof Element && (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== "checkbox" && el.type !== "range" || el.isContentEditable);

// ---------------------------------------------------------------------------
// Idioma
// ---------------------------------------------------------------------------
function toggleLang() {
  narrator.cancel();
  setLang(otherLang());
}

// refaz tudo o que o JS montou com texto
function refreshTexts() {
  renderGallery();
  buildHelp();
  buildCanvasHelp();
  bindShortcutHints();
  fillSweepSelects();
  setSweepUI(sweep.on ? "running" : sweep.preparing ? "preparing" : "idle");
  updateAudioUI();
  renderPhoneStatus();
  updateTitle();
  if (state.group) {
    setupExplorer();
    state.readingDirty = true;
    if ($("legendDialog").open) openLegend();
  }
  if (haptics.peer?.id && !$("phoneBox").hidden) detectAddresses();
  setVolume(Number($("volumeSlider").value));
}

onLangChange(() => {
  refreshTexts();
  // com o tutorial aberto, ele mesmo relê o passo no novo idioma: o aviso vai só para o leitor de tela
  announce(t("lang.changed"), { speak: !tutorial.isActive() });
});

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------
function closeOnBackdrop(dlg) {
  // clique fora da janela (no fundo escurecido) fecha, como o Escape
  dlg.addEventListener("click", (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) { dlg.returnValue = ""; dlg.close(); }
  });
}

function setupEvents() {
  $("brandLink").addEventListener("click", (e) => { e.preventDefault(); backToGallery(); });
  $("backButton").addEventListener("click", backToGallery);
  $("audioToggle").addEventListener("click", toggleAudio);
  $("langToggle").addEventListener("click", toggleLang);
  $("reviewLegend").addEventListener("click", openLegend);
  attachScaleHover($("legendTrack"), $("legendMarker"), $("legendTip"));
  attachScaleHover($("dlgTrack"), $("dlgMarker"), $("dlgTip"));
  $("tutorialOpen").addEventListener("click", () => tutorial.open());
  $("tutorialSkipLink").addEventListener("click", (e) => { e.preventDefault(); tutorial.open(); });

  // ajuda
  $("helpOpen").addEventListener("click", openHelp);
  $("helpSkipLink").addEventListener("click", (e) => { e.preventDefault(); openHelp(); });
  $("helpClose").addEventListener("click", () => $("helpDialog").close());
  $("helpDialog").addEventListener("close", () => narrator.cancel());
  $("helpSpeak").addEventListener("click", () => speak(helpSpeech(), { force: true }));
  closeOnBackdrop($("helpDialog"));

  // ATALHOS DA PÁGINA TODA (teclas únicas, sem modificador; ver js/atalhos.js).
  // Não valem enquanto se digita num campo de texto.
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || isTyping(e.target)) return;
    const acao = acaoDoEvento(e, "global");
    if (acao) {
      e.preventDefault();
      runAction(acao);
      return;
    }
    if (e.key === "Escape" && (sweep.on || sweep.preparing) && !$("helpDialog").open && !$("legendDialog").open) { e.preventDefault(); stopSweep(false); return; }
    if (e.key === "Escape" && narrator.busy() && !tutorial.isActive()) narrator.cancel();
  });

  // legenda: fecha com Escape (nativo) ou com um clique fora da janela
  const dlg = $("legendDialog");
  closeOnBackdrop(dlg);
  const markScroll = () => { legendHover.scrolledAt = performance.now(); };
  dlg.addEventListener("scroll", markScroll, { passive: true, capture: true });
  dlg.addEventListener("wheel", markScroll, { passive: true });
  $("dlgReadAloud").addEventListener("click", () => (legendVoice.active ? stopLegendVoice() : startLegendVoice()));
  dlg.addEventListener("close", () => {
    stopLegendVoice();
    endLegendPreview({ resume: false });
    engine.stopPreview();
    engine.stopPlacePreview();
    if (dlg.returnValue === "start") startExperience();
    // "Voltar", Escape ou clique fora: antes de entrar no mapa, volta para a galeria;
    // com o mapa já aberto (legenda revista), só fecha a janela
    else if ($("exploreView").hidden) backToGallery();
    dlg.returnValue = "";
  });
  dlg.addEventListener("cancel", () => { dlg.returnValue = ""; });

  // mapa: ponteiro. Clique (ou toque) diz o país e o valor.
  canvas.addEventListener("pointerenter", (e) => { state.pointerInside = true; setFromPointer(e); });
  canvas.addEventListener("pointermove", (e) => {
    state.pointerInside = true;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    setFromPointer(events[events.length - 1] || e);
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (sweep.on || sweep.preparing) stopSweep(false);
    canvas.focus({ preventScroll: true });
    if (!engine.started) toggleAudio();
    if (e.pointerType !== "mouse") canvas.setPointerCapture(e.pointerId);
    state.pointerInside = true;
    setFromPointer(e);
  });
  canvas.addEventListener("click", () => readPlace());
  canvas.addEventListener("pointerleave", () => { state.pointerInside = false; state.readingDirty = true; });
  canvas.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") { state.pointerInside = false; state.readingDirty = true; } });
  canvas.addEventListener("focus", () => { state.keyboardActive = true; state.readingDirty = true; });
  canvas.addEventListener("blur", () => { state.keyboardActive = false; state.readingDirty = true; });

  // mapa: teclado (setas, 1 a 9 e os atalhos "mapa" do dicionário)
  canvas.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // atalhos do navegador e dos leitores de tela
    const step = SETTINGS.keyboard.step;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step * 2], ArrowDown: [0, step * 2] };
    if (arrows[e.key]) {
      e.preventDefault();
      if (sweep.on || sweep.preparing) stopSweep(false); // a pessoa retoma o controle
      const [u0, v0] = [state.u, state.v];
      moveFocal(...arrows[e.key]);
      tutorial.notify("move");
      // chegou à borda: avisa, para a pessoa não ficar apertando a seta sem sair do lugar
      if (state.u === u0 && state.v === v0 && !tutorial.isSpeaking()) announce(t(`explore.edge.${e.key}`));
      return;
    }
    if (/^[1-9]$/.test(e.key)) { e.preventDefault(); jumpToCell(Number(e.key)); return; }
    const acao = acaoDoEvento(e, "mapa");
    if (acao) {
      e.preventDefault();
      e.stopPropagation();
      runAction(acao);
    }
  });

  // sinfonia e passeios
  $("sweepButton").addEventListener("click", toggleSweep);
  $("sweepRoute").addEventListener("change", () => { if (!sweep.on && !sweep.preparing) setSweepUI("idle"); });
  $("playSymphony").addEventListener("click", () => ACTIONS.sinfonia());

  // som
  $("volumeSlider").addEventListener("input", (e) => setVolume(Number(e.target.value)));

  // celular
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
  $("copyReceiver").addEventListener("click", async () => {
    const url = receiverUrl();
    if (!url) { toast(t("phone.noLinkYet")); return; }
    try {
      await navigator.clipboard.writeText(url);
      announce(t("phone.copied"));
    } catch {
      toast(t("phone.copyFailed"));
    }
  });
  const redetect = () => { if (!$("phoneBox").hidden && haptics.peer?.id) detectAddresses(); };
  window.addEventListener("online", redetect);
  navigator.connection?.addEventListener?.("change", redetect);

  // acessibilidade
  $("voiceToggle").addEventListener("change", (e) => applyVoice(e.target.checked));
  $("tutorialVoice").addEventListener("change", (e) => applyVoice(e.target.checked));
  $("readerToggle").addEventListener("change", (e) => applyReader(e.target.checked));
  $("highContrast").addEventListener("change", (e) => { document.documentElement.classList.toggle("hc", e.target.checked); savePrefs(); });
  $("textSize").addEventListener("change", (e) => applyTextSize(e.target.value));
  $("colorMode").addEventListener("change", (e) => applyColorMode(e.target.value));

  window.addEventListener("resize", () => { if (!$("exploreView").hidden) layoutCanvas(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && engine.started && !engine.paused) { engine.pause(); updateAudioUI(); }
  });
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------
async function init() {
  applyI18n();
  setupEvents();
  if (prefs.receiver) $("receiverMode").value = prefs.receiver;
  const volume = prefs.volume ?? SETTINGS.audio.volumeDb;
  $("volumeSlider").value = volume;
  setVolume(volume);
  applyVoice(prefs.voice ?? SETTINGS.narration.onAtStart, { say: false });
  applyReader(prefs.reader ?? SETTINGS.narration.readControls, { say: false });
  const hc = prefs.hc ?? SETTINGS.a11y.highContrast ?? window.matchMedia("(prefers-contrast: more)").matches;
  $("highContrast").checked = !!hc;
  document.documentElement.classList.toggle("hc", !!hc);
  applyTextSize(prefs.text || SETTINGS.a11y.textSize);
  if (prefs.color) { $("colorMode").value = prefs.color; state.colorMode = prefs.color; }
  if (prefs.lan) $("lanInput").value = prefs.lan;

  // leitor embutido: lê cada controle que recebe o foco (js/a11y.js)
  initFocusEcho({
    enabled: () => $("readerToggle").checked && voiceOn(),
    speak: (text) => speak(text),
    skip: (el) => el.id === "tutorialTitle" || el.id === "tutorialPanel", // o tutorial fala os próprios passos
  });

  refreshTexts();
  showView("gallery");
  requestAnimationFrame(frame);
  if (CONFIG_PROBLEMS.length) toast(`config.json: ${CONFIG_PROBLEMS[0]}`, 12000);
  // primeira visita: o guia em áudio é a primeira coisa na tela (e no leitor de tela)
  if (!tutorial.seen()) tutorial.open({ gate: true });

  await Promise.all([loadLandMask(), loadCountries()]);
  if (!engine.available) toast(t("audio.noTone"), 6000);
}

init();
