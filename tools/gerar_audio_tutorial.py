"""Grava as falas fixas do tutorial em MP3 com voz neural (Microsoft Edge TTS), em inglês e português.

Uso:
    pip install edge-tts
    python tools/gerar_audio_tutorial.py            # grava só o que mudou
    python tools/gerar_audio_tutorial.py --tudo     # regrava tudo
    python tools/gerar_audio_tutorial.py --idioma pt

Lê assets/tutorial/roteiro.json (um bloco por idioma), grava assets/tutorial/<idioma>-<id>.mp3
e registra em "audio" o texto de cada gravação. No navegador, o tutorial só usa um MP3 quando o
texto registrado é igual ao texto atual; se você editar o roteiro (ou trocar uma tecla em
js/shortcuts.js) sem rodar o script, ele volta para a voz do navegador naquela fala, em vez de
tocar uma gravação desatualizada.

Os passos com {atalhos} (lista de atalhos) e {instrumentos} (um instrumento por característica)
são montados aqui do mesmo jeito que o site os monta, a partir de js/shortcuts.js, js/i18n.js,
js/config.js e config.json, e também são gravados: assim o tutorial inteiro toca em MP3, sem
depender da voz do navegador (que corta textos longos).

Atenção: o edge-tts envia os textos ao serviço de voz da Microsoft para gerar o áudio.
"""

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

try:
    import edge_tts
except ImportError:
    sys.exit("Instale o pacote primeiro: pip install edge-tts")

RAIZ = Path(__file__).resolve().parent.parent
PASTA = RAIZ / "assets" / "tutorial"
ROTEIRO = PASTA / "roteiro.json"
ATALHOS = RAIZ / "js" / "shortcuts.js"
I18N = RAIZ / "js" / "i18n.js"
CONFIG_JS = RAIZ / "js" / "config.js"
CONFIG_JSON = RAIZ / "config.json"

# Mesmos nomes falados de js/i18n.js → keyName()
NOMES_TECLAS = {
    "en": {" ": "Space", "[": "open bracket", "]": "close bracket", "+": "plus", "-": "minus", "=": "equals"},
    "pt": {" ": "Espaço", "[": "abre colchete", "]": "fecha colchete", "+": "mais", "-": "menos", "=": "igual"},
}


def teclas():
    """Lê `nome: { key: "x"` de js/shortcuts.js."""
    texto = ATALHOS.read_text(encoding="utf-8")
    return dict(re.findall(r'(\w+):\s*\{\s*key:\s*"((?:\\.|[^"])*)"', texto))


def preencher(texto, idioma, mapa):
    def nome(m):
        tecla = mapa.get(m.group(1))
        if tecla is None:
            return m.group(1)
        return NOMES_TECLAS[idioma].get(tecla, tecla.upper() if len(tecla) == 1 else tecla)
    return re.sub(r"\{tecla:(\w+)\}", nome, texto)


def textos_i18n():
    """{"en": {chave: texto}, "pt": {...}} lidos de js/i18n.js (só os textos simples)."""
    linhas = I18N.read_text(encoding="utf-8").splitlines()
    out, atual = {}, None
    for linha in linhas:
        m = re.match(r"^  (en|pt): \{\s*$", linha)
        if m:
            atual = out.setdefault(m.group(1), {})
            continue
        if atual is not None and re.match(r"^  \},?\s*$", linha):
            atual = None
            continue
        m = re.match(r'^\s*"([\w.\-]+)":\s*("(?:\\.|[^"\\])*"),?\s*$', linha)
        if atual is not None and m:
            atual[m.group(1)] = json.loads(m.group(2))
    return out


def ordem_atalhos():
    """SHORTCUT_ORDER de js/shortcuts.js."""
    texto = ATALHOS.read_text(encoding="utf-8")
    bloco = re.search(r"SHORTCUT_ORDER\s*=\s*\[(.*?)\]", texto, re.S).group(1)
    return re.findall(r'"(\w+)"', bloco)


