"""短時間だけ有効なアップロードセッションで、準備済みの静的ファイルを送信します。

配置クライアントがAPI応答のセッションを非表示の標準入力から渡します。
この補助処理はローカルの認証ファイルを読まず、トークンをディスクへ保存しません。"""

import base64
import json
import sys
import termios
import urllib.request
import uuid
from pathlib import Path

old = termios.tcgetattr(sys.stdin)
hidden = termios.tcgetattr(sys.stdin)
hidden[3] &= ~termios.ECHO
termios.tcsetattr(sys.stdin, termios.TCSADRAIN, hidden)
print("Ready for asset upload JSON on stdin (input is hidden).", flush=True)
try:
    config = json.loads(sys.stdin.readline())
finally:
    termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old)
root = Path(__file__).resolve().parents[1]
assets = json.loads((root / ".deploy/assets.json").read_text())
config["buckets"] = json.loads((root / ".deploy/upload-buckets.json").read_text())
by_hash = {x["hash"]: x for x in assets}
completion = config["jwt"]
uploaded = 0
for bucket in config["buckets"]:
    boundary = "factory-" + uuid.uuid4().hex
    parts = []
    for file_hash in bucket:
        asset = by_hash[file_hash]
        content = base64.b64encode(Path(asset["file"]).read_bytes())
        parts.extend(
            [
                (
                    "--"
                    + boundary
                    + '\r\nContent-Disposition: form-data; name="'
                    + file_hash
                    + '"; filename="'
                    + file_hash
                    + '"\r\nContent-Type: '
                    + asset["mime"]
                    + "\r\n\r\n"
                ).encode(),
                content,
                b"\r\n",
            ]
        )
    parts.append(("--" + boundary + "--\r\n").encode())
    request = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/accounts/"
        + config["account_id"]
        + "/workers/assets/upload?base64=true",
        data=b"".join(parts),
        headers={
            "Authorization": "Bearer " + config["jwt"],
            "Content-Type": "multipart/form-data; boundary=" + boundary,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=55) as response:
        result = json.load(response)
    if not result.get("success"):
        raise RuntimeError("Cloudflare asset upload failed")
    if result.get("result", {}).get("jwt"):
        completion = result["result"]["jwt"]
    uploaded += len(bucket)
# 呼び出し元はこのJSONをメモリー内で受け取ります。セッションを含むため、そのままログへ出さないでください。
print(json.dumps({"uploaded": uploaded, "completion_jwt": completion}), flush=True)
