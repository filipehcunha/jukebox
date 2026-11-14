// A Sinfonia da Terra · Earth Jukebox Multissensorial
// Orquestra galeria, legenda sensorial, leitura de pixels, áudio, háptica e acessibilidade.

import { SCALES, SCALE_LIST, LAYERS, LAYER_ORDER, GMAO_T0_UTC, scaleFromPixels, paletteColor } from "./scales.js";
import { MAPPING_CONFIG, SAMPLE_SET, SETTINGS, CONFIG_PROBLEMS, layerInstruments, layerVariable, VARIABLE_LABELS } from "./config.js";
import { loadLandMask, loadCountries, formatCoord } from "./geo.js";
import { ImageSampler, loadBitmap } from "./sampler.js";
import { SonificationEngine, MUSICAL_KEYS, midiName } from "./audio.js";
import { HapticBridge, renderQr, guessReceiverBase, checkPublicReceiver, PUBLIC_RECEIVER_BASE } from "./haptics.js";
import { presetGroups, upgradeGmaoSequences, groupFiles, filesFromDrop, renderPresets, renderLocalGroups } from "./gallery.js";
import { createTutorial } from "./tutorial.js";
import { narrator } from "./voz.js";
import { initFocusEcho } from "./a11y.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const canvas = $("mapCanvas");
const ctx = canvas.getContext("2d");
const scope = $("scopeCanvas");
const scopeCtx = scope.getContext("2d");

const engine = new SonificationEngine();
window.sinfonia = { engine, MAPPING_CONFIG, SAMPLE_SET, SETTINGS }; // acesso para depuração no console do navegador
const haptics = new HapticBridge({ onStatus: onPhoneStatus });
// as funções do app usadas aqui são declarações, então já existem (hoisting)
const tutorial = createTutorial({
  engine,
  isLowSensory: () => $("lowSensory").checked,
  openPractice,
  hasTimeline: () => (state.group?.frames.length ?? 0) > 1,
  focusMap: () => { canvas.focus({ preventScroll: true }); state.keyboardActive = true; state.readingDirty = true; },
  backToGallery,
  inExplore: () => !$("exploreView").hidden,
  toast,
  onClose: onTutorialClose,
});

// A VOZ TEM PRIORIDADE: enquanto qualquer narração fala (tutorial, leitura do mapa, leitura
// dos controles), a música para por completo e volta sozinha quando a fala termina.
// O comportamento (parar ou só abaixar, e as rampas) vem de config.json → narracao.
narrator.onBusyChange = (speaking) => engine.duck(speaking);

const state = {
  presets: presetGroups(),
  locals: [],
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
  announcedKey: "",
  trail: [],
  playing: false,
  loadToken: 0,
  colorMode: "none",
  pendingStart: false,
  legendHover: null, // posição 0..1 sob o mouse na barra de cores (pré-escuta da escala)
};

// ---------------------------------------------------------------------------
// Preferências
// ---------------------------------------------------------------------------
const prefs = (() => {
  try { return JSON.parse(localStorage.getItem("sinfonia-prefs") || "{}"); } catch { return {}; }
})();
// Os valores iniciais vêm do config.json. Se o arquivo foi editado desde a última visita,
// ele vence as escolhas salvas no navegador para esses mesmos itens.
const CONFIG_SIGNATURE = JSON.stringify([
  SETTINGS.audio.volumeDb, SETTINGS.audio.key, SETTINGS.audio.useSamples,
  SETTINGS.narration.onAtStart, SETTINGS.a11y.textSize, SETTINGS.a11y.highContrast,
]);
if (prefs.cfg !== CONFIG_SIGNATURE) {
  for (const k of ["volume", "key", "samples", "voice", "voiceSet", "text", "hc"]) delete prefs[k];
}
let voiceChosen = !!prefs.voiceSet; // a pessoa já ligou ou desligou a narração por conta própria
function savePrefs() {
  try {
    localStorage.setItem("sinfonia-prefs", JSON.stringify({
      low: $("lowSensory").checked, voice: $("voiceToggle").checked, voiceSet: voiceChosen, hc: $("highContrast").checked,
      color: $("colorMode").value, volume: Number($("volumeSlider").value), key: $("keySelect").value,
      samples: $("samplesToggle").checked, lan: $("lanInput").value, receiver: $("receiverMode").value,
      text: $("textSize").value, cfg: CONFIG_SIGNATURE, v: 2,
    }));
  } catch { /* armazenamento indisponível */ }
}

// ---------------------------------------------------------------------------
// Anúncios (ARIA live + voz) e toasts
// ---------------------------------------------------------------------------
let toastTimer;
function toast(msg, ms = 3800) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), ms);
  speak(msg, { queue: true }); // avisos também são falados (o leitor de tela já lê o role=alert)
}

// A narração está ligada? (interruptor do painel ou narração do tutorial)
function voiceOn() {
  return $("voiceToggle").checked || tutorial.wantsVoice();
}

// Fala com o narrador compartilhado (melhor voz pt-BR instalada, fila sem cortes).
// A música para enquanto ele fala: ver narrator.onBusyChange acima.
function speak(text, { queue = false, force = false } = {}) {
  if (!text || !(force || voiceOn())) return;
  const low = $("lowSensory").checked;
  narrator.say(text, {
    queue,
    rate: low ? SETTINGS.low.voiceRate : SETTINGS.narration.rate,
    volume: low ? SETTINGS.low.voiceVolume : SETTINGS.narration.volume,
  });
}

