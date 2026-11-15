// Galeria: os mapas da NASA pré-carregados. Cada mapa tem a sua escala própria.
// Títulos e descrições ficam em lang/*.json → maps.<id>.

import { SCALES } from "./scales.js";
import { t } from "./i18n.js";

export function presetGroups() {
  const gmao = (key) => ({
    id: `gmao-${key}`,
    scaleId: key,
    projection: { type: "equirectangular" },
    src: `assets/gmao_${key}.jpg`,
  });
  const list = [
    { id: "ecco2", scaleId: "sst", projection: { type: "equirectangular" }, src: "assets/ecco2_sst.jpg" },
    {
      id: "gedi",
      scaleId: "gedi",
      // globo renderizado com câmera em perspectiva (a ~3,5 raios da Terra). Parâmetros
      // ajustados comparando terra/oceano da imagem com o countries.geojson: erro de 4,4%
      // dos pixels (a ortográfica antiga errava 36%, sobretudo perto da borda do globo).
      projection: { type: "perspective", cx: 0.5022, cy: 0.4999, r: 0.4772, aspect: 1024 / 576, lon0: 37.76, lat0: 0.13, dist: 3.53 },
      src: "assets/gedi_forest.jpg",
    },
    gmao("temp"),
    gmao("humidity"),
    gmao("wind"),
    gmao("co"),
  ];
  // textos no idioma atual
  for (const g of list) {
    Object.defineProperties(g, {
      title: { get: () => t(`maps.${g.id}.title`), enumerable: true },
      description: { get: () => t(`maps.${g.id}.description`), enumerable: true },
      source: { get: () => t(`maps.${g.id}.source`), enumerable: true },
    });
  }
  return list;
}

export function renderPresets(container, groups, onSelect) {
  container.innerHTML = "";
  for (const g of groups) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "preset-card";
    card.setAttribute("aria-label", `${g.title}. ${g.description}`);
    const img = document.createElement("img");
    img.src = g.src;
    img.alt = "";
    img.decoding = "async";
    img.loading = "lazy";
    img.width = 320;
    img.height = 160;
    img.setAttribute("aria-hidden", "true");
    const scale = SCALES[g.scaleId];
    card.innerHTML = `
      <span class="preset-card__media"></span>
      <span class="preset-card__body">
        <span class="preset-card__eyebrow">${g.source}</span>
        <strong class="preset-card__title">${g.title}</strong>
        <span class="preset-card__desc">${g.description}</span>
        <span class="preset-card__meta"><span class="chip">${scale.short} · ${scale.unit}</span></span>
        <span class="preset-card__bar" style="background:${scale.gradientCss()}"></span>
      </span>`;
    card.querySelector(".preset-card__media").append(img);
    card.addEventListener("click", () => onSelect(g));
    container.append(card);
  }
}
