import {
  DATASET_CONFIGS,
  loadDataset,
  paletteGradient,
} from "./datasets.js";
import {
  EarthAudioEngine,
  SCALES,
  quantizeNote,
} from "./audio.js";

const canvas = document.getElementById("visualCanvas");
const canvasShell = document.getElementById("canvasShell");
const ctx = canvas.getContext("2d");
const scopeCanvas = document.getElementById("scopeCanvas");
const scopeCtx = scopeCanvas.getContext("2d");

const ui = {
  playButton: document.getElementById("playButton"),
  playLabel: document.getElementById("playLabel"),
  startButton: document.getElementById("startButton"),
  startOverlay: document.getElementById("startOverlay"),
  loadingVeil: document.getElementById("loadingVeil"),
  liveText: document.getElementById("liveText"),
  audioStatusText: document.getElementById("audioStatusText"),
  datasetKicker: document.getElementById("datasetKicker"),
  vizHeading: document.getElementById("vizHeading"),
  datasetMeta: document.getElementById("datasetMeta"),
  sourceLink: document.getElementById("sourceLink"),
  legendTitle: document.getElementById("legendTitle"),
  legendRange: document.getElementById("legendRange"),
  legendBar: document.getElementById("legendBar"),
  legendTicks: document.getElementById("legendTicks"),
  readRegion: document.getElementById("readRegion"),
  readValueLabel: document.getElementById("readValueLabel"),
  readValue: document.getElementById("readValue"),
  readIntensityLabel: document.getElementById("readIntensityLabel"),
  readIntensity: document.getElementById("readIntensity"),
  readNote: document.getElementById("readNote"),
  coordReadout: document.getElementById("coordReadout"),
  canvasHint: document.getElementById("canvasHint"),
  pitchMarker: document.getElementById("pitchMarker"),
  ariaStatus: document.getElementById("ariaStatus"),
  toast: document.getElementById("toast"),
  lowSensory: document.getElementById("lowSensory"),
  highContrast: document.getElementById("highContrast"),
  vibrationToggle: document.getElementById("vibrationToggle"),
  colorMode: document.getElementById("colorMode"),
  scaleSelect: document.getElementById("scaleSelect"),
  sceneSelect: document.getElementById("sceneSelect"),
  sceneHelp: document.getElementById("sceneHelp"),
};

const audio = new EarthAudioEngine();
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  datasetId: "sst",
  sceneId: "global",
  scenesByDataset: { sst: "global", gedi: "global" },
  dataset: null,
  scaleId: "pentatonicC",
  audioStarted: false,
  audioOn: false,
  lowSensory: false,
  highContrast: false,
  vibration: true,
  colorMode: "none",
  prefersReducedMotion: motionQuery.matches,
  position: { x: 0.5, y: 0.5 },
  pointerInside: false,
  pointerType: "mouse",
  keyboardMode: false,
  active: false,
  needsUpdate: true,
  forceAnnounce: false,
  lastReading: null,
  lastNote: null,
  lastAnnouncementAt: 0,
  lastAnnouncementKey: "",
  lastVibrateValue: null,
  lastVibrateAt: 0,
  trail: [],
  view: { width: 1200, height: 600, dpr: 1 },
  scopeView: { width: 360, height: 80, dpr: 1 },
  loading: false,
  loadToken: 0,
  toastTimer: 0,
  announceParity: false,
  idleTick: 0,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value, decimals) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatReadingValue(reading, config) {
  if (!reading) return "—";
  return `${formatNumber(reading.value, config.valueDecimals)} ${config.valueUnit}`;
}

function formatNote(note) {
  if (!note) return "—";
  return `${note.name} · ${Math.round(note.frequency)} Hz`;
}

function intensityInfo(intensity, config, reading) {
  if (config.id === "gedi") {
    if (reading && reading.isWater) {
      return { short: "Oceano", full: "oceano, sem dossel florestal" };
    }
    if (intensity < 0.2) return { short: "Esparso", full: "dossel esparso" };
    if (intensity < 0.48) return { short: "Moderado", full: "dossel moderado" };
    if (intensity < 0.76) return { short: "Denso", full: "dossel denso" };
    return { short: "Muito denso", full: "dossel muito denso" };
  }

  if (intensity < 0.22) return { short: "Fraca", full: "corrente fraca" };
  if (intensity < 0.5) return { short: "Moderada", full: "corrente moderada" };
  if (intensity < 0.78) return { short: "Forte", full: "corrente forte" };
  return { short: "Muito intensa", full: "corrente muito intensa" };
}

