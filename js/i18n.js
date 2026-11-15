// Idioma do site: inglês (padrão) ou português.
//
// Todos os textos da interface e das narrações ficam em lang/en.json e lang/pt.json, com as
// mesmas chaves. t("chave.sub", { var }) devolve o texto no idioma atual; {var} é substituído.
// No HTML, elementos com data-i18n="chave" recebem o texto (data-i18n-html aceita <kbd>),
// e data-i18n-attr="aria-label:chave;title:chave" preenche atributos.

export const LANGS = ["en", "pt"];
const KEY = "sinfonia-lang";
const DEFAULT = "en";

const dicts = {};
await Promise.all(LANGS.map(async (l) => {
  try {
    const res = await fetch(new URL(`../lang/${l}.json`, import.meta.url), { cache: "no-cache" });
    dicts[l] = await res.json();
  } catch (err) {
    console.error(`[i18n] lang/${l}.json não carregou`, err);
    dicts[l] = {};
  }
}));

let lang = (() => {
  try {
    const saved = localStorage.getItem(KEY);
    if (LANGS.includes(saved)) return saved;
  } catch { /* sem armazenamento */ }
  return DEFAULT;
})();

const listeners = new Set();

export const getLang = () => lang;
/** Código BCP 47 para a voz, Intl e o atributo lang do HTML. */
export const locale = () => (lang === "pt" ? "pt-BR" : "en-US");
/** O outro idioma (o botão de troca mostra este). */
export const otherLang = () => (lang === "en" ? "pt" : "en");

function lookup(d, key) {
  return key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), d);
}

/** Texto (ou objeto/lista) da chave no idioma atual; cai no inglês se faltar. */
export function t(key, vars, { in: forLang } = {}) {
  const l = forLang || lang;
  let v = lookup(dicts[l], key);
  if (v === undefined) v = lookup(dicts[DEFAULT], key);
  if (v === undefined) {
    console.warn(`[i18n] chave ausente: ${key}`);
    return key;
  }
  if (typeof v !== "string" || !vars) return v;
  return v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

/** Número no formato do idioma (vírgula no português, ponto no inglês). */
export function num(n, decimals = 0) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(decimals).replace(".", lang === "pt" ? "," : ".").replace("-", "−");
}

/** Junta uma lista: "a, b e c" / "a, b and c". */
export function joinList(list) {
  if (list.length <= 1) return list[0] || "";
  return `${list.slice(0, -1).join(", ")} ${t("common.and")} ${list[list.length - 1]}`;
}

export function applyI18n(root = document) {
  document.documentElement.lang = locale();
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":").map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  });
}

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try { localStorage.setItem(KEY, lang); } catch { /* sem armazenamento */ }
  applyI18n();
  for (const fn of listeners) {
    try { fn(lang); } catch (err) { console.error(err); }
  }
}

/** Chamado depois de cada troca de idioma (para refazer textos montados pelo JS). */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
