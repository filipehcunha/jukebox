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
    // VIBRAÇÃO PROPORCIONAL À COR: a posição na barra (0 = azul/frio/baixo, 1 = vermelho/
    // quente/alto) define o ritmo. Valores altos → pulsos curtos e de alta frequência
    // (~16 Hz); valores baixos → pulsos longos e lentos (~1,3 Hz). Frentes aceleram um pouco.
    const p = hapticPattern(reading.norm, reading.grad, this.low);
    this._broadcast({
      type: "haptic",
      ...p,
      event: transition ? "transition" : front ? "front" : "tick",
      norm: reading.norm,
      zone: reading.zone?.label,
      value: reading.valueText,
      region: reading.region?.name || "",
      color: reading.rgb,
    });
  }
}

const lerp = (a, b, t) => a + (b - a) * t;

// norm 0..1 → { pulse (ms), gap (ms), strength 0..1, hz }
export function hapticPattern(norm, grad = 0, low = false) {
  const n = clamp(norm);
  let pulse = lerp(240, 22, n);
  let gap = lerp(560, 38, n) * (1 - 0.35 * clamp(grad));
  let strength = lerp(0.35, 1, n);
  if (low) {
    pulse = Math.min(pulse * 0.6, 140);
    gap = Math.max(gap * 1.5, 140);
    strength *= 0.45;
  }
  pulse = Math.round(pulse);
  gap = Math.round(gap);
  return { pulse, gap, strength, hz: 1000 / (pulse + gap) };
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

// ---------------- Endereço que o celular deve abrir ----------------
// Tudo é detectado na hora, em qualquer computador:
//  1. Página aberta por um endereço de rede ou HTTPS (ex.: http://192.168.0.7:8000 ou um
//     site publicado) → o próprio endereço da página serve para o celular.
//  2. Página em localhost servida pelo servidor.py → /__lan lista os IPs desta máquina
//     (refeito a cada pedido, acompanha troca de rede).
//  3. Outro servidor estático → tenta descobrir o IP local pela WebRTC (alguns navegadores
//     escondem o IP; nesse caso o usuário digita).
// Retorna { candidates: [{url, label}], local: bool, warning? }
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", ""];

export async function guessReceiverBase() {
  const here = new URL(".", location.href);
  const local = LOCAL_HOSTS.includes(location.hostname) || location.protocol === "file:";
  if (!local) {
    return { local: false, candidates: [{ url: here.href, label: `${location.host} · endereço desta página` }] };
  }
  try {
    const res = await fetch("__lan", { cache: "no-store" });
    if (res.ok) {
      const info = await res.json();
      const list = info.candidates?.length ? info.candidates : info.url ? [{ url: info.url, ip: info.url, iface: "" }] : [];
      if (list.length) {
        return {
          local: false,
          fromServer: true,
          warning: info.warning,
          candidates: list.map((c) => ({ url: new URL(here.pathname, c.url).href, label: c.iface ? `${c.ip} · ${c.iface}` : c.ip })),
        };
      }
    }
  } catch { /* servidor sem /__lan */ }
  const port = location.port ? `:${location.port}` : "";
  const ips = location.protocol === "file:" ? [] : await localIpsViaWebRTC();
  return {
    local: true,
    candidates: ips.map((ip) => ({ url: `http://${ip}${port}${here.pathname}`, label: `${ip} · detectado pelo navegador` })),
  };
}

function isPrivateIPv4(ip) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) && ip !== "10.255.255.254";
}

// IPs locais via candidatos ICE (sem servidor STUN, nada sai da máquina)
async function localIpsViaWebRTC(timeout = 1200) {
  if (typeof RTCPeerConnection === "undefined") return [];
  const ips = new Set();
  let pc;
  try {
    pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel("ip");
    pc.onicecandidate = (e) => {
      const m = e.candidate?.candidate?.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
      if (m && isPrivateIPv4(m[1])) ips.add(m[1]);
    };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((r) => {
      const t = setTimeout(r, timeout);
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); r(); } };
    });
  } catch { /* navegador bloqueou */ } finally {
    pc?.close();
  }
  return [...ips].sort((a, b) => (b.startsWith("192.168.") ? 1 : 0) - (a.startsWith("192.168.") ? 1 : 0));
}

// A cópia pública do receptor (GitHub Pages) só aparece como opção se estiver no ar.
// O GitHub Pages responde com CORS liberado, então dá para checar daqui.
export async function checkPublicReceiver() {
  if (location.href.startsWith(PUBLIC_RECEIVER_BASE)) return true;
  try {
    const res = await fetch(new URL("receiver.html", PUBLIC_RECEIVER_BASE), { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
