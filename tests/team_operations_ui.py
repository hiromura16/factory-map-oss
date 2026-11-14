"""Real-browser team workflow: assignment, blockers, checklists, recurring inspection and follow-up."""

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
        page = browser.new_page(viewport={"width": 1536, "height": 1150})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(url + "/console.html#tasks")
        page.get_by_role("button", name="サンプル作業を追加", exact=True).click()
        page.get_by_text("サンプルの仕事を追加しました。", exact=True).wait_for()
        page.get_by_role("button", name="ボード", exact=True).click()
        assert page.locator("[data-task-card]").count() == 7
        page.get_by_role("button", name="担当者・負荷", exact=True).click()
        page.get_by_role("button", name="＋ 担当者を追加", exact=True).click()
        dialog = page.get_by_role("dialog", name="担当者を追加", exact=True)
        dialog.get_by_label("担当者名", exact=True).fill("テスト巡回担当")
        dialog.get_by_label("担当者の専門").fill("空調・給排水")
        dialog.get_by_label("担当者の連絡先").fill("内線1234")
        dialog.get_by_role("button", name="担当者を保存").click()
        dialog.wait_for(state="hidden")
        member = page.locator(".team-member-card").filter(has_text="テスト巡回担当")
        member.get_by_role("button", name="自分として表示", exact=True).click()
        page.get_by_role("button", name="＋ 仕事を登録", exact=True).click()
        dialog = page.get_by_role("dialog", name="仕事を登録", exact=True)
        dialog.get_by_label("作業名", exact=True).fill("A棟の修理前確認")
        dialog.get_by_label("作業の優先度").select_option("urgent")
        dialog.get_by_label("作業の担当者").select_option(label="テスト巡回担当")
        dialog.get_by_label("作業内容", exact=True).fill("交換部品と現場の状況を確認する。")
        dialog.get_by_label("対象設備を検索", exact=True).fill("AC-A-001")
        dialog.get_by_label("対象設備", exact=True).select_option("a1")
        dialog.get_by_text("チェック項目を編集", exact=True).click()
        field = dialog.get_by_label("チェック項目（1行に1項目）")
        field.fill("外観を確認")
        field.press("End")
        field.press("Enter")
        field.press_sequentially("写真を撮る")
        assert field.input_value() == "外観を確認\n写真を撮る"
        dialog.get_by_label("作業の添付資料").set_input_files(
            {
                "name": "作業用紙.pdf",
                "mimeType": "application/pdf",
                "buffer": b"%PDF-1.4\nTask attachment",
            }
        )
        dialog.get_by_role("link", name="作業用紙.pdf ↗", exact=True).wait_for()
        dialog.get_by_role("button", name="作業を保存", exact=True).click()
        dialog.wait_for(state="hidden")
        card = page.locator("[data-task-card]").filter(has_text="A棟の修理前確認")
        card.wait_for()
        card.get_by_role("button", name="A棟の修理前確認を開始", exact=True).click()
        page.locator(".team-kanban-column.in_progress").get_by_role(
            "button", name="A棟の修理前確認", exact=True
        ).wait_for()
        card.get_by_role("button", name="A棟の修理前確認", exact=True).click()
        dialog = page.get_by_role("dialog", name="作業の詳細・引き継ぎ", exact=True)
        dialog.get_by_label("作業の状態").select_option("waiting")
        dialog.get_by_label("手配待ちの理由").fill("交換部品の納期回答待ち。")
        dialog.get_by_role("button", name="作業を保存", exact=True).click()
        dialog.wait_for(state="hidden")
        page.locator(".team-kanban-column.waiting").get_by_text(
            "交換部品の納期回答待ち。", exact=True
        ).wait_for()
        card.get_by_role("button", name="A棟の修理前確認", exact=True).click()
        dialog = page.get_by_role("dialog", name="作業の詳細・引き継ぎ", exact=True)
        dialog.get_by_label("引き継ぎコメント").fill("部品は明日の午前に届く予定。")
        dialog.get_by_role("button", name="コメントを記録", exact=True).click()
        dialog.get_by_text("部品は明日の午前に届く予定。", exact=True).wait_for()
        dialog.get_by_role("checkbox", name="外観を確認", exact=True).check()
        dialog.get_by_role("checkbox", name="写真を撮る", exact=True).check()
        dialog.get_by_role("button", name="完了にする", exact=True).click()
        dialog.get_by_role("button", name="作業を完了する", exact=True).click()
        dialog.wait_for(state="hidden")
        card.wait_for(state="detached")
        page.locator(".team-filter-toggle").click()
        page.get_by_role("button", name="条件をクリア", exact=True).click()
        page.get_by_role("button", name="一覧", exact=True).click()
        page.get_by_label("作業一覧の状態").select_option("only_open")
        assert page.locator("[data-task-row]").count() > 0
        page.get_by_label("作業一覧の状態").select_option("open")
        page.get_by_label("表示中の作業を選択", exact=True).check()
        page.get_by_role("button", name="期限を明日に", exact=True).click()
        page.get_by_text("選択した作業を更新しました。", exact=True).wait_for()
        page.get_by_role("button", name="週間予定", exact=True).click()
        assert page.locator(".team-week-grid>section").count() == 7
        page.get_by_role("button", name="ボード", exact=True).click()
        page.screenshot(path="/tmp/plantdesk-team-board.png", full_page=True)
        page.get_by_role("button", name="点検計画", exact=True).click()
        page.get_by_role("button", name="＋ 点検計画を作成", exact=True).click()
        dialog = page.get_by_role("dialog", name="点検計画を作成", exact=True)
        dialog.get_by_label("点検計画名", exact=True).fill("空調機の週次巡回")
        dialog.get_by_label("点検周期（日）").fill("7")
        dialog.get_by_label("点検計画の担当者").select_option(label="テスト巡回担当")
        dialog.get_by_label("計画の確認項目").fill("異音を確認\n漏れを確認")
        dialog.get_by_label("計画の対象設備を検索").fill("AC-A-001")
        dialog.get_by_role("checkbox", name="計画の対象 AC-A-001", exact=True).check()
        dialog.get_by_role("button", name="点検計画を保存", exact=True).click()
        dialog.wait_for(state="hidden")
        plan = page.locator(".inspection-plan-card").filter(has_text="空調機の週次巡回")
        plan.get_by_role("button", name="今回の点検を起票", exact=True).click()
        dialog = page.get_by_role("dialog", name="点検作業の作成前確認", exact=True)
        assert "新規作業 1件" in dialog.inner_text()
        dialog.get_by_role("button", name="確認して作業を作成", exact=True).click()
        dialog.wait_for(state="hidden")
        plan.get_by_text("この計画の作業", exact=True).click()
        plan.locator(".team-plan-task").click()
        dialog = page.get_by_role("dialog", name="作業の詳細・引き継ぎ", exact=True)
        dialog.get_by_role("checkbox", name="異音を確認", exact=True).check()
        dialog.get_by_role("checkbox", name="漏れを確認", exact=True).check()
        dialog.get_by_role("button", name="点検結果を記録して完了", exact=True).click()
        dialog.get_by_label("作業の点検結果").select_option("attention")
        dialog.get_by_label("作業の点検内容").fill("接続部に漏れあり。補修の手配をする。")
        assert dialog.get_by_role("checkbox", name="要対応のフォロー作業を作成").is_checked()
        dialog.get_by_role("button", name="点検結果を保存して完了", exact=True).click()
        dialog.wait_for(state="hidden")
        saved = page.evaluate('async()=>await (await fetch("/api/state")).json()')
        a = next(a for a in saved["state"]["assets"] if a["id"] == "a1")
        assert any(
            h.get("text") == "接続部に漏れあり。補修の手配をする。" and h.get("taskId")
            for h in a["history"]
        )
        assert any(t.get("followupFor") and t["assetId"] == "a1" for t in saved["state"]["tasks"])
        page.get_by_role("button", name="朝会・引き継ぎ", exact=True).click()
        page.get_by_label("引き継ぎレポート").wait_for()
        text = page.get_by_label("引き継ぎレポート").input_value()
        assert "直近7日の完了" in text
        assert "A棟の修理前確認" in text
        assert "要対応：A棟 空調室外機" in text
        page.screenshot(path="/tmp/plantdesk-team-handover.png", full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        page.get_by_role("button", name="作業一覧", exact=True).click()
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
        page.screenshot(path="/tmp/plantdesk-team-mobile.png", full_page=True)
        # Contextual work creation from an equipment detail is prefilled.
        page.goto(url + "/?asset=a1")
        page.wait_for_function("window.FactoryPreferences?.getPreferences")
        page.get_by_role("link", name="仕事を依頼", exact=True).click()
        dialog = page.get_by_role("dialog", name="仕事を登録", exact=True)
        assert dialog.get_by_label("対象設備", exact=True).input_value() == "a1"
        dialog.get_by_role("button", name="仕事を登録を閉じる", exact=True).click()
        assert not errors, errors
        browser.close()
    print(
        "PASS: team demo, roster/self-view, contextual requests, two-line checklists, files, assignments, blockers/comments, bulk changes, weekly schedule, recurring inspections, atomic history+follow-up, handover, mobile"
    )
finally:
    server.terminate()
    server.wait(timeout=10)
