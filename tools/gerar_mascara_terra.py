"""
Gera assets/landmask.png (720x360, equirretangular): branco = continente, preto = oceano.

Nos frames de vento do GMAO, os continentes aparecem como relevo sombreado cinza-claro
(vento fraco é transparente) e o oceano calmo como fundo escuro. Votamos por maioria
em vários frames horários, o que elimina as áreas de vento forte que cobrem o relevo.
Usado pelo app para nomear regiões ("Atlântico Norte", "América do Sul", ...).
"""
from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
W, H = 720, 360
frames = range(0, 372, 31)
votes = [0] * (W * H)
for f in frames:
    im = Image.open(ROOT / "dados" / "wind_frames" / f"frame_{f:06d}.jpg").convert("RGB").resize((W, H), Image.BILINEAR)
    px = im.load()
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            land = lum > 105 and max(r, g, b) - min(r, g, b) < 45
            votes[y * W + x] += land
mask = Image.new("L", (W, H))
thr = len(frames) * 0.5
mask.putdata([255 if v >= thr else 0 for v in votes])
mask = mask.filter(ImageFilter.MedianFilter(3))
# fechamento morfológico: preenche pequenos buracos no interior dos continentes
mask = mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
# Logo GMAO (canto superior esquerdo) e carimbo de data (inferior esquerdo) cobrem o mapa.
for y in range(int(0.075 * H)):
    for x in range(int(0.176 * W)):
        mask.putpixel((x, y), 0)
for y in range(int(0.898 * H), H):
    for x in range(int(0.247 * W)):
        mask.putpixel((x, y), 0)

# Gelo da Groenlândia e da Antártida aparece tingido pelo vento catabático (não cinza):
# completa com um polígono aproximado (Groenlândia) e uma faixa de latitude (Antártida).
GREENLAND = [(-44, 59.8), (-52, 64), (-54, 68), (-58, 75.5), (-73, 78), (-62, 81.5), (-35, 83.6),
             (-12, 81.5), (-18, 77), (-20, 72), (-24, 69), (-32, 68), (-40, 65), (-42, 61)]


def inside(lon, lat, poly):
    hit = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > lat) != (y2 > lat) and lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


for y in range(H):
    lat = 90 - (y + 0.5) * 180 / H
    for x in range(W):
        lon = (x + 0.5) * 360 / W - 180
        if lat <= -71 or (lat > 59 and inside(lon, lat, GREENLAND)):
            mask.putpixel((x, y), 255)
# "Lagos" isolados (componentes de oceano pequenos, < 600 px) viram continente:
# são manchas de vento forte sobre desertos, não mares reais.
px = mask.load()
seen = bytearray(W * H)
for sy in range(H):
    for sx in range(W):
        if px[sx, sy] or seen[sy * W + sx]:
            continue
        comp, stack = [], [(sx, sy)]
        seen[sy * W + sx] = 1
        while stack:
            x, y = stack.pop()
            comp.append((x, y))
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                nx %= W
                if 0 <= ny < H and not px[nx, ny] and not seen[ny * W + nx]:
                    seen[ny * W + nx] = 1
                    stack.append((nx, ny))
        if len(comp) < 600:
            for x, y in comp:
                px[x, y] = 255
mask.convert("1").save(ROOT / "assets" / "landmask.png", optimize=True)
print("ok", sum(1 for v in mask.getdata() if v) / (W * H))
