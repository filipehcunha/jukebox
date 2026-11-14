"""Grava as falas fixas do tutorial em MP3 com voz neural (Microsoft Edge TTS).

Uso:
    pip install edge-tts
    python tools/gerar_audio_tutorial.py            # grava só o que mudou
    python tools/gerar_audio_tutorial.py --tudo     # regrava tudo
    python tools/gerar_audio_tutorial.py --voz pt-BR-AntonioNeural

Lê assets/tutorial/roteiro.json, grava assets/tutorial/<id>.mp3 e registra em "audio"
o texto de cada gravação. No navegador, o tutorial só usa um MP3 quando o texto registrado
é igual ao texto atual; se você editar o roteiro sem rodar o script, ele volta para a voz
do navegador naquela fala, em vez de tocar uma gravação desatualizada.

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

PASTA = Path(__file__).resolve().parent.parent / "assets" / "tutorial"
ROTEIRO = PASTA / "roteiro.json"


def texto_do_passo(passo):
    """Mesmo texto falado que js/tutorial.js monta (título + parágrafos)."""
    titulo = passo["titulo"]
    fim = "" if re.search(r"[.!?]$", titulo) else "."
    return f"{titulo}{fim} {' '.join(passo['texto'])}"


def falas(roteiro):
    for pid, passo in roteiro["passos"].items():
        yield pid, texto_do_passo(passo)
    for mid, texto in roteiro["mensagens"].items():
        yield mid, texto


async def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tudo", action="store_true", help="regrava todas as falas")
    ap.add_argument("--voz", help="voz do edge-tts (padrão: campo 'voz' do roteiro)")
    ap.add_argument("--velocidade", default="+0%", help="ex.: -5%% ou +5%%")
    args = ap.parse_args()

    roteiro = json.loads(ROTEIRO.read_text(encoding="utf-8"))
    if args.voz:
        roteiro["voz"] = args.voz
    voz = roteiro["voz"]
    antigo = roteiro.get("audio", {})
    novo = {}

    for fid, texto in falas(roteiro):
        arquivo = f"{fid}.mp3"
        destino = PASTA / arquivo
        reg = antigo.get(fid)
        if not args.tudo and reg and reg.get("texto") == texto and reg.get("voz") == voz and destino.exists():
            novo[fid] = reg
            continue
        print(f"gravando {arquivo} ({len(texto)} caracteres)…")
        await edge_tts.Communicate(texto, voz, rate=args.velocidade).save(str(destino))
        novo[fid] = {"arquivo": arquivo, "voz": voz, "texto": texto}

    # remove gravações de falas que saíram do roteiro
    for mp3 in PASTA.glob("*.mp3"):
        if mp3.stem not in novo:
            print(f"removendo {mp3.name} (fala não existe mais)")
            mp3.unlink()

    roteiro["audio"] = novo
    ROTEIRO.write_text(json.dumps(roteiro, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"pronto: {len(novo)} falas com a voz {voz}")


if __name__ == "__main__":
    asyncio.run(main())
