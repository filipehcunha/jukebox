// Geografia: projeções, máscara terra/oceano, países e nomes de regiões.
// Os nomes saem no idioma escolhido (js/i18n.js).

import { t, getLang, num } from "./i18n.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let landMask = null; // { data: Uint8Array, width, height }

export async function loadLandMask(url = "assets/landmask.png") {
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const raw = ctx.getImageData(0, 0, c.width, c.height).data;
    const data = new Uint8Array(c.width * c.height);
    for (let i = 0; i < data.length; i += 1) data[i] = raw[i * 4] > 127 ? 1 : 0;
    landMask = { data, width: c.width, height: c.height };
  } catch {
    landMask = null;
  }
}

export function isLand(lat, lon) {
  if (!landMask) return null;
  const x = Math.floor(((lon + 180) / 360) * landMask.width) % landMask.width;
  const y = clamp(Math.floor(((90 - lat) / 180) * landMask.height), 0, landMask.height - 1);
  return landMask.data[y * landMask.width + x] === 1;
}

// ---------------------------------------------------------------------------
// Países (GeoJSON do Natural Earth, Admin 0 – Countries)
// ---------------------------------------------------------------------------

let countries = null; // [{ names: { pt, en }, iso, bbox, parts: [{ bbox, poly }] }]
const countryCache = new Map();
const CACHE_MAX = 5000;

// Nomes dos países nos idiomas do site, a partir do código ISO (Intl.DisplayNames).
// Se o navegador não souber o código, usa os nomes do próprio GeoJSON (NAME_PT, NAME_EN).
const displayNames = {};
for (const [lang, locale] of [["pt", "pt-BR"], ["en", "en"]]) {
  try { displayNames[lang] = new Intl.DisplayNames([locale], { type: "region" }); } catch { displayNames[lang] = null; }
}

function countryNames(props) {
  const p = props || {};
  const iso = p.ISO_A2_EH && p.ISO_A2_EH !== "-99" ? p.ISO_A2_EH : p.ISO_A2;
  const fromIntl = (lang) => {
    if (!displayNames[lang] || !iso || iso === "-99") return null;
    try {
      const n = displayNames[lang].of(iso);
      return n && n !== iso ? n : null; // código desconhecido: o Intl devolve o próprio código
    } catch { return null; }
  };
  const pt = fromIntl("pt") || p.NAME_PT || p.NAME || p.ADMIN || null;
  const en = fromIntl("en") || p.NAME_EN || p.NAME || p.ADMIN || null;
  return pt || en ? { pt: pt || en, en: en || pt, iso: iso && iso !== "-99" ? iso : null } : null;
}

function ringBBox(ring) {
  let minLo = 180, maxLo = -180, minLa = 90, maxLa = -90;
  for (const [lo, la] of ring) {
    if (lo < minLo) minLo = lo;
    if (lo > maxLo) maxLo = lo;
    if (la < minLa) minLa = la;
    if (la > maxLa) maxLa = la;
  }
  return [minLo, minLa, maxLo, maxLa];
}

export async function loadCountries(url = "assets/countries.geojson") {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const gj = await res.json();
    const list = [];
    for (const f of gj.features || []) {
      const g = f.geometry;
      if (!g) continue;
      let polys = [];
      if (g.type === "Polygon") polys = [g.coordinates];
      else if (g.type === "MultiPolygon") polys = g.coordinates;
      else continue;

      const names = countryNames(f.properties);
      if (!names) continue;

      const parts = polys.map((poly) => ({ bbox: ringBBox(poly[0]), poly }));
      const bbox = [
        Math.min(...parts.map((p) => p.bbox[0])),
        Math.min(...parts.map((p) => p.bbox[1])),
        Math.max(...parts.map((p) => p.bbox[2])),
        Math.max(...parts.map((p) => p.bbox[3])),
      ];
      list.push({ names, iso: names.iso, bbox, parts });
    }
    countries = list.length ? list : null;
  } catch {
    countries = null;
  }
  countryCache.clear();
}

