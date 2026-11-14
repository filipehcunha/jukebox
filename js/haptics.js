// Sincronização háptica com o smartphone via WebRTC (PeerJS) + QR Code.
//
// O computador cria um peer com ID aleatório no servidor público de sinalização do PeerJS
// (só troca o "aperto de mão"; os dados vão direto, peer-to-peer). O QR Code aponta para
// receiver.html#<id>; o celular conecta e recebe pacotes {pulse, gap, strength, event...}
// que viram padrões de navigator.vibrate().

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// Cópia pública do receptor (GitHub Pages do repositório). O receptor é uma página
// estática: pode estar hospedado em qualquer lugar, pois só conversa via PeerJS/WebRTC.
export const PUBLIC_RECEIVER_BASE = "https://filipehcunha.github.io/jukebox/";

export class HapticBridge {
  constructor({ onStatus } = {}) {
    this.onStatus = onStatus || (() => {});
    this.peer = null;
    this.conns = new Set();
    this.lastSend = 0;
    this.lastZone = null;
    this.low = false;
  }

  get available() {
    return typeof window.Peer !== "undefined";
  }

  get connected() {
    return [...this.conns].some((c) => c.open);
  }

  open() {
    if (!this.available) return Promise.reject(new Error("PeerJS não carregou (sem internet?)."));
    if (this.peer && !this.peer.destroyed && this.peer.id) return Promise.resolve(this.peer.id);
    const id = `sinfonia-terra-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
    return new Promise((resolve, reject) => {
      this.peer = new window.Peer(id, { debug: 1 });
      this.peer.on("open", (pid) => {
        this.onStatus("waiting", pid);
        resolve(pid);
      });
      this.peer.on("connection", (conn) => {
        conn.on("open", () => {
          this.conns.add(conn);
          this.onStatus("connected", conn.metadata?.device || "smartphone");
          conn.on("iceStateChanged", (st) => this.onStatus("ice", st));
          conn.send({ type: "hello", low: this.low });
        });
        conn.on("data", (msg) => {
          if (msg?.type === "caps") this.onStatus("caps", msg);
        });
        conn.on("close", () => {
          this.conns.delete(conn);
          this.onStatus(this.connected ? "connected" : "waiting", this.peer?.id);
        });
        conn.on("error", () => this.conns.delete(conn));
      });
      this.peer.on("disconnected", () => {
        this.onStatus("reconnecting");
        try { this.peer.reconnect(); } catch { /* noop */ }
      });
      this.peer.on("error", (err) => {
        this.onStatus("error", err?.type || String(err));
        reject(err);
      });
    });
  }

  close() {
    for (const c of this.conns) c.close();
    this.conns.clear();
    this.peer?.destroy();
    this.peer = null;
    this.onStatus("closed");
  }

  setLowSensory(on) {
    this.low = on;
    this._broadcast({ type: "mode", low: on });
  }

  _broadcast(msg) {
    for (const c of this.conns) if (c.open) c.send(msg);
  }

  // Converte a leitura atual em um pacote háptico. Envia no máximo ~16 vezes/s.
  send(reading, { active }) {
    if (!this.connected) return;
    const now = performance.now();
    const zoneId = reading?.valid ? reading.zone?.index : null;
    const transition = zoneId !== null && this.lastZone !== null && zoneId !== this.lastZone;
    const front = reading?.valid && reading.grad > 0.45;
    if (!transition && now - this.lastSend < 60) return;
    this.lastSend = now;
    if (zoneId !== null) this.lastZone = zoneId;

    if (!active || !reading?.valid) {
      this._broadcast({ type: "haptic", pulse: 0, gap: 0, strength: 0, event: "idle" });
      return;
    }
    // intensidade: valor na barra + bordas (frentes térmicas, plumas, correntes)
    const strength = clamp(0.25 + 0.55 * reading.norm + 0.4 * reading.grad) * (this.low ? 0.45 : 1);
    const pulse = Math.round(10 + 45 * strength);
    const gap = Math.round(lerpGap(strength, reading.grad));
    this._broadcast({
      type: "haptic",
      pulse,
      gap,
      strength,
      event: transition ? "transition" : front ? "front" : "tick",
      norm: reading.norm,
      zone: reading.zone?.label,
      value: reading.valueText,
      region: reading.region?.name || "",
      color: reading.rgb,
    });
  }
}

function lerpGap(strength, grad) {
  // regiões intensas e frentes vibram com pulsos mais próximos
  return 420 - 300 * clamp(0.6 * strength + 0.6 * grad);
}

// ---------------- QR Code ----------------
export function renderQr(el, text) {
  el.innerHTML = "";
  if (typeof window.QRCode === "undefined") {
    el.textContent = "QRCode.js não carregou.";
    return;
  }
  // eslint-disable-next-line no-new
  new window.QRCode(el, {
    text,
    width: 196,
    height: 196,
    colorDark: "#04101c",
    colorLight: "#ffffff",
    correctLevel: window.QRCode.CorrectLevel.M,
  });
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `QR Code para abrir o receptor tátil: ${text}`);
}

// Endereço base acessível pelo celular. "localhost" não funciona no telefone; nesse caso
// tenta o endpoint /__lan do servidor.py, que informa o IP da rede local.
export async function guessReceiverBase() {
  const here = new URL(".", location.href);
  const local = ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);
  if (!local) return { base: here.href, local: false };
  try {
    const res = await fetch("__lan", { cache: "no-store" });
    if (res.ok) {
      const { url } = await res.json();
      if (url) return { base: new URL(here.pathname, url).href, local: false, fromServer: true };
    }
  } catch { /* servidor sem /__lan */ }
  return { base: here.href, local: true };
}
