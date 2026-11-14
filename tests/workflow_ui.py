"""案件・先行作業・子作業・完了条件を、実際のAPIとブラウザーで検証します。"""

import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
server = subprocess.Popen(
    [os.environ.get("FACTORY_MAP_NODE", "node"), "tests/map-local-server.mjs"],
    cwd=ROOT,
    stdout=subprocess.PIPE,
    text=True,
)
try:
    url = server.stdout.readline().strip()
    assert url.startswith("http://127.0.0.1:"), url
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
        )
        page = browser.new_page(viewport={"width": 1536, "height": 1100})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(url + "/console.html?teamTab=projects#tasks")
        page.get_by_role("button", name="案件と工程のサンプルを追加", exact=True).click()
        page.locator("[data-project-card]").first.wait_for()
        assert page.locator("[data-project-card]").count() == 3
        page.screenshot(path="/tmp/plantdesk-projects.png", full_page=True)
        page.get_by_role("button", name="＋ 案件を追加", exact=True).click()
        dialog = page.get_by_role("dialog", name="案件を追加", exact=True)
        dialog.get_by_label("案件名", exact=True).fill("ブラウザーで工程を確認")
        dialog.get_by_label("案件の目的・完了条件").fill("前工程・子作業・完了条件を確認して終える")
        dialog.get_by_label("案件の責任者").select_option("team-demo-3")
        dialog.get_by_role("button", name="案件を保存", exact=True).click()
        dialog.wait_for(state="hidden")
        card = page.locator("[data-project-card]").filter(has_text="ブラウザーで工程を確認")

        def create_task(title, predecessor=None, criteria=None):
            card.get_by_role("button", name="＋ 作業を追加", exact=True).click()
            d = page.get_by_role("dialog", name="仕事を登録", exact=True)
            d.get_by_label("作業名", exact=True).fill(title)
            if criteria:
                d.get_by_label("作業の完了条件", exact=True).fill(criteria)
            if predecessor:
                d.locator(".task-relations summary").click()
                d.get_by_label(predecessor + "を先行作業にする", exact=True).check()
            d.get_by_role("button", name="作業を保存", exact=True).click()
            d.wait_for(state="hidden")

        create_task("前工程の確認", criteria="隔離と安全確認が済んでいる")
        create_task("次の工程を進める", predecessor="前工程の確認")
        card.get_by_role("button", name="案件の作業を見る", exact=True).click()
        page.get_by_role("button", name="ボード", exact=True).click()
        next_card = page.locator("[data-task-card]").filter(has_text="次の工程を進める")
        next_card.get_by_role("button", name="次の工程を進めるを開始", exact=True).click()
        page.get_by_role("status").filter(has_text="先行作業").wait_for()
        page.get_by_role("button", name="前工程の確認", exact=True).click()
        d = page.get_by_role("dialog", name="作業の詳細・引き継ぎ", exact=True)
        d.get_by_role("button", name="完了にする", exact=True).click()
        d.get_by_role("button", name="作業を完了する", exact=True).click()
        d.get_by_role("alert").filter(has_text="完了条件").wait_for()
        d.get_by_label("作業の完了条件を確認", exact=True).check()
        d.get_by_role("button", name="作業を完了する", exact=True).click()
        d.wait_for(state="hidden")
        next_card.get_by_role("button", name="次の工程を進めるを開始", exact=True).click()
        next_card.get_by_role("button", name="次の工程を進めるを完了", exact=True).wait_for()
        next_card.get_by_role("button", name="次の工程を進める", exact=True).click()
        d = page.get_by_role("dialog", name="作業の詳細・引き継ぎ", exact=True)
        d.get_by_role("button", name="＋ 子作業を追加", exact=True).click()
        child = page.get_by_role("dialog", name="仕事を登録", exact=True)
        assert child.get_by_label("親作業", exact=True).input_value()
        child.get_by_label("作業名", exact=True).fill("施工写真を確認")
        child.get_by_role("button", name="作業を保存", exact=True).click()
        child.wait_for(state="hidden")
        next_card.get_by_role("button", name="次の工程を進めるを完了", exact=True).click()
        d = page.get_by_role("dialog", name="作業の詳細・引き継ぎ", exact=True)
        d.get_by_role("button", name="作業を完了する", exact=True).click()
        d.get_by_role("alert").filter(has_text="子作業").wait_for()
        d.get_by_role("button", name="閉じる", exact=True).click()
        for title in ["施工写真を確認", "次の工程を進める"]:
            page.get_by_role("button", name=title, exact=True).click()
            d = page.get_by_role("dialog", name="作業の詳細・引き継ぎ", exact=True)
            d.get_by_role("button", name="完了にする", exact=True).click()
            d.get_by_role("button", name="作業を完了する", exact=True).click()
            d.wait_for(state="hidden")
        page.get_by_role("button", name="案件・改善", exact=True).click()
        assert "100%" in card.inner_text()
        card.get_by_role("button", name="ブラウザーで工程を確認を編集", exact=True).click()
        d = page.get_by_role("dialog", name="案件を編集", exact=True)
        d.get_by_label("案件の状態").select_option("done")
        d.get_by_role("button", name="案件を保存", exact=True).click()
        d.wait_for(state="hidden")
        assert card.count() == 0
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        page.screenshot(path="/tmp/plantdesk-projects-mobile.png", full_page=True)
        page.goto(url + "/console.html?teamTab=projects&project=project-demo-pipe#tasks")
        page.locator(".team-filter-toggle").click()
        page.get_by_label("作業一覧の案件", exact=True).wait_for()
        assert page.get_by_label("作業一覧の案件", exact=True).input_value() == "project-demo-pipe"
        assert page.locator("[data-task-card]").count() > 0
        assert not errors, errors
        browser.close()
    print(
        "PASS: projects, scenario demo, dependencies, blocked start, acceptance confirmation, child completion, computed progress, project completion and mobile"
    )
finally:
    server.terminate()
    server.wait(timeout=10)
