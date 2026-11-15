// ===========================================================================
// DICIONÁRIO DE ATALHOS: tecla → botão
// ===========================================================================
//
// Para trocar a tecla de um atalho, mude só o campo `key` aqui. A ajuda, o tutorial, as
// dicas nos botões (<kbd>) e o aria-keyshortcuts são montados a partir deste dicionário.
//
// Nenhum atalho usa tecla modificadora (Ctrl, Alt, Shift ou Meta): basta apertar a tecla.
//
//   key     valor de KeyboardEvent.key. Letras em minúsculas ("h"); " " é a barra de espaço.
//   alt     outras teclas que fazem a mesma coisa (opcional).
//   button  id do botão da página que o atalho aperta: o atalho faz exatamente o mesmo
//           que clicar nele. null = ação sem botão (ver ACTIONS em js/app.js).
//   scope   "global": vale na página toda (menos dentro de campos de texto e listas).
//           "map": só com o mapa em foco.
//
// O texto de cada atalho (ajuda e tutorial) fica em js/i18n.js → "sc.<nome>".

export const SHORTCUTS = {
  help:       { key: "h", alt: ["F1"], button: "helpOpen",      scope: "global" },
  tutorial:   { key: "t",              button: "tutorialOpen",  scope: "global" },
  language:   { key: "i",              button: "langToggle",    scope: "global" },
  sound:      { key: "m",              button: "audioToggle",   scope: "global" },
  gallery:    { key: "g",              button: "backButton",    scope: "global" },
  legend:     { key: "l",              button: "reviewLegend",  scope: "global" },
  tour:       { key: "v",              button: "tourButton",    scope: "global" },
  timeline:   { key: "p",              button: "playTimeline",  scope: "global" },
  focusMap:   { key: "f",              button: null,            scope: "global" },
  overview:   { key: "o",              button: null,            scope: "global" },
  position:   { key: "c",              button: null,            scope: "global" },
  prevHour:   { key: "[",              button: null,            scope: "global" },
  nextHour:   { key: "]",              button: null,            scope: "global" },
  volumeUp:   { key: "+", alt: ["="],  button: null,            scope: "global" },
  volumeDown: { key: "-",              button: null,            scope: "global" },
  read:       { key: " ", alt: ["Enter"], button: null,         scope: "map" },
  center:     { key: "Home",           button: null,            scope: "map" },
};

// Teclas fixas do mapa (não configuráveis): setas movem o cursor e 1 a 9 saltam entre regiões.
export const MAP_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];

// Ordem em que os atalhos aparecem na ajuda e no tutorial
export const SHORTCUT_ORDER = [
  "help", "tutorial", "language", "read", "focusMap", "sound", "gallery", "legend", "tour",
  "overview", "position", "center", "timeline", "prevHour", "nextHour", "volumeUp", "volumeDown",
];

/** O evento corresponde a este atalho? Ignora combinações com Ctrl, Alt (exceto AltGr) e Meta. */
export function matches(sc, e) {
  if (e.ctrlKey && !e.getModifierState?.("AltGraph")) return false;
  if (e.metaKey) return false;
  if (e.altKey && !e.getModifierState?.("AltGraph")) return false;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return k === sc.key || (sc.alt || []).includes(k);
}

/** Nome da tecla para o aria-keyshortcuts (ex.: "H", "Space", "Home"). */
export function ariaKey(key) {
  if (key === " ") return "Space";
  return key.length === 1 ? key.toUpperCase() : key;
}
