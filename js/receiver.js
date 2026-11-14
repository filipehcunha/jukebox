// Página receptora do smartphone: recebe pacotes WebRTC e aciona navigator.vibrate().

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const pulseEl = $("pulse");
const canVibrate = typeof navigator.vibrate === "function";
let enabled = false;
let low = false;
let current = null; // último pacote háptico
let lastPacket = 0;
let nextTick = 0;

function step(name, s, detail = "") {
  const li = document.querySelector(`[data-step="${name}"]`);
  if (!li) return;
  li.dataset.s = s;
  li.querySelector("small")?.remove();
  if (detail) {
    const sm = document.createElement("small");
    sm.textContent = detail;
    li.append(sm);
  }
}
step("vibe", canVibrate ? "warn" : "err", canVibrate ? "Toque no botão acima para liberar." : "Não suportada neste navegador (iPhone/Safari). Usando pulso visual.");

function setStatus(text, s = "") {
  statusEl.textContent = text;
  statusEl.dataset.s = s;
}

$("support").textContent = canVibrate
  ? "Dica: deixe a tela ligada e o som do celular no modo vibração."
  : "Este navegador não oferece vibração (ex.: iPhone/Safari). O círculo pulsa visualmente no lugar da vibração.";

$("enable").addEventListener("click", () => {
  enabled = true;
  // o primeiro vibrate precisa acontecer dentro de um gesto do usuário
  if (canVibrate) navigator.vibrate([30, 60, 30]);
  $("enable").textContent = canVibrate ? "Vibração ativada ✓" : "Pulso visual ativado ✓";
  $("enable").setAttribute("aria-pressed", "true");
  if (canVibrate) step("vibe", "ok", "Liberada. Se não sentir nada, desative o modo silencioso total.");
  try { navigator.wakeLock?.request("screen"); } catch { /* noop */ }
});

function flash(strength) {
  pulseEl.style.setProperty("--s", strength.toFixed(2));
  pulseEl.classList.add("hit");
  setTimeout(() => pulseEl.classList.remove("hit"), 70);
}

function vibrate(pattern) {
  if (enabled && canVibrate) navigator.vibrate(pattern);
}

function handle(msg) {
  if (msg.type === "hello" || msg.type === "mode") {
    low = !!msg.low;
    return;
  }
  if (msg.type !== "haptic") return;
  lastPacket = performance.now();
  current = msg;
  if (msg.color) pulseEl.style.setProperty("--c", msg.color.join(" "));
  if (msg.value) $("value").textContent = msg.value;
  if (msg.zone) $("zone").textContent = [msg.region, msg.zone].filter(Boolean).join(" · ");
  if (msg.event === "transition") {
    // cruzou uma zona (ex.: de "Ameno" para "Quente"): pulso duplo marcado
    vibrate(low ? [25, 50, 25] : [55, 45, 70]);
    flash(1);
    nextTick = performance.now() + 220;
    patternEnds = 0;
  } else if (msg.event === "front" && performance.now() > nextTick) {
    vibrate(low ? [20] : [35, 30, 20]);
    flash(0.8);
    nextTick = performance.now() + 120;
    patternEnds = 0;
  } else if (msg.event === "idle") {
    current = null;
    pulseEl.style.setProperty("--s", "0");
  }
}

// Pulsação contínua no ritmo da cor sob o cursor: vermelho/quente = pulsos curtos e
// rápidos, azul/frio = pulsos longos e lentos. Emite um padrão de ~0,6 s por vez
// (navigator.vibrate([pulso, intervalo, pulso, ...])) e o reemite quando o ritmo muda.
let patternStart = 0;
let patternEnds = 0;
let patternKey = "";
let nextFlash = 0;
function loop() {
  const now = performance.now();
  const live = current && current.pulse > 0 && now - lastPacket < 600;
  if (live) {
    const period = current.pulse + current.gap;
    const key = `${current.pulse}|${current.gap}`;
    const changed = key !== patternKey && now - patternStart > 120;
    if (now >= nextTick && (now >= patternEnds || changed)) {
      const reps = Math.max(1, Math.round(640 / period));
      const pattern = [];
      for (let i = 0; i < reps; i += 1) pattern.push(current.pulse, current.gap);
      vibrate(pattern);
      patternStart = now;
      patternEnds = now + reps * period;
      patternKey = key;
    }
    if (now >= nextFlash) {
      flash(current.strength);
      nextFlash = now + period;
    }
    $("rate").textContent = `${current.hz >= 10 ? Math.round(current.hz) : current.hz.toFixed(1).replace(".", ",")} pulsos/s · ${current.pulse} ms`;
  } else if (patternEnds) {
    if (enabled && canVibrate) navigator.vibrate(0);
    patternEnds = 0;
    patternKey = "";
    $("rate").textContent = "—";
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------- conexão ----------------
const hostId = decodeURIComponent(location.hash.slice(1) || new URLSearchParams(location.search).get("id") || "");
if (!hostId) {
  setStatus("Código ausente. Escaneie o QR Code exibido no computador.", "err");
} else if (typeof window.Peer === "undefined") {
  setStatus("Não foi possível carregar o PeerJS. Verifique a internet do celular.", "err");
} else {
  step("signal", "warn", "Conectando a 0.peerjs.com…");
  const peer = new window.Peer({ debug: 1 });
  let retry = 0;
  let peerTimer;
  const signalTimer = setTimeout(() => {
    step("signal", "err", "Sem resposta. O celular está com internet? Tente outra rede ou os dados móveis.");
    setStatus("Não foi possível alcançar o servidor de sinalização.", "err");
  }, 12000);
  const connect = () => {
    step("peer", "warn", "Procurando o computador…");
    const conn = peer.connect(hostId, { reliable: false, metadata: { device: navigator.userAgent.includes("Mobile") ? "smartphone" : "dispositivo" } });
    clearTimeout(peerTimer);
    peerTimer = setTimeout(() => {
      if (conn.open) return;
      step("peer", "err", "O computador não respondeu. Gere um novo QR Code. Se persistir, a rede pode estar bloqueando WebRTC: tente os dados móveis.");
      setStatus("Sem conexão direta com o computador.", "err");
    }, 15000);
    conn.on("open", () => {
      retry = 0;
      clearTimeout(peerTimer);
      step("peer", "ok", "Recebendo dados do mapa.");
      setStatus("Conectado ao computador ✓", "ok");
      conn.send({ type: "caps", vibrate: canVibrate });
    });
    conn.on("data", handle);
    conn.on("close", () => {
      step("peer", "warn", "Conexão encerrada. Reconectando…");
      setStatus("Conexão encerrada. Tentando reconectar…", "warn");
      current = null;
      if (retry++ < 5) setTimeout(connect, 1500);
    });
  };
  peer.on("open", () => {
    clearTimeout(signalTimer);
    step("signal", "ok");
    connect();
  });
  peer.on("error", (err) => {
    clearTimeout(peerTimer);
    if (err?.type === "peer-unavailable") {
      step("peer", "err", "Esse QR Code expirou (a página do computador foi recarregada). Gere um novo.");
      setStatus("O computador não está mais disponível. Gere um novo QR Code.", "err");
    } else {
      step("signal", "err", `Erro: ${err?.type || err}`);
      setStatus(`Erro de conexão: ${err?.type || err}`, "err");
    }
  });
}
