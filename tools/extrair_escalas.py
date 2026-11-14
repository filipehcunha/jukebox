"""
Extrai as escalas de cores (colorbars) das legendas NASA/GMAO e gera js/colormaps.js.

Cada barra é amostrada coluna a coluna (mediana vertical, que remove ruído JPEG).
A posição horizontal x é convertida em valor físico usando os rótulos da legenda:
  - Temperatura (T2M): linear, -40 °C (borda esquerda) a 40 °C (borda direita)
  - Umidade (Q2M):     linear, 0 a 22 g/kg
  - Vento:             linear, 0 a 40 m/s (0–3,4 m/s é transparente na legenda)
  - CO:                não linear; marcas de 40, 100, 130, 200 e 500 ppbv
                       medidas nos pixels x = 72.5, 188.5, 279.5, 370.5, 463.5

Uso:  python3 tools/extrair_escalas.py            -> escreve js/colormaps.js
      python3 tools/extrair_escalas.py --validar  -> mede o ajuste nos frames de dados/
"""
import json
import math
import random
import statistics as st
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ESCALAS = ROOT / "referencias" / "escalas"

BAR_LEFT, BAR_RIGHT = 72.5, 463.5  # bordas internas (px) da barra nas 4 legendas

SCALES = {
    "temp": dict(file="escala_temperatura_t2m.jpeg", rows=(84, 106), x=(74, 462),
                 ticks=[(BAR_LEFT, -40), (BAR_RIGHT, 40)]),
    "humidity": dict(file="escala_umidade_q2m.jpeg", rows=(84, 106), x=(74, 462),
                     ticks=[(BAR_LEFT, 0), (BAR_RIGHT, 22)]),
    # 0–3,4 m/s é transparente (cinza do fundo da legenda): começa em x=110.
    # Acima de ~34 m/s a barra vai a cinza, indistinguível do relevo continental:
    # corta em x=410 (≈34,6 m/s); valores acima são raríssimos (furacões intensos).
    "wind": dict(file="escala_vento.jpeg", rows=(84, 106), x=(113, 410),
                 ticks=[(BAR_LEFT, 0), (BAR_RIGHT, 40)]),
    "co": dict(file="escala_co.jpeg", rows=(46, 68), x=(74, 462),
               ticks=[(BAR_LEFT, 40), (188.5, 100), (279.5, 130), (370.5, 200), (BAR_RIGHT, 500)]),
}


# Vento: nos frames, a faixa transparente da legenda (calmaria) aparece sobre o fundo
# escuro do oceano (~RGB 30,30,30) e vai ganhando um tom púrpura até virar o azul opaco
# da barra. Rampa medida empiricamente em transectos do frame 100 (Pacífico equatorial).
WIND_OCEAN_RAMP = [
    (2.0, [30, 30, 30]),
    (3.0, [40, 30, 44]),
    (3.6, [50, 29, 62]),
    (4.2, [56, 28, 78]),
    (4.8, [44, 26, 100]),
    (5.3, [34, 24, 113]),
    (5.8, [14, 30, 141]),
    (6.3, [8, 32, 168]),
]
# Pixels quase neutros (cinza do relevo continental, fundo escuro do oceano, linhas de
# costa) = vento abaixo do limiar visível da legenda (< ~4 m/s).
WIND_NEUTRAL_CHROMA = 18
WIND_CALM_VALUE = 2.0


def x_to_value(x, ticks):
    for (xa, va), (xb, vb) in zip(ticks, ticks[1:]):
        if x <= xb or (xb, vb) == ticks[-1]:
            t = (x - xa) / (xb - xa)
            return va + t * (vb - va)
    return ticks[-1][1]


def sample_scale(cfg, step=2):
    im = Image.open(ESCALAS / cfg["file"]).convert("RGB")
    y0, y1 = cfg["rows"]
    x0, x1 = cfg["x"]
    stops = []
    for x in range(x0, x1 + 1):
        # mediana vertical + pequena janela horizontal (x-1..x+1) contra artefatos JPEG
        px = [im.getpixel((xx, y)) for y in range(y0, y1 + 1) for xx in (x - 1, x, x + 1)]
        rgb = [int(round(st.median(c[i] for c in px))) for i in range(3)]
        stops.append((round(x_to_value(x, cfg["ticks"]), 3), rgb))
    stops = stops[::step] if step > 1 else stops
    if cfg is SCALES["wind"]:
        stops = [(v, c) for v, c in WIND_OCEAN_RAMP] + stops
    return stops


# ---------- CIELAB (para distância perceptual) ----------
def _lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb_to_lab(rgb):
    r, g, b = (_lin(v) for v in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def nearest(lab, labs):
    best, bi = 1e9, 0
    for i, l in enumerate(labs):
        d = (lab[0] - l[0]) ** 2 + (lab[1] - l[1]) ** 2 + (lab[2] - l[2]) ** 2
        if d < best:
            best, bi = d, i
    return bi, math.sqrt(best)


def validate(all_stops):
    random.seed(1)
    masks = [(0, 0, 360, 76), (0, 920, 505, 1024)]  # logo GMAO e carimbo de data
    for key, stops in all_stops.items():
        labs = [rgb_to_lab(c) for _, c in stops]
        dists, bad = [], {}
        for frame in (0, 100, 200, 300, 371):
            im = Image.open(ROOT / "dados" / f"{key}_frames" / f"frame_{frame:06d}.jpg").convert("RGB")
            w, h = im.size
            for _ in range(2500):
                x, y = random.randrange(w), random.randrange(h)
                if any(a <= x < c and b <= y < d for a, b, c, d in masks):
                    continue
                rgb = im.getpixel((x, y))
                if key == "wind" and max(rgb) - min(rgb) < WIND_NEUTRAL_CHROMA:
                    dists.append(0.0)
                    continue
                _, d = nearest(rgb_to_lab(rgb), labs)
                dists.append(d)
                if d > 12:
                    k = tuple(v // 32 * 32 for v in rgb)
                    bad[k] = bad.get(k, 0) + 1
        dists.sort()
        n = len(dists)
        q = lambda p: dists[int(p * (n - 1))]
        print(f"{key:9s} n={n} dE mediana={q(.5):.1f} p90={q(.9):.1f} p97={q(.97):.1f} "
              f"fora(>12)={sum(d > 12 for d in dists) / n:.1%}")
        print("   cores mal ajustadas mais comuns:", sorted(bad.items(), key=lambda kv: -kv[1])[:6])


def main():
    all_stops = {k: sample_scale(cfg) for k, cfg in SCALES.items()}
    if "--validar" in sys.argv:
        validate({k: sample_scale(cfg, 1) for k, cfg in SCALES.items()})
        return
    out = ROOT / "js" / "colormaps.js"
    body = ",\n".join(
        f"  {k}: [\n" + ",\n".join(f"    [{v}, {c[0]}, {c[1]}, {c[2]}]" for v, c in stops) + "\n  ]"
        for k, stops in all_stops.items()
    )
    out.write_text(
        "// Gerado por tools/extrair_escalas.py a partir de referencias/escalas/*.jpeg\n"
        "// Cada entrada: [valor físico, R, G, B] amostrado da barra de cores da legenda NASA/GMAO.\n"
        "// Não edite à mão: rode `python3 tools/extrair_escalas.py`.\n"
        f"export const GMAO_COLORMAPS = {{\n{body}\n}};\n",
        encoding="utf-8",
    )
    print(f"escrito {out.relative_to(ROOT)}", {k: len(v) for k, v in all_stops.items()})


if __name__ == "__main__":
    main()
