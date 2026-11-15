// Página receptora do smartphone: recebe pacotes WebRTC e aciona navigator.vibrate().
// O idioma vem da URL (?lang=en ou ?lang=pt), igual ao do site no computador.

const TEXT = {
  "en": {
    "title": "Vibration receiver",
    "sub": "Earth Symphony · vibration synced with the map on the computer",
    "enable": "Tap to turn on vibration",
    "connecting": "Connecting…",
    "hint": "Move over the map on the computer.",
    "rateTitle": "Vibration rhythm: warm colors vibrate short and fast, cold colors long and slow",
    "stepsAria": "Connection check",
    "page": "Receiver page open",
    "signal": "Signaling server (PeerJS)",
    "peer": "Direct connection to the computer (WebRTC)",
    "vibe": "Vibration",
    "vibeTap": "Tap the button above to allow it.",
    "vibeNo": "Not supported in this browser (iPhone/Safari). Using a visual pulse.",
    "tip": "Tip: keep the screen on and the phone in vibrate mode.",
    "noVibeTip": "This browser has no vibration (e.g. iPhone/Safari). The circle pulses on screen instead.",
    "enabled": "Vibration on ✓",
    "enabledVisual": "Visual pulse on ✓",
    "vibeOk": "Allowed. If you feel nothing, turn off total silent mode.",
    "pulses": "pulses/s",
    "noCode": "Missing code. Scan the QR code shown on the computer.",
    "noPeer": "Could not load PeerJS. Check the phone's internet.",
    "signalWait": "Connecting to 0.peerjs.com…",
    "signalErr": "No answer. Is the phone online? Try another network or mobile data.",
    "signalStatus": "Could not reach the signaling server.",
    "peerWait": "Looking for the computer…",
    "peerErr": "The computer did not answer. Show a new QR code. If it keeps happening, the network may block WebRTC: try mobile data.",
    "peerStatus": "No direct connection to the computer.",
    "peerOk": "Receiving map data.",
    "connected": "Connected to the computer ✓",
    "closedStep": "Connection closed. Reconnecting…",
    "closedStatus": "Connection closed. Trying to reconnect…",
    "expiredStep": "This QR code has expired (the computer page was reloaded). Show a new one.",
    "expiredStatus": "The computer is no longer available. Show a new QR code.",
    "error": "Error: {e}",
    "errorStatus": "Connection error: {e}"
  },
  "pt": {
    "title": "Receptor Tátil",
    "sub": "A Sinfonia da Terra · vibração sincronizada com o mapa do computador",
    "enable": "Toque para ativar a vibração",
    "connecting": "Conectando…",
    "hint": "Mova o cursor sobre o mapa no computador.",
    "rateTitle": "Ritmo da vibração: cores quentes vibram curto e rápido, cores frias longo e lento",
    "stepsAria": "Diagnóstico da conexão",
    "page": "Página do receptor aberta",
    "signal": "Servidor de sinalização (PeerJS)",
    "peer": "Conexão direta com o computador (WebRTC)",
    "vibe": "Vibração",
    "vibeTap": "Toque no botão acima para liberar.",
    "vibeNo": "Não suportada neste navegador (iPhone/Safari). Usando pulso visual.",
    "tip": "Dica: deixe a tela ligada e o som do celular no modo vibração.",
    "noVibeTip": "Este navegador não oferece vibração (ex.: iPhone/Safari). O círculo pulsa visualmente no lugar da vibração.",
    "enabled": "Vibração ativada ✓",
    "enabledVisual": "Pulso visual ativado ✓",
    "vibeOk": "Liberada. Se não sentir nada, desative o modo silencioso total.",
    "pulses": "pulsos/s",
    "noCode": "Código ausente. Escaneie o QR Code exibido no computador.",
    "noPeer": "Não foi possível carregar o PeerJS. Verifique a internet do celular.",
    "signalWait": "Conectando a 0.peerjs.com…",
    "signalErr": "Sem resposta. O celular está com internet? Tente outra rede ou os dados móveis.",
    "signalStatus": "Não foi possível alcançar o servidor de sinalização.",
    "peerWait": "Procurando o computador…",
    "peerErr": "O computador não respondeu. Gere um novo QR Code. Se persistir, a rede pode estar bloqueando WebRTC: tente os dados móveis.",
    "peerStatus": "Sem conexão direta com o computador.",
    "peerOk": "Recebendo dados do mapa.",
    "connected": "Conectado ao computador ✓",
    "closedStep": "Conexão encerrada. Reconectando…",
    "closedStatus": "Conexão encerrada. Tentando reconectar…",
    "expiredStep": "Esse QR Code expirou (a página do computador foi recarregada). Gere um novo.",
    "expiredStatus": "O computador não está mais disponível. Gere um novo QR Code.",
    "error": "Erro: {e}",
    "errorStatus": "Erro de conexão: {e}"
  }
};
const LANG = new URLSearchParams(location.search).get("lang") === "pt" ? "pt" : "en";
const L = (k, vars = {}) => TEXT[LANG][k].replace(/\{(\w+)\}/g, (m, v) => vars[v] ?? m);
document.documentElement.lang = LANG === "pt" ? "pt-BR" : "en-US";
document.title = L("title");
for (const el of document.querySelectorAll("[data-t]")) el.textContent = L(el.dataset.t);
document.getElementById("rate").title = L("rateTitle");
document.getElementById("steps").setAttribute("aria-label", L("stepsAria"));

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const pulseEl = $("pulse");
const canVibrate = typeof navigator.vibrate === "function";
let enabled = false;
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
step("vibe", canVibrate ? "warn" : "err", canVibrate ? L("vibeTap") : L("vibeNo"));

