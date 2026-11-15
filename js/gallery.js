// Galeria de escolha: imagens pré-carregadas da NASA + pastas/arquivos locais do usuário.

import { SCALES, scaleFromName } from "./scales.js";

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const PAGE = 36;
const GMAO_FRAMES = 372;

const pad6 = (n) => String(n).padStart(6, "0");
const naturalSort = (a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true, sensitivity: "base" });

// Cenas pré-carregadas (requisito 1: ECCO2 e GEDI sempre disponíveis)
export function presetGroups() {
  const gmao = (key, title, desc) => ({
    id: `gmao-${key}`,
    preset: true,
    title,
    description: desc,
    scaleId: key,
    projection: { type: "equirectangular" },
    source: "NASA GMAO · GEOS (30 out – 14 nov 2026)",
    sample: `assets/gmao_${key}.jpg`,
    sequencePrefix: `dados/${key}_frames/frame_`,
    frames: [{ name: `gmao_${key}.jpg`, src: `assets/gmao_${key}.jpg`, thumb: `assets/gmao_${key}.jpg`, gmaoIndex: 100 }],
  });
  return [
    {
      id: "ecco2",
      preset: true,
      title: "Temperatura dos Oceanos · ECCO2",
      description: "Temperatura e correntes da superfície do mar (modelo ECCO2, MIT/JPL).",
      scaleId: "sst",
      projection: { type: "equirectangular" },
      source: "NASA SVS · ECCO2",
      frames: [{ name: "ecco2_sst.jpg", src: "assets/ecco2_sst.jpg", thumb: "assets/ecco2_sst.jpg" }],
    },
    {
      id: "gedi",
      preset: true,
      title: "Altura das Florestas · GEDI",
      description: "Altura do dossel florestal medida por laser a bordo da ISS.",
      scaleId: "gedi",
      // globo renderizado com câmera em perspectiva (a ~3,5 raios da Terra). Parâmetros
      // ajustados comparando terra/oceano da imagem com o countries.geojson: erro de 4,4%
      // dos pixels (a ortográfica antiga errava 36%, sobretudo perto da borda do globo).
      projection: { type: "perspective", cx: 0.5022, cy: 0.4999, r: 0.4772, aspect: 1024 / 576, lon0: 37.76, lat0: 0.13, dist: 3.53 },
      source: "NASA SVS · GEDI",
      frames: [{ name: "gedi_forest.jpg", src: "assets/gedi_forest.jpg", thumb: "assets/gedi_forest.jpg" }],
    },
    gmao("temp", "Temperatura do Ar · T2M", "Temperatura a 2 m da superfície, de −40 °C a 40 °C."),
    gmao("humidity", "Umidade do Ar · Q2M", "Gramas de vapor d'água por quilo de ar, de 0 a 22 g/kg."),
    gmao("wind", "Velocidade do Vento", "Vento perto da superfície, da calmaria à força de furacão."),
    gmao("co", "Monóxido de Carbono · CO", "Partes por bilhão (ppbv): queimadas, indústria e transporte."),
  ];
}

// Se a pasta dados/ estiver servida junto com o site, os presets GMAO viram sequências
// horárias completas (372 frames) com linha do tempo.
export async function upgradeGmaoSequences(groups) {
  await Promise.all(
    groups
      .filter((g) => g.sequencePrefix)
      .map(async (g) => {
        try {
          const res = await fetch(`${g.sequencePrefix}${pad6(0)}.jpg`, { method: "HEAD", cache: "no-store" });
          if (!res.ok) return;
          g.frames = Array.from({ length: GMAO_FRAMES }, (_, i) => ({
            name: `frame_${pad6(i)}.jpg`,
            src: `${g.sequencePrefix}${pad6(i)}.jpg`,
            thumb: null,
            gmaoIndex: i,
          }));
          g.startIndex = 100;
          g.sequence = true;
        } catch { /* sem pasta dados/ */ }
      })
  );
}

// Agrupa arquivos locais por pasta
export function groupFiles(files) {
  const byDir = new Map();
  for (const file of files) {
    if (!IMAGE_RE.test(file.name)) continue;
    const rel = file.webkitRelativePath || file._relPath || file.name;
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "Imagens selecionadas";
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push({ name: file.name, src: file, thumb: null });
  }
  const groups = [];
  for (const [dir, frames] of byDir) {
    frames.sort(naturalSort);
    const scaleId = scaleFromName(dir) || scaleFromName(frames[0].name);
    const gmaoLike = scaleId && SCALES[scaleId].family === "gmao";
    frames.forEach((f) => {
      const m = gmaoLike && f.name.match(/frame_(\d+)/);
      if (m) f.gmaoIndex = Number(m[1]);
    });
    groups.push({
      id: `local-${dir}-${frames.length}-${Math.random().toString(36).slice(2, 6)}`,
      preset: false,
      title: dir.split("/").pop() || dir,
      path: dir,
      description: `${frames.length} ${frames.length === 1 ? "imagem" : "imagens"} da sua pasta`,
      scaleId, // null = detectar pelas cores ao abrir
      projection: null, // decidido ao abrir (proporção 2:1 => equirretangular)
      source: "Arquivos locais",
      frames,
      sequence: frames.length > 1,
      shown: Math.min(PAGE, frames.length),
    });
  }
  return groups.sort((a, b) => a.path.localeCompare(b.path, "pt-BR", { numeric: true }));
}

