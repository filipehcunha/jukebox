#!/usr/bin/env python3
"""
Servidor local da Sinfonia da Terra.

Serve o projeto em todas as interfaces (0.0.0.0) para que o smartphone, na mesma rede
Wi-Fi, consiga abrir a página receptora do QR Code.

Em /__lan responde com os endereços desta máquina na rede local. A detecção é refeita
a cada pedido, então funciona em qualquer computador (Linux, macOS, Windows, WSL) e
acompanha trocas de rede sem reiniciar. O app usa a resposta para montar o QR Code.

Uso:
    python3 servidor.py                 # porta 8000 (ou a próxima livre)
    python3 servidor.py 8080            # outra porta
    python3 servidor.py 8000 --url http://192.168.0.10:8000   # força o endereço do QR
"""
import http.server
import ipaddress
import json
import os
import platform
import re
import socket
import subprocess
import sys
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IS_WSL = "microsoft" in platform.uname().release.lower()


def _route_ip(target):
    """IP da interface que o sistema usaria para alcançar `target` (não envia pacotes)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((target, 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def _run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=3).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def _windows_ipconfig():
    """IPs do Windows (útil no WSL em modo NAT, cujo IP interno o celular não alcança)."""
    exe = "/mnt/c/Windows/System32/ipconfig.exe" if IS_WSL else "ipconfig"
    out = _run([exe])
    ips, adapter = [], ""
    for line in out.splitlines():
        if line and not line.startswith(" "):
            adapter = line.strip().rstrip(":")
        m = re.search(r"IPv4[^:]*:\s*([\d.]+)", line)
        if m:
            ips.append((m.group(1), adapter))
    return ips


def _all_ips():
    found = []  # (ip, nome da interface)
    default = _route_ip("10.255.255.255") or _route_ip("8.8.8.8")
    if default:
        found.append((default, "rota padrão"))
    system = platform.system()
    if system == "Linux":
        for line in _run(["ip", "-4", "-o", "addr", "show"]).splitlines():
            m = re.match(r"\d+:\s+(\S+)\s+inet\s+([\d.]+)", line)
            if m:
                found.append((m.group(2), m.group(1)))
    elif system == "Darwin":
        iface = ""
        for line in _run(["ifconfig"]).splitlines():
            if line and not line[0].isspace():
                iface = line.split(":")[0]
            m = re.search(r"inet ([\d.]+)", line)
            if m:
                found.append((m.group(1), iface))
    elif system == "Windows":
        found += _windows_ipconfig()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append((info[4][0], "hostname"))
    except OSError:
        pass
    return found


VIRTUAL = re.compile(r"docker|br-|veth|virbr|vbox|vmnet|tailscale|zt|wg|tun|utun|lo\b|loopback|vethernet|hyper-v", re.I)


def _score(ip, iface, default):
    a = ipaddress.ip_address(ip)
    if a.is_loopback or a.is_link_local or ip == "10.255.255.254" or not a.is_private:
        return None
    s = 0
    if ip == default:
        s += 30
    if ip.startswith("192.168."):
        s += 20
    elif ip.startswith("10."):
        s += 12
    elif a in ipaddress.ip_network("172.16.0.0/12"):
        s += 2  # muitas vezes Docker ou NAT do WSL
    if VIRTUAL.search(iface or ""):
        s -= 25
    if re.search(r"wi-?fi|wlan|wireless|en0|eth|ethernet", iface or "", re.I):
        s += 5
    return s


def lan_candidates(port):
    default = _route_ip("10.255.255.255")
    seen, out = set(), []
    for ip, iface in _all_ips():
        if ip in seen:
            continue
        seen.add(ip)
        sc = _score(ip, iface, default)
        if sc is not None:
            out.append({"url": f"http://{ip}:{port}", "ip": ip, "iface": iface, "score": sc})
    warning = None
    # WSL em modo NAT: o IP interno (172.x) não é visível pela rede. Usa o IP do Windows.
    if IS_WSL and not any(c["score"] >= 10 for c in out):
        for ip, adapter in _windows_ipconfig():
            if ip not in seen and _score(ip, adapter, None) is not None and not VIRTUAL.search(adapter):
                seen.add(ip)
                out.append({"url": f"http://{ip}:{port}", "ip": ip, "iface": f"Windows · {adapter}", "score": 25})
        warning = (
            "WSL em modo NAT: o celular só alcança o IP do Windows depois de um "
            f"redirecionamento de porta (veja o terminal do servidor) ou com networkingMode=mirrored."
        )
    out.sort(key=lambda c: -c["score"])
    return out, warning


def find_port(start):
    for p in range(start, start + 20):
        # no WSL mirrored um programa do Windows pode ocupar a porta sem impedir o bind aqui
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.3)
            if probe.connect_ex(("127.0.0.1", p)) == 0:
                continue
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("0.0.0.0", p))
                return p
            except OSError:
                continue
    raise SystemExit(f"Nenhuma porta livre entre {start} e {start + 19}.")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    forced = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else None
    if forced in args:
        args.remove(forced)
    wanted = int(args[0]) if args else int(os.environ.get("PORT", 8000))
    port = find_port(wanted)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path.split("?")[0] == "/__lan":
                cands, warning = lan_candidates(port)
                # Se o navegador já abriu a página por um IP da rede, esse endereço é o melhor
                host = (self.headers.get("Host") or "").split(":")[0]
                if host and host not in ("localhost", "127.0.0.1", "[::1]"):
                    url = f"http://{self.headers['Host']}"
                    cands = [{"url": url, "ip": host, "iface": "endereço usado por este navegador", "score": 99}] + [
                        c for c in cands if c["ip"] != host
                    ]
                if forced:
                    cands = [{"url": forced.rstrip("/"), "ip": forced, "iface": "--url", "score": 100}] + cands
                body = json.dumps({
                    "url": cands[0]["url"] if cands else None,
                    "candidates": cands,
                    "warning": None if forced else warning,
                    "port": port,
                }).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

        def end_headers(self):
            # evita que o navegador guarde versões antigas do JS durante o desenvolvimento
            if not self.path.startswith("/dados/") and not self.path.startswith("/assets/"):
                self.send_header("Cache-Control", "no-cache")
            super().end_headers()

        def log_message(self, fmt, *a):
            if "/dados/" not in (a[0] if a else ""):
                super().log_message(fmt, *a)

    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), partial(Handler, directory=str(ROOT)))
    cands, warning = lan_candidates(port)
    print("\n  A Sinfonia da Terra")
    if port != wanted:
        print(f"  (porta {wanted} ocupada, usando {port})")
    print(f"  Neste computador: http://localhost:{port}")
    if forced:
        print(f"  Na rede (celular): {forced}  (--url)")
    for c in cands[:4]:
        print(f"  Na rede (celular): {c['url']}   [{c['iface']}]")
    if not cands and not forced:
        print("  Nenhum endereço de rede local encontrado (sem Wi-Fi/cabo?).")
    print("  Ctrl+C para encerrar.\n")
    if warning:
        win_ip = cands[0]["ip"] if cands else "IP-DO-WINDOWS"
        wsl_ip = _route_ip("10.255.255.255") or "IP-DO-WSL"
        print("  WSL em modo NAT: o celular não alcança o IP interno do WSL.")
        print("  Opção 1 (recomendada): em %UserProfile%\\.wslconfig coloque")
        print("      [wsl2]\n      networkingMode=mirrored")
        print("    e rode `wsl --shutdown`.")
        print("  Opção 2: no PowerShell como administrador:")
        print(f"      netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport={port} connectaddress={wsl_ip} connectport={port}")
        print(f"      New-NetFirewallRule -DisplayName 'Sinfonia da Terra {port}' -Direction Inbound -Protocol TCP -LocalPort {port} -Action Allow -Profile Private")
        print(f"    Depois o celular abre http://{win_ip}:{port}\n")
    elif IS_WSL:
        print("  WSL (modo mirrored). Se o celular não abrir o endereço, libere a porta no Windows")
        print("  (PowerShell como administrador, uma vez só):")
        print(f"    New-NetFirewallHyperVRule -Name Sinfonia{port} -DisplayName 'Sinfonia da Terra {port}' "
              f"-Direction Inbound -VMCreatorId '{{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}}' -Protocol TCP -LocalPorts {port}")
        print(f"    New-NetFirewallRule -DisplayName 'Sinfonia da Terra {port}' -Direction Inbound -Protocol TCP "
              f"-LocalPort {port} -Action Allow -Profile Private\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
