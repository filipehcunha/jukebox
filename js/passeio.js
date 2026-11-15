// Passeio sonoro (tecla V): o cursor passeia sozinho pelo mapa, em movimentos aleatórios e
// contínuos, enquanto a pessoa escuta o instrumento subir e descer. Este módulo tem só o
// caminho; o controle (início, parada, botão) fica em app.js.
//
// O cursor anda em velocidade constante e muda de direção aos poucos (curvas suaves, sem
// saltos), escolhendo uma nova curva de tempos em tempos. Ao chegar a uma borda, ele
// "quica" de volta para dentro do mapa, como uma bola de bilhar.

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const MU = 0.01; // margem horizontal: não encosta na borda da imagem
const MV = 0.03; // margem vertical

/**
 * Cria o passeio a partir da posição atual do cursor.
 * @param {{u: number, v: number}} origin  posição inicial (0 a 1)
 * @param {object} [opts]
 * @param {number} [opts.speed]   largura do mapa percorrida por segundo (config.json → passeio.velocidade)
 * @param {number} [opts.aspect]  largura / altura do mapa (para a velocidade ser igual nos dois eixos)
 */
export function createWander(origin, { speed = 0.05, aspect = 2 } = {}) {
  return {
    u: clamp(origin.u, MU, 1 - MU),
    v: clamp(origin.v, MV, 1 - MV),
    heading: Math.random() * Math.PI * 2,
    turn: 0,
    targetTurn: 0,
    nextChange: 0,
    t: 0,
    speed,
    aspect,
  };
}

/** Avança o passeio `dt` segundos e devolve a nova posição { u, v }. */
export function stepWander(w, dt) {
  dt = clamp(dt, 0, 0.1); // aba em segundo plano ou travada: não dá um salto
  w.t += dt;
  if (w.t >= w.nextChange) {
    // nova curva: para a esquerda ou para a direita, mais aberta ou mais fechada
    w.targetTurn = (Math.random() * 2 - 1) * 1.8;
    w.nextChange = w.t + 0.8 + Math.random() * 2;
  }
  w.turn += (w.targetTurn - w.turn) * Math.min(1, dt * 2);
  w.heading += w.turn * dt;
  let u = w.u + Math.cos(w.heading) * w.speed * dt;
  let v = w.v + Math.sin(w.heading) * w.speed * w.aspect * dt;
  if (u < MU || u > 1 - MU) { w.heading = Math.PI - w.heading; u = clamp(u, MU, 1 - MU); }
  if (v < MV || v > 1 - MV) { w.heading = -w.heading; v = clamp(v, MV, 1 - MV); }
  w.u = u;
  w.v = v;
  return { u, v };
}