function announce(text, force = false) {
  let output = text;
  if (force) {
    state.announceParity = !state.announceParity;
    output += state.announceParity ? "\u200B" : "\u200C";
  }
  ui.ariaStatus.textContent = output;
}

function showToast(message, duration = 3200) {
  window.clearTimeout(state.toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    ui.toast.classList.remove("is-visible");
  }, duration);
}

function updateAudioUI() {
  const playing = state.audioStarted && state.audioOn;
  document.body.classList.toggle("is-playing", playing);
  ui.playButton.setAttribute("aria-pressed", String(playing));

  if (!state.audioStarted) {
    ui.playLabel.textContent = "Iniciar experiência";
    ui.audioStatusText.textContent = "Áudio aguardando ativação";
    ui.startOverlay.hidden = false;
  } else if (playing) {
    ui.playLabel.textContent = "Pausar áudio";
    ui.audioStatusText.textContent = state.lowSensory
      ? "Som ativo em modo de baixa sensibilidade"
      : "Som ativo · dados em tempo real";
    ui.startOverlay.hidden = true;
  } else {
    ui.playLabel.textContent = "Retomar áudio";
    ui.audioStatusText.textContent = "Áudio pausado";
    ui.startOverlay.hidden = true;
  }

  if (!state.lastReading) {
    ui.liveText.textContent = playing ? "Áudio ativo · mova o ponteiro" : "Pronto para explorar";
  }
}

function refreshActivity() {
  const keyboardActive = state.keyboardMode && document.activeElement === canvas;
  const nextActive = state.pointerInside || keyboardActive;

  if (nextActive === state.active) {
    if (!nextActive) audio.setActive(false);
    return;
  }

  state.active = nextActive;
  state.needsUpdate = true;

  if (!nextActive) {
    audio.setActive(false);
    ui.liveText.textContent =
      state.audioStarted && state.audioOn
        ? "Áudio ativo · explore o mapa"
        : state.audioStarted
          ? "Áudio pausado"
          : "Pronto para explorar";
  }
}

async function startAudio(options = {}) {
  if (state.audioStarted && state.audioOn) {
    if (options.focusCanvas) canvas.focus({ preventScroll: true });
    return true;
  }

  try {
    if (!state.audioStarted) {
      await audio.start();
      state.audioStarted = true;
    }

    state.audioOn = true;
    audio.setPlaying(true);
    audio.setLowSensory(state.lowSensory);
    audio.setScale(state.scaleId);

    ui.startOverlay.hidden = true;
    updateAudioUI();

    if (options.center) {
      state.position = { x: 0.5, y: 0.5 };
      state.pointerInside = false;
      state.keyboardMode = true;
      state.active = true;
    }

    if (options.focusCanvas) {
      canvas.focus({ preventScroll: true });
    }

    if (state.active) {
      state.needsUpdate = true;
      audio.setActive(true);
    }

    return true;
  } catch (error) {
    showToast(
      error && error.message
        ? error.message
        : "Não foi possível iniciar o áudio neste navegador.",
      5200
    );
    return false;
  }
}

function pauseAudio() {
  state.audioOn = false;
  audio.setPlaying(false);
  audio.setActive(false);
  updateAudioUI();
  ui.liveText.textContent = "Áudio pausado";
}

async function toggleAudio() {
  if (!state.audioStarted || !state.audioOn) {
    const center = document.activeElement !== canvas;
    await startAudio({ center });
  } else {
    pauseAudio();
  }
}

async function startExperienceFromButton() {
  const started = await startAudio({ center: true, focusCanvas: true });
  if (started) {
    state.needsUpdate = true;
    announce("Experiência sonora iniciada. Use as setas ou mova o ponteiro sobre o mapa.", true);
  }
}

function showLoading(visible) {
  state.loading = visible;
  ui.loadingVeil.hidden = !visible;
  canvasShell.setAttribute("aria-busy", String(visible));
  ui.startButton.disabled = visible;
  ui.sceneSelect.disabled = visible;
}

