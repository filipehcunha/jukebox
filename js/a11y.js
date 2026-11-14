// Camada de acessibilidade para quem navega sem ver a tela e sem leitor de tela.
//
// Quando a narração por voz está ligada, este módulo lê em voz alta cada controle que
// recebe o foco (nome, tipo, estado e descrição), como um leitor de tela faria, e lê o
// novo estado quando uma caixa, lista ou controle deslizante muda. Quem já usa NVDA,
// JAWS, VoiceOver ou TalkBack deixa a narração desligada e usa o ARIA da página.

const text = (s) => (s || "").replace(/\s+/g, " ").trim();
const byIds = (ids) => text((ids || "").split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" "));

// texto de um rótulo sem os controles que estão dentro dele
function labelText(label) {
  const clone = label.cloneNode(true);
  clone.querySelectorAll("input, select, textarea, output, small, [aria-hidden='true']").forEach((n) => n.remove());
  return text(clone.textContent);
}

/** Nome acessível (simplificado) de um elemento. */
export function accessibleName(el) {
  if (el.hasAttribute("aria-labelledby")) {
    const t = byIds(el.getAttribute("aria-labelledby"));
    if (t) return t;
  }
  if (el.getAttribute("aria-label")) return text(el.getAttribute("aria-label"));
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
    const label = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest("label");
    if (label) return labelText(label);
    return text(el.getAttribute("placeholder") || el.title);
  }
  if (el.tagName === "IMG") return text(el.alt);
  const clone = el.cloneNode(true);
  clone.querySelectorAll("[aria-hidden='true'], svg").forEach((n) => n.remove());
  return text(clone.textContent) || text(el.title);
}

// descrição: aria-describedby, ou o texto pequeno do rótulo (interruptores)
function description(el) {
  if (el.getAttribute("role") === "application") return ""; // o mapa tem ajuda própria (tecla H)
  const d = byIds(el.getAttribute("aria-describedby"));
  if (d) return d.length > 400 ? `${d.slice(0, 400)}…` : d;
  if (/^(INPUT|SELECT)$/.test(el.tagName)) return text(el.closest("label")?.querySelector("small")?.textContent);
  return "";
}

function rangeValue(el) {
  return text(el.getAttribute("aria-valuetext")) || text(el.closest("label")?.querySelector("output")?.textContent) || String(el.value ?? el.getAttribute("aria-valuenow") ?? "");
}

// tipo e estado do controle, em português
function roleAndState(el) {
  const role = el.getAttribute("role");
  const tag = el.tagName;
  const type = (el.getAttribute("type") || "").toLowerCase();
  if (role === "slider" || (tag === "INPUT" && type === "range")) return `controle deslizante, ${rangeValue(el)}. Use as setas para ajustar`;
  if (role === "application") return el.getAttribute("aria-roledescription") || "área interativa";
  if (tag === "INPUT" && type === "checkbox") return `interruptor, ${el.checked ? "ligado" : "desligado"}. Espaço para alternar`;
  if (tag === "INPUT" && type === "file") return "botão para escolher arquivos";
  if (tag === "INPUT" || tag === "TEXTAREA") return `campo de texto${el.value ? `, ${el.value}` : ", vazio"}`;
  if (tag === "SELECT") return `lista de opções, ${text(el.selectedOptions[0]?.textContent) || "nada escolhido"}. Use as setas para trocar`;
  if (tag === "SUMMARY") return `seção recolhível, ${el.parentElement?.open ? "aberta" : "fechada"}`;
  if (tag === "A") return "link";
  if (tag === "BUTTON" || role === "button") {
    const pressed = el.getAttribute("aria-pressed");
    const state = pressed === "true" ? ", ligado" : pressed === "false" ? ", desligado" : "";
    return `botão${state}${el.disabled ? ", indisponível" : ""}`;
  }
  if (/^H[1-6]$/.test(tag)) return "título";
  return "";
}

/** Frase completa para um elemento focado: nome, tipo/estado e descrição. */
export function describeElement(el) {
  const kind = roleAndState(el);
  // só controles, títulos e elementos rotulados: um contêiner focado (ex.: <main>) não é lido inteiro
  if (!kind && !el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby")) return "";
  const name = accessibleName(el);
  if (!name) return "";
  const parts = [name, kind, description(el)].filter(Boolean);
  // título de um diálogo: acrescenta a descrição do diálogo
  const dlg = el.closest("dialog");
  if (dlg && /^H[1-6]$/.test(el.tagName) && dlg.getAttribute("aria-labelledby") === el.id) {
    const d = byIds(dlg.getAttribute("aria-describedby"));
    if (d) parts.push(d.length > 600 ? `${d.slice(0, 600)}…` : d);
  }
  return parts.map((p) => p.replace(/[.\s]+$/, "")).join(". ") + ".";
}

/**
 * Liga a leitura em voz alta dos controles.
 * @param {() => boolean} opts.enabled  a narração está ligada?
 * @param {(text: string) => void} opts.speak
 * @param {(el: Element) => boolean} [opts.skip]  elementos que o app anuncia por conta própria
 */
export function initFocusEcho({ enabled, speak, skip = () => false }) {
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (!enabled() || !(el instanceof Element) || skip(el)) return;
    const sentence = describeElement(el);
    if (sentence) speak(sentence);
  });

  // mudança de estado: interruptor, lista ou controle deslizante
  let rangeTimer;
  const changed = (e) => {
    const el = e.target;
    if (!enabled() || !(el instanceof Element) || el.hasAttribute("data-no-echo") || skip(el)) return;
    if (el.tagName === "SELECT") speak(text(el.selectedOptions[0]?.textContent));
    else if (el.tagName === "INPUT" && el.type === "checkbox") speak(el.checked ? "Ligado" : "Desligado");
    else if (el.tagName === "INPUT" && el.type === "range") {
      clearTimeout(rangeTimer);
      rangeTimer = setTimeout(() => speak(rangeValue(el)), 350);
    }
  };
  document.addEventListener("change", changed);
  document.addEventListener("input", (e) => { if (e.target?.type === "range") changed(e); });
  document.addEventListener("toggle", (e) => {
    if (enabled() && e.target.tagName === "DETAILS") speak(e.target.open ? "Aberta" : "Fechada");
  }, true);
}
