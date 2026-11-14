"""旧OIDCコンソールで、PKCE・nonce・再送拒否・認証途中の取消しとログアウトを検証します。"""

import base64
import functools
import http.server
import json
import os
import threading
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "public"))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = "http://127.0.0.1:" + str(server.server_port)
config = {
    "enabled": True,
    "issuer": origin,
    "clientId": "qa-public",
    "authorizationEndpoint": origin + "/mock-authorize",
    "tokenEndpoint": origin + "/mock-token",
}
empty = {
    "version": 2,
    "drawings": [],
    "works": [],
    "assets": [],
    "propertyDefinitions": [],
    "notes": [],
}
state = json.loads(json.dumps(empty))
rev = 0
plan = "free"
nonce = ""
challenge = ""
bad_nonce = False
cancel_token = False
logout_late = False
requests = []


def jwt(c):
    def enc(x):
        return base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip("=")

    return (
        enc({"alg": "RS256", "kid": "mock"}) + "." + enc(c) + ".fake-signature-for-mocked-api-only"
    )


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
        )
        page = browser.new_page(viewport={"width": 1250, "height": 1000})
        page.set_default_timeout(8000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        def route(r):
            global nonce, challenge, state, rev, plan
            u = urlparse(r.request.url)
            path = u.path
            requests.append(path)
            if path == "/saas-config.json":
                r.fulfill(json=config)
            elif path == "/mock-authorize":
                q = parse_qs(u.query)
                assert q["code_challenge_method"] == ["S256"]
                assert len(q["code_challenge"][0]) == 43
                nonce = q["nonce"][0]
                challenge = q["code_challenge"][0]
                target = (
                    q["redirect_uri"][0]
                    + "?"
                    + urlencode({"code": "mock-code", "state": q["state"][0], "iss": origin})
                )
                r.fulfill(
                    content_type="text/html",
                    body='<a id="approve" href="' + target + '">Approve mock sign-in</a>',
                )
            elif path == "/mock-token":
                if cancel_token:
                    page.evaluate(
                        "setTimeout(()=>document.getElementById('cancel-login').click(),0)"
                    )
                    page.wait_for_timeout(80)
                q = parse_qs(r.request.post_data)
                assert len(q["code_verifier"][0]) >= 43
                assert q["code"] == ["mock-code"]
                import hashlib

                assert (
                    base64.urlsafe_b64encode(
                        hashlib.sha256(q["code_verifier"][0].encode()).digest()
                    )
                    .decode()
                    .rstrip("=")
                    == challenge
                )
                r.fulfill(
                    json={
                        "id_token": jwt(
                            {
                                "iss": origin,
                                "aud": "qa-public",
                                "sub": "qa",
                                "nonce": "bad" if bad_nonce else nonce,
                                "exp": time.time() + 300,
                            }
                        )
                    }
                )
            elif path.startswith("/api/v1/"):
                assert r.request.headers.get("authorization", "").startswith("Bearer ")
                if path.endswith("/organizations") and logout_late:
                    page.evaluate("setTimeout(()=>document.getElementById('logout').click(),0)")
                    page.wait_for_timeout(80)
                if path.endswith("/organizations"):
                    r.fulfill(
                        json={
                            "items": [
                                {
                                    "id": "org-1",
                                    "name": "QA organization",
                                    "role": "owner",
                                    "plan": plan,
                                    "revision": rev,
                                }
                            ]
                        }
                    )
                elif path.endswith("/onboard"):
                    r.fulfill(json={"organizationId": "org-1", "role": "owner"}, status=201)
                elif path.endswith("/state") or path.endswith("/export"):
                    r.fulfill(
                        json={
                            "state": state,
                            "revision": rev,
                            "plan": plan,
                            "limits": {
                                "drawings": 3 if plan == "free" else 30,
                                "assets": 100 if plan == "free" else 2000,
                            },
                        }
                    )
                elif path.endswith("/billing"):
                    d = r.request.post_data_json
                    assert d["revision"] == rev
                    plan = d["plan"]
                    rev += 1
                    r.fulfill(json={"revision": rev})
                elif path.endswith("/import-preview"):
                    data = r.request.post_data_json
                    r.fulfill(
                        json={
                            "state": data,
                            "counts": {
                                k: len(data[k])
                                for k in [
                                    "drawings",
                                    "works",
                                    "assets",
                                    "propertyDefinitions",
                                    "notes",
                                ]
                            },
                            "history": 0,
                            "conflicts": [],
                            "attachmentIds": [],
                            "warnings": [],
                            "canApply": True,
                        }
                    )
                elif path.endswith("/import"):
                    d = r.request.post_data_json
                    assert d["revision"] == rev
                    state = d["state"]
                    rev += 1
                    r.fulfill(json={"revision": rev})
                else:
                    r.fulfill(status=404, json={"error": "unexpected API"})
            else:
                r.continue_()

        page.route("**/*", route)
        page.goto(origin + "/saas.html")
        page.wait_for_function("!document.getElementById('login').disabled")
        assert "/mock-authorize" not in requests
        page.locator("#login").click()
        page.locator("#approve").click()
        page.wait_for_function("!document.getElementById('console').hidden")
        assert page.evaluate("sessionStorage.getItem('factory-map.oidc-transaction.v1')") is None
        assert "code=" not in page.url and "state=" not in page.url
        assert (
            page.evaluate('Object.values(localStorage).some(v=>v.includes("fake-signature"))')
            is False
        )
        page.locator("#org-name").fill("New QA organization")
        page.locator("#create-org button").click()
        page.wait_for_function(
            "document.getElementById('message').textContent.includes('組織を作成')"
        )
        page.locator("#org-select").select_option("org-1")
        page.wait_for_function("!document.getElementById('workspace').hidden")
        assert "100" in page.locator("#usage").inner_text()
        page.locator("#plan").select_option("pro")
        page.locator("#change-plan").click()
        page.wait_for_function("document.getElementById('revision').textContent.includes('pro')")
        snapshot = {**empty, "drawings": [{"id": "site", "name": "sample"}]}
        page.locator("#import-file").set_input_files(
            {
                "name": "sample.json",
                "mimeType": "application/json",
                "buffer": json.dumps(snapshot).encode(),
            }
        )
        page.locator("#preview").click()
        page.wait_for_function("!document.getElementById('apply-import').disabled")
        page.locator("#apply-import").click()
        page.wait_for_function(
            "document.getElementById('message').textContent.includes('取り込みました')"
        )
        with page.expect_download() as download:
            page.locator("#export").click()
        assert download.value.suggested_filename == "factory-map-export.json"
        page.screenshot(path="/tmp/factory-map-saas-desktop.png", full_page=True)
        page.locator("#logout").click()
        assert page.locator("#console").is_hidden()
        # 使用済みの認証コールバックを再送しても、トークン交換が行われないことを確認します。
        before = requests.count("/mock-token")
        page.goto(origin + "/saas.html?code=mock-code&state=replayed")
        page.wait_for_function("document.getElementById('message').textContent.includes('一致')")
        assert requests.count("/mock-token") == before
        # nonce不一致を、認証後のAPIへ要求を送る前に拒否することを確認します。
        bad_nonce = True
        before = requests.count("/api/v1/organizations")
        page.locator("#login").click()
        page.locator("#approve").click()
        page.wait_for_function("document.getElementById('message').textContent.includes('nonce')")
        assert requests.count("/api/v1/organizations") == before
        bad_nonce = False
        # 認証コールバックの重複パラメーターを、コード交換の前に拒否することを確認します。
        page.locator("#login").click()
        page.locator("#approve").wait_for()
        target = page.locator("#approve").get_attribute("href")
        before = requests.count("/mock-token")
        page.goto(target + "&code=duplicate")
        page.wait_for_function(
            "document.getElementById('message').textContent.includes('認証コードが不正')"
        )
        assert requests.count("/mock-token") == before
        # トークン交換中に取り消し、遅れて返った応答でログイン状態にならないことを確認します。
        cancel_token = True
        page.locator("#login").click()
        page.locator("#approve").click()
        page.wait_for_function(
            "document.getElementById('message').textContent.includes('取り消しました')"
        )
        page.wait_for_timeout(150)
        assert page.locator("#console").is_hidden()
        cancel_token = False
        page.locator("#login").click()
        page.locator("#approve").click()
        page.wait_for_function("!document.getElementById('console').hidden")
        # 再取得の応答待ちにログアウトしても、古い組織一覧が後から表示されないことを確認します。
        logout_late = True
        page.locator("#refresh").click()
        page.wait_for_function(
            "document.getElementById('message').textContent.includes('ログアウトしました')"
        )
        page.wait_for_timeout(150)
        assert page.locator("#console").is_hidden()
        assert page.locator("#org-select option").count() == 1
        logout_late = False
        page.locator("#cancel-login").click()
        assert page.locator("#console").is_hidden()
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path="/tmp/factory-map-saas-mobile.png", full_page=True)
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
        # 接続設定がない場合は設定方法を表示し、自動的な認証画面への移動を始めないことを確認します。
        config["enabled"] = False
        page.goto(origin + "/saas.html")
        page.wait_for_function("!document.getElementById('setup').hidden")
        assert page.locator("#login").is_disabled()
        assert not errors, errors
        browser.close()
    print(
        "SaaS UI mock QA passed: explicit login PKCE, nonce, one-time callback/replay, logout/relogin, org selection, plan, import preview/apply/export, mobile, setup"
    )
finally:
    server.shutdown()
