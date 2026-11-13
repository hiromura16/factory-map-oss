"""Serve only the reviewed browser UI assets, never the project directory.

Usage: python3 serve_ui.py --bind 192.168.16.16 --port 8017
This is a prototype viewer, not a shared application backend.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent / 'public'
ALLOWED = frozenset({
    'index.html', 'styles.css', 'app.js', 'cad.js',
    'assets/site-plan.svg', 'assets/floor-plan.svg',
    'samples/factory-layout.dxf',
    'vendor/leaflet.js', 'vendor/leaflet.css',
    'vendor/geoman.js', 'vendor/geoman.css', 'vendor/dxf-parser.js',
    'vendor/LICENSE-leaflet.txt', 'vendor/LICENSE-geoman.txt', 'vendor/LICENSE-dxf-parser.txt',
    'vendor/images/marker-icon.png', 'vendor/images/marker-icon-2x.png',
    'vendor/images/marker-shadow.png', 'vendor/images/layers.png', 'vendor/images/layers-2x.png',
})


class UIHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        relative = 'index.html' if path == '/' else path.removeprefix('/')
        if relative not in ALLOWED:
            self.send_error(404)
            return None
        candidate = ROOT / relative
        if not candidate.is_file() or candidate.is_symlink() or ROOT not in candidate.resolve().parents:
            self.send_error(404)
            return None
        self.path = '/' + relative
        return super().send_head()

    def list_directory(self, path):
        self.send_error(403, 'Directory listing is disabled')
        return None

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bind', default='127.0.0.1')
    parser.add_argument('--port', default=8017, type=int)
    args = parser.parse_args()
    missing = [name for name in ALLOWED if not (ROOT / name).is_file()]
    if missing:
        raise SystemExit('Missing public assets: ' + ', '.join(missing))
    server = ThreadingHTTPServer((args.bind, args.port), partial(UIHandler, directory=str(ROOT)))
    print(f'UI: http://{args.bind}:{args.port}/ (allowlisted assets only)', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
