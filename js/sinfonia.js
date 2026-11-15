// Sinfonia do mapa: uma faixa vertical varre a imagem da esquerda para a direita e cada
// coluna vira música, como nas sonificações da NASA (posição vertical → altura da nota,
// valor → intensidade). Diferente de uma tradução pixel a pixel, aqui há uma composição:
//
//   forma      abertura (só baixo e paisagem) → desenvolvimento → clímax → final com cadência
//   harmonia   um acorde por compasso, escolhido pelo valor médio da coluna:
//              baixo → vi (menor, melancólico) · IV · I · alto → V (tensão). Termina em V → I.
//   melodia    (camada média) segue a altura, no mapa, de onde os valores são mais altos
//   contracanto (camada aguda) notas longas na altura de onde os valores são mais baixos
//   arpejos    (camada de arpejo) surgem nas frentes e contrastes fortes e no clímax
//   baixo      (camada grave) fundamental e quinta do acorde
//
// Todas as notas saem da pentatônica maior da tonalidade; o baixo usa só fundamental e
// quinta, então nenhuma combinação dissona. Este módulo só calcula: quem toca é o audio.js.

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export const STEP_S = 0.25; // uma colcheia
export const BAR = 8; // colcheias por compasso (2 s)
export const ROWS = 24; // pontos lidos em cada coluna

// Lê o mapa inteiro, coluna a coluna. readAt(u, v) devolve a leitura do app (com .env).
export function analyze(readAt, scale, totalSteps, onRow) {
  const cols = [];
  for (let k = 0; k < totalSteps; k += 1) {
    const u = clamp((k + 0.5) / totalSteps, 0.004, 0.996);
    const vals = [];
    const amb = { mar: 0, gelo: 0, floresta: 0, deserto: 0 };
    let geoN = 0, alertN = 0, alertSum = 0;
    for (let i = 0; i < ROWS; i += 1) {
      const v = (i + 0.5) / ROWS;
      const r = readAt(u, v);
      onRow?.(r);
      if (r.env) {
        geoN += 1;
        for (const name of Object.keys(amb)) amb[name] += r.env.levels[name] || 0;
      }
      if (!r.valid) continue;
      vals.push({ v, norm: r.norm });
      const a = scale.alertLevel(r.value);
      if (a > 0) { alertN += 1; alertSum += a; }
    }
    const n = vals.length;
    const col = { u, n, mean: null, peak: 0, hotV: 0.5, coldV: 0.5, rough: 0, amb, alert: 0 };
    for (const name of Object.keys(amb)) amb[name] = geoN ? amb[name] / geoN : 0;
    amb.mar = amb.mar ** 0.7;
    for (const name of ["gelo", "floresta", "deserto"]) amb[name] = clamp(amb[name] * 2.5);
    if (n) {
      col.mean = vals.reduce((s, x) => s + x.norm, 0) / n;
      col.peak = Math.max(...vals.map((x) => x.norm));
      // centro de massa das partes mais altas e das mais baixas (contornos suaves)
      const centroid = (w) => {
        let sw = 0, sv = 0;
        for (const x of vals) { const q = w(x.norm) ** 2; sw += q; sv += q * x.v; }
        return sw > 1e-9 ? sv / sw : vals[Math.floor(n / 2)].v;
      };
      col.hotV = centroid((x) => Math.max(0, x - col.mean));
      col.coldV = centroid((x) => Math.max(0, col.mean - x));
      for (let i = 1; i < n; i += 1) col.rough += Math.abs(vals[i].norm - vals[i - 1].norm);
      col.rough /= Math.max(1, n - 1);
      if (alertN / n > 0.04) col.alert = clamp(0.2 + 0.8 * (alertSum / alertN));
    }
    cols.push(col);
  }
  // energia = contraste dentro da coluna + mudança em relação à coluna anterior (frentes)
  let prev = null;
  for (const c of cols) {
    c.energy = c.n ? c.rough + (prev !== null && c.mean !== null ? 2 * Math.abs(c.mean - prev) : 0) : 0;
    if (c.mean !== null) prev = c.mean;
  }
  const sorted = cols.map((c) => c.energy).sort((a, b) => a - b);
  for (const c of cols) c.eRank = sorted.findIndex((e) => e >= c.energy) / Math.max(1, sorted.length - 1);
  return cols;
}

