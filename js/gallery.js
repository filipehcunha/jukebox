// Galeria de escolha: mapas da NASA (GMAO) pré-carregados. Cada mapa tem a sua escala própria e fixa.
// Títulos e descrições ficam em js/i18n.js → "map.<id>.title" e "map.<id>.desc".

import { SCALES } from "./scales.js";
import { t } from "./i18n.js";

const GMAO_FRAMES = 372;
const pad6 = (n) => String(n).padStart(6, "0");

export function presetGroups() {
  const gmao = (key) => ({
    id: `gmao-${key}`,
    scaleId: key,
    projection: { type: "equirectangular" },
    source: "NASA GMAO · GEOS",
    sample: `assets/gmao_${key}.jpg`,
    sequencePrefix: `dados/${key}_frames/frame_`,
    frames: [{ name: `gmao_${key}.jpg`, src: `assets/gmao_${key}.jpg`, gmaoIndex: 100 }],
  });
  return [
    gmao("temp"),
    gmao("humidity"),
    gmao("wind"),
    gmao("co"),
  ];
}

/** Título do mapa no idioma atual */
export const groupTitle = (g) => t(`map.${g.id}.title`);

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
            gmaoIndex: i,
          }));
          g.startIndex = 100;
          g.sequence = true;
        } catch { /* sem pasta dados/ */ }
      })
  );
}

export function renderPresets(container, groups, onSelect) {
  container.innerHTML = "";
  for (const g of groups) {
    const scale = SCALES[g.scaleId];
    const title = groupTitle(g);
    const desc = t(`map.${g.id}.desc`);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "preset-card";
    card.setAttribute("aria-label", `${title}. ${desc}${g.sequence ? ` ${t("gallery.hours", { n: g.frames.length })}` : ""}`);
    card.innerHTML = `
      <span class="preset-card__media"><img src="${g.sample}" alt="" loading="lazy" decoding="async" width="320" height="160"></span>
      <span class="preset-card__body">
        <span class="preset-card__eyebrow"></span>
        <strong class="preset-card__title"></strong>
        <span class="preset-card__desc"></span>
        <span class="preset-card__bar" style="background:${scale.gradientCss()}"></span>
      </span>`;
    card.querySelector(".preset-card__eyebrow").textContent = `${scale.characteristicName} · ${scale.unit}`;
    card.querySelector(".preset-card__title").textContent = title;
    card.querySelector(".preset-card__desc").textContent = desc;
    card.addEventListener("click", () => onSelect(g, g.startIndex ?? 0));
    container.append(card);
  }
}
