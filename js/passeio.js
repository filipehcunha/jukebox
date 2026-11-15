// Passeio sonoro: o cursor percorre o mapa sozinho enquanto a pessoa escuta (varredura
// automática). Este módulo tem as partes independentes da interface: os caminhos, as
// estatísticas da travessia, o resumo falado no fim e a conversão da gravação para WAV.
// O controle (início, parada, gravação, botões) fica em app.js.

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export const ROUTES = {
  sinfonia: { label: "Sinfonia do mapa", hint: "uma faixa varre o mapa e compõe uma peça" },
  volta: { label: "Volta ao mundo", hint: "de oeste para leste, numa mesma latitude" },
  polos: { label: "De polo a polo", hint: "de norte a sul, numa mesma longitude" },
  mapa: { label: "Mapa inteiro", hint: "faixas de cima para baixo, em zigue-zague" },
};

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
    const lab = r.env?.label;
    if (lab && lab !== "mar") st.places[lab] = (st.places[lab] || 0) + 1;
  }
  if (!r.valid) return;
  st.validN += 1;
  if (scale.alertLevel(r.value) > 0) st.alertN += 1;
  const place = r.region?.name || null;
  if (!st.hi || r.value > st.hi.value) st.hi = { value: r.value, place };
  if (!st.lo || r.value < st.lo.value) st.lo = { value: r.value, place };
}

const pct = (a, b) => Math.round((100 * a) / Math.max(b, 1));
const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);

// Frase final: o que a travessia encontrou, inclusive quanto dela estava em alerta.
export function summarize(st, scale, { secs, completed, whole = false }) {
  const parts = [whole
    ? (completed ? `Fim da sinfonia, ${secs} segundos de música.` : `Sinfonia interrompida depois de ${secs} segundos.`)
    : completed ? `Passeio terminado em ${secs} segundos.` : `Passeio interrompido depois de ${secs} segundos.`];
  if (st.geoN) {
    const c = st.countries.size;
    const lands = c === 0 ? "nenhum país" : c === 1 ? "1 país" : `${c} países`;
    parts.push(whole
      ? `O mapa mostra ${lands}, e ${pct(st.oceanN, st.geoN)}% dele é oceano.`
      : `Você atravessou ${lands}, e ${pct(st.oceanN, st.geoN)}% do caminho foi sobre o oceano.`);
    const places = Object.entries(st.places).filter(([, n]) => pct(n, st.geoN) >= 2).sort((a, b) => b[1] - a[1]);
    if (places.length) parts.push(`${whole ? "Também há" : "Também passou por"} ${places.map(([lab, n]) => `${lab} (${pct(n, st.geoN)}%)`).join(", ")}.`);
  }
  const where = (x) => `${x.place ? `${x.place}, ` : ""}${lowerFirst(scale.sentence(scale.format(x.value)))}`;
  if (st.hi && st.lo) {
    parts.push(`Mais alto: ${where(st.hi)}. Mais baixo: ${where(st.lo)}.`);
  } else if (!st.validN) {
    parts.push("O caminho não passou por pontos com dados legíveis.");
  }
  if (scale.alert && st.validN) {
    parts.push(st.alertN
      ? `${pct(st.alertN, st.validN) < 1 ? "Um trecho curto" : `${pct(st.alertN, st.validN)}% ${whole ? "do mapa" : "do caminho"}`} com ${scale.alert.label}: foi o coração que você ouviu.`
      : `Nenhum trecho com ${scale.alert.label} ${whole ? "neste mapa" : "neste caminho"}.`);
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