def instrumentos_por_caracteristica():
    """[(característica, instrumento)] na ordem de js/config.js, com o config.json por cima."""
    padrao = re.search(r"DEFAULT_MAPPING\s*=\s*\{(.*?)\}", CONFIG_JS.read_text(encoding="utf-8"), re.S).group(1)
    pares = re.findall(r'(\w+):\s*"(\w+)"', padrao)
    usuario = json.loads(CONFIG_JSON.read_text(encoding="utf-8")).get("mapeamento", {})
    return [(c, usuario.get(c, inst).upper()) for c, inst in pares]


def junta(lista, sep, idioma):
    """Igual a joinList() de js/i18n.js."""
    e = " e " if idioma == "pt" else " and "
    if len(lista) <= 1:
        return lista[0] if lista else ""
    if len(lista) == 2:
        return e.join(lista)
    antes = "" if sep.strip() == "," and idioma == "pt" else sep.strip()
    return f"{sep.join(lista[:-1])}{antes}{e}{lista[-1]}"


def nome_tecla(tecla, idioma):
    return NOMES_TECLAS[idioma].get(tecla, tecla.upper() if len(tecla) == 1 else tecla)


def texto_do_passo(passo, idioma, mapa, ctx):
    """Mesmo texto falado que js/tutorial.js → spokenText() monta (título + parágrafos)."""
    textos = ctx["i18n"][idioma]
    titulo = preencher(passo["titulo"], idioma, mapa)
    fim = "" if re.search(r"[.!?]$", titulo) else "."
    partes = []
    for p in passo["texto"]:
        if p == "{atalhos}":
            partes.append(" ".join(f"{nome_tecla(mapa[n], idioma)}: {textos[f'sc.{n}']}." for n in ctx["ordem"]))
            continue
        if "{instrumentos}" in p:
            itens = [f"{textos[f'char.{c}'].lower()}, {textos[f'inst.{i}'].lower()}" for c, i in ctx["instrumentos"]]
            p = p.replace("{instrumentos}", f"{junta(itens, '; ', idioma)}.")
        partes.append(preencher(p, idioma, mapa))
    return f"{titulo}{fim} {' '.join(partes)}"


def falas(bloco, idioma, mapa, ctx):
    for pid, passo in bloco["passos"].items():
        yield pid, texto_do_passo(passo, idioma, mapa, ctx)
    for mid, texto in bloco["mensagens"].items():
        yield mid, preencher(texto, idioma, mapa)


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tudo", action="store_true", help="regrava todas as falas")
    ap.add_argument("--idioma", choices=["en", "pt"], help="grava só um idioma")
    ap.add_argument("--velocidade", default="+0%", help="ex.: -5%% ou +5%%")
    args = ap.parse_args()

    roteiro = json.loads(ROTEIRO.read_text(encoding="utf-8"))
    mapa = teclas()
    ctx = {"i18n": textos_i18n(), "ordem": ordem_atalhos(), "instrumentos": instrumentos_por_caracteristica()}
    audio = roteiro.setdefault("audio", {})
    usados = set()

    for idioma, voz in roteiro["vozes"].items():
        antigo = audio.get(idioma, {})
        if args.idioma and idioma != args.idioma:
            usados.update(a["arquivo"] for a in antigo.values())
            continue
        novo = {}
        for fid, texto in falas(roteiro[idioma], idioma, mapa, ctx):
            arquivo = f"{idioma}-{fid}.mp3"
            destino = PASTA / arquivo
            reg = antigo.get(fid)
            usados.add(arquivo)
            if not args.tudo and reg and reg.get("texto") == texto and reg.get("voz") == voz and destino.exists():
                novo[fid] = reg
                continue
            print(f"gravando {arquivo} ({len(texto)} caracteres)…")
            await edge_tts.Communicate(texto, voz, rate=args.velocidade).save(str(destino))
            novo[fid] = {"arquivo": arquivo, "voz": voz, "texto": texto}
        audio[idioma] = novo

    # remove gravações de falas que saíram do roteiro
    for mp3 in PASTA.glob("*.mp3"):
        if mp3.name not in usados:
            print(f"removendo {mp3.name} (fala não existe mais)")
            mp3.unlink()

    ROTEIRO.write_text(json.dumps(roteiro, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"pronto: {sum(len(v) for v in audio.values())} falas")


if __name__ == "__main__":
    asyncio.run(main())
