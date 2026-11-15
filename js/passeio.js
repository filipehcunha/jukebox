// Passeio sonoro: o cursor percorre o mapa sozinho enquanto a pessoa escuta (varredura
// automática). Este módulo tem as partes independentes da interface: os caminhos, as
// estatísticas da travessia, o resumo falado no fim e a conversão da gravação para WAV.
// O controle (início, parada, gravação, botões) fica em app.js.

import { t } from "./i18n.js";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// Caminhos (os nomes estão em lang/*.json → sweep.routes)
export const ROUTES = ["sinfonia", "volta", "polos", "mapa"];
export const routeLabel = (id) => t(`sweep.routes.${id}`);

const M = 0.004; // margem: não encosta na borda da imagem
const span = (q) => M + clamp(q) * (1 - 2 * M);

// Posição do cursor (u, v de 0 a 1) no instante p (0 = início, 1 = fim) do caminho.
// `origin` é onde o cursor estava ao começar: a volta ao mundo segue aquela latitude e
// o polo a polo segue aquela longitude.
export function routePoint(id, p, origin, rows = 5) {
  if (id === "volta") return { u: span(p), v: origin.v };
  if (id === "polos") return { u: origin.u, v: span(p) };
  const i = Math.min(rows - 1, Math.floor(clamp(p) * rows));
  const q = clamp(p) * rows - i;
  return { u: i % 2 ? span(1 - q) : span(q), v: (i + 0.5) / rows };
}

// ---------------------------------------------------------------------------
// Estatísticas da travessia (alimentadas a cada leitura durante o passeio)
// ---------------------------------------------------------------------------
export function createStats() {
  return { n: 0, geoN: 0, oceanN: 0, validN: 0, alertN: 0, countries: new Set(), places: {}, hi: null, lo: null };
}

export function addReading(st, r, scale) {
  st.n += 1;
  if (r.region) {
    st.geoN += 1;
    if (r.region.land === false) st.oceanN += 1;
    if (r.region.country) st.countries.add(r.region.country);
    const kind = r.env?.kind;
    if (kind && kind !== "sea") st.places[kind] = (st.places[kind] || 0) + 1;
  }
  if (!r.valid) return;
  st.validN += 1;
  if (scale.alertLevel(r.value) > 0) st.alertN += 1;
  const place = r.region?.name || null;
  if (!st.hi || r.value > st.hi.value) st.hi = { value: r.value, place };
  if (!st.lo || r.value < st.lo.value) st.lo = { value: r.value, place };
}

const pct = (a, b) => Math.round((100 * a) / Math.max(b, 1));
const lowerFirst = (x) => x.charAt(0).toLocaleLowerCase() + x.slice(1);

// Frase final: o que a travessia encontrou, inclusive quanto dela estava em alerta.
// Textos em lang/*.json → summary.
export function summarize(st, scale, { secs, completed, whole = false }) {
  const S = (key, vars) => t(`summary.${key}`, vars);
  const parts = [S(`${whole ? "symphony" : "walk"}${completed ? "Done" : "Stopped"}`, { secs })];
  if (st.geoN) {
    const c = st.countries.size;
    const lands = c === 0 ? S("noCountry") : c === 1 ? S("oneCountry") : S("countries", { n: c });
    parts.push(S(whole ? "mapShows" : "youCrossed", { lands, ocean: pct(st.oceanN, st.geoN) }));
    const places = Object.entries(st.places).filter(([, n]) => pct(n, st.geoN) >= 2).sort((a, b) => b[1] - a[1]);
    if (places.length) {
      const list = places.map(([kind, n]) => `${t(`places.${kind}`)} (${pct(n, st.geoN)}%)`).join(", ");
      parts.push(S(whole ? "alsoThere" : "alsoPassed", { list }));
    }
  }
  const where = (x) => `${x.place ? `${x.place}, ` : ""}${lowerFirst(scale.sentence(scale.format(x.value)))}`;
  if (st.hi && st.lo) parts.push(S("hiLo", { hi: where(st.hi), lo: where(st.lo) }));
  else if (!st.validN) parts.push(S("noData"));
  if (scale.alert && st.validN) {
    const p = pct(st.alertN, st.validN);
    const area = whole ? S("ofMap") : S("ofPath");
    parts.push(st.alertN
      ? S("alertYes", { part: p < 1 ? S("shortStretch") : `${p}% ${area}`, label: scale.alertLabel })
      : S("alertNo", { label: scale.alertLabel, where: whole ? S("onMap") : S("onPath") }));
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Exportação: a gravação (WebM/Ogg do MediaRecorder) vira WAV, que toca em qualquer lugar
// ---------------------------------------------------------------------------
export async function toWav(blob, audioContext) {
  const buf = await audioContext.decodeAudioData(await blob.arrayBuffer());
  return encodeWav(buf);
}

export function encodeWav(buf) {
  const ch = Math.min(buf.numberOfChannels, 2);
  const len = buf.length;
  const rate = buf.sampleRate;
  const bytes = len * ch * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (o, s) => { for (let i = 0; i < s.length; i += 1) view.setUint8(o + i, s.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, 36 + bytes, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * ch * 2, true); view.setUint16(32, ch * 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, bytes, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  // o limitador ao vivo não é rígido e a decodificação do Opus passa um pouco de 1,0: se o pico
  // passar de −0,3 dBFS, abaixa o arquivo inteiro (nunca aumenta) para não saturar
  let peak = 0;
  for (const d of data) for (let i = 0; i < len; i += 1) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  const gain = peak > 0.966 ? 0.94 / peak : 1;
  let o = 44;
  for (let i = 0; i < len; i += 1) {
    for (let c = 0; c < ch; c += 1) {
      const x = clamp(data[c][i] * gain, -1, 1);
      view.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view], { type: "audio/wav" });
}

export function fileName(title, routeId, ext = "wav") {
  const slug = (title || "mapa").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `sinfonia-da-terra-${slug}-${routeId}-${stamp}.${ext}`;
}