const CHORDS = {
  I: { root: 0, tones: [0, 4, 7] },
  vi: { root: 9, tones: [9, 0, 4] },
  IV: { root: 5, tones: [5, 9, 0] },
  V: { root: 7, tones: [7, 2, 9] }, // suspenso (sem a terça): combina com a pentatônica
};
const PATTERNS = [
  [1, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 0, 1, 0, 0, 1, 0],
  [1, 0, 1, 1, 0, 1, 1, 0],
];

// Seções da peça em função da posição p (0 a 1)
export function sectionAt(p) {
  if (p < 0.1) return "abertura";
  if (p < 0.6) return "desenvolvimento";
  if (p < 0.82) return "clímax";
  return "final";
}
function dynamics(p) {
  if (p < 0.1) return 0.45 + 3.5 * p;
  if (p < 0.7) return 0.8 + (0.2 * (p - 0.1)) / 0.6;
  if (p < 0.82) return 1;
  return Math.max(0.66, 1 - 3.2 * (p - 0.82));
}

// ctx = { root (0..11), notes(lo, hi) → pentatônica MIDI, ranges: {low, mid, high, arp} → [lo, hi],
//         poly: {low: bool, ...}, low: modo de baixa sensibilidade }
// Retorna { steps: [[evento]], final: [evento], chords: [nome por compasso] }
// evento = { layer, midi, dur, vel, off (s dentro do passo), v? (altura no mapa, p/ o desenho) }
export function compose(cols, ctx) {
  const total = cols.length;
  const bars = Math.round(total / BAR);
  const pc = (m) => ((m % 12) + 12) % 12;
  const inRange = (layer, set) => {
    const [lo, hi] = ctx.ranges[layer];
    const out = [];
    for (let m = lo; m <= hi; m += 1) if (set.includes(pc(m - ctx.root))) out.push(m);
    return out;
  };
  const nearest = (list, m) => list.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));

  // harmonia: um acorde por compasso, pelo valor médio (relativo ao próprio mapa)
  const barMean = [];
  for (let b = 0; b < bars; b += 1) {
    const xs = cols.slice(b * BAR, (b + 1) * BAR).filter((c) => c.mean !== null).map((c) => c.mean);
    barMean.push(xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  }
  const known = barMean.filter((x) => x !== null);
  const lo = Math.min(...known, 1), hi = Math.max(...known, 0);
  const chords = barMean.map((m, b) => {
    if (b === 0 || b === bars - 1) return "I";
    if (b === bars - 2) return "V";
    if (m === null) return null; // mantém o anterior
    const q = hi - lo > 1e-6 ? (m - lo) / (hi - lo) : 0.6;
    return q < 0.25 ? "vi" : q < 0.5 ? "IV" : q < 0.75 ? "I" : "V";
  });
  for (let b = 1; b < bars; b += 1) if (!chords[b]) chords[b] = chords[b - 1];

  const melody = ctx.notes(...ctx.ranges.mid);
  const counter = ctx.notes(...ctx.ranges.high);
  const soft = ctx.low ? 0.7 : 1;
  const steps = [];
  let lastMel = null;
  for (let k = 0; k < total; k += 1) {
    const c = cols[k];
    const p = k / total;
    const b = Math.min(bars - 1, Math.floor(k / BAR));
    const s = k % BAR;
    const chord = CHORDS[chords[b]];
    const sec = sectionAt(p);
    const dyn = dynamics(p) ** 2 * soft; // ao quadrado: a abertura é bem suave e o clímax, cheio
    const ev = [];

    // baixo: fundamental (e quinta, se o instrumento for polifônico) no início do compasso
    if (s === 0) {
      const roots = inRange("low", [chord.root]);
      const root = nearest(roots, ctx.ranges.low[0] + 7);
      ev.push({ layer: "low", midi: root, dur: BAR * STEP_S * 0.97, vel: 0.2 + 0.3 * dyn, off: 0 });
      if (ctx.poly.low && root + 7 <= ctx.ranges.low[1]) ev.push({ layer: "low", midi: root + 7, dur: BAR * STEP_S * 0.97, vel: 0.06 + 0.26 * dyn, off: 0.02 });
    }

    if (c.n) {
      // melodia: ritmo conforme a seção e a energia; altura = onde estão os valores mais altos
      let d = sec === "abertura" ? 0 : sec === "desenvolvimento" ? (p < 0.3 ? 1 : 2) : sec === "clímax" ? 3 : p < 0.9 ? 2 : 1;
      if (sec === "desenvolvimento" && c.eRank > 0.7) d += 1;
      if (ctx.low) d = Math.max(0, d - 1);
      if (PATTERNS[Math.min(3, d)][s]) {
        let m = melody[Math.round((1 - c.hotV) * (melody.length - 1))];
        if (s === 0) m = nearest(inRange("mid", chord.tones), m); // tempo forte: nota do acorde
        if (m !== lastMel || s === 0) {
          const vel = clamp(0.12 + (0.38 + 0.45 * c.peak) * dyn, 0.08, 0.98);
          ev.push({ layer: "mid", midi: m, dur: 1.4, vel, off: 0, v: c.hotV });
          if (sec === "clímax" && s % 4 === 0 && m + 12 <= ctx.ranges.mid[1]) ev.push({ layer: "mid", midi: m + 12, dur: 1.2, vel: vel * 0.6, off: 0.01 });
          lastMel = m;
        }
      }
      // contracanto: nota longa a cada dois compassos, na altura dos valores mais baixos
      if (p >= 0.3 && p < 0.9 && k % (BAR * 2) === 4) {
        const m = counter[Math.round((1 - c.coldV) * (counter.length - 1))];
        ev.push({ layer: "high", midi: m, dur: 3.2, vel: 0.5 * dyn, off: 0, v: c.coldV });
      }
      // arpejos: nas frentes e contrastes fortes, e sempre no clímax
      const arpOn = sec === "clímax" || (sec === "desenvolvimento" && p > 0.2 && c.eRank > 0.65);
      if (arpOn && s % 2 === 1 && !(ctx.low && s % 4 === 3)) {
        const tones = inRange("arp", chord.tones);
        const base = Math.round(clamp(c.mean) * Math.max(0, tones.length - 5));
        const m = tones[Math.min(tones.length - 1, base + (s - 1) / 2)];
        ev.push({ layer: "arp", midi: m, dur: 0.9, vel: clamp((0.42 + 0.3 * c.eRank) * dyn), off: 0, v: 1 - (m - ctx.ranges.arp[0]) / (ctx.ranges.arp[1] - ctx.ranges.arp[0]) });
      }
    }
    steps.push(ev);
  }

  // acorde final: a tônica, arpejada de baixo para cima, deixada soar
  const I = CHORDS.I.tones;
  const final = [];
  const bass = nearest(inRange("low", [0]), ctx.ranges.low[0] + 7);
  final.push({ layer: "low", midi: bass, dur: 4.5, vel: 0.5 * soft, off: 0 });
  if (ctx.poly.low && bass + 7 <= ctx.ranges.low[1]) final.push({ layer: "low", midi: bass + 7, dur: 4.5, vel: 0.3 * soft, off: 0.03 });
  const mids = inRange("mid", I);
  const mi = mids.indexOf(nearest(mids, ctx.ranges.mid[0] + 6));
  mids.slice(mi, mi + 4).forEach((m, i) => final.push({ layer: "mid", midi: m, dur: 3.5, vel: (0.5 - 0.05 * i) * soft, off: 0.1 + i * 0.11, v: 0.5 }));
  inRange("arp", I).slice(0, 7).forEach((m, i) => final.push({ layer: "arp", midi: m, dur: 2.5, vel: (0.3 + 0.02 * i) * soft, off: 0.25 + i * 0.085 }));
  const top = inRange("high", [0]);
  if (top.length) final.push({ layer: "high", midi: top[Math.min(1, top.length - 1)], dur: 3.6, vel: 0.3 * soft, off: 0.5 });
  return { steps, final, chords };
}