// Ponto dentro de anel (ray casting)
function inRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// poly[0] = anel externo; poly[1..] = buracos (lagos, enclaves)
function inPoly(poly, lon, lat) {
  if (!inRing(poly[0], lon, lat)) return false;
  for (let k = 1; k < poly.length; k += 1) if (inRing(poly[k], lon, lat)) return false;
  return true;
}

// País em (lat, lon) ({ names, iso }), ou null (oceano, fora de qualquer polígono, ou dados não carregados).
export function countryAt(lat, lon) {
  if (!countries) return null;
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (countryCache.has(key)) return countryCache.get(key);

  let found = null;
  outer: for (const c of countries) {
    const b = c.bbox;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    for (const part of c.parts) {
      const pb = part.bbox;
      if (lon < pb[0] || lon > pb[2] || lat < pb[1] || lat > pb[3]) continue;
      if (inPoly(part.poly, lon, lat)) {
        found = c;
        break outer;
      }
    }
  }

  if (countryCache.size >= CACHE_MAX) countryCache.clear();
  countryCache.set(key, found);
  return found;
}

// Distância (km) de um ponto a um segmento, em plano local (boa para distâncias curtas).
function distToSegKm(px, py, ax, ay, bx, by, kx, ky) {
  const x0 = (px - ax) * kx, y0 = (py - ay) * ky;
  const dx = (bx - ax) * kx, dy = (by - ay) * ky;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp((x0 * dx + y0 * dy) / len2, 0, 1);
  return Math.hypot(x0 - t * dx, y0 - t * dy);
}

const NEAR_KM = 15; // tolerância do fallback de costa quando a máscara diz terra
const COAST_KM = 8; // tolerância quando a máscara diz oceano (ela erra no litoral)
const nearCache = new Map();

