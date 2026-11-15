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

Os passos com {atalhos} ou {instrumentos} são montados na hora pelo site (a partir de
js/shortcuts.js e do config.json) e por isso não são gravados.

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


def texto_do_passo(passo, idioma, mapa):
    """Mesmo texto falado que js/tutorial.js monta (título + parágrafos)."""
    titulo = preencher(passo["titulo"], idioma, mapa)
    fim = "" if re.search(r"[.!?]$", titulo) else "."
    return f"{titulo}{fim} {' '.join(preencher(p, idioma, mapa) for p in passo['texto'])}"


def falas(bloco, idioma, mapa):
    for pid, passo in bloco["passos"].items():
        if any("{atalhos}" in p or "{instrumentos}" in p for p in passo["texto"]):
            continue  # montado na hora pelo site
        yield pid, texto_do_passo(passo, idioma, mapa)
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
    audio = roteiro.setdefault("audio", {})
    usados = set()

    for idioma, voz in roteiro["vozes"].items():
        antigo = audio.get(idioma, {})
        if args.idioma and idioma != args.idioma:
            usados.update(a["arquivo"] for a in antigo.values())
            continue
        novo = {}
        for fid, texto in falas(roteiro[idioma], idioma, mapa):
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
