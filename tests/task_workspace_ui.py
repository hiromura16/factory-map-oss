"""実APIで、2つの業務画面、一覧の直接編集、詳細ペイン、未保存保護と点検履歴を検証します。"""

import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

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
        page = browser.new_page(viewport={"width": 1536, "height": 1050})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url + "/console.html?teamTab=projects#tasks")
        page.get_by_role("button", name="案件と工程のサンプルを追加", exact=True).click()
        page.locator("[data-project-card]").first.wait_for()
        primary = page.get_by_role("navigation", name="業務", exact=True)
        assert primary.get_by_role("button").all_text_contents() == ["◫ダッシュボード", "☷タスク"]
        page.get_by_role("button", name="ダッシュボード", exact=True).click()
        page.locator(".management-dashboard").wait_for()
        assert (
            page.get_by_role("heading", name="判断・調整が必要なタスク", exact=False).count() == 1
        )
        page.screenshot(path="/tmp/plantdesk-dashboard-redesign.png", full_page=True)
        page.locator(".management-counts button").filter(has_text="担当未定").click()
        expect(page.locator(".team-task-table")).to_be_visible()
        state = page.evaluate('async()=> (await (await fetch("/api/state")).json()).state')
        assert page.locator("[data-task-row]").count() == len(
            [
                t
                for t in state["tasks"]
                if not t["assigneeId"] and t["status"] not in ["done", "cancelled"]
            ]
        )
        page.get_by_role("navigation", name="タスクのビュー").get_by_role(
            "button", name="未完了", exact=True
        ).click()
        page.get_by_label("タスクをすばやく追加").fill("一覧から追加した仕事")
        page.get_by_label("タスクをすばやく追加").press("Enter")
        row = page.locator("[data-task-row]").filter(has_text="一覧から追加した仕事")
        row.wait_for()
        with page.expect_response(
            lambda r: "/api/tasks/" in r.url and r.request.method == "PATCH" and r.ok
        ):
            row.get_by_label("一覧から追加した仕事の担当者", exact=True).select_option(
                "team-demo-2"
            )
        expect(row.get_by_label("一覧から追加した仕事の担当者", exact=True)).to_be_enabled()
        with page.expect_response(
            lambda r: "/api/tasks/" in r.url and r.request.method == "PATCH" and r.ok
        ):
            row.get_by_label("一覧から追加した仕事の期限", exact=True).fill("2026-11-22")
        expect(row.get_by_label("一覧から追加した仕事の期限", exact=True)).to_be_enabled()
        with page.expect_response(
            lambda r: "/api/tasks/" in r.url and r.request.method == "PATCH" and r.ok
        ):
            row.get_by_label("一覧から追加した仕事の優先度", exact=True).select_option("high")
        expect(row.get_by_label("一覧から追加した仕事の優先度", exact=True)).to_be_enabled()
        row.get_by_role("button", name="一覧から追加した仕事", exact=True).click()
        pane = page.get_by_role("dialog", name="作業の詳細・引き継ぎ", exact=True)
        assert pane.evaluate('(e)=> !e.matches(":modal")')
        assert pane.get_by_label("作業の期限", exact=True).input_value() == "2026-11-22"
        assert pane.get_by_label("作業の担当者", exact=True).input_value() == "team-demo-2"
        page.screenshot(path="/tmp/plantdesk-task-detail-redesign.png", full_page=True)
        # 一覧を残したまま別の行を選び、同じ詳細ペインが選択先へ切り替わることを確認します。
        other = page.locator("[data-task-row]").filter(has_not_text="一覧から追加した仕事").first
        other_title = other.locator(".task-title-button").inner_text()
        other.locator(".task-title-button").click()
        expect(pane.get_by_label("作業名", exact=True)).to_have_value(other_title)
        pane.get_by_label("作業名", exact=True).fill("まだ保存しない変更")
        page.once("dialog", lambda d: d.dismiss())
        row.locator(".task-title-button").click()
        expect(pane.get_by_label("作業名", exact=True)).to_have_value("まだ保存しない変更")
        page.once("dialog", lambda d: d.accept())
        row.locator(".task-title-button").click()
        expect(pane.get_by_label("作業名", exact=True)).to_have_value("一覧から追加した仕事")
        pane.get_by_role("button", name="閉じる", exact=True).click()
        row.get_by_role("button", name="一覧から追加した仕事を完了", exact=True).click()
        pane.get_by_role("button", name="作業を完了する", exact=True).click()
        pane.wait_for(state="hidden")
        page.get_by_role("navigation", name="タスクのビュー").get_by_role(
            "button", name="完了", exact=True
        ).click()
        row.wait_for()
        page.get_by_role("navigation", name="タスクのビュー").get_by_role(
            "button", name="点検・保守", exact=True
        ).click()
        state = page.evaluate('async()=> (await (await fetch("/api/state")).json()).state')
        task_ids = page.locator("[data-task-row]").evaluate_all(
            "(els)=>els.map(e=>e.dataset.taskRow)"
        )
        assert task_ids and all(
            t["kind"] in ["inspection", "repair"] for t in state["tasks"] if t["id"] in task_ids
        )
        page.get_by_label("タスクの並び順").select_option("due")
        page.wait_for_function(
            'async()=>{const p=await (await fetch("/api/preferences")).json();return p.preferences.teamBoard.kind==="maintenance"&&p.preferences.teamBoard.sort==="due";}'
        )
        page.get_by_role("button", name="点検予定・履歴", exact=True).click()
        page.get_by_label("点検待ち設備の条件").select_option("")
        page.locator("[data-inspection-asset]").first.wait_for()
        page.get_by_role("button", name="実施履歴", exact=True).click()
        page.locator("[data-inspection-history]").first.wait_for()
        page.locator("[data-inspection-history]").first.get_by_role(
            "button", name="結果を見る"
        ).click()
        result = page.get_by_role("dialog", name="点検結果", exact=True)
        expect(result).to_be_visible()
        result.get_by_role("button", name="点検結果を閉じる", exact=True).click()
        page.screenshot(path="/tmp/plantdesk-inspections-redesign.png", full_page=True)
        page.get_by_role("button", name="作業一覧", exact=True).click()
        page.get_by_role("navigation", name="タスクのビュー").get_by_role(
            "button", name="未完了", exact=True
        ).click()
        page.screenshot(path="/tmp/plantdesk-task-list-redesign.png", full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        page.locator("[data-task-row] .task-title-button").first.click()
        expect(pane).to_be_visible()
        assert pane.bounding_box()["width"] <= 390
        page.screenshot(path="/tmp/plantdesk-task-mobile-redesign.png", full_page=True)
        pane.get_by_role("button", name="閉じる", exact=True).click()
        page.get_by_role("button", name="ダッシュボード", exact=True).click()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        page.screenshot(path="/tmp/plantdesk-dashboard-mobile-redesign.png", full_page=True)
        # 旧点検画面のブックマークが、統合後のタスク内の点検表示へ移動することを確認します。
        page.goto(url + "/console.html#inspections")
        expect(page.get_by_role("heading", name="タスク", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="点検待ち設備", exact=True)).to_be_visible()
        assert not errors, errors
        browser.close()
    print(
        "PASS: two work screens, dashboard queues, inline saved fields, nonmodal detail, unsaved guard, completion, inspection scope/history, persisted view, mobile and legacy route"
    )
finally:
    server.terminate()
    server.wait(timeout=10)
