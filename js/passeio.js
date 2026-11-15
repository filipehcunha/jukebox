// Passeio sonoro (tecla V): o cursor atravessa o mapa sozinho, de oeste para leste, na altura
// em que estava, enquanto a pessoa escuta o instrumento subir e descer. Este módulo tem as
// partes independentes da interface: o caminho, as estatísticas da travessia e o resumo
// falado no fim. O controle (início, parada, botão) fica em app.js.

import { t } from "./i18n.js";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const M = 0.004; // margem: não encosta na borda da imagem

// Posição do cursor (u, v de 0 a 1) no instante p (0 = início, 1 = fim) do passeio.
export function routePoint(p, origin) {
  return { u: M + clamp(p) * (1 - 2 * M), v: origin.v };
}

// ---------------------------------------------------------------------------
// Estatísticas da travessia (alimentadas a cada leitura durante o passeio)
// ---------------------------------------------------------------------------
export function createStats() {
  return { n: 0, geoN: 0, oceanN: 0, validN: 0, alertN: 0, countries: new Set(), hi: null, lo: null };
}

export function addReading(st, r, scale) {
  st.n += 1;
  if (r.region) {
    st.geoN += 1;
    if (r.region.land === false) st.oceanN += 1;
    if (r.region.country) st.countries.add(r.region.country);
  }
  if (!r.valid) return;
  st.validN += 1;
  if (scale.alertLevel(r.value) > 0) st.alertN += 1;
  const place = r.region?.name || null;
  if (!st.hi || r.value > st.hi.value) st.hi = { value: r.value, place };
  if (!st.lo || r.value < st.lo.value) st.lo = { value: r.value, place };
}

const pct = (a, b) => Math.round((100 * a) / Math.max(b, 1));

// Frase final: o que a travessia encontrou.
export function summarize(st, scale, { secs, completed }) {
  const parts = [t(completed ? "tour.done" : "tour.stopped", { s: secs })];
  if (st.geoN) {
    const c = st.countries.size;
    parts.push(t("tour.crossed", { n: c, pct: pct(st.oceanN, st.geoN) }));
  }
  const where = (x) => `${x.place ? `${x.place}, ` : ""}${scale.spoken(x.value)}`;
  if (st.hi && st.lo) {
    parts.push(t("tour.hiLo", { hi: where(st.hi), lo: where(st.lo) }));
  } else if (!st.validN) {
    parts.push(t("tour.noData"));
  }
  if (scale.alert && st.alertN) parts.push(t("tour.alert", { pct: Math.max(1, pct(st.alertN, st.validN)), label: scale.alert.label }));
  return parts.join(" ");
}