function populateSceneSelect(datasetId, selectedId) {
  const dataset = DATASET_CONFIGS[datasetId];
  if (!dataset) return;

  ui.sceneSelect.replaceChildren(
    ...dataset.scenes.map((scene) => {
      const option = document.createElement("option");
      option.value = scene.id;
      option.textContent = scene.label;
      return option;
    })
  );
  ui.sceneSelect.value = selectedId;
  ui.sceneSelect.disabled = state.loading;
}

function updateDatasetUI(config) {
  ui.datasetKicker.textContent = config.kicker;
  ui.vizHeading.textContent = config.title;
  ui.datasetMeta.textContent = config.meta;
  ui.sourceLink.href = config.sourceUrl;
  ui.sourceLink.textContent = config.sourceLabel;
  ui.legendTitle.textContent = config.legendTitle;
  ui.legendRange.textContent = config.legendRange;
  ui.legendBar.style.background = paletteGradient(config);
  ui.legendTicks.replaceChildren(
    ...config.legendTicks.map((tick) => {
      const span = document.createElement("span");
      span.textContent = String(tick);
      return span;
    })
  );
  ui.readValueLabel.textContent = config.valueLabel;
  ui.readIntensityLabel.textContent = config.intensityLabel;
  ui.sceneHelp.textContent =
    config.description || "Escolha uma visão global ou um recorte regional para explorar.";
  ui.startButton.disabled = state.loading;

  canvas.setAttribute(
    "aria-label",
    `A Sinfonia da Terra. ${config.ariaSubject}. Use o ponteiro ou as setas do teclado para explorar. Cada posição produz uma nota musical quantizada.`
  );
}

async function selectDataset(id, options = {}) {
  const datasetConfig = DATASET_CONFIGS[id];
  if (!datasetConfig) return;

  const fallbackScene = datasetConfig.defaultScene || datasetConfig.scenes[0].id;
  const requestedScene =
    options.sceneId || state.scenesByDataset[id] || fallbackScene;
  const sceneId = datasetConfig.scenes.some((scene) => scene.id === requestedScene)
    ? requestedScene
    : fallbackScene;
  const previousDatasetId = state.datasetId;
  const previousSceneId = state.sceneId;
  const previousScenesByDataset = { ...state.scenesByDataset };
  const token = ++state.loadToken;

  populateSceneSelect(id, sceneId);
  showLoading(true);

  try {
    const dataset = await loadDataset(id, sceneId);
    if (token !== state.loadToken) return;

    state.datasetId = id;
    state.sceneId = sceneId;
    state.scenesByDataset[id] = sceneId;
    state.dataset = dataset;
    state.lastVibrateValue = null;
    updateDatasetUI(dataset.config);
    populateSceneSelect(id, sceneId);

    const radio = document.querySelector(`input[name="dataset"][value="${id}"]`);
    if (radio) radio.checked = true;

    if (!options.initial) {
      showToast(`${dataset.config.title}: ${dataset.config.meta}.`);
      announce(
        `${dataset.config.title}. ${dataset.config.meta}. Use as setas para explorar.`,
        true
      );
    }

    state.needsUpdate = true;
    state.forceAnnounce = Boolean(options.initial);
    updateReading(true);
  } catch (error) {
    if (token !== state.loadToken) return;
    showToast(error.message || "Falha ao carregar o dataset.", 5200);
    const radio = document.querySelector(
      `input[name="dataset"][value="${previousDatasetId}"]`
    );
    if (radio) radio.checked = true;
    state.scenesByDataset = previousScenesByDataset;
    populateSceneSelect(previousDatasetId, previousSceneId);
  } finally {
    if (token === state.loadToken) {
      showLoading(false);
      updateAudioUI();
    }
  }
}

