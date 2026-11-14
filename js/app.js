// A Sinfonia da Terra · Earth Jukebox Multissensorial
// Orquestra galeria, legenda sensorial, leitura de pixels, áudio, háptica e acessibilidade.

import { SCALES, SCALE_LIST, INSTRUMENTS, INSTRUMENT_ORDER, GMAO_T0_UTC, scaleFromPixels, paletteColor } from "./scales.js";
import { loadLandMask, formatCoord } from "./geo.js";
import { ImageSampler, loadBitmap } from "./sampler.js";
import { SonificationEngine, MUSICAL_KEYS, midiName } from "./audio.js";
import { HapticBridge, renderQr, guessReceiverBase, PUBLIC_RECEIVER_BASE } from "./haptics.js";
import { presetGroups, upgradeGmaoSequences, groupFiles, filesFromDrop, renderPresets, renderLocalGroups } from "./gallery.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const canvas = $("mapCanvas");
const ctx = canvas.getContext("2d");
const scope = $("scopeCanvas");
const scopeCtx = scope.getContext("2d");

const engine = new SonificationEngine();
window.sinfonia = { engine }; // acesso para depuração no console do navegador
const haptics = new HapticBridge({ onStatus: onPhoneStatus });

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
};

// ---------------------------------------------------------------------------
// Preferências
// ---------------------------------------------------------------------------
const prefs = (() => {
  try { return JSON.parse(localStorage.getItem("sinfonia-prefs") || "{}"); } catch { return {}; }
})();
function savePrefs() {
  try {
    localStorage.setItem("sinfonia-prefs", JSON.stringify({
      low: $("lowSensory").checked, voice: $("voiceToggle").checked, hc: $("highContrast").checked,
      color: $("colorMode").value, volume: Number($("volumeSlider").value), key: $("keySelect").value,
      samples: $("samplesToggle").checked, lan: $("lanInput").value, receiver: $("receiverMode").value, v: 2,
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
}

function announce(text, { speak = true } = {}) {
  const live = $("ariaLive");
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = text; });
  if (speak && $("voiceToggle").checked && "speechSynthesis" in window) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR";
    u.rate = $("lowSensory").checked ? 0.92 : 1.05;
    u.volume = $("lowSensory").checked ? 0.7 : 1;
    const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("pt"));
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function showView(name) {
  const gallery = name === "gallery";
  $("galleryView").hidden = !gallery;
  $("exploreView").hidden = gallery;
  document.body.dataset.view = name;
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
async function selectGroup(group, index = 0) {
  state.group = group;
  state.index = index;
  state.scale = group.scaleId ? SCALES[group.scaleId] : null;
  state.u = 0.5;
  state.v = 0.5;
  state.trail = [];
  state.announcedKey = "";
  const loading = loadFrame(index, { initial: true });
  if (!state.scale) await loading; // precisa detectar a escala antes de montar a legenda
  openLegend();
  await loading;
}

function openLegend() {
  const scale = state.scale || SCALES.generic;
  const g = state.group;
  $("legendDialogTitle").textContent = "Legenda auditiva e sensorial";
  $("legendDialogIntro").textContent = `${g.title}: ouça cada instrumento antes de explorar. ${scale.label}.`;
  $("dlgScaleLabel").textContent = scale.label;
  $("dlgScaleUnit").textContent = scale.unit;
  $("dlgGradient").style.background = scale.gradientCss();
  renderTicks($("dlgTicks"), scale);
  $("dlgKey").textContent = MUSICAL_KEYS[engine.key].label.replace("Pentatônica Maior", "pentatônica maior");

  const list = $("instrumentList");
  list.innerHTML = "";
  for (const id of INSTRUMENT_ORDER) {
    const inst = INSTRUMENTS[id];
    const li = document.createElement("li");
    li.className = "instrument";
    li.style.setProperty("--inst", inst.color);
    const swatch = instrumentSwatch(scale, id);
    li.innerHTML = `
      <span class="instrument__icon" aria-hidden="true">${INSTRUMENT_ICONS[id]}</span>
      <div class="instrument__body">
        <p class="instrument__register">${inst.register}</p>
        <h3 class="instrument__name" id="inst-${id}">${inst.name}</h3>
        <p class="instrument__role">${inst.role}</p>
        <p class="instrument__here"><span class="instrument__swatch" style="background:${swatch}"></span>${scale.legend[id]}</p>
      </div>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "button button--ghost instrument__play";
    btn.setAttribute("aria-describedby", `inst-${id}`);
    btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor"/></svg> Ouvir`;
    btn.addEventListener("click", async () => {
      try {
        btn.classList.add("is-playing");
        const secs = await engine.preview(id);
        updateAudioUI();
        setTimeout(() => btn.classList.remove("is-playing"), secs * 1000);
      } catch (err) {
        btn.classList.remove("is-playing");
        toast(err.message || "Não foi possível iniciar o áudio.");
      }
    });
    li.append(btn);
    list.append(li);
  }

  const dlg = $("legendDialog");
  if (!dlg.open) dlg.showModal();
  $("legendDialogTitle").focus();
}

// gradiente com as cores da escala onde o instrumento domina (ou um ícone de brilho/borda)
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
  return id === "harp"
    ? "repeating-linear-gradient(90deg, #fff 0 3px, #222 3px 7px)"
    : "linear-gradient(90deg, #333, #fff)";
}

const INSTRUMENT_ICONS = {
  cello: `<svg viewBox="0 0 48 48"><path d="M24 4v10M20 6h8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M24 14c-5 0-8 3-7 8 .6 2.6-3 3.5-3 9 0 6.5 4.5 11 10 11s10-4.5 10-11c0-5.5-3.6-6.4-3-9 1-5-2-8-7-8Z" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M21 27c1 1 5 1 6 0M21 33c1-1 5-1 6 0" stroke="currentColor" stroke-width="2"/><path d="M24 14v28" stroke="currentColor" stroke-width="1.6"/></svg>`,
  piano: `<svg viewBox="0 0 48 48"><rect x="5" y="12" width="38" height="26" rx="3" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12.5 12v26M20 12v26M27.5 12v26M35 12v26" stroke="currentColor" stroke-width="1.8"/><path d="M10 12h5v14h-5zM17.5 12h5v14h-5zM32.5 12h5v14h-5z" fill="currentColor"/></svg>`,
  flute: `<svg viewBox="0 0 48 48"><path d="M8 38 40 8" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="18" cy="28" r="1.8" fill="var(--bg-deep, #000)"/><circle cx="23" cy="23" r="1.8" fill="var(--bg-deep, #000)"/><circle cx="28" cy="18" r="1.8" fill="var(--bg-deep, #000)"/><path d="M36 30c3 1 5 3 6 6M33 35c2 .5 3.5 2 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`,
  harp: `<svg viewBox="0 0 48 48"><path d="M12 42V8c10 0 14 6 18 12s8 8 8 8l-26 14Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M17 13v26M22 15v21M27 19v15M32 25v6" stroke="currentColor" stroke-width="1.6"/></svg>`,
};

async function startExperience() {
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
  if (state.reading) announceReading(true);
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
    `Mapa sonoro de ${g.title}, ${scale.label}. Use as setas para mover o cursor focal; cada posição toca instrumentos conforme o valor.`
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
function stopTimeline() {
  state.playing = false;
  clearTimeout(playTimer);
  $("playTimeline").setAttribute("aria-pressed", "false");
  $("playTimeline").setAttribute("aria-label", "Reproduzir linha do tempo");
}
function stepFrame(delta) {
  const g = state.group;
  if (!g || g.frames.length < 2) return;
  stopTimeline();
  loadFrame((state.index + delta + g.frames.length) % g.frames.length).then(() => {
    announce(frameTimeText(g.frames[state.index]), { speak: true });
  });
}

// ---------------------------------------------------------------------------
// Leitura e sonificação
// ---------------------------------------------------------------------------
function isActive() {
  return !$("exploreView").hidden && (state.pointerInside || state.keyboardActive) && !$("legendDialog").open;
}

function computeReading() {
  const { sampler, scale } = state;
  if (!sampler || !scale) return null;
  const r = sampler.read(state.u, state.v, scale, state.projection);
  if (r.valid) {
    r.weights = scale.roles(r);
    r.valueText = scale.format(r.value);
  } else {
    r.weights = { cello: 0, piano: 0, flute: 0, harp: 0 };
    r.valueText = "sem dado";
  }
  return r;
}

function activeInstruments(r) {
  return INSTRUMENT_ORDER.filter((id) => (r.weights?.[id] ?? 0) >= 0.25)
    .sort((a, b) => r.weights[b] - r.weights[a])
    .map((id) => INSTRUMENTS[id].short);
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

function processReading() {
  const r = computeReading();
  if (!r) return;
  const prev = state.reading;
  state.reading = r;
  const active = isActive();
  engine.update({
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
  // nota do instrumento dominante (violoncelo grave, piano médio, flauta aguda, harpa)
  const dom = INSTRUMENT_ORDER.reduce((a, b) => ((r.weights[b] ?? 0) > (r.weights[a] ?? 0) ? b : a));
  const domOn = r.valid && (r.weights[dom] ?? 0) > 0.05;
  $("readNote").textContent = domOn ? midiName(engine.noteFor(dom, r.norm)) : "—";
  const pan = state.u * 2 - 1;
  const side = Math.abs(pan) < 0.12 ? "centro" : pan < 0 ? `esquerda ${Math.round(-pan * 100)}%` : `direita ${Math.round(pan * 100)}%`;
  $("readPan").textContent = domOn ? `${INSTRUMENTS[dom].short} · ${side}` : side;
  const marker = $("legendMarker");
  marker.hidden = !r.valid;
  if (r.valid) marker.style.left = `${(r.norm * 100).toFixed(2)}%`;
  const meters = $("instMeters");
  if (!meters.children.length) {
    meters.innerHTML = INSTRUMENT_ORDER.map(
      (id) => `<li style="--inst:${INSTRUMENTS[id].color}"><span>${INSTRUMENTS[id].short}</span><i><b id="m-${id}"></b></i></li>`
    ).join("");
  }
  for (const id of INSTRUMENT_ORDER) {
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
  const R = (14 + pulse) * dpr;
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
    // anuncia quando o cursor para por ~0,7 s
    if (isActive() && performance.now() - state.lastMove > 700 && state.lastMove) announceReading();
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
}

engine.onSamplesState = (s) => {
  const el = $("samplesState");
  el.textContent = {
    loading: "Carregando amostras gravadas… (sintetizador enquanto isso)",
    ready: "Amostras gravadas prontas: piano Salamander, violoncelo, flauta e harpa",
    failed: "Sem acesso às amostras: usando instrumentos sintetizados",
  }[s] || el.textContent;
};

// ---------------------------------------------------------------------------
// Smartphone
// ---------------------------------------------------------------------------
let receiverBase = null;
function onPhoneStatus(kind, info) {
  const st = $("phoneStatus");
  const dot = $("phoneDot");
  dot.className = "status-dot";
  if (kind === "waiting") { st.textContent = "Aguardando o celular escanear o QR Code…"; dot.classList.add("is-wait"); }
  if (kind === "connected") { st.textContent = `Smartphone conectado ✓ · mova o mouse sobre o mapa`; dot.classList.add("is-on"); announce("Smartphone conectado para vibração.", { speak: false }); }
  if (kind === "caps" && info && info.vibrate === false) toast("O celular conectado não suporta vibração (ex.: iPhone). Ele mostrará pulsos visuais.", 6000);
  if (kind === "reconnecting") st.textContent = "Reconectando ao serviço de sinalização…";
  if (kind === "error") { st.textContent = `Erro na conexão WebRTC (${info}).`; dot.classList.add("is-err"); }
  if (kind === "closed") st.textContent = "Desconectado.";
}

// O celular precisa abrir receiver.html de algum lugar:
//  - "lan":    servidor deste computador na rede Wi-Fi (http://192.168.x.x:8000)
//  - "public": cópia pública em HTTPS (GitHub Pages) — não depende de firewall/rede local
// Nos dois casos a ligação de dados é a mesma: PeerJS (sinalização) + WebRTC (P2P).
function receiverUrl() {
  const id = haptics.peer?.id;
  if (!id) return null;
  const mode = $("receiverMode").value;
  let base;
  if (mode === "public") {
    base = PUBLIC_RECEIVER_BASE;
  } else {
    base = receiverBase.base;
    const lan = $("lanInput").value.trim();
    if (receiverBase.local) {
      if (!lan) return null;
      try { base = new URL(/^https?:\/\//.test(lan) ? lan : `http://${lan}`).href; } catch { return null; }
      if (!base.endsWith("/")) base += "/";
    }
  }
  return `${new URL("receiver.html", base).href}#${id}`;
}

function refreshQr() {
  const mode = $("receiverMode").value;
  $("lanField").hidden = mode !== "lan" || !receiverBase?.local;
  const url = receiverUrl();
  const warn = $("qrWarn");
  if (!url) {
    $("qrBox").innerHTML = "";
    $("qrUrl").textContent = "";
    warn.hidden = false;
    warn.textContent = haptics.peer?.id
      ? "Digite o endereço deste computador na rede (ex.: 192.168.0.10:8000) ou escolha “Internet (GitHub Pages)”."
      : "";
    return;
  }
  const host = new URL(url).hostname;
  warn.hidden = !(mode === "lan" && /^(localhost|127\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host));
  warn.textContent = "Esse endereço parece interno (localhost/WSL/Docker) e o celular não vai alcançá-lo.";
  renderQr($("qrBox"), url);
  $("qrUrl").textContent = url;
  $("receiverLink").href = url;
}

async function connectPhone() {
  $("phoneBox").hidden = false;
  $("phoneStatus").textContent = "Conectando ao servidor de sinalização PeerJS…";
  try {
    receiverBase = await guessReceiverBase();
    if (receiverBase.local && !$("lanInput").value && prefs.lan) $("lanInput").value = prefs.lan;
    // site já publicado em HTTPS: o próprio endereço serve para o celular
    if (!receiverBase.local && location.protocol === "https:") $("receiverMode").value = "lan";
    await haptics.open();
    haptics.setLowSensory($("lowSensory").checked);
    refreshQr();
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
    const big = e.shiftKey ? 0.05 : 0.0125;
    const map = { ArrowLeft: [-big, 0], ArrowRight: [big, 0], ArrowUp: [0, -big * 2], ArrowDown: [0, big * 2] };
    if (map[e.key]) {
      e.preventDefault();
      moveFocal(...map[e.key]);
      return;
    }
    switch (e.key) {
      case " ": e.preventDefault(); toggleAudio(); break;
      case "Enter": e.preventDefault(); state.readingDirty = true; processReading(); announceReading(true); break;
      case "Home": e.preventDefault(); state.u = 0.5; state.v = 0.5; moveFocal(0, 0); break;
      case "[": e.preventDefault(); stepFrame(-1); break;
      case "]": e.preventDefault(); stepFrame(1); break;
      case "p": case "P": e.preventDefault(); state.playing ? stopTimeline() : startTimeline(); break;
      case "l": case "L": e.preventDefault(); openLegend(); break;
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
    sliderTimer = setTimeout(() => loadFrame(i), 60);
  });
  $("playTimeline").addEventListener("click", () => (state.playing ? stopTimeline() : startTimeline()));

  // áudio
  $("volumeSlider").addEventListener("input", (e) => {
    const db = Number(e.target.value);
    $("volumeOut").textContent = `${db} dB`;
    engine.setVolume(db);
    savePrefs();
  });
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
  $("receiverMode").addEventListener("change", () => { refreshQr(); savePrefs(); });

  // acessibilidade
  $("lowSensory").addEventListener("change", (e) => applyLowSensory(e.target.checked));
  $("highContrast").addEventListener("change", (e) => { document.documentElement.classList.toggle("hc", e.target.checked); savePrefs(); });
  $("voiceToggle").addEventListener("change", (e) => {
    savePrefs();
    if (e.target.checked) announce("Narração por voz ativada.");
    else speechSynthesis?.cancel();
  });
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
  // preferências salvas
  if (prefs.receiver) $("receiverMode").value = prefs.receiver;
  if (prefs.volume !== undefined && prefs.v === 2) { $("volumeSlider").value = prefs.volume; $("volumeOut").textContent = `${prefs.volume} dB`; engine.setVolume(prefs.volume); }
  if (prefs.key) { $("keySelect").value = prefs.key; engine.setKey(prefs.key); }
  if (prefs.samples === false) { $("samplesToggle").checked = false; engine.setUseSamples(false); }
  if (prefs.voice) $("voiceToggle").checked = true;
  const hc = prefs.hc ?? window.matchMedia("(prefers-contrast: more)").matches;
  $("highContrast").checked = !!hc;
  document.documentElement.classList.toggle("hc", !!hc);
  if (prefs.color) { $("colorMode").value = prefs.color; state.colorMode = prefs.color; }
  if (prefs.lan) $("lanInput").value = prefs.lan;
  applyLowSensory(!!prefs.low);

  showView("gallery");
  renderGallery();
  updateAudioUI();
  requestAnimationFrame(frame);

  await loadLandMask();
  await upgradeGmaoSequences(state.presets);
  if (state.presets.some((g) => g.sequence)) {
    $("presetsNote").textContent = "Prontos para uso imediato. A pasta dados/ foi encontrada: os mapas GMAO abrem como sequências de 372 horas com linha do tempo.";
    renderGallery();
  }
  if (!engine.available) toast("Tone.js não carregou: o áudio precisa de internet na primeira vez.", 6000);
}

init();