// Lê pastas arrastadas (DataTransferItem.webkitGetAsEntry)
export async function filesFromDrop(dataTransfer) {
  const out = [];
  const walk = async (entry, path) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      file._relPath = path + file.name;
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${path}${entry.name}/`);
      } while (batch.length);
    }
  };
  const entries = [...dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];
  for (const e of entries) await walk(e, "");
  return out;
}

// ---------------- miniaturas preguiçosas ----------------
const queue = [];
let running = 0;
function pump() {
  while (running < 3 && queue.length) {
    const job = queue.shift();
    running += 1;
    job().finally(() => {
      running -= 1;
      pump();
    });
  }
}

async function makeThumb(frame) {
  if (frame.thumb) return frame.thumb;
  let bmp;
  if (typeof frame.src === "string") {
    const blob = await (await fetch(frame.src)).blob();
    bmp = await createImageBitmap(blob, { resizeWidth: 320, resizeQuality: "low" });
  } else {
    bmp = await createImageBitmap(frame.src, { resizeWidth: 320, resizeQuality: "low" });
  }
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close?.();
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
  frame.thumb = URL.createObjectURL(blob);
  return frame.thumb;
}

const observer =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            observer.unobserve(e.target);
            const img = e.target;
            const frame = img._frame;
            queue.push(() =>
              makeThumb(frame)
                .then((url) => {
                  img.src = url;
                })
                .catch(() => img.closest(".thumb")?.classList.add("thumb--error"))
            );
            pump();
          }
        },
        { rootMargin: "300px" }
      )
    : null;

function lazyImg(frame, alt) {
  const img = document.createElement("img");
  img.alt = alt;
  img.decoding = "async";
  img.width = 320;
  img.height = 160;
  if (frame.thumb) img.src = frame.thumb;
  else if (observer) {
    img._frame = frame;
    observer.observe(img);
  } else makeThumb(frame).then((u) => (img.src = u));
  return img;
}

// ---------------- renderização ----------------
function scaleBadge(group) {
  const s = group.scaleId ? SCALES[group.scaleId] : null;
  return s ? s.short : "Escala detectada ao abrir";
}

export function renderPresets(container, groups, onSelect) {
  container.innerHTML = "";
  for (const g of groups) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "preset-card";
    card.setAttribute("aria-label", `${g.title}. ${g.description} ${g.sequence ? `${g.frames.length} horas com linha do tempo.` : ""}`);
    const thumbFrame = { thumb: g.sample || g.frames[0].thumb, src: g.sample || g.frames[0].src };
    const img = lazyImg(thumbFrame, "");
    img.setAttribute("aria-hidden", "true");
    const scale = SCALES[g.scaleId];
    card.innerHTML = `
      <span class="preset-card__media"></span>
      <span class="preset-card__body">
        <span class="preset-card__eyebrow">${g.source}</span>
        <strong class="preset-card__title">${g.title}</strong>
        <span class="preset-card__desc">${g.description}</span>
        <span class="preset-card__meta">
          <span class="chip">${scale.short} · ${scale.unit}</span>
          ${g.sequence ? `<span class="chip chip--accent">${g.frames.length} frames horários</span>` : `<span class="chip">1 imagem</span>`}
        </span>
        <span class="preset-card__bar" style="background:${scale.gradientCss()}"></span>
      </span>`;
    card.querySelector(".preset-card__media").append(img);
    card.addEventListener("click", () => onSelect(g, g.startIndex ?? 0));
    container.append(card);
  }
}

export function renderLocalGroups(container, groups, { onSelect, onScaleChange }) {
  container.innerHTML = "";
  for (const g of groups) {
    const section = document.createElement("section");
    section.className = "folder";
    section.setAttribute("aria-label", `Pasta ${g.title}`);
    const head = document.createElement("div");
    head.className = "folder__head";
    head.innerHTML = `
      <div>
        <h3 class="folder__title"><span aria-hidden="true">📁</span> ${escapeHtml(g.path)}</h3>
        <p class="folder__desc">${g.description}${g.sequence ? " · abre com linha do tempo" : ""}</p>
      </div>`;
    const label = document.createElement("label");
    label.className = "folder__scale";
    label.innerHTML = `<span>Escala de cores</span>`;
    const select = document.createElement("select");
    select.innerHTML =
      `<option value="">Detectar automaticamente</option>` +
      Object.values(SCALES)
        .map((s) => `<option value="${s.id}" ${s.id === g.scaleId ? "selected" : ""}>${s.label}</option>`)
        .join("");
    select.addEventListener("change", () => onScaleChange(g, select.value || null));
    label.append(select);
    head.append(label);
    section.append(head);

    const grid = document.createElement("ul");
    grid.className = "thumb-grid";
    grid.setAttribute("role", "list");
    section.append(grid);

    const renderPage = () => {
      const from = grid.children.length;
      for (let i = from; i < g.shown; i += 1) {
        const f = g.frames[i];
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "thumb";
        btn.setAttribute("aria-label", `Explorar ${f.name} (${i + 1} de ${g.frames.length}, ${scaleBadge(g)})`);
        btn.append(lazyImg(f, ""));
        const cap = document.createElement("span");
        cap.className = "thumb__name";
        cap.textContent = f.name;
        btn.append(cap);
        btn.addEventListener("click", () => onSelect(g, i));
        li.append(btn);
        grid.append(li);
      }
      more.hidden = g.shown >= g.frames.length;
      more.textContent = `Mostrar mais (${g.frames.length - g.shown} restantes)`;
    };
    const more = document.createElement("button");
    more.type = "button";
    more.className = "button button--ghost folder__more";
    more.addEventListener("click", () => {
      g.shown = Math.min(g.frames.length, g.shown + PAGE * 2);
      renderPage();
    });
    section.append(more);
    renderPage();
    container.append(section);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