function updateReading(force = false, options = {}) {
  const dataset = state.dataset;
  if (!dataset) return;

  const reading = dataset.sample(state.position.x, state.position.y);
  const config = dataset.config;
  const note = reading
    ? quantizeNote(reading.normalized, state.scaleId)
    : null;

  state.lastReading = reading;
  state.lastNote = note;

  if (!reading) {
    const isLocalScene = config.projection === "local";
    const reason = dataset.reasonAt(state.position.x, state.position.y);
    const isLand = reason === 1;
    const missingLabel = isLand
      ? "Continente"
      : isLocalScene
        ? "Sem dados"
        : "Fora do globo";
    ui.readRegion.textContent = missingLabel;
    ui.readValue.textContent = "—";
    ui.readIntensity.textContent = "—";
    ui.readNote.textContent = "—";
    ui.coordReadout.textContent = isLocalScene
      ? "Cena regional"
      : isLand
        ? dataset.coordinateAt(state.position.x, state.position.y)
        : "Fora do globo";
    ui.pitchMarker.style.left = "50%";
    audio.setActive(false);

    if (state.active) {
      const now = performance.now();
      if (now - state.lastAnnouncementAt > 1200) {
        announce(
          isLand
            ? "Continente. Sem dados de temperatura oceânica nesta posição."
            : isLocalScene
              ? "Sem dados nesta posição da imagem."
              : "Fora da cobertura de dados deste dataset.",
          force
        );
        state.lastAnnouncementAt = now;
      }
    }
    state.needsUpdate = false;
    state.forceAnnounce = false;
    return;
  }

  const valueText = formatReadingValue(reading, config);
  const intensity = intensityInfo(reading.intensity, config, reading);

  ui.readRegion.textContent = reading.region;
  ui.readValue.textContent = valueText;
  ui.readIntensity.textContent = intensity.short;
  ui.readNote.textContent = note.name;
  ui.coordReadout.textContent = reading.coordinateLabel;
  ui.pitchMarker.style.left = `${(reading.normalized * 100).toFixed(1)}%`;

  if (state.active) {
    audio.update(
      {
        valueNorm: reading.normalized,
        intensity: reading.intensity,
        pan: reading.x * 2 - 1,
      },
      true
    );
  }

  if (state.audioStarted && state.audioOn && state.active) {
    ui.liveText.textContent = `Sonificando · ${reading.region}`;
    ui.canvasHint.textContent = "Som ativo · mova devagar para ouvir as transições";
  } else if (state.audioStarted && state.audioOn) {
    ui.liveText.textContent = "Áudio ativo · explore o mapa";
  } else if (state.audioStarted) {
    ui.liveText.textContent = "Áudio pausado";
  } else {
    ui.liveText.textContent = "Pronto para explorar";
  }

  const now = performance.now();
  const band = Math.round(reading.normalized * 20);
  const announcementKey = `${reading.region}|${band}|${intensity.short}`;
  const shouldAnnounce =
    force ||
    options.forceAnnounce ||
    (state.active &&
      announcementKey !== state.lastAnnouncementKey &&
      now - state.lastAnnouncementAt > (state.keyboardMode ? 300 : 900));

  if (shouldAnnounce) {
    let description = `${reading.region}. `;

    if (config.id === "gedi") {
      description += reading.isWater
        ? "Oceano, sem dossel florestal. "
        : `${intensity.full}, ${valueText}. `;
    } else {
      description += `${valueText}. ${intensity.full}. `;
    }

    description += `Nota ${note.name}.`;
    announce(description, force || options.forceAnnounce);
    state.lastAnnouncementAt = now;
    state.lastAnnouncementKey = announcementKey;
  }

  maybeVibrate(reading, config);

  if (state.active) {
    const motionReduced = state.prefersReducedMotion || state.lowSensory;
    const last = state.trail[state.trail.length - 1];
    const distance = last
      ? Math.hypot(reading.x - last.x, reading.y - last.y)
      : Infinity;

    if (!motionReduced && distance > 0.006) {
      state.trail.push({
        x: reading.x,
        y: reading.y,
        color: reading.color,
        intensity: reading.intensity,
        time: now,
      });
      if (state.trail.length > 22) state.trail.shift();
    }
  }

  state.needsUpdate = false;
  state.forceAnnounce = false;
}

function maybeVibrate(reading, config) {
  if (!state.vibration || !navigator.vibrate) return;
  if (state.pointerType !== "touch" && state.pointerType !== "pen") return;
  if (reading.isWater) return;

  const now = performance.now();
  const threshold = config.id === "sst" ? 1.6 : 7;
  const previous = state.lastVibrateValue;

  if (
    previous !== null &&
    Math.abs(reading.value - previous) >= threshold &&
    now - state.lastVibrateAt > 280
  ) {
    state.lastVibrateAt = now;
    try {
      navigator.vibrate(state.lowSensory ? 6 : 10);
    } catch {
      /* A API de vibração é opcional. */
    }
  }

  state.lastVibrateValue = reading.value;
}

function getNormalizedPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function setPositionFromPointer(event) {
  state.pointerType = event.pointerType || "mouse";
  state.position = getNormalizedPosition(event);
  state.pointerInside = true;
  state.keyboardMode = false;
  state.active = true;
  state.needsUpdate = true;
}