function setStatus(text, s = "") {
  statusEl.textContent = text;
  statusEl.dataset.s = s;
}

$("support").textContent = canVibrate
  ? L("tip")
  : L("noVibeTip");

$("enable").addEventListener("click", () => {
  enabled = true;
  // o primeiro vibrate precisa acontecer dentro de um gesto do usuário
  if (canVibrate) navigator.vibrate([30, 60, 30]);
  $("enable").textContent = canVibrate ? L("enabled") : L("enabledVisual");
  $("enable").setAttribute("aria-pressed", "true");
  if (canVibrate) step("vibe", "ok", L("vibeOk"));
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
  if (msg.type !== "haptic") return;
  lastPacket = performance.now();
  current = msg;
  if (msg.color) pulseEl.style.setProperty("--c", msg.color.join(" "));
  if (msg.value) $("value").textContent = msg.value;
  if (msg.zone) $("zone").textContent = [msg.region, msg.zone].filter(Boolean).join(" · ");
  if (msg.event === "transition") {
    // cruzou uma zona (ex.: de "Ameno" para "Quente"): pulso duplo marcado
    vibrate([55, 45, 70]);
    flash(1);
    nextTick = performance.now() + 220;
    patternEnds = 0;
  } else if (msg.event === "front" && performance.now() > nextTick) {
    vibrate([35, 30, 20]);
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
    $("rate").textContent = `${current.hz >= 10 ? Math.round(current.hz) : current.hz.toFixed(1).replace(".", ",")} ${L("pulses")} · ${current.pulse} ms`;
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
  setStatus(L("noCode"), "err");
} else if (typeof window.Peer === "undefined") {
  setStatus(L("noPeer"), "err");
} else {
  step("signal", "warn", L("signalWait"));
  const peer = new window.Peer({ debug: 1 });
  let retry = 0;
  let peerTimer;
  const signalTimer = setTimeout(() => {
    step("signal", "err", L("signalErr"));
    setStatus(L("signalStatus"), "err");
  }, 12000);
  const connect = () => {
    step("peer", "warn", L("peerWait"));
    const conn = peer.connect(hostId, { reliable: false, metadata: { device: navigator.userAgent.includes("Mobile") ? "smartphone" : "dispositivo" } });
    clearTimeout(peerTimer);
    peerTimer = setTimeout(() => {
      if (conn.open) return;
      step("peer", "err", L("peerErr"));
      setStatus(L("peerStatus"), "err");
    }, 15000);
    conn.on("open", () => {
      retry = 0;
      clearTimeout(peerTimer);
      step("peer", "ok", L("peerOk"));
      setStatus(L("connected"), "ok");
      conn.send({ type: "caps", vibrate: canVibrate });
    });
    conn.on("data", handle);
    conn.on("close", () => {
      step("peer", "warn", L("closedStep"));
      setStatus(L("closedStatus"), "warn");
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
      step("peer", "err", L("expiredStep"));
      setStatus(L("expiredStatus"), "err");
    } else {
      step("signal", "err", L("error", { e: err?.type || err }));
      setStatus(L("errorStatus", { e: err?.type || err }), "err");
    }
  });
}
