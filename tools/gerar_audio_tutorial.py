"""Grava as falas fixas do tutorial em MP3 com voz neural (Microsoft Edge TTS), nos dois idiomas.

Uso:
    pip install edge-tts
    python tools/gerar_audio_tutorial.py              # grava só o que mudou (inglês e português)
    python tools/gerar_audio_tutorial.py --tudo       # regrava tudo
    python tools/gerar_audio_tutorial.py --idioma pt  # só um idioma

Lê assets/tutorial/<idioma>/roteiro.json e grava assets/tutorial/<idioma>/<id>.mp3, registrando
em "audio" o texto de cada gravação. Nos textos:
    {k:acao}    vira o nome da tecla do atalho, lido de js/atalhos.js (ex.: {k:ajuda} → "H")
    {inst:mapa} vira o nome do instrumento do mapa, lido de config.json (ex.: {inst:temp} → "Piano")
Os nomes das teclas e dos instrumentos em cada idioma vêm de lang/<idioma>.json.

No navegador, o tutorial só usa um MP3 quando o texto registrado é igual ao texto atual. Se você
editar o roteiro, trocar uma tecla em js/atalhos.js ou um instrumento no config.json sem rodar o
script, ele usa a voz do navegador naquela fala, em vez de tocar uma gravação desatualizada.

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
TUTORIAL = RAIZ / "assets" / "tutorial"
IDIOMAS = ["en", "pt"]
VOZES = {"en": "en-US-JennyNeural", "pt": "pt-BR-FranciscaNeural"}  # voz de cada idioma (o roteiro pode trocar)

# padrões do config.js, usados quando o config.json não traz o mapa
INSTRUMENTO_PADRAO = {"temp": "GRAND_PIANO", "humidity": "FLUTE", "wind": "VIOLIN", "co": "CELLO", "sst": "MARIMBA", "gedi": "HARP"}


def ler_json(caminho):
    return json.loads(caminho.read_text(encoding="utf-8"))


def ler_atalhos():
    """Tecla principal de cada ação em js/atalhos.js (uma ação por linha: nome: { tecla: "x", ...)."""
    texto = (RAIZ / "js" / "atalhos.js").read_text(encoding="utf-8")
    return {m.group(1): json.loads(f'"{m.group(2)}"') for m in re.finditer(r'^\s*(\w+):\s*\{\s*tecla:\s*"((?:[^"\\]|\\.)*)"', texto, re.M)}


def preencher(texto, idioma, atalhos, instrumentos, lang):
    def tecla(m):
        k = atalhos.get(m.group(1))
        if k is None:
            return m.group(0)
        return lang["keys"].get(k, k.upper() if len(k) == 1 else k)

    def inst(m):
        mapa = m.group(1)
        return lang["instruments"].get(instrumentos.get(mapa, INSTRUMENTO_PADRAO.get(mapa, "")), m.group(0))

    texto = re.sub(r"\{k:(\w+)\}", tecla, texto)
    return re.sub(r"\{inst:(\w+)\}", inst, texto)


def falas(roteiro, idioma, ctx):
    """(id, texto, voz) de cada fala: passos (título + parágrafos) e mensagens."""
    voz = roteiro.get("voz") or VOZES[idioma]
    for pid, passo in roteiro["passos"].items():
        titulo = preencher(passo["titulo"], idioma, *ctx[idioma])
        fim = "" if re.search(r"[.!?]$", titulo) else "."
        corpo = " ".join(preencher(p, idioma, *ctx[idioma]) for p in passo["texto"])
        yield pid, f"{titulo}{fim} {corpo}", voz  # mesmo texto que js/tutorial.js monta
    for mid, msg in roteiro["mensagens"].items():
        if isinstance(msg, dict):  # fala em outro idioma (ex.: "Para português, aperte I")
            outro = msg["idioma"]
            yield mid, preencher(msg["texto"], outro, *ctx[outro]), VOZES[outro]
        else:
            yield mid, preencher(msg, idioma, *ctx[idioma]), voz


async def gravar_idioma(idioma, ctx, tudo, velocidade):
    pasta = TUTORIAL / idioma
    arq = pasta / "roteiro.json"
    roteiro = ler_json(arq)
    antigo = roteiro.get("audio", {})
    novo = {}
    for fid, texto, voz in falas(roteiro, idioma, ctx):
        nome = f"{fid}.mp3"
        destino = pasta / nome
        reg = antigo.get(fid)
        if not tudo and reg and reg.get("texto") == texto and reg.get("voz") == voz and destino.exists():
            novo[fid] = reg
            continue
        print(f"[{idioma}] gravando {nome} ({len(texto)} caracteres)…")
        await edge_tts.Communicate(texto, voz, rate=velocidade).save(str(destino))
        novo[fid] = {"arquivo": nome, "voz": voz, "texto": texto}
    for mp3 in pasta.glob("*.mp3"):
        if mp3.stem not in novo:
            print(f"[{idioma}] removendo {mp3.name} (fala não existe mais)")
            mp3.unlink()
    roteiro["audio"] = novo
    arq.write_text(json.dumps(roteiro, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[{idioma}] pronto: {len(novo)} falas")


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tudo", action="store_true", help="regrava todas as falas")
    ap.add_argument("--idioma", choices=IDIOMAS, help="grava só este idioma")
    ap.add_argument("--velocidade", default="+0%", help="ex.: -5%% ou +5%%")
    args = ap.parse_args()

    atalhos = ler_atalhos()
    config = ler_json(RAIZ / "config.json")
    instrumentos = {k: v for k, v in config.get("instrumentoPorMapa", {}).items() if not k.startswith("_")}
    ctx = {l: (atalhos, instrumentos, ler_json(RAIZ / "lang" / f"{l}.json")) for l in IDIOMAS}
    for idioma in [args.idioma] if args.idioma else IDIOMAS:
        await gravar_idioma(idioma, ctx, args.tudo, args.velocidade)


if __name__ == "__main__":
    asyncio.run(main())
