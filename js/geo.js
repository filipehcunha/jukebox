// Geografia: projeções, máscara terra/oceano e nomes de regiões.

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

// Regiões nomeadas (verificadas antes dos continentes/oceanos genéricos)
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

export function regionName(lat, lon) {
  const land = isLand(lat, lon);
  for (const r of NAMED) {
    if (r.test(lat, lon, land)) return { name: r.name, land };
  }
  if (land === null) return { name: lat >= 0 ? "Hemisfério Norte" : "Hemisfério Sul", land: null };
  return { name: land ? landRegion(lat, lon) : oceanRegion(lat, lon), land };
}

export function formatCoord(lat, lon) {
  const f = (n) => Math.abs(n).toFixed(1).replace(".", ",");
  return `${f(lat)}° ${lat >= 0 ? "N" : "S"} · ${f(lon)}° ${lon >= 0 ? "L" : "O"}`;
}
