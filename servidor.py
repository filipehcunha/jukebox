#!/usr/bin/env python3
"""
Servidor local da Sinfonia da Terra.

Serve o projeto em todas as interfaces (0.0.0.0) para que o smartphone, na mesma rede
Wi-Fi, consiga abrir a página receptora do QR Code. Também responde em /__lan com o
endereço da rede local, que o app usa automaticamente para montar o QR Code.

Uso:
    python3 servidor.py                 # porta 8000
    python3 servidor.py 8080            # outra porta
    python3 servidor.py 8000 --url http://192.168.0.10:8000   # força o endereço do QR
"""
import http.server
import json
import socket
import sys
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # não envia pacotes; só escolhe a interface de saída
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8000
    forced = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else None
    public = forced or f"http://{lan_ip()}:{port}"

    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path.split("?")[0] == "/__lan":
                body = json.dumps({"url": public}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

        def log_message(self, fmt, *a):
            if "/dados/" not in (a[0] if a else ""):
                super().log_message(fmt, *a)

    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), partial(Handler, directory=str(ROOT)))
    print(f"\n  A Sinfonia da Terra")
    print(f"  Neste computador: http://localhost:{port}")
    print(f"  Na rede (celular): {public}")
    print(f"  Ctrl+C para encerrar.\n")
    if "microsoft" in Path("/proc/version").read_text(errors="ignore").lower() if Path("/proc/version").exists() else False:
        print("  WSL detectado. Se o celular não abrir o endereço acima, libere a porta no Windows")
        print("  (PowerShell como administrador, uma vez só):")
        print(f"    New-NetFirewallHyperVRule -Name Sinfonia{port} -DisplayName 'Sinfonia da Terra {port}' "
              f"-Direction Inbound -VMCreatorId '{{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}}' -Protocol TCP -LocalPorts {port}")
        print(f"    New-NetFirewallRule -DisplayName 'Sinfonia da Terra {port}' -Direction Inbound -Protocol TCP "
              f"-LocalPort {port} -Action Allow -Profile Private")
        print("  (sem networkingMode=mirrored no .wslconfig, o IP acima é interno do WSL e não funciona)\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