// Anuncia para o leitor de tela (região ARIA live) e para a narração por voz
function announce(text, { speak: toVoice = true, live: toLive = true } = {}) {
  const live = $("ariaLive");
  if (toLive) {
    live.textContent = "";
    requestAnimationFrame(() => { live.textContent = text; });
  }
  if (toVoice) speak(text);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function showView(name) {
  const gallery = name === "gallery";
  $("galleryView").hidden = !gallery;
  $("exploreView").hidden = gallery;
  document.body.dataset.view = name;
  document.title = gallery || !state.group
    ? "Galeria · A Sinfonia da Terra"
    : `${state.group.title} · A Sinfonia da Terra`;
  if (gallery) {
    stopTimeline();
    engine.update({ active: false });
    haptics.send(null, { active: false });
  }
}

function backToGallery() {
  showView("gallery");
  $("main").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
  announce(`Galeria de mapas. ${state.presets.length} mapas da NASA. Use Tab para escolher um mapa e Enter para abrir.`);
}

// ---------------------------------------------------------------------------
// Galeria
// ---------------------------------------------------------------------------
function renderGallery() {
  renderPresets($("presetGrid"), state.presets, selectGroup);
  const hasLocal = state.locals.length > 0;
  $("localSection").hidden = !hasLocal;
  if (hasLocal) {
    const total = state.locals.reduce((n, g) => n + g.frames.length, 0);
    $("localSummary").textContent = `${total} ${total === 1 ? "imagem" : "imagens"} em ${state.locals.length} ${state.locals.length === 1 ? "pasta" : "pastas"}. Clique em uma miniatura para explorar.`;
    renderLocalGroups($("localGroups"), state.locals, {
      onSelect: selectGroup,
      onScaleChange: (g, id) => { g.scaleId = id; },
    });
  }
}

function addFiles(files) {
  const groups = groupFiles(files);
  if (!groups.length) {
    toast("Nenhuma imagem JPG, PNG ou WebP encontrada.");
    return;
  }
  state.locals = [...groups, ...state.locals];
  renderGallery();
  $("localSection").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
  const total = groups.reduce((n, g) => n + g.frames.length, 0);
  announce(`${total} imagens carregadas em ${groups.length} pastas.`, { speak: false });
}

// ---------------------------------------------------------------------------
// Seleção de imagem -> Legenda sensorial -> Exploração
// ---------------------------------------------------------------------------
async function selectGroup(group, index = 0, { skipLegend = false } = {}) {
  // o clique na galeria é um gesto do usuário: libera o áudio já aqui, para que a
  // pré-escuta no hover da legenda toque sem precisar de outro clique
  if (engine.available) engine.start().then(updateAudioUI).catch(() => {});
  state.group = group;
  state.index = index;
  state.scale = group.scaleId ? SCALES[group.scaleId] : null;
  state.u = 0.5;
  state.v = 0.5;
  state.trail = [];
  state.announcedKey = "";
  const loading = loadFrame(index, { initial: true });
  if (skipLegend) {
    await loading;
    applyInstruments();
    await startExperience({ quiet: true });
    return;
  }
  if (!state.scale) await loading; // precisa detectar a escala antes de montar a legenda
  applyInstruments();
  openLegend();
  await loading;
}

// Instrumentos das camadas para a escala atual: vêm só do config.json (mapeamento e
// camadasPorEscala); a interface não os altera.
function applyInstruments() {
  engine.setLayerInstruments(layerInstruments(state.scale?.id || "default"));
  $("instMeters").innerHTML = ""; // rótulos refeitos na próxima leitura
}
const instLabel = (layer) => SAMPLE_SET[engine.layerInstrument(layer)].label;

function openLegend() {
  const scale = state.scale || SCALES.generic;
  const g = state.group;
  engine.update({ active: false });
  $("legendDialogTitle").textContent = "Legenda auditiva e sensorial";
  $("legendDialogIntro").textContent = `${g.title}: passe o mouse sobre cada instrumento, ou use Tab e Enter nos botões Ouvir, para conhecer os sons antes de explorar. ${scale.label}.`;
  $("dlgVoiceText").textContent = SETTINGS.narration.pauseMusic
    ? "Quando a narração fala, a música para por completo e volta ao fim da frase."
    : `Quando a narração fala, os instrumentos abaixam ${Math.abs(SETTINGS.narration.duckDb)} dB e voltam ao fim da frase.`;
  $("dlgScaleLabel").textContent = scale.label;
  $("dlgScaleUnit").textContent = scale.unit;
  $("dlgGradient").style.background = scale.gradientCss();
  renderTicks($("dlgTicks"), scale);
  $("dlgKey").textContent = MUSICAL_KEYS[engine.key].label.replace("Pentatônica Maior", "pentatônica maior");

  const list = $("instrumentList");
  list.innerHTML = "";
  for (const id of LAYER_ORDER) {
    const layer = LAYERS[id];
    const instId = engine.layerInstrument(id);
    const inst = SAMPLE_SET[instId];
    const variable = layerVariable(scale.id, id);
    const li = document.createElement("li");
    li.className = "instrument";
    li.style.setProperty("--inst", layer.color);
    const swatch = instrumentSwatch(scale, id);
    li.innerHTML = `
      <span class="instrument__icon" aria-hidden="true">${INSTRUMENT_ICONS[inst.icon]}</span>
      <div class="instrument__body">
        <p class="instrument__register">${layer.register} · <code title="${VARIABLE_LABELS[variable]}: definido em config.json">mapeamento.${variable}</code></p>
        <h3 class="instrument__name" id="inst-${id}">${inst.label}</h3>
        <p class="instrument__role" id="inst-${id}-role">${layer.role}</p>
        <p class="instrument__here" id="inst-${id}-here"><span class="instrument__swatch" style="background:${swatch}"></span>${scale.legend[id]}</p>
      </div>
      <div class="instrument__actions"></div>`;
    // o botão carrega o nome e a explicação: é ele que o teclado e o leitor de tela encontram
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "button button--ghost instrument__play";
    btn.setAttribute("aria-label", `Ouvir ${inst.label}, som ${layer.register.toLowerCase()}`);
    btn.setAttribute("aria-describedby", `inst-${id}-role inst-${id}-here`);
    btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor"/></svg> Ouvir`;
    li.querySelector(".instrument__actions").append(btn);

    const play = async () => {
      try {
        narrator.cancel(); // a música fica muda enquanto a voz fala: cala a voz para ouvir o instrumento
        list.querySelectorAll(".is-playing").forEach((el) => el.classList.remove("is-playing"));
        li.classList.add("is-playing");
        const secs = await engine.preview(id);
        updateAudioUI();
        clearTimeout(li._t);
        li._t = setTimeout(() => li.classList.remove("is-playing"), secs * 1000);
      } catch (err) {
        li.classList.remove("is-playing");
        toast(err.message || "Não foi possível iniciar o áudio.");
      }
    };
    const stop = () => {
      clearTimeout(li._hover);
      clearTimeout(li._t);
      li.classList.remove("is-playing");
      engine.stopPreview();
    };
    // PRÉ-ESCUTA NO HOVER: tocar ao entrar no card (pequeno atraso evita disparos ao só atravessar)
    li.addEventListener("mouseenter", () => { clearTimeout(li._hover); li._hover = setTimeout(play, 90); });
    li.addEventListener("mouseleave", stop);
    btn.addEventListener("click", play);
    list.append(li);
  }

  const dlg = $("legendDialog");
  if (!dlg.open) dlg.showModal();
  $("legendDialogTitle").focus();
}

// gradiente com as cores da escala onde a camada domina (ou um ícone de brilho/borda)
function instrumentSwatch(scale, id) {
  const stops = [];
  for (let i = 0; i <= 60; i += 1) {
    const pos = i / 60;
    const value = scale.id === "generic" ? pos * 100 : scale.valueAtPos(pos);
    const w = scale.roles({ value, norm: pos, bright: 0.45, peak: 0.1, grad: 0, texture: 0 })[id];
    if (w >= 0.5) stops.push(scale.colorAtPos(pos));
  }
  if (stops.length >= 2) {
    const pick = stops.filter((_, i) => i % Math.ceil(stops.length / 8) === 0);
    return `linear-gradient(90deg, ${pick.join(", ")})`;
  }
  return id === "arp"
    ? "repeating-linear-gradient(90deg, #fff 0 3px, #222 3px 7px)"
    : "linear-gradient(90deg, #333, #fff)";
}

const INSTRUMENT_ICONS = {
  bowed: `<svg viewBox="0 0 48 48"><path d="M24 4v10M20 6h8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M24 14c-5 0-8 3-7 8 .6 2.6-3 3.5-3 9 0 6.5 4.5 11 10 11s10-4.5 10-11c0-5.5-3.6-6.4-3-9 1-5-2-8-7-8Z" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M21 27c1 1 5 1 6 0M21 33c1-1 5-1 6 0" stroke="currentColor" stroke-width="2"/><path d="M24 14v28" stroke="currentColor" stroke-width="1.6"/></svg>`,
  keys: `<svg viewBox="0 0 48 48"><rect x="5" y="12" width="38" height="26" rx="3" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12.5 12v26M20 12v26M27.5 12v26M35 12v26" stroke="currentColor" stroke-width="1.8"/><path d="M10 12h5v14h-5zM17.5 12h5v14h-5zM32.5 12h5v14h-5z" fill="currentColor"/></svg>`,
  wind: `<svg viewBox="0 0 48 48"><path d="M8 38 40 8" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="18" cy="28" r="1.8" fill="var(--bg-deep, #000)"/><circle cx="23" cy="23" r="1.8" fill="var(--bg-deep, #000)"/><circle cx="28" cy="18" r="1.8" fill="var(--bg-deep, #000)"/><path d="M36 30c3 1 5 3 6 6M33 35c2 .5 3.5 2 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`,
  harp: `<svg viewBox="0 0 48 48"><path d="M12 42V8c10 0 14 6 18 12s8 8 8 8l-26 14Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M17 13v26M22 15v21M27 19v15M32 25v6" stroke="currentColor" stroke-width="1.6"/></svg>`,
  mallet: `<svg viewBox="0 0 48 48"><path d="M6 30h36" stroke="currentColor" stroke-width="2"/><rect x="7" y="18" width="5" height="16" rx="1.5" fill="currentColor"/><rect x="14" y="19" width="5" height="14" rx="1.5" fill="currentColor"/><rect x="21" y="20" width="5" height="12" rx="1.5" fill="currentColor"/><rect x="28" y="21" width="5" height="10" rx="1.5" fill="currentColor"/><rect x="35" y="22" width="5" height="8" rx="1.5" fill="currentColor"/><path d="M14 6l8 10M34 6l-6 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="23" cy="17" r="2.6" fill="currentColor"/><circle cx="27.5" cy="18" r="2.6" fill="currentColor"/></svg>`,
  pad: `<svg viewBox="0 0 48 48"><rect x="5" y="10" width="38" height="28" rx="4" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M10 26c3-8 6-8 9 0s6 8 9 0 6-8 9 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
};

async function startExperience({ quiet = false } = {}) {
  showView("explore");
  try {
    await engine.start();
    engine.resume();
  } catch (err) {
    toast(err.message || "Áudio indisponível neste navegador.");
  }
  updateAudioUI();
  canvas.focus({ preventScroll: true });
  state.keyboardActive = true;
  state.readingDirty = true;
  layoutCanvas();
  if (!quiet) {
    announce(`Mapa aberto: ${state.group.title}. Use as setas para explorar. Aperte H para ouvir os atalhos.`);
    if (state.reading) { state.announcedKey = ""; state.lastMove = performance.now(); } // a leitura do lugar vem em seguida
  }
}

// Tutorial: abre o mapa de temperatura direto (a legenda é ensinada pelo próprio tutorial)
async function openPractice() {
  const group = state.presets.find((g) => g.id === "gmao-temp") || state.presets[0];
  await selectGroup(group, group.startIndex ?? 0, { skipLegend: true });
  canvas.scrollIntoView({ block: "center", behavior: reducedMotion.matches ? "auto" : "smooth" });
}

// ---------------------------------------------------------------------------
// Carregamento de quadros
// ---------------------------------------------------------------------------
const frameCache = new Map(); // src(string) -> Promise<bitmap> (pré-busca da linha do tempo)
function fetchBitmap(src) {
  if (typeof src !== "string") return loadBitmap(src);
  if (!frameCache.has(src)) {
    frameCache.set(src, loadBitmap(src).catch((e) => { frameCache.delete(src); throw e; }));
    if (frameCache.size > 8) frameCache.delete(frameCache.keys().next().value);
  }
  return frameCache.get(src);
}

async function loadFrame(index, { initial = false } = {}) {
  const g = state.group;
  if (!g) return;
  const token = ++state.loadToken;
  const frame = g.frames[index];
  if (initial || !state.playing) $("loadingVeil").hidden = false;
  try {
    const bmp = await fetchBitmap(frame.src);
    if (token !== state.loadToken) return;
    const sampler = new ImageSampler(bmp);
    state.sampler = sampler;
    state.index = index;
    if (!state.scale) {
      const id = scaleFromPixels(sampler.imageData);
      state.scale = SCALES[id];
      g.scaleId = id;
      if (id === "generic") toast("Escala não reconhecida: usando o matiz da cor (azul = frio, vermelho = quente). Você pode trocar a escala acima do mapa.", 6000);
    }
    state.projection = g.projection || (Math.abs(sampler.width / sampler.height - 2) < 0.05 ? { type: "equirectangular" } : { type: "none" });
    if (initial) setupExplorerFor(g);
    rebuildBase();
    updateTimelineUI();
    state.readingDirty = true;
    // pré-busca dos próximos quadros
    if (g.frames.length > 1) {
      for (let k = 1; k <= 3; k += 1) {
        const nf = g.frames[(index + k) % g.frames.length];
        if (typeof nf.src === "string") fetchBitmap(nf.src).catch(() => {});
      }
    }
  } catch (err) {
    console.error(err);
    toast(`Não foi possível abrir ${frame.name}.`);
  } finally {
    if (token === state.loadToken) $("loadingVeil").hidden = true;
  }
}

function setupExplorerFor(g) {
  const scale = state.scale;
  $("exploreKicker").textContent = g.source;
  $("exploreHeading").textContent = g.title;
  $("scaleSelect").value = scale.id;
  updateLegendBar();
  $("timeline").hidden = g.frames.length < 2;
  const slider = $("frameSlider");
  slider.max = String(g.frames.length - 1);
  canvas.setAttribute(
    "aria-label",
    `Mapa sonoro de ${g.title}, ${scale.label}. Setas movem o cursor, Enter lê o lugar, O dá a visão geral e H abre a ajuda`
  );
  layoutCanvas();
}

function updateLegendBar() {
  const s = state.scale;
  $("legendTitle").textContent = s.label;
  $("legendUnit").textContent = s.unit;
  const pal = ["cividis", "viridis", "gray"].includes(state.colorMode) ? state.colorMode : null;
  $("legendGradient").style.background = pal
    ? `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => `rgb(${paletteColor(pal, t).join(" ")})`).join(", ")})`
    : s.gradientCss();
  renderTicks($("legendTicks"), s);
  $("legendEnds").innerHTML = s.ends.map((e) => `<span>${e}</span>`).join("");
  $("readValueLabel").textContent = s.short;
}

function renderTicks(el, scale) {
  el.innerHTML = scale.ticks
    .map((t) => `<span style="left:${(t.pos * 100).toFixed(2)}%">${String(t.value).replace("-", "−")}</span>`)
    .join("");
}

// ---------------------------------------------------------------------------
// Barra de cores tocável: passar o mouse (ou usar as setas) toca o valor daquela posição
// com os mesmos instrumentos, notas e vibração que um pixel dessa cor no mapa
// ---------------------------------------------------------------------------
function legendReading(scale, pos) {
  const value = scale.id === "generic" ? pos * 100 : scale.valueAtPos(pos);
  const r = { valid: true, value, norm: pos, bright: 0.55, peak: 0.12, grad: 0, texture: 0, u: pos };
  r.weights = scale.roles(r);
  r.valueText = scale.format(value);
  r.zone = scale.zoneOf(value);
  const m = scale.colorAtPos(pos).match(/[\d.]+/g);
  r.rgb = m && !scale.colorAtPos(pos).startsWith("hsl") ? m.slice(0, 3).map(Number) : [255, 255, 255];
  return r;
}

function scaleSentence(r) {
  const inst = activeInstruments(r);
  return `${state.scale?.sentence(r.valueText) || r.valueText}, ${r.zone.label.toLowerCase()}${inst.length ? `: ${joinPt(inst)}` : ""}.`;
}

async function playScaleAt(pos) {
  const scale = state.scale || SCALES.generic;
  state.legendHover = clamp(pos);
  if (!engine.started) {
    try { await engine.start(); updateAudioUI(); } catch (err) { toast(err.message || "Áudio indisponível."); return null; }
  }
  if (state.legendHover === null) return null;
  const r = legendReading(scale, state.legendHover);
  engine.stopPreview();
  engine.update({ active: true, pan: state.legendHover * 2 - 1, norm: state.legendHover, weights: r.weights, bright: r.bright, grad: 0 });
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
  track.setAttribute("aria-label", "Escala de cores tocável: passe o mouse ou use as setas para ouvir cada valor");
  let raf = 0;
  let pending = null;
  let kbPos = 0.5;
  const show = (pos) => {
    const scale = state.scale || SCALES.generic;
    const r = legendReading(scale, pos);
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
  const move = (e) => {
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
    if (track.id === "dlgTrack") marker.hidden = true;
    stopScale();
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
    const step = e.shiftKey ? 0.1 : 0.025;
    const keys = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, Home: -1, End: 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    kbPos = clamp(kbPos + keys[e.key]);
    show(kbPos);
    const r = await playScaleAt(kbPos);
    if (r) announce(scaleSentence(r), { speak: true, live: false }); // o leitor de tela já lê o aria-valuetext
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
  const fmt = (tz) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
  return `${fmt("UTC")} UTC · ${fmt("America/Sao_Paulo").split(", ").pop()} em Brasília`;
}

function updateTimelineUI() {
  const g = state.group;
  if (!g) return;
  const f = g.frames[state.index];
  $("frameSlider").value = String(state.index);
  $("frameSlider").setAttribute("aria-valuetext", `${state.index + 1} de ${g.frames.length}, ${frameTimeText(f)}`);
  $("frameLabel").textContent = `${f.name} · ${state.index + 1}/${g.frames.length}`;
  $("frameTime").textContent = frameTimeText(f);
}

let playTimer = null;
function startTimeline() {
  const g = state.group;
  if (!g || g.frames.length < 2) return;
  state.playing = true;
  $("playTimeline").setAttribute("aria-pressed", "true");
  $("playTimeline").setAttribute("aria-label", "Pausar linha do tempo");
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
    announce("Este mapa tem uma imagem só, sem linha do tempo.");
    return;
  }
  if (state.playing) {
    stopTimeline();
    announce(`Linha do tempo pausada em ${frameTimeText(state.group.frames[state.index])}.`);
  } else {
    announce(`Linha do tempo tocando, ${$("speedSelect").value} horas por segundo. Aperte P para pausar.`);
    startTimeline();
  }
}
function stopTimeline() {
  state.playing = false;
  clearTimeout(playTimer);
  $("playTimeline").setAttribute("aria-pressed", "false");
  $("playTimeline").setAttribute("aria-label", "Reproduzir linha do tempo");
}
function stepFrame(delta) {
  const g = state.group;
  if (!g) return;
  if (g.frames.length < 2) {
    announce("Este mapa tem uma imagem só, sem outras horas.");
    return;
  }
  stopTimeline();
  loadFrame((state.index + delta + g.frames.length) % g.frames.length).then(() => {
    announce(frameTimeText(g.frames[state.index]), { speak: true });
    tutorial.notify("frame");
  });
}

// ---------------------------------------------------------------------------
// Leitura e sonificação
// ---------------------------------------------------------------------------
function isActive() {
  return !$("exploreView").hidden && (state.pointerInside || state.keyboardActive) && !$("legendDialog").open && !$("helpDialog").open;
}

function computeReading() {
  const { sampler, scale } = state;
  if (!sampler || !scale) return null;
  const r = sampler.read(state.u, state.v, scale, state.projection);
  if (r.valid) {
    r.weights = scale.roles(r);
    r.valueText = scale.format(r.value);
  } else {
    r.weights = { low: 0, mid: 0, high: 0, arp: 0 };
    r.valueText = "sem dado";
  }
  return r;
}

function activeInstruments(r) {
  return [...new Set(LAYER_ORDER.filter((id) => (r.weights?.[id] ?? 0) >= 0.25)
    .sort((a, b) => r.weights[b] - r.weights[a])
    .map(instLabel))];
}

function joinPt(list) {
  if (list.length <= 1) return list[0] || "";
  return `${list.slice(0, -1).join(", ")} e ${list[list.length - 1]}`;
}

function readingSentence(r) {
  const place = r.region?.name || state.group?.title || "Imagem";
  if (!r.valid) return `${place}: sem dados. ${r.reason}.`;
  const inst = activeInstruments(r);
  const instText = inst.length ? joinPt(inst) : "silêncio suave";
  return `${place}: ${instText}. ${state.scale.sentence(r.valueText)}, ${r.zone.label.toLowerCase()}.`;
}

function announceReading(force = false) {
  const r = state.reading;
  if (!r) return;
  const key = r.valid ? `${r.region?.name}|${r.zone?.index}|${Math.round(r.norm * 40)}` : `x|${r.reason}`;
  if (!force && key === state.announcedKey) return;
  state.announcedKey = key;
  announce(readingSentence(r));
}

// ---------------------------------------------------------------------------
// Exploração sem ver o mapa: visão geral, posição e saltos entre regiões
// ---------------------------------------------------------------------------
function placeWords(u, v) {
  const vert = v < 1 / 3 ? "em cima" : v > 2 / 3 ? "embaixo" : "";
  const horiz = u < 1 / 3 ? "à esquerda" : u > 2 / 3 ? "à direita" : "";
  if (!vert && !horiz) return "no centro do mapa";
  return [vert || "a meia altura", horiz || "no centro"].join(", ");
}

// Tecla O: percorre o mapa numa grade e diz onde estão os valores mais alto e mais baixo
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
    announce(`Visão geral de ${group.title}: não encontrei dados legíveis nesta imagem.`);
    return;
  }
  const where = (r) => {
    const reg = r.region;
    const prefix = reg?.country ? `${reg.country}, ` : reg?.name ? `na região ${reg.name}, ` : "";
    return `${prefix}${placeWords(r.u, r.v)}`;
  };
}

// Tecla C: onde o cursor está
function announcePosition() {
  const r = state.reading;
  const place = r?.region?.name || state.group?.title || "Imagem";
  const coord = r?.geo ? `${formatCoord(r.geo.lat, r.geo.lon)}. ` : "";
  announce(`${place}. ${coord}Cursor ${placeWords(state.u, state.v)}: ${Math.round(state.u * 100)}% da largura e ${Math.round(state.v * 100)}% da altura do mapa.`);
}

// Teclas 1 a 9: nove regiões, como um teclado de telefone (1 = em cima à esquerda)
function jumpToCell(n) {
  state.u = ((n - 1) % 3 + 0.5) / 3;
  state.v = (Math.floor((n - 1) / 3) + 0.5) / 3;
  moveFocal(0, 0);
  processReading();
  announceReading(true);
}

function changeVolume(delta) {
  const slider = $("volumeSlider");
  const db = clamp(Number(slider.value) + delta, Number(slider.min), Number(slider.max));
  slider.value = String(db);
  setVolume(db);
  announce(`Volume ${db} decibéis.`);
}

function setVolume(db) {
  $("volumeOut").textContent = `${db} dB`;
  $("volumeSlider").setAttribute("aria-valuetext", `${db} decibéis`);
  engine.setVolume(db);
  savePrefs();
}

function processReading() {
  const r = computeReading();
  if (!r) return;
  const prev = state.reading;
  state.reading = r;
  const active = isActive();
  tutorial.notify("reading", r);
  // a barra de cores (pré-escuta da escala) e a legenda aberta têm prioridade sobre o mapa
  if (state.legendHover !== null || $("legendDialog").open) {
    updateReadingUI(r, prev);
    return;
  }
  // durante uma demonstração sonora do tutorial, o motor fica com ela
  if (!tutorial.isDemoPlaying()) engine.update({
    active: active && r.valid,
    pan: state.u * 2 - 1,
    norm: r.valid ? r.norm : 0.5,
    weights: r.weights,
    bright: r.bright ?? 0.5,
    grad: r.grad ?? 0,
  });
  haptics.send(r, { active });
  updateReadingUI(r, prev);
}

function updateReadingUI(r) {
  $("readRegion").textContent = r.region?.name || (state.projection?.type === "none" ? "Imagem livre" : "—");
  $("readCoord").textContent = r.geo ? formatCoord(r.geo.lat, r.geo.lon) : `x ${(r.u * 100).toFixed(0)}% · y ${(r.v * 100).toFixed(0)}%`;
  $("readValue").textContent = r.valid ? r.valueText : "Sem dado";
  $("readZone").textContent = r.valid ? r.zone.label : r.reason;
  // nota da camada dominante (grave, médio, agudo ou arpejo)
  const dom = LAYER_ORDER.reduce((a, b) => ((r.weights[b] ?? 0) > (r.weights[a] ?? 0) ? b : a));
  const domOn = r.valid && (r.weights[dom] ?? 0) > 0.05;
  $("readNote").textContent = domOn ? midiName(engine.noteFor(dom, r.norm)) : "—";
  const pan = state.u * 2 - 1;
  const side = Math.abs(pan) < 0.12 ? "centro" : pan < 0 ? `esquerda ${Math.round(-pan * 100)}%` : `direita ${Math.round(pan * 100)}%`;
  $("readPan").textContent = domOn ? `${instLabel(dom)} · ${side}` : side;
  if (state.legendHover === null) {
    const marker = $("legendMarker");
    marker.hidden = !r.valid;
    if (r.valid) marker.style.left = `${(r.norm * 100).toFixed(2)}%`;
  }
  const meters = $("instMeters");
  if (!meters.children.length) {
    meters.innerHTML = LAYER_ORDER.map(
      (id) => `<li style="--inst:${LAYERS[id].color}"><span>${instLabel(id)}</span><i><b id="m-${id}"></b></i></li>`
    ).join("");
  }
  for (const id of LAYER_ORDER) {
    $(`m-${id}`).style.transform = `scaleX(${(r.weights[id] ?? 0).toFixed(3)})`;
  }
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
  const pulse = reducedMotion.matches || $("lowSensory").checked ? 0 : Math.sin(time / 380) * 2;
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
    const label = r.valid ? `${r.valueText} · ${r.region?.name || r.zone.label}` : "sem dado";
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

function drawScope() {
  const w = scope.width;
  const h = scope.height;
  scopeCtx.clearRect(0, 0, w, h);
  const data = engine.getWaveform();
  const color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#67e8f9";
  scopeCtx.strokeStyle = color;
  scopeCtx.lineWidth = 2;
  scopeCtx.beginPath();
  if (!data || engine.paused) {
    scopeCtx.moveTo(0, h / 2);
    scopeCtx.lineTo(w, h / 2);
  } else {
    for (let i = 0; i < data.length; i += 1) {
      const px = (i / (data.length - 1)) * w;
      const py = h / 2 - clamp(data[i] * 2.2, -1, 1) * (h / 2 - 4);
      if (i) scopeCtx.lineTo(px, py);
      else scopeCtx.moveTo(px, py);
    }
  }
  scopeCtx.stroke();
}

let lastReadingTime = 0;
function frame(time) {
  if (!$("exploreView").hidden) {
    if (state.readingDirty || time - lastReadingTime > 250) {
      state.readingDirty = false;
      lastReadingTime = time;
      processReading();
    }
    draw(time);
    drawScope();
    // anuncia quando o cursor para (config.json → narracao.esperaParadoMs),
    // sem interromper o que a voz ainda está falando
    if (isActive() && performance.now() - state.lastMove > SETTINGS.narration.restMs && state.lastMove && !narrator.busy()) announceReading();
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
  $("audioToggleLabel").textContent = on ? "Pausar áudio" : engine.started ? "Retomar áudio" : "Ativar áudio";
  $("liveText").textContent = on ? "Som ao vivo" : engine.started ? "Áudio pausado" : "Áudio desligado";
  $("livePill").classList.toggle("is-live", on);
  $("audioDot").classList.toggle("is-on", on);
  $("audioStatus").textContent = !engine.available
    ? "Tone.js não carregou: verifique a conexão com a internet."
    : on ? `Tocando · ${MUSICAL_KEYS[engine.key].label}${engine.low ? " · baixa sensibilidade" : ""}` : engine.started ? "Áudio pausado" : "Áudio aguardando ativação";
}

async function toggleAudio() {
  try {
    if (!engine.started) await engine.start();
    else if (engine.paused) engine.resume();
    else engine.pause();
  } catch (err) {
    toast(err.message || "Não foi possível iniciar o áudio.");
  }
  updateAudioUI();
  state.readingDirty = true;
  // só voz: o leitor de tela já recebe a mudança pelo status do painel de áudio
  if (engine.started) announce(engine.paused ? "Som pausado." : "Som ligado.", { live: false });
}

engine.onSamplesState = (s, labels = []) => {
  const el = $("samplesState");
  const list = labels.join(", ");
  el.textContent = {
    loading: "Carregando amostras gravadas… (sintetizador enquanto isso)",
    ready: `Amostras gravadas prontas: ${list}`,
    partial: `Parte das amostras carregou: ${list}`,
    failed: "Sem acesso às amostras: usando instrumentos sintetizados",
    none: `Instrumentos sintetizados: ${list}`,
  }[s] || el.textContent;
};

// ---------------------------------------------------------------------------
// Smartphone
// ---------------------------------------------------------------------------
function onPhoneStatus(kind, info) {
  const st = $("phoneStatus");
  const dot = $("phoneDot");
  dot.className = "status-dot";
  if (kind === "waiting") { st.textContent = "Aguardando o celular escanear o QR Code…"; dot.classList.add("is-wait"); }
  if (kind === "connected") { st.textContent = `Smartphone conectado ✓ · mova o mouse sobre o mapa`; dot.classList.add("is-on"); announce("Smartphone conectado para vibração."); }
  if (kind === "caps" && info && info.vibrate === false) toast("O celular conectado não suporta vibração (ex.: iPhone). Ele mostrará pulsos visuais.", 6000);
  if (kind === "reconnecting") st.textContent = "Reconectando ao serviço de sinalização…";
  if (kind === "error") { st.textContent = `Erro na conexão WebRTC (${info}).`; dot.classList.add("is-err"); }
  if (kind === "closed") st.textContent = "Desconectado.";
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
    warn.textContent = "Não encontrei o endereço deste computador na rede. Digite o IP (ex.: 192.168.0.10:8000) ou rode python3 servidor.py, que detecta sozinho.";
    return;
  }
  const host = new URL(url).hostname;
  const internal = mode === "lan" && /^(localhost|127\.|\[::1\])/.test(host);
  warn.hidden = !(internal || (mode === "lan" && lanWarning));
  warn.textContent = internal ? "Esse endereço é interno deste computador e o celular não vai alcançá-lo." : lanWarning || "";
  renderQr($("qrBox"), url);
  $("qrUrl").textContent = url;
  $("receiverLink").href = url;
}

let lanWarning = null;
// Detecta (de novo) os endereços: chamado ao gerar o QR e quando a rede muda
async function detectAddresses() {
  const [info, pub] = await Promise.all([guessReceiverBase(), checkPublicReceiver()]);
  lanWarning = info.warning || null;
  const pubOpt = $("receiverMode").querySelector('option[value="public"]');
  pubOpt.disabled = !pub;
  pubOpt.textContent = pub ? "Internet: GitHub Pages (HTTPS)" : "Internet: GitHub Pages (não publicado)";
  if (!pub && $("receiverMode").value === "public") $("receiverMode").value = "lan";

  const sel = $("lanSelect");
  const prevValue = sel.value;
  sel.innerHTML =
    info.candidates.map((c) => `<option value="${c.url}">${c.label}</option>`).join("") +
    `<option value="__manual">Digitar outro endereço…</option>`;
  const keep = [...sel.options].some((o) => o.value === prevValue) && prevValue !== "__manual";
  sel.value = keep ? prevValue : info.candidates.length ? info.candidates[0].url : "__manual";
  if (!info.candidates.length && pub) $("receiverMode").value = "public";
  $("lanHelp").textContent = info.fromServer
    ? `Detectado automaticamente pelo servidor.py${info.candidates.length > 1 ? ". Há mais de uma rede: escolha a mesma do celular" : ""}.`
    : !info.local
      ? "É o endereço desta página, que o celular também consegue abrir."
      : info.candidates.length
        ? "Detectado pelo navegador. Se o celular não abrir, rode python3 servidor.py ou digite o IP."
        : "Não deu para detectar o IP neste navegador. Rode python3 servidor.py ou digite o IP local do computador.";
  refreshQr();
}

async function connectPhone() {
  $("phoneBox").hidden = false;
  $("phoneStatus").textContent = "Conectando ao servidor de sinalização PeerJS…";
  try {
    if (prefs.lan && !$("lanInput").value) $("lanInput").value = prefs.lan;
    await haptics.open();
    haptics.setLowSensory($("lowSensory").checked);
    await detectAddresses();
    $("phoneConnectLabel").textContent = "Gerar novo QR Code";
  } catch (err) {
    $("phoneStatus").textContent = `Não foi possível falar com o servidor PeerJS (${err?.type || err?.message || err}). Este computador está com internet? Alguma extensão/antivírus bloqueia 0.peerjs.com?`;
  }
}

// ---------------------------------------------------------------------------
// Acessibilidade
// ---------------------------------------------------------------------------
function applyLowSensory(on) {
  $("lowSensory").checked = on;
  $("quickLowSensory").setAttribute("aria-pressed", String(on));
  document.documentElement.classList.toggle("low-sensory", on);
  engine.setLowSensory(on);
  haptics.setLowSensory(on);
  updateAudioUI();
  savePrefs();
}

// Narração por voz: lê os controles ao navegar e os lugares no mapa
function applyVoice(on) {
  $("voiceToggle").checked = on;
  voiceChosen = true;
  savePrefs();
  if (on) announce("Narração por voz ligada. A música para enquanto eu falo. Aperte F1 para ouvir os atalhos.");
  else {
    narrator.cancel();
    announce("Narração por voz desligada.", { speak: false });
    speak("Narração por voz desligada.", { force: true });
  }
}

// Ao sair do tutorial feito com narração, a voz continua ligada no resto do site:
// quem não enxerga a tela não fica sem guia. Não muda nada se a pessoa já escolheu antes.
function onTutorialClose({ started, voice }) {
  if (!started || !voice || voiceChosen || $("voiceToggle").checked) return;
  $("voiceToggle").checked = true;
  savePrefs();
  speak("A narração por voz continua ligada. Para desligar, aperte Alt, Shift e N. Para ouvir os atalhos, aperte F1.", { queue: true });
}

// Tamanho do texto (baixa visão)
const CURSOR_SCALE = { normal: 1, grande: 1.35, enorme: 1.7 };
function applyTextSize(size) {
  if (!(size in CURSOR_SCALE)) size = "normal";
  $("textSize").value = size;
  document.documentElement.classList.toggle("text-grande", size === "grande");
  document.documentElement.classList.toggle("text-enorme", size === "enorme");
  if (!$("exploreView").hidden) layoutCanvas();
  savePrefs();
}

// ---------------------------------------------------------------------------
// Ajuda e atalhos
// ---------------------------------------------------------------------------
function openHelp() {
  const dlg = $("helpDialog");
  if (!dlg.open) dlg.showModal();
  $("helpTitle").focus();
}

// texto da ajuda para a voz: nomes de teclas que a síntese não lê bem viram palavras
function helpSpeech() {
  const clone = $("helpBody").cloneNode(true);
  const names = { "[": "abre colchete", "]": "fecha colchete", "+": "mais", "-": "menos" };
  clone.querySelectorAll("kbd").forEach((k) => { k.textContent = names[k.textContent] || k.textContent; });
  return [...clone.querySelectorAll("h3, p, li")]
    .map((el) => el.textContent.replace(/\s+/g, " ").replace(/ \+ /g, " mais ").trim())
    .map((t) => (/[.!?:]$/.test(t) ? t : `${t}.`))
    .join(" ");
}

function focusMapShortcut() {
  if ($("exploreView").hidden) {
    announce("Nenhum mapa aberto. Escolha um mapa na galeria.");
    return;
  }
  for (const id of ["helpDialog", "legendDialog"]) if ($(id).open) $(id).close();
  canvas.focus({ preventScroll: true });
  canvas.scrollIntoView({ block: "center", behavior: "auto" });
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
// Eventos
// ---------------------------------------------------------------------------
function setupEvents() {
  $("folderInput").addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
  $("filesInput").addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
  const dz = $("dropzone");
  ["dragenter", "dragover"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add("is-drag"); }));
  ["dragleave", "drop"].forEach((t) => dz.addEventListener(t, () => dz.classList.remove("is-drag")));
  dz.addEventListener("drop", async (e) => {
    e.preventDefault();
    addFiles(await filesFromDrop(e.dataTransfer));
  });

  $("brandLink").addEventListener("click", (e) => { e.preventDefault(); backToGallery(); });
  $("backButton").addEventListener("click", backToGallery);
  $("audioToggle").addEventListener("click", toggleAudio);
  $("quickLowSensory").addEventListener("click", () => applyLowSensory(!$("lowSensory").checked));
  $("reviewLegend").addEventListener("click", openLegend);
  attachScaleHover($("legendTrack"), $("legendMarker"), $("legendTip"));
  attachScaleHover($("dlgTrack"), $("dlgMarker"), $("dlgTip"));
  $("tutorialOpen").addEventListener("click", () => tutorial.open());
  $("tutorialSkipLink").addEventListener("click", (e) => { e.preventDefault(); tutorial.open(); });

  // ajuda e atalhos
  $("helpOpen").addEventListener("click", openHelp);
  $("helpOpenPanel").addEventListener("click", openHelp);
  $("helpSkipLink").addEventListener("click", (e) => { e.preventDefault(); openHelp(); });
  $("helpClose").addEventListener("click", () => $("helpDialog").close());
  $("helpDialog").addEventListener("close", () => narrator.cancel());
  $("helpSpeak").addEventListener("click", () => speak(helpSpeech(), { force: true }));

  // atalhos que valem na página toda (sempre com modificador, para não atrapalhar quem digita
  // nem as teclas de navegação dos leitores de tela)
  document.addEventListener("keydown", (e) => {
    if (e.key === "F1") { e.preventDefault(); openHelp(); return; }
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const actions = {
        KeyH: openHelp,
        KeyN: () => applyVoice(!$("voiceToggle").checked),
        KeyM: focusMapShortcut,
        KeyG: () => { for (const id of ["helpDialog", "legendDialog"]) if ($(id).open) $(id).close(); backToGallery(); },
        KeyT: () => tutorial.open(),
      };
      if (actions[e.code]) { e.preventDefault(); actions[e.code](); }
      return;
    }
    // Escape cala a voz (o tutorial trata o próprio Escape)
    if (e.key === "Escape" && narrator.busy() && !tutorial.isActive()) narrator.cancel();
  });

  // diálogo da legenda
  const dlg = $("legendDialog");
  dlg.addEventListener("close", () => {
    if (dlg.returnValue === "start") startExperience();
    else if (dlg.returnValue === "back" || dlg.returnValue === "") {
      if ($("exploreView").hidden) backToGallery();
    }
    dlg.returnValue = "";
  });
  dlg.addEventListener("cancel", () => { dlg.returnValue = ""; });

  // escala manual
  $("scaleSelect").innerHTML = SCALE_LIST.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
  $("scaleSelect").addEventListener("change", (e) => {
    state.scale = SCALES[e.target.value];
    if (state.group) state.group.scaleId = state.scale.id;
    applyInstruments();
    updateLegendBar();
    rebuildBase();
    state.readingDirty = true;
    announce(`Escala alterada para ${state.scale.label}.`, { speak: false });
  });

  // canvas: ponteiro
  canvas.addEventListener("pointerenter", (e) => { state.pointerInside = true; setFromPointer(e); });
  canvas.addEventListener("pointermove", (e) => {
    state.pointerInside = true;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    setFromPointer(events[events.length - 1] || e);
  });
  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus({ preventScroll: true });
    if (!engine.started) toggleAudio();
    if (e.pointerType !== "mouse") canvas.setPointerCapture(e.pointerId);
    state.pointerInside = true;
    setFromPointer(e);
  });
  canvas.addEventListener("pointerleave", () => { state.pointerInside = false; state.readingDirty = true; });
  canvas.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") { state.pointerInside = false; state.readingDirty = true; } });
  canvas.addEventListener("focus", () => { state.keyboardActive = true; state.readingDirty = true; });
  canvas.addEventListener("blur", () => { state.keyboardActive = false; state.readingDirty = true; });

  // canvas: teclado
  canvas.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // atalhos globais e do navegador
    const big = e.shiftKey ? SETTINGS.keyboard.bigStep : SETTINGS.keyboard.step;
    const map = { ArrowLeft: [-big, 0], ArrowRight: [big, 0], ArrowUp: [0, -big * 2], ArrowDown: [0, big * 2] };
    if (map[e.key]) {
      e.preventDefault();
      const [u0, v0] = [state.u, state.v];
      moveFocal(...map[e.key]);
      tutorial.notify("move");
      // chegou à borda: avisa, para a pessoa não ficar apertando a seta sem sair do lugar
      if (state.u === u0 && state.v === v0 && !tutorial.isSpeaking()) {
        const edge = { ArrowLeft: "esquerda", ArrowRight: "direita", ArrowUp: "de cima", ArrowDown: "de baixo" }[e.key];
        announce(`Borda ${edge} do mapa.`);
      }
      return;
    }
    if (/^[1-9]$/.test(e.key)) { e.preventDefault(); jumpToCell(Number(e.key)); return; }
    switch (e.key) {
      case " ": e.preventDefault(); toggleAudio(); break;
      case "Enter": e.preventDefault(); state.readingDirty = true; processReading(); announceReading(true); tutorial.notify("announce"); break;
      case "Home": e.preventDefault(); state.u = 0.5; state.v = 0.5; moveFocal(0, 0); tutorial.notify("home"); break;
      case "[": e.preventDefault(); stepFrame(-1); break;
      case "]": e.preventDefault(); stepFrame(1); break;
      case "+": case "=": e.preventDefault(); changeVolume(2); break;
      case "-": case "_": e.preventDefault(); changeVolume(-2); break;
      case "p": case "P": e.preventDefault(); toggleTimeline(); break;
      case "l": case "L": e.preventDefault(); openLegend(); break;
      case "t": case "T": e.preventDefault(); tutorial.open(); break;
      case "o": case "O": e.preventDefault(); mapOverview(); break;
      case "c": case "C": e.preventDefault(); processReading(); announcePosition(); break;
      case "n": case "N": e.preventDefault(); applyVoice(!$("voiceToggle").checked); break;
      case "g": case "G": e.preventDefault(); backToGallery(); break;
      case "h": case "H": case "?": e.preventDefault(); openHelp(); break;
      default:
    }
  });

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
  $("keySelect").addEventListener("change", (e) => { engine.setKey(e.target.value); updateAudioUI(); savePrefs(); });
  $("samplesToggle").addEventListener("change", (e) => { engine.setUseSamples(e.target.checked); savePrefs(); });

  // smartphone
  $("phoneConnect").addEventListener("click", connectPhone);
  $("phoneDisconnect").addEventListener("click", () => {
    haptics.close();
    $("phoneBox").hidden = true;
    $("phoneConnectLabel").textContent = "Gerar QR Code";
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
    if (!url) { toast("Ainda não há link: o endereço deste computador não foi encontrado."); return; }
    try {
      await navigator.clipboard.writeText(url);
      announce("Link do receptor copiado. Envie para o celular e abra no navegador.");
    } catch {
      toast("Não foi possível copiar. O link está escrito logo acima deste botão.");
    }
  });
  // rede mudou (outro Wi-Fi, cabo, VPN): refaz a detecção se o painel estiver aberto
  const redetect = () => { if (!$("phoneBox").hidden && haptics.peer?.id) detectAddresses(); };
  window.addEventListener("online", redetect);
  navigator.connection?.addEventListener?.("change", redetect);

  // acessibilidade
  $("lowSensory").addEventListener("change", (e) => applyLowSensory(e.target.checked));
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
  setupEvents();
  // valores iniciais: config.json; as escolhas salvas no navegador vêm por cima
  if (prefs.receiver) $("receiverMode").value = prefs.receiver;
  const volume = prefs.volume !== undefined && prefs.v === 2 ? prefs.volume : SETTINGS.audio.volumeDb;
  $("volumeSlider").value = volume;
  $("volumeOut").textContent = `${volume} dB`;
  $("volumeSlider").setAttribute("aria-valuetext", `${volume} decibéis`);
  engine.setVolume(volume);
  $("keySelect").value = prefs.key || SETTINGS.audio.key;
  engine.setKey($("keySelect").value);
  const samples = prefs.samples ?? SETTINGS.audio.useSamples;
  $("samplesToggle").checked = samples;
  if (samples !== engine.useSamples) engine.setUseSamples(samples);
  $("voiceToggle").checked = prefs.voice ?? SETTINGS.narration.onAtStart;
  const hc = prefs.hc ?? SETTINGS.a11y.highContrast ?? window.matchMedia("(prefers-contrast: more)").matches;
  $("highContrast").checked = !!hc;
  document.documentElement.classList.toggle("hc", !!hc);
  $("textSize").value = prefs.text || SETTINGS.a11y.textSize;
  applyTextSize($("textSize").value);
  if (prefs.color) { $("colorMode").value = prefs.color; state.colorMode = prefs.color; }
  if (prefs.lan) $("lanInput").value = prefs.lan;
  applyLowSensory(!!prefs.low);

  // com a narração ligada, a voz lê cada controle que recebe o foco (js/a11y.js)
  initFocusEcho({
    enabled: () => SETTINGS.narration.readControls && voiceOn(),
    speak: (text) => speak(text),
    skip: (el) => el.id === "tutorialTitle", // o tutorial fala os próprios passos
  });

  showView("gallery");
  renderGallery();
  updateAudioUI();
  requestAnimationFrame(frame);
  if (CONFIG_PROBLEMS.length) {
    toast(`config.json: ${CONFIG_PROBLEMS.length === 1 ? "1 problema" : `${CONFIG_PROBLEMS.length} problemas`}. ${CONFIG_PROBLEMS[0]}`, 12000);
  }
  // primeira visita: o guia em áudio é a primeira coisa na tela (e no leitor de tela)
  if (!tutorial.seen()) tutorial.open({ gate: true });

  await Promise.all([loadLandMask(), loadCountries()]);
  await upgradeGmaoSequences(state.presets);
  if (state.presets.some((g) => g.sequence)) {
    $("presetsNote").textContent = "Prontos para uso imediato. A pasta dados/ foi encontrada: os mapas GMAO abrem como sequências de 372 horas com linha do tempo.";
    renderGallery();
  }
  if (!engine.available) toast("Tone.js não carregou: o áudio precisa de internet na primeira vez.", 6000);
}

init();
