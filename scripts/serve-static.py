"""ビルド一覧で許可されたブラウザー用ファイルだけを配信する静的プレビュー。

使用例: python3 scripts/serve-static.py --bind 127.0.0.1 --port 8017
台帳の保存や認証は備えていないため、APIを含む検証には npm run dev を使います。"""

import argparse
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1] / "public"
# ビルド一覧にないファイルは public/ に置かれていても配信しません。
MANIFEST = ROOT.parent / ".deploy/manifest.json"
if not MANIFEST.is_file():
    raise SystemExit("先に npm run build を実行してください。")
ALLOWED = frozenset(path.removeprefix("/") for path in json.loads(MANIFEST.read_text()))


class UIHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        relative = "index.html" if path == "/" else path.removeprefix("/")
        if relative not in ALLOWED:
            self.send_error(404)
            return None
        candidate = ROOT / relative
        if (
            not candidate.is_file()
            or candidate.is_symlink()
            or ROOT not in candidate.resolve().parents
        ):
            self.send_error(404)
            return None
        self.path = "/" + relative
        return super().send_head()

    def list_directory(self, path):
        self.send_error(403, "Directory listing is disabled")
        return None

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", default=8017, type=int)
    args = parser.parse_args()
    missing = [name for name in ALLOWED if not (ROOT / name).is_file()]
    if missing:
        raise SystemExit("Missing public assets: " + ", ".join(missing))
    server = ThreadingHTTPServer((args.bind, args.port), partial(UIHandler, directory=str(ROOT)))
    print(f"UI: http://{args.bind}:{args.port}/ (allowlisted assets only)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
