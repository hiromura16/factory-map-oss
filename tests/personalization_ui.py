"""模擬APIとサンプル台帳を使い、表示設定・追加アイコン・プラン比較の画面を検証します。"""

import base64
import functools
import http.server
import json
import os
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(
    ("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT / "public"))
)
threading.Thread(target=server.serve_forever, daemon=True).start()
seed = json.loads((ROOT / "shared/demo/seed.json").read_text())
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
        )
        page = browser.new_page(viewport={"width": 1500, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        def api(route):
            url = route.request.url
            result = (
                {"state": seed, "revision": 1}
                if url.endswith("/api/state")
                else {"editor": False}
                if url.endswith("/api/auth/status")
                else {}
            )
            route.fulfill(json=result)

        page.route("**/api/**", api)
        page.goto("http://127.0.0.1:" + str(server.server_port))
        page.wait_for_function("window.factoryMap")
        page.locator("#factory-left-toggle").click()
        assert page.locator(".list-pane").is_hidden()
        assert page.locator("#factory-left-toggle").get_attribute("aria-expanded") == "false"
        page.locator("#factory-right-toggle").click()
        assert page.locator("#detail-pane").is_hidden()
        page.locator("#factory-left-toggle").click()
        assert page.locator(".list-pane").is_visible()
        page.locator("#factory-focus-toggle").click()
        assert page.locator(".summary-grid").is_hidden()
        page.locator("#factory-customize").click()
        page.get_by_label("テーマ", exact=True).select_option("dark")
        assert page.locator("body").get_attribute("data-factory-theme") == "dark"
        page.get_by_label("情報の密度", exact=True).select_option("compact")
        page.get_by_label("デモプラン", exact=True).select_option("pro")
        assert "2,000" in page.locator("#factory-plan-usage").inner_text()
        page.screenshot(path="/tmp/factory-map-personalization-desktop.png")
        page.keyboard.press("Escape")
        assert not page.locator("#factory-custom-dialog").is_visible()
        page.reload()
        page.wait_for_function("window.factoryMap")
        assert page.locator("body").get_attribute("data-factory-theme") == "dark"
        assert page.locator("#detail-pane").is_hidden()
        page.locator("#factory-customize").click()
        page.get_by_label("アイコン画像を追加").set_input_files(
            {"name": "bad.svg", "mimeType": "image/svg+xml", "buffer": b'<svg onload="alert(1)"/>'}
        )
        assert "SVG" in page.locator("#factory-icon-error").inner_text()
        png = page.evaluate(
            "()=>{const c=document.createElement('canvas');c.width=c.height=16;c.getContext('2d').fillRect(0,0,16,16);return c.toDataURL('image/png').split(',')[1]}"
        )
        page.get_by_label("アイコン画像を追加").set_input_files(
            {"name": "demo.png", "mimeType": "image/png", "buffer": base64.b64decode(png)}
        )
        page.wait_for_function("window.FactoryPreferences.getPreferences().icons.length===1")
        icon = page.evaluate("window.FactoryPreferences.getPreferences().icons[0].id")
        page.get_by_label("空調", exact=True).select_option(icon)
        assert "data:image/png" in page.evaluate(
            "FactoryEquipment.markerHTML({properties:{category:'hvac'}})"
        )
        page.get_by_role("button", name="demo.pngを削除").click()
        assert page.evaluate("window.FactoryPreferences.getPreferences().icons.length") == 0
        page.get_by_role("button", name="表示設定を初期化").click()
        assert page.locator(".summary-grid").is_visible()
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path="/tmp/factory-map-personalization-mobile.png")
        assert page.evaluate("document.documentElement.scrollWidth<=window.innerWidth")
        page.locator("#factory-customize").click()
        page.keyboard.press("Escape")
        assert not page.locator("#factory-custom-dialog").is_visible()
        assert not errors, errors
        browser.close()
    print(
        "personalization UI: panel toggles, focus, theme, persistence, mock plan, invalid/valid upload, mapping/removal, reset, mobile, Escape passed"
    )
finally:
    server.shutdown()
