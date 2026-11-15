// ===========================================================================
// DICIONÁRIO DE ATALHOS DE TECLADO
// ===========================================================================
// Para trocar um atalho, mude só a "tecla" aqui. A ajuda, os textos do tutorial, os
// avisos falados e o aria-keyshortcuts dos botões se ajustam sozinhos.
//
//   tecla   tecla única, sem Ctrl/Alt/Shift (valor de KeyboardEvent.key: "h", " ", "Home"...)
//   outras  teclas alternativas para a mesma ação (opcional)
//   botao   id do botão da página que esse atalho aciona (opcional). Sem botão, a ação é
//           feita pelo app.js (ver ACTIONS lá).
//   onde    "global"   vale na página toda (menos quando se digita num campo de texto)
//           "mapa"     vale com o mapa em foco
//           "tutorial" vale com o tutorial aberto
//
// Mantenha uma ação por linha, no formato  nome: { tecla: "x", ... },
// porque tools/gerar_audio_tutorial.py lê este arquivo para escrever as teclas nas falas.
// Depois de trocar uma tecla, rode o script para regravar o áudio do tutorial.
export const ATALHOS = {
  ajuda: { tecla: "h", outras: ["F1"], botao: "helpOpen", onde: "global" },
  tutorial: { tecla: "t", botao: "tutorialOpen", onde: "global" },
  idioma: { tecla: "i", botao: "langToggle", onde: "global" },
  voz: { tecla: "n", botao: "voiceToggle", onde: "global" },
  som: { tecla: "s", botao: "audioToggle", onde: "global" },
  mapa: { tecla: "m", onde: "global" },
  galeria: { tecla: "g", botao: "backButton", onde: "global" },
  lerLugar: { tecla: " ", outras: ["Enter"], onde: "mapa" },
  visaoGeral: { tecla: "o", onde: "mapa" },
  posicao: { tecla: "c", onde: "mapa" },
  centro: { tecla: "Home", onde: "mapa" },
  sinfonia: { tecla: "v", botao: "playSymphony", onde: "mapa" },
  legenda: { tecla: "l", botao: "reviewLegend", onde: "mapa" },
  volumeMais: { tecla: "+", outras: ["="], onde: "mapa" },
  volumeMenos: { tecla: "-", outras: ["_"], onde: "mapa" },
  repetir: { tecla: "r", botao: "tutorialRepeat", onde: "tutorial" },
};

// Teclas fixas (não são atalhos de uma ação só): setas movem o cursor, 1 a 9 saltam entre
// nove regiões do mapa e Escape fecha janelas ou cala a voz.

const norm = (k) => (k.length === 1 ? k.toLowerCase() : k);

/** Teclas (normalizadas) que disparam a ação. */
export function teclasDe(acao) {
  const a = ATALHOS[acao];
  return a ? [a.tecla, ...(a.outras || [])].map(norm) : [];
}

/** Ação de um evento de teclado no contexto indicado, ou null. Teclas com Ctrl, Alt ou
 *  Meta ficam para o navegador e para os leitores de tela. */
export function acaoDoEvento(e, onde) {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const k = norm(e.key);
  for (const [nome, a] of Object.entries(ATALHOS)) {
    if (a.onde !== onde) continue;
    if (teclasDe(nome).includes(k)) return nome;
  }
  return null;
}

/** Valor para aria-keyshortcuts (ex.: "H F1", "Space"). */
export function ariaShortcut(acao) {
  return teclasDe(acao).map((k) => (k === " " ? "Space" : k.length === 1 ? k.toUpperCase() : k)).join(" ");
}

/** Nome da tecla para mostrar e falar, no idioma pedido (nomes em lang/*.json → keys). */
export function nomeTecla(tecla, t) {
  const names = t("keys");
  if (names && typeof names === "object" && names[tecla]) return names[tecla];
  return tecla.length === 1 ? tecla.toUpperCase() : tecla;
}

/** Nome da tecla principal de uma ação. */
export function teclaDe(acao, t) {
  const a = ATALHOS[acao];
  return a ? nomeTecla(a.tecla, t) : "";
}
