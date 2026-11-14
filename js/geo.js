// Geografia: projeções, máscara terra/oceano, países e nomes de regiões.

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

let countries = null; // [{ name, bbox, parts: [{ bbox, poly }] }]
const countryCache = new Map();
const CACHE_MAX = 5000;

let ptNames = null;
try {
  ptNames = new Intl.DisplayNames(["pt-BR"], { type: "region" });
} catch {
  ptNames = null;
}

// Nome em português a partir do código ISO; se não der, usa o nome do arquivo.
function countryName(props) {
  const p = props || {};
  const fallback = p.NAME_PT || p.NAME || p.ADMIN || null;
  const iso = p.ISO_A2_EH && p.ISO_A2_EH !== "-99" ? p.ISO_A2_EH : p.ISO_A2;
  if (ptNames && iso && iso !== "-99") {
    try {
      const n = ptNames.of(iso);
      // Quando o código é desconhecido, o Intl devolve o próprio código.
      if (n && n !== iso) return n;
    } catch {
      /* código inválido: cai no fallback */
    }
  }
  return fallback;
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

      const name = countryName(f.properties);
      if (!name) continue;

      const parts = polys.map((poly) => ({ bbox: ringBBox(poly[0]), poly }));
      const bbox = [
        Math.min(...parts.map((p) => p.bbox[0])),
        Math.min(...parts.map((p) => p.bbox[1])),
        Math.max(...parts.map((p) => p.bbox[2])),
        Math.max(...parts.map((p) => p.bbox[3])),
      ];
      list.push({ name, bbox, parts });
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

// Nome do país em (lat, lon), ou null (oceano, fora de qualquer polígono, ou dados não carregados).
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
        found = c.name;
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

const NEAR_KM = 15; // tolerância padrão do fallback de costa
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
          best = c.name;
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
  return null;
}

// ---------------------------------------------------------------------------
// Regiões nomeadas (verificadas antes dos continentes/oceanos genéricos)
// ---------------------------------------------------------------------------

const NAMED = [
  { name: "Antártida", test: (la) => la <= -64 },
  { name: "Groenlândia", test: (la, lo, land) => land && la >= 59 && lo >= -74 && lo <= -11 },
  { name: "Ártico", test: (la) => la >= 78 },
  { name: "Amazônia", test: (la, lo, land) => land && la <= 5 && la >= -15 && lo >= -75 && lo <= -48 },
  { name: "Saara", test: (la, lo, land) => land && la >= 15 && la <= 33 && lo >= -17 && lo <= 32 },
  { name: "Península Arábica", test: (la, lo, land) => land && la >= 12 && la <= 32 && lo >= 35 && lo <= 60 },
  { name: "Planalto Tibetano", test: (la, lo, land) => land && la >= 28 && la <= 38 && lo >= 78 && lo <= 102 },
  { name: "Índia", test: (la, lo, land) => land && la >= 7 && la < 28 && lo >= 68 && lo <= 90 },
  { name: "China", test: (la, lo, land) => land && la >= 20 && la <= 45 && lo > 102 && lo <= 123 },
  { name: "Sibéria", test: (la, lo, land) => land && la >= 50 && lo >= 60 && lo <= 180 },
  { name: "Sudeste Asiático", test: (la, lo, land) => land && la >= -11 && la < 20 && lo >= 92 && lo <= 155 },
  { name: "Austrália", test: (la, lo, land) => land && la <= -10 && la >= -45 && lo >= 112 && lo <= 155 },
  { name: "Madagascar", test: (la, lo, land) => land && la >= -26 && la <= -11.5 && lo >= 43 && lo <= 51 },
  { name: "Bacia do Congo", test: (la, lo, land) => land && la >= -10 && la <= 6 && lo >= 12 && lo <= 31 },
  { name: "Sahel", test: (la, lo, land) => land && la >= 9 && la < 15 && lo >= -17 && lo <= 38 },
  { name: "Mar Mediterrâneo", test: (la, lo, land) => !land && la >= 30 && la <= 46 && lo >= -5 && lo <= 36 },
  { name: "Golfo do México", test: (la, lo, land) => !land && la >= 18 && la <= 31 && lo >= -98 && lo <= -81 },
  { name: "Mar do Caribe", test: (la, lo, land) => !land && la >= 9 && la < 18 && lo >= -88 && lo <= -60 },
  { name: "Golfo de Bengala", test: (la, lo, land) => !land && la >= 5 && la <= 22 && lo >= 80 && lo <= 95 },
  { name: "Mar da Arábia", test: (la, lo, land) => !land && la >= 5 && la <= 25 && lo >= 55 && lo < 77 },
];

function oceanRegion(lat, lon) {
  if (lat >= 66.5) return "Oceano Ártico";
  if (lat <= -55) return "Oceano Austral";
  const hemi = lat >= 0 ? "Norte" : "Sul";
  if (lon >= -70 && lon <= 20 && !(lat < 10 && lon < -80)) return `Atlântico ${hemi}`;
  if (lon > 20 && lon < 120 && lat < 30) return `Oceano Índico`;
  if (lat > 23) return "Pacífico Norte";
  if (lat < -23) return "Pacífico Sul";
  return "Pacífico Equatorial";
}

function landRegion(lat, lon) {
  if (lon >= -170 && lon < -25) {
    if (lat >= 15) return "América do Norte";
    if (lat >= 7) return "América Central";
    return "América do Sul";
  }
  if (lon >= -25 && lon < 60) return lat >= 36 ? "Europa" : lat >= 12 && lon >= 35 ? "Oriente Médio" : "África";
  if (lon >= 60) {
    if (lon >= 110 && lat < -10) return "Oceania";
    return "Ásia";
  }
  return lat >= 0 ? "Ásia" : "Oceania";
}

// Retorna { name, land, country, region }.
// - Em terra, `name` é o nome do PAÍS (a região genérica vai para `region`).
// - No oceano (ou se não houver país), `name` continua sendo a região/oceano.
// - `country` é o país em português, ou null (oceano / GeoJSON não carregado).
export function regionName(lat, lon) {
  const maskLand = isLand(lat, lon);
  let country = countryAt(lat, lon);
  // Máscara diz terra, mas o ponto caiu logo fora do polígono (costa): usa o país mais próximo.
  if (!country && maskLand === true) country = nearestCountry(lat, lon);
  // Se há país no ponto, é terra, mesmo que a máscara divirja um pouco na costa.
  const land = country ? true : maskLand;

  let region;
  const named = NAMED.find((r) => r.test(lat, lon, land));
  if (named) region = named.name;
  else if (land === null) region = lat >= 0 ? "Hemisfério Norte" : "Hemisfério Sul";
  else region = land ? landRegion(lat, lon) : oceanRegion(lat, lon);

  // Prioriza o país: é o que a narração deve falar.
  return { name: country || region, land, country, region };
}

export function formatCoord(lat, lon) {
  const f = (n) => Math.abs(n).toFixed(1).replace(".", ",");
  return `${f(lat)}° ${lat >= 0 ? "N" : "S"} · ${f(lon)}° ${lon >= 0 ? "L" : "O"}`;
}