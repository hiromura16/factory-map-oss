"""検証専用の一時DBから、README用の実画面を撮影します。"""

import os
from pathlib import Path
import subprocess

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "docs" / "images"


def main():
    IMAGES.mkdir(parents=True, exist_ok=True)
    server = subprocess.Popen(
        [os.environ.get("FACTORY_MAP_NODE", "node"), "scripts/dev-server.mjs"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        url = server.stdout.readline().strip()
        if not url.startswith("http://127.0.0.1:"):
            raise RuntimeError("ループバックの開発サーバーを起動できませんでした")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
            )
            context = browser.new_context(
                viewport={"width": 1440, "height": 1000},
                locale="ja-JP",
                timezone_id="Asia/Tokyo",
                reduced_motion="reduce",
            )
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))

            def capture(name):
                page.screenshot(path=str(IMAGES / name), animations="disabled")
                print(name, flush=True)

            page.goto(url + "/console.html?teamTab=projects#tasks")
            page.get_by_role("button", name="案件と工程のサンプルを追加", exact=True).click()
            page.locator("[data-project-card]").first.wait_for()
            page.get_by_role("button", name="ダッシュボード", exact=True).click()
            page.locator(".management-dashboard").wait_for()
            capture("dashboard.png")

            page.get_by_role("button", name="タスク", exact=True).click()
            page.locator("[data-task-row]").first.wait_for()
            capture("tasks.png")
            page.locator("[data-task-row] .task-title-button").first.click()
            details = page.get_by_role("dialog", name="作業の詳細・引き継ぎ", exact=True)
            details.wait_for()
            capture("task-detail.png")
            page.set_viewport_size({"width": 390, "height": 844})
            capture("mobile.png")
            details.get_by_role("button", name="閉じる", exact=True).click()
            page.set_viewport_size({"width": 1440, "height": 1000})
            page.get_by_role("button", name="ボード", exact=True).click()
            page.locator("[data-task-card]").first.wait_for()
            capture("board.png")

            page.get_by_role("button", name="点検予定・履歴", exact=True).click()
            page.get_by_role("button", name="実施履歴", exact=True).click()
            page.locator("[data-inspection-history]").first.wait_for()
            capture("inspections.png")

            page.goto(url + "/")
            page.wait_for_function("window.factoryMap && window.FactoryPreferences?.getPreferences")
            page.locator("#map").wait_for()
            capture("map.png")
            browser.close()
            if errors:
                raise RuntimeError("画面撮影中のJavaScriptエラー: " + str(errors))
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__ == "__main__":
    main()