function moveFocusedPoint(dx, dy) {
  state.position = {
    x: clamp(state.position.x + dx, 0, 1),
    y: clamp(state.position.y + dy, 0, 1),
  };
  state.keyboardMode = true;
  state.active = true;
  state.needsUpdate = true;
  state.forceAnnounce = true;
}

function setupCanvasSizing() {
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    state.view = { width: rect.width, height: rect.height, dpr };
  };

  resize();
  if ("ResizeObserver" in window) {
    new ResizeObserver(resize).observe(canvasShell);
  } else {
    window.addEventListener("resize", resize);
  }
}

function setupScopeSizing() {
  const resize = () => {
    const rect = scopeCanvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (scopeCanvas.width !== width || scopeCanvas.height !== height) {
      scopeCanvas.width = width;
      scopeCanvas.height = height;
    }
    state.scopeView = { width: rect.width, height: rect.height, dpr };
  };

  resize();
  if ("ResizeObserver" in window) {
    new ResizeObserver(resize).observe(scopeCanvas);
  } else {
    window.addEventListener("resize", resize);
  }
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function truncateText(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text;
  let output = text;
  while (output.length > 1 && context.measureText(`${output}…`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}…`;
}

function drawGraticule(context, width, height, projection, time) {
  context.save();
  context.lineWidth = 1;

  if (projection === "globe") {
    const cx = (804 / 1600) * width;
    const cy = (399 / 800) * height;
    const rx = (391 / 1600) * width;
    const ry = (391 / 800) * height;

    context.beginPath();
    context.ellipse(cx, cy, rx + 9, ry + 9, 0, 0, Math.PI * 2);
    context.strokeStyle = "rgba(148, 229, 255, 0.1)";
    context.setLineDash([3, 9]);
    context.lineDashOffset = -time / 80;
    context.stroke();

    context.setLineDash([]);
    context.beginPath();
    context.ellipse(cx, cy, rx * 0.66, ry, 0, 0, Math.PI * 2);
    context.strokeStyle = "rgba(148, 229, 255, 0.035)";
    context.stroke();
    return;
  }

  if (projection === "local") {
    const rect = state.dataset ? state.dataset.drawRect : null;
    if (!rect) {
      context.restore();
      return;
    }

    const x = (rect.x / 1600) * width;
    const y = (rect.y / 800) * height;
    const rectWidth = (rect.width / 1600) * width;
    const rectHeight = (rect.height / 800) * height;

    context.save();
    context.beginPath();
    context.rect(x, y, rectWidth, rectHeight);
    context.clip();
    context.strokeStyle = "rgba(154, 222, 255, 0.04)";

    for (let i = 1; i < 8; i += 1) {
      const lineX = x + (rectWidth / 8) * i;
      context.beginPath();
      context.moveTo(lineX, y);
      context.lineTo(lineX, y + rectHeight);
      context.stroke();
    }

    for (let i = 1; i < 4; i += 1) {
      const lineY = y + (rectHeight / 4) * i;
      context.beginPath();
      context.moveTo(x, lineY);
      context.lineTo(x + rectWidth, lineY);
      context.stroke();
    }

    context.restore();
    context.restore();
    return;
  }

  context.strokeStyle = "rgba(154, 222, 255, 0.045)";
  for (let i = 1; i < 12; i += 1) {
    const x = (width / 12) * i;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  for (let i = 1; i < 6; i += 1) {
    const y = (height / 6) * i;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.strokeStyle = "rgba(196, 244, 255, 0.09)";
  context.stroke();

  context.beginPath();
  context.moveTo(width / 2, 0);
  context.lineTo(width / 2, height);
  context.strokeStyle = "rgba(196, 244, 255, 0.065)";
  context.stroke();
  context.restore();
}

function drawTrail(context, width, height, time) {
  if (!state.trail.length) return;

  const cutoff = time - 1400;
  state.trail = state.trail.filter((point) => point.time >= cutoff);
  context.save();
  context.globalCompositeOperation = "lighter";

  for (const point of state.trail) {
    const age = clamp((time - point.time) / 1400, 0, 1);
    const alpha = (1 - age) * 0.2;
    const radius = 2 + (1 - age) * 4;
    const color = point.color || [103, 232, 249];
    context.beginPath();
    context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
    context.fillStyle = `rgba(${color.join(", ")}, ${alpha.toFixed(3)})`;
    context.fill();
  }

  context.restore();
}

function drawReticle(context, width, height, time) {
  if (!state.active) return;

  const reading = state.lastReading;
  const x = state.position.x * width;
  const y = state.position.y * height;
  const motionReduced = state.prefersReducedMotion || state.lowSensory;
  const color = reading && reading.color ? reading.color : [103, 232, 249];
  const colorCss = `rgb(${color.join(", ")})`;
  const accent = state.highContrast ? "#ffffff" : colorCss;

  context.save();
  context.globalCompositeOperation = "lighter";

  const glow = context.createRadialGradient(x, y, 0, x, y, 46);
  glow.addColorStop(0, `rgba(${color.join(", ")}, 0.22)`);
  glow.addColorStop(0.45, `rgba(${color.join(", ")}, 0.08)`);
  glow.addColorStop(1, `rgba(${color.join(", ")}, 0)`);
  context.fillStyle = glow;
  context.beginPath();
  context.arc(x, y, 46, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.save();
  context.strokeStyle = state.highContrast
    ? "rgba(255, 255, 255, 0.3)"
    : "rgba(184, 239, 255, 0.18)";
  context.lineWidth = 1;
  context.setLineDash([2, 7]);
  context.beginPath();
  context.moveTo(x, 0);
  context.lineTo(x, height);
  context.moveTo(0, y);
  context.lineTo(width, y);
  context.stroke();

  context.setLineDash([4, 6]);
  context.lineDashOffset = motionReduced ? 0 : -time / 90;
  context.strokeStyle = accent;
  context.lineWidth = state.highContrast ? 2 : 1.35;
  context.beginPath();
  context.arc(x, y, 18, 0, Math.PI * 2);
  context.stroke();

  if (!motionReduced) {
    const phase = (time % 1500) / 1500;
    context.setLineDash([]);
    context.strokeStyle = `rgba(${color.join(", ")}, ${(0.26 * (1 - phase)).toFixed(3)})`;
    context.beginPath();
    context.arc(x, y, 20 + phase * 22, 0, Math.PI * 2);
    context.stroke();
  }

  context.setLineDash([]);
  context.fillStyle = state.highContrast ? "#fff" : colorCss;
  context.beginPath();
  context.arc(x, y, 3, 0, Math.PI * 2);
  context.fill();
  context.restore();

  drawReadingChip(context, x, y, width, height, reading);
}

function drawReadingChip(context, x, y, width, height, reading) {
  const config = state.dataset ? state.dataset.config : null;
  if (!config) return;

  const lineOne = reading ? reading.region : "Fora da cobertura";
  const lineTwo = reading
    ? `${formatReadingValue(reading, config)} · ${state.lastNote ? state.lastNote.name : "—"}`
    : "Sem dados aqui";

  context.save();
  context.font = '600 10px "Inter", system-ui, sans-serif';
  const lineOneWidth = context.measureText(lineOne).width;
  context.font = '700 12px "Inter", system-ui, sans-serif';
  const lineTwoWidth = context.measureText(lineTwo).width;
  const chipWidth = clamp(Math.max(lineOneWidth, lineTwoWidth) + 22, 108, 258);
  const chipHeight = 46;
  const legendGuard = 72;

  let chipX = x + 24;
  let chipY = y + 20;

  if (chipX + chipWidth > width - 12) chipX = x - chipWidth - 24;
  if (chipY + chipHeight > height - legendGuard) chipY = y - chipHeight - 22;

  chipX = clamp(chipX, 12, width - chipWidth - 12);
  chipY = clamp(chipY, 12, height - chipHeight - 12);

  roundedRect(context, chipX, chipY, chipWidth, chipHeight, 11);
  context.fillStyle = state.highContrast ? "rgba(0, 0, 0, 0.92)" : "rgba(2, 9, 16, 0.84)";
  context.fill();
  context.strokeStyle = state.highContrast
    ? "rgba(255, 255, 255, 0.72)"
    : "rgba(151, 225, 255, 0.2)";
  context.lineWidth = 1;
  context.stroke();

  context.font = '600 10px "Inter", system-ui, sans-serif';
  context.fillStyle = state.highContrast ? "#fff" : "rgba(194, 224, 241, 0.86)";
  context.textBaseline = "middle";
  context.fillText(
    truncateText(context, lineOne, chipWidth - 20),
    chipX + 11,
    chipY + 15
  );

  context.font = '700 12px "Inter", system-ui, sans-serif';
  context.fillStyle = state.highContrast ? "#fff" : "rgb(232, 250, 255)";
  context.fillText(
    truncateText(context, lineTwo, chipWidth - 20),
    chipX + 11,
    chipY + 31
  );
  context.restore();
}

function drawFrame(time) {
  const { width, height, dpr } = state.view;
  if (!state.dataset || width < 1 || height < 1) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(state.dataset.visualCanvas, 0, 0, width, height);

  drawGraticule(ctx, width, height, state.dataset.config.projection, time);

  if (!state.prefersReducedMotion && !state.lowSensory) {
    drawTrail(ctx, width, height, time);
  }

  drawReticle(ctx, width, height, time);
}

function drawScope(time) {
  const { width, height, dpr } = state.scopeView;
  if (width < 1 || height < 1) return;

  scopeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scopeCtx.clearRect(0, 0, width, height);

  const background = scopeCtx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "rgba(3, 12, 21, 0.55)");
  background.addColorStop(1, "rgba(3, 12, 21, 0.08)");
  scopeCtx.fillStyle = background;
  scopeCtx.fillRect(0, 0, width, height);

  const mid = height / 2;
  scopeCtx.strokeStyle = "rgba(143, 168, 189, 0.14)";
  scopeCtx.lineWidth = 1;
  scopeCtx.beginPath();
  scopeCtx.moveTo(0, mid);
  scopeCtx.lineTo(width, mid);
  scopeCtx.stroke();

  const data = audio.getScopeData();
  const active = state.audioStarted && state.audioOn;
  const amplitude = height * 0.34;
  const points = Math.max(42, Math.floor(width / 3));
  const path = new Path2D();

  for (let i = 0; i < points; i += 1) {
    const progress = i / (points - 1);
    let sample = 0;

    if (data && active) {
      const index = Math.floor(progress * (data.length - 1));
      sample = (data[index] - 128) / 128;
    } else {
      const wave =
        Math.sin(progress * Math.PI * 6 + time / 720) * 0.14 +
        Math.sin(progress * Math.PI * 13 - time / 1000) * 0.045;
      sample = active ? wave * 0.45 : wave;
    }

    const x = progress * width;
    const y = mid - sample * amplitude;

    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }

  const fillPath = new Path2D(path);
  fillPath.lineTo(width, mid);
  fillPath.lineTo(0, mid);
  fillPath.closePath();

  const fill = scopeCtx.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, active ? "rgba(103, 232, 249, 0.2)" : "rgba(143, 168, 189, 0.08)");
  fill.addColorStop(1, "rgba(103, 232, 249, 0)");
  scopeCtx.fillStyle = fill;
  scopeCtx.fill(fillPath);

  scopeCtx.strokeStyle = active ? "rgba(142, 247, 255, 0.92)" : "rgba(143, 168, 189, 0.34)";
  scopeCtx.lineWidth = 1.4;
  scopeCtx.stroke(path);

  const marker = state.lastReading ? state.lastReading.x : 0.5;
  scopeCtx.fillStyle = active ? "rgba(251, 113, 133, 0.88)" : "rgba(143, 168, 189, 0.28)";
  scopeCtx.beginPath();
  scopeCtx.arc(marker * width, mid, 2.2, 0, Math.PI * 2);
  scopeCtx.fill();
}

function animate(time) {
  state.idleTick = time;

  if (state.needsUpdate) {
    updateReading();
  }

  drawFrame(time);
  drawScope(time);
  requestAnimationFrame(animate);
}

function setupEvents() {
  ui.playButton.addEventListener("click", () => {
    toggleAudio();
  });

  ui.startButton.addEventListener("click", () => {
    startExperienceFromButton();
  });

  canvas.addEventListener("pointerenter", (event) => {
    setPositionFromPointer(event);
    refreshActivity();
  });

  canvas.addEventListener("pointermove", (event) => {
    setPositionFromPointer(event);
    refreshActivity();
  });

  canvas.addEventListener("pointerdown", (event) => {
    setPositionFromPointer(event);
    canvas.focus({ preventScroll: true });
    refreshActivity();

    if (!state.audioStarted) {
      startAudio({ center: false });
    }
  });

  canvas.addEventListener("pointerleave", () => {
    state.pointerInside = false;
    refreshActivity();
  });

  canvas.addEventListener("focus", () => {
    requestAnimationFrame(() => {
      if (document.activeElement === canvas && canvas.matches(":focus-visible")) {
        state.keyboardMode = true;
        if (state.position.x === 0.5 && state.position.y === 0.5 && !state.pointerInside) {
          state.needsUpdate = true;
        }
        refreshActivity();
      }
    });
  });

  canvas.addEventListener("blur", () => {
    state.keyboardMode = false;
    refreshActivity();
  });

  canvas.addEventListener("keydown", async (event) => {
    const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

    if (arrows.includes(event.key)) {
      event.preventDefault();

      if (!state.audioStarted) {
        await startAudio({ center: false });
      }

      const step = event.shiftKey ? 0.05 : 0.015;
      if (event.key === "ArrowLeft") moveFocusedPoint(-step, 0);
      if (event.key === "ArrowRight") moveFocusedPoint(step, 0);
      if (event.key === "ArrowUp") moveFocusedPoint(0, -step);
      if (event.key === "ArrowDown") moveFocusedPoint(0, step);
      state.forceAnnounce = true;
      return;
    }

    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      toggleAudio();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      updateReading(true, { forceAnnounce: true });
    }
  });

  document.querySelectorAll('input[name="dataset"]').forEach((input) => {
    input.addEventListener("change", (event) => {
      if (event.target.checked) {
        selectDataset(event.target.value, {
          sceneId: state.scenesByDataset[event.target.value],
        });
      }
    });
  });

  ui.sceneSelect.addEventListener("change", () => {
    if (ui.sceneSelect.value && ui.sceneSelect.value !== state.sceneId) {
      selectDataset(state.datasetId, { sceneId: ui.sceneSelect.value });
    }
  });

  ui.scaleSelect.addEventListener("change", () => {
    state.scaleId = ui.scaleSelect.value;
    audio.setScale(state.scaleId);
    updateReading(true, { forceAnnounce: true });
  });

  ui.lowSensory.addEventListener("change", () => {
    state.lowSensory = ui.lowSensory.checked;
    document.body.classList.toggle("is-low-sensory", state.lowSensory);
    audio.setLowSensory(state.lowSensory);
    updateReading(true);
    showToast(
      state.lowSensory
        ? "Modo de baixa sensibilidade ativado: volume e filtros suavizados."
        : "Modo de baixa sensibilidade desativado."
    );
  });

  ui.highContrast.addEventListener("change", () => {
    state.highContrast = ui.highContrast.checked;
    document.body.classList.toggle("is-high-contrast", state.highContrast);
    showToast(
      state.highContrast
        ? "Alto contraste ativado."
        : "Alto contraste desativado."
    );
  });

  ui.vibrationToggle.addEventListener("change", () => {
    state.vibration = ui.vibrationToggle.checked;
    showToast(
      state.vibration
        ? "Feedback tátil ativado em dispositivos compatíveis."
        : "Feedback tátil desativado."
    );
  });

  ui.colorMode.addEventListener("change", () => {
    state.colorMode = ui.colorMode.value;
    document.body.dataset.colorMode = state.colorMode;
    showToast(
      state.colorMode === "none"
        ? "Filtro de cor desativado."
        : `Filtro de cor: ${ui.colorMode.options[ui.colorMode.selectedIndex].text}.`
    );
  });

  const handleMotionChange = (event) => {
    state.prefersReducedMotion = event.matches;
  };

  if (typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", handleMotionChange);
  } else if (typeof motionQuery.addListener === "function") {
    motionQuery.addListener(handleMotionChange);
  }

  window.addEventListener("pointerup", () => {
    if (state.pointerType === "touch" && !state.keyboardMode) {
      window.setTimeout(() => {
        if (!state.pointerInside) refreshActivity();
      }, 120);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.audioStarted && state.audioOn) {
      state.needsUpdate = false;
      audio.setActive(false);
    } else if (!document.hidden && state.active) {
      state.needsUpdate = true;
    }
  });
}

async function init() {
  ui.startButton.disabled = true;
  document.body.dataset.colorMode = "none";
  setupCanvasSizing();
  setupScopeSizing();
  setupEvents();
  updateAudioUI();

  try {
    await selectDataset("sst", { initial: true, sceneId: "global" });
  } catch {
    /* A mensagem de erro é apresentada por selectDataset. */
  }

  requestAnimationFrame(animate);
}

init();