// País mais próximo dentro de `maxKm` (para pontos que caem logo fora da costa do GeoJSON).
// Só olha para os anéis externos (costas e fronteiras), ignorando lagos e enclaves.
export function nearestCountry(lat, lon, maxKm = NEAR_KM) {
  if (!countries) return null;
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${maxKm}`;
  if (nearCache.has(key)) return nearCache.get(key);

  const ky = 111;
  const kx = 111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const padLat = maxKm / ky;
  const padLon = maxKm / kx;

  let best = null;
  let bestD = maxKm;
  for (const c of countries) {
    const b = c.bbox;
    if (lon < b[0] - padLon || lon > b[2] + padLon || lat < b[1] - padLat || lat > b[3] + padLat) continue;
    for (const part of c.parts) {
      const pb = part.bbox;
      if (lon < pb[0] - padLon || lon > pb[2] + padLon || lat < pb[1] - padLat || lat > pb[3] + padLat) continue;
      const ring = part.poly[0];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const d = distToSegKm(lon, lat, ring[j][0], ring[j][1], ring[i][0], ring[i][1], kx, ky);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
  }

  if (nearCache.size >= CACHE_MAX) nearCache.clear();
  nearCache.set(key, best);
  return best;
}

// ---------------------------------------------------------------------------
// Projeção
// ---------------------------------------------------------------------------

// u,v (0..1 na imagem) -> {lat, lon} ou null
export function project(projection, u, v) {
  if (!projection || projection.type === "none") return null;
  if (projection.type === "equirectangular") {
    return { lat: 90 - v * 180, lon: u * 360 - 180 };
  }
  if (projection.type === "orthographic") {
    // centro e raio em frações da largura/altura da imagem; lat0 = inclinação do globo
    const { cx, cy, r, lon0, lat0 = 0, aspect } = projection;
    const x = ((u - cx) * aspect) / r;
    const y = (cy - v) / r;
    const rho = Math.hypot(x, y);
    if (rho > 1) return null;
    const D = Math.PI / 180;
    const c = Math.asin(rho);
    const p0 = lat0 * D;
    const lat = rho < 1e-9 ? lat0 : Math.asin(clamp(Math.cos(c) * Math.sin(p0) + (y * Math.sin(c) * Math.cos(p0)) / rho, -1, 1)) / D;
    const off = Math.atan2(x * Math.sin(c), rho * Math.cos(c) * Math.cos(p0) - y * Math.sin(c) * Math.sin(p0)) / D;
    let lon = lon0 + off;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;
    return { lat, lon };
  }
  if (projection.type === "perspective") {
    // Globo visto por uma câmera a `dist` raios da Terra do centro (perspectiva vertical).
    // cx, cy = centro do disco; r = raio do disco VISÍVEL (o limbo), em fração da altura;
    // o ponto central do globo é (lat0, lon0). Com dist enorme vira a ortográfica.
    const { cx, cy, r, lon0, lat0 = 0, dist, aspect } = projection;
    const x = ((u - cx) * aspect) / r;
    const y = (cy - v) / r;
    if (x * x + y * y > 1) return null;
    // raio saindo da câmera (0, 0, dist), olhando para -z; o limbo fica em tan = 1/√(dist²−1)
    const tmax = 1 / Math.sqrt(dist * dist - 1);
    const n = Math.hypot(x * tmax, y * tmax, 1);
    const dx = (x * tmax) / n, dy = (y * tmax) / n, dz = -1 / n;
    const b = dist * dz;
    const s = -b - Math.sqrt(Math.max(b * b - (dist * dist - 1), 0));
    const qx = s * dx, qy = s * dy, qz = dist + s * dz; // ponto da esfera no referencial da câmera
    // referencial da câmera -> Terra: z aponta para (lat0, lon0), x para leste, y para norte
    const D = Math.PI / 180;
    const sL = Math.sin(lon0 * D), cL = Math.cos(lon0 * D), sF = Math.sin(lat0 * D), cF = Math.cos(lat0 * D);
    const gx = -qx * sL - qy * sF * cL + qz * cF * cL;
    const gy = qx * cL - qy * sF * sL + qz * cF * sL;
    const gz = qy * cF + qz * sF;
    return { lat: Math.asin(clamp(gz, -1, 1)) / D, lon: Math.atan2(gy, gx) / D };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Regiões nomeadas (verificadas antes dos continentes/oceanos genéricos)
// ---------------------------------------------------------------------------

const NAMED = [
  { id: "antarctica", test: (la) => la <= -64 },
  { id: "greenland", test: (la, lo, land) => land && la >= 59 && lo >= -74 && lo <= -11 },
  { id: "arctic", test: (la) => la >= 78 },
  { id: "amazon", test: (la, lo, land) => land && la <= 5 && la >= -15 && lo >= -75 && lo <= -48 },
  { id: "sahara", test: (la, lo, land) => land && la >= 15 && la <= 33 && lo >= -17 && lo <= 32 },
  { id: "arabia", test: (la, lo, land) => land && la >= 12 && la <= 32 && lo >= 35 && lo <= 60 },
  { id: "tibet", test: (la, lo, land) => land && la >= 28 && la <= 38 && lo >= 78 && lo <= 102 },
  { id: "india", test: (la, lo, land) => land && la >= 7 && la < 28 && lo >= 68 && lo <= 90 },
  { id: "china", test: (la, lo, land) => land && la >= 20 && la <= 45 && lo > 102 && lo <= 123 },
  { id: "siberia", test: (la, lo, land) => land && la >= 50 && lo >= 60 && lo <= 180 },
  { id: "seAsia", test: (la, lo, land) => land && la >= -11 && la < 20 && lo >= 92 && lo <= 155 },
  { id: "australia", test: (la, lo, land) => land && la <= -10 && la >= -45 && lo >= 112 && lo <= 155 },
  { id: "madagascar", test: (la, lo, land) => land && la >= -26 && la <= -11.5 && lo >= 43 && lo <= 51 },
  { id: "congo", test: (la, lo, land) => land && la >= -10 && la <= 6 && lo >= 12 && lo <= 31 },
  { id: "sahel", test: (la, lo, land) => land && la >= 9 && la < 15 && lo >= -17 && lo <= 38 },
  { id: "mediterranean", test: (la, lo, land) => !land && la >= 30 && la <= 46 && lo >= -5 && lo <= 36 },
  { id: "gulfMexico", test: (la, lo, land) => !land && la >= 18 && la <= 31 && lo >= -98 && lo <= -81 },
  { id: "caribbean", test: (la, lo, land) => !land && la >= 9 && la < 18 && lo >= -88 && lo <= -60 },
  { id: "bengal", test: (la, lo, land) => !land && la >= 5 && la <= 22 && lo >= 80 && lo <= 95 },
  { id: "arabianSea", test: (la, lo, land) => !land && la >= 5 && la <= 25 && lo >= 55 && lo < 77 },
];

function oceanRegion(lat, lon) {
  if (lat >= 66.5) return "arcticOcean";
  if (lat <= -55) return "southernOcean";
  const n = lat >= 0;
  if (lon >= -70 && lon <= 20 && !(lat < 10 && lon < -80)) return n ? "northAtlantic" : "southAtlantic";
  if (lon > 20 && lon < 120 && lat < 30) return "indianOcean";
  if (lat > 23) return "northPacific";
  if (lat < -23) return "southPacific";
  return "equatorialPacific";
}

function landRegion(lat, lon) {
  if (lon >= -170 && lon < -25) {
    if (lat >= 15) return "northAmerica";
    if (lat >= 7) return "centralAmerica";
    return "southAmerica";
  }
  if (lon >= -25 && lon < 60) return lat >= 36 ? "europe" : lat >= 12 && lon >= 35 ? "middleEast" : "africa";
  if (lon >= 60) {
    if (lon >= 110 && lat < -10) return "oceania";
    return "asia";
  }
  return lat >= 0 ? "asia" : "oceania";
}

// Retorna { name, land, country, region, iso }, com os nomes no idioma atual.
// - Em terra, `name` é o nome do PAÍS (a região genérica vai para `region`).
// - No oceano (ou se não houver país), `name` continua sendo a região/oceano.
// - `country` é o nome do país, ou null (oceano / GeoJSON não carregado).
export function regionName(lat, lon) {
  const maskLand = isLand(lat, lon);
  let c = countryAt(lat, lon);
  // Ponto logo fora do polígono (costa recortada, cidade no litoral, ilha pequena): usa o país
  // mais próximo. A máscara de terra tem só 0,5°/px e erra no litoral (Lisboa e Suva caem no
  // "mar"), então mesmo com ela dizendo oceano aceitamos um país a até COAST_KM.
  if (!c) c = nearestCountry(lat, lon, maskLand === true ? NEAR_KM : COAST_KM);
  // Se há país no ponto, é terra, mesmo que a máscara divirja um pouco na costa.
  const land = c ? true : maskLand;

  let regionId;
  const named = NAMED.find((r) => r.test(lat, lon, land));
  if (named) regionId = named.id;
  else if (land === null) regionId = lat >= 0 ? "northHemisphere" : "southHemisphere";
  else regionId = land ? landRegion(lat, lon) : oceanRegion(lat, lon);

  const country = c ? c.names[getLang()] || c.names.en : null;
  const region = t(`region.${regionId}`);
  // Prioriza o país: é o que a narração deve falar.
  return { name: country || region, land, country, region, iso: c?.iso || null };
}

// ---------------------------------------------------------------------------
// Paisagem sonora: que tipo de lugar está sob o cursor (mar, gelo, floresta, deserto)
// ---------------------------------------------------------------------------
// Caixas aproximadas [latMín, latMáx, lonMín, lonMáx]. Quando o mapa tem um dado que diz
// mais (altura do dossel no GEDI, temperatura, umidade, temperatura do mar), o dado manda.
const DESERTS = [
  [15, 32, -17, 33], // Saara
  [13, 31, 36, 59], // Península Arábica
  [-28, -17, 12, 25], // Namíbia e Kalahari
  [-27, -18, -71, -68.5], // Atacama
  [-31, -19, 117, 142], // interior da Austrália
  [37, 46, 92, 112], // Gobi
  [36.5, 41.5, 76, 90], // Taklamakan
  [24, 29.5, 69, 73.5], // Thar
  [27, 34, 53, 66], // planaltos do Irã e do Afeganistão
  [27, 37, -117, -109], // Sonora e Mojave
];
const FORESTS = [
  [-15, 5, -75, -48], // Amazônia
  [-6, 5, 10, 30], // Bacia do Congo
  [-10, 7, 95, 152], // Sudeste Asiático insular e Nova Guiné
  [7, 18, -92, -77], // América Central
];
const inBox = (boxes, lat, lon) => boxes.some(([a, b, c, d]) => lat >= a && lat <= b && lon >= c && lon <= d);
const ramp = (e0, e1, x) => clamp((x - e0) / (e1 - e0), 0, 1);

// region = resultado de regionName; data = { scaleId, value, valid } da leitura atual.
// Retorna { levels: { mar, gelo, floresta, deserto } (0 a 1), id, label } ou null sem geografia.
// id = "mar", "marGelado", "gelo", "floresta", "deserto" ou "" (label = nome no idioma atual).
export function landscapeAt(lat, lon, region, data = {}) {
  if (!region || region.land === null || region.land === undefined) return null;
  const v = data.valid ? data.value : NaN;
  const has = (id) => data.scaleId === id && Number.isFinite(v);
  const L = { mar: 0, gelo: 0, floresta: 0, deserto: 0 };

  if (region.land === false) {
    L.mar = 1;
    // mar gelado: perto do ponto de congelamento (ECCO2) ou nas latitudes do gelo marinho
    L.gelo = has("sst") ? 0.7 * ramp(4, 0, v) : Math.abs(lat) >= 66 ? 0.5 : 0;
  } else {
    L.gelo = lat <= -60 || lat >= 70 || region.iso === "GL" ? 1 : 0;
    if (has("temp")) L.gelo = Math.max(L.gelo * ramp(5, -5, v), ramp(-5, -18, v));
    L.deserto = inBox(DESERTS, lat, lon) ? 1 : 0;
    L.floresta = inBox(FORESTS, lat, lon) ? 1 : 0;
    if (has("humidity") && Math.abs(lat) < 50) {
      L.deserto = Math.max(L.deserto, ramp(5, 2, v));
      L.floresta = Math.max(L.floresta, 0.8 * ramp(15, 19, v));
    }
    if (has("gedi")) L.floresta = ramp(6, 25, v); // altura do dossel: o dado manda
    // o gelo prevalece sobre os outros
    L.deserto *= 1 - L.gelo;
    L.floresta *= 1 - L.gelo;
    if (L.floresta && L.deserto) L[L.floresta >= L.deserto ? "deserto" : "floresta"] = 0;
  }

  let id = "";
  if (L.mar) id = L.gelo >= 0.35 ? "marGelado" : "mar";
  else {
    const top = ["gelo", "floresta", "deserto"].reduce((a, b) => (L[b] > L[a] ? b : a));
    if (L[top] >= 0.35) id = top;
  }
  return { levels: L, id, label: id ? t(`place.${id}`) : "" };
}

// "12,3° S · 45,6° O" (pt) / "12.3° S · 45.6° W" (en)
export function formatCoord(lat, lon) {
  const f = (n) => num(Math.abs(n), 1);
  return `${f(lat)}° ${t(lat >= 0 ? "coord.N" : "coord.S")} · ${f(lon)}° ${t(lon >= 0 ? "coord.E" : "coord.W")}`;
}