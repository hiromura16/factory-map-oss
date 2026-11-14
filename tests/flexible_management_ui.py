"""Layer set composition, parent navigation, equipment JSON import and property columns."""

import os
import subprocess
import json
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
            executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"),
            args=["--enable-features=WebMCP"],
        )
        page = browser.new_page(viewport={"width": 1536, "height": 1100})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(url)
        page.wait_for_function("FactoryPreferences.getPreferences")
        page.evaluate(
            """async()=>{await factoryMap.changeState(()=>{factoryMap.state.layers=[{id:'hvac',name:'空調',color:'#224466',audience:'facility'},{id:'power',name:'電気',color:'#448866',audience:'public'},{id:'water',name:'給排水',color:'#337788',audience:'public'}];factoryMap.state.assets[0].layerId='hvac';});}"""
        )
        page.locator("#layers-toggle").click()
        page.get_by_role("button", name="＋ 作成", exact=True).click()
        dialog = page.locator("#layer-set-dialog")
        dialog.get_by_label("セット名", exact=True).fill("空調巡回")
        dialog.get_by_label("給排水のセット内設定").select_option("none")
        dialog.get_by_label("電気のセット内設定").select_option("hide")
        dialog.get_by_role("button", name="セットを保存", exact=True).click()
        dialog.wait_for(state="hidden")
        card = page.locator(".layer-set-card").filter(has_text="空調巡回")
        card.get_by_role("button", name="切替", exact=True).click()
        page.wait_for_function(
            'FactoryPreferences.getPreferences().hiddenLayerIds.includes("power")'
        )
        page.wait_for_function('document.getElementById("show-assets").checked')
        page.get_by_role("button", name="＋ 作成", exact=True).click()
        dialog.get_by_label("セット名", exact=True).fill("インフラ点検")
        dialog.get_by_label("給排水のセット内設定").select_option("show")
        dialog.get_by_label("電気のセット内設定").select_option("show")
        dialog.get_by_role("button", name="セットを保存", exact=True).click()
        dialog.wait_for(state="hidden")
        page.get_by_label("空調巡回を組み合わせる").check()
        page.get_by_label("インフラ点検を組み合わせる").check()
        page.get_by_role("button", name="共通部分だけ表示", exact=True).click()
        page.wait_for_function(
            'FactoryPreferences.getPreferences().hiddenLayerIds.includes("power")&&FactoryPreferences.getPreferences().hiddenLayerIds.includes("water")'
        )
        assert not page.evaluate(
            'FactoryPreferences.getPreferences().hiddenLayerIds.includes("hvac")'
        )
        page.get_by_role("button", name="和集合だけ表示", exact=True).click()
        page.wait_for_function(
            '!FactoryPreferences.getPreferences().hiddenLayerIds.includes("water")'
        )
        page.screenshot(path="/tmp/plantdesk-layer-sets.png", full_page=True)
        page.reload()
        page.wait_for_function("FactoryPreferences.getPreferences")
        assert page.evaluate("factoryMap.state.layerSets.length") == 2
        # A directly selected detail drawing must still offer an up button.
        page.get_by_label("表示する図面").select_option("floor-a1")
        page.get_by_role("button", name="上の図面へ戻る", exact=True).click()
        page.wait_for_function('factoryMap.currentDrawing==="site"')
        assert page.get_by_role("button", name="上の図面へ戻る", exact=True).is_disabled()
        # New properties appear as selectable equipment and related-equipment work columns.
        page.evaluate(
            """async()=>{await factoryMap.changeState(()=>{factoryMap.state.propertyDefinitions.push({id:'vendor',name:'メーカー',type:'text'},{id:'capacity',name:'定格容量',type:'number',unit:'kW'});factoryMap.state.assets[0].properties.vendor='テストメーカー';factoryMap.state.assets[0].properties.capacity=15;factoryMap.state.works[0].assetIds=[factoryMap.state.assets[0].id];});}"""
        )
        asset = page.evaluate("factoryMap.state.assets[0]")
        page.goto(url + "/console.html#equipment")
        page.get_by_role("button", name="JSONで一括登録", exact=True).click()
        dialog = page.locator(".asset-import-dialog")
        data = {
            "assets": [
                {
                    "code": "JSON-UI-001",
                    "name": "JSONで追加した空調",
                    "drawingId": "site",
                    "point": [111, 222],
                    "properties": {"category": "hvac", "vendor": "追加メーカー", "capacity": 22},
                }
            ]
        }
        dialog.get_by_label("設備JSON", exact=True).fill(json.dumps(data, ensure_ascii=False))
        dialog.get_by_role("button", name="内容を確認する", exact=True).click()
        dialog.get_by_role("button", name="この内容で設備を保存", exact=True).wait_for()
        assert "新規追加 1件" in dialog.inner_text()
        dialog.get_by_role("button", name="この内容で設備を保存", exact=True).click()
        dialog.get_by_text("1件を追加、0件を更新しました。", exact=True).wait_for()
        dialog.get_by_role("button", name="設備取り込みを閉じる").click()
        page.get_by_role("button", name="JSONで一括登録", exact=True).click()
        dialog.get_by_label("設備JSONの取り込み方法").select_option("upsert")
        data = {"assets": [{"code": asset["code"], "properties": {"vendor": "更新メーカー"}}]}
        dialog.get_by_label("設備JSON", exact=True).fill(json.dumps(data, ensure_ascii=False))
        dialog.get_by_role("button", name="内容を確認する", exact=True).click()
        dialog.get_by_role("button", name="この内容で設備を保存", exact=True).click()
        dialog.get_by_text("0件を追加、1件を更新しました。", exact=True).wait_for()
        dialog.get_by_role("button", name="設備取り込みを閉じる").click()
        page.locator(".register-column-picker summary").click()
        page.get_by_label("表示項目を検索").fill("メーカー")
        page.locator(".register-column-panel").get_by_role(
            "checkbox", name="メーカー（prop:vendor）", exact=True
        ).check()
        page.get_by_label("表示項目を検索").fill("定格")
        page.locator(".register-column-panel").get_by_role(
            "checkbox", name="定格容量", exact=False
        ).check()
        page.locator(".register-column-picker summary").click()
        page.get_by_label("設備一覧を検索").fill(asset["code"])
        page.get_by_label("設備一覧を検索").press("Tab")
        page.get_by_text("一覧の表示設定を保存しました。", exact=True).wait_for()
        row = page.locator('[data-register-row="' + asset["id"] + '"]')
        assert "更新メーカー" in row.inner_text()
        assert "15 kW" in row.inner_text()
        assert page.locator(".register-table").evaluate("e=>e.scrollWidth>e.clientWidth")
        page.reload()
        page.wait_for_function('document.querySelectorAll("[data-register-row]").length===1')
        assert "メーカー" in page.locator(".register-table thead").inner_text()
        page.screenshot(path="/tmp/plantdesk-property-columns.png", full_page=True)
        page.get_by_role("button", name="工事一覧", exact=True).click()
        page.locator(".register-column-picker summary").click()
        page.get_by_label("表示項目の種類").select_option(label="関連設備のプロパティ")
        page.get_by_label("表示項目を検索").fill("メーカー")
        page.locator(".register-column-panel").get_by_role(
            "checkbox", name="関連設備：メーカー（assetProp:vendor）", exact=True
        ).check()
        page.get_by_text("一覧の表示設定を保存しました。", exact=True).wait_for()
        page.locator(".register-column-picker summary").click()
        assert "更新メーカー" in page.locator(".register-table tbody").inner_text()
        page.set_viewport_size({"width": 390, "height": 844})
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
        page.screenshot(path="/tmp/plantdesk-register-mobile.png", full_page=True)
        assert not errors, errors
        browser.close()
    print(
        "PASS: overlapping layer sets/composition/persistence; explicit parent navigation; preview/import/upsert JSON; equipment and related work properties; horizontal register scroll and mobile page fit"
    )
finally:
    server.terminate()
    server.wait(timeout=10)
