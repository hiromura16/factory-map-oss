"""localhost:8017の試作マップに対して、基本表示・DXF読み込み・画面操作を検証します。"""

import os

from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True, args=["--no-sandbox"])
        context = browser.new_context(
            viewport={"width": 1600, "height": 1080}, locale="ja-JP", timezone_id="Asia/Tokyo"
        )
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:8017/", wait_until="networkidle")
        page.wait_for_function("window.factoryMap && window.factoryMap.state.works.length === 6")
        expect(page.locator("#record-list .record-card")).to_have_count(5)
        page.screenshot(path=str(ROOT / "preview-desktop.png"), full_page=True)
        page.locator("[data-summary=active]").click()
        expect(page.locator("#record-list .record-card")).to_have_count(3)
        page.locator("#search").fill("A棟")
        expect(page.locator("#record-list .record-card")).to_have_count(1)
        page.locator("#record-list .record-card").click()
        expect(page.locator("#detail-pane h2")).to_have_text("A棟南側 配管更新工事")
        page.locator("#search").fill("")
        page.locator("[data-summary=all]").click()
        page.locator("#date-toggle").click()
        page.locator("#date-filter").fill("2026-11-25")
        expect(page.locator("#record-list .record-card")).to_have_count(1)
        expect(page.locator("#record-list h3")).to_have_text("B棟東側 外壁補修")
        page.locator("#date-toggle").click()
        page.locator("#plan-open").click()
        expect(page.locator("#plan-dialog")).to_be_visible()
        expect(page.locator("#plan-dialog")).to_contain_text("Rust API")
        page.locator("#plan-dialog [data-close]").last.click()

        page.locator("#import-open").click()
        page.locator("#cad-file").set_input_files(
            str(ROOT / "frontend/static/samples/factory-layout.dxf")
        )
        page.wait_for_function('window.factoryMap.currentDrawing !== "site"')
        drawing_id = page.evaluate("window.factoryMap.currentDrawing")
        cad = page.evaluate(
            "window.factoryMap.state.drawings.find(d=>d.id===window.factoryMap.currentDrawing).cad"
        )
        assert len(cad["features"]) >= 20, cad
        assert "BUILDINGS" in cad["layers"] and "EQUIPMENT" in cad["layers"]
        source = (ROOT / "frontend/static/samples/factory-layout.dxf").read_text()
        mm_source = source.replace("9\n$INSUNITS\n70\n6", "9\n$INSUNITS\n70\n4")
        mm_cad = page.evaluate("(source)=>FactoryCAD.parse(source)", mm_source)
        assert abs(mm_cad["bounds"][1][1] - cad["bounds"][1][1] / 1000) < 1e-8, (
            "Millimetres must convert to metres"
        )
        omitted_source = source.replace(
            "0\nENDSEC\n0\nEOF", "0\nHATCH\n8\nPATTERN\n0\nENDSEC\n0\nEOF"
        )
        omitted = page.evaluate("(source)=>FactoryCAD.parse(source)", omitted_source)
        assert omitted["skipped"].get("HATCH") == 1, "Unsupported entities must be reported"
        expect(page.locator("#record-list .record-card")).to_have_count(0)
        page.locator("#layers-toggle").click()
        expect(page.locator("#layers-panel")).to_contain_text("BUILDINGS")
        page.locator("#layers-toggle").click()
        page.screenshot(path=str(ROOT / "preview-dxf.png"), full_page=True)

        page.locator("#work-add").click()
        corners = page.evaluate("""() => {
            const map=window.factoryMap.map, rect=map.getContainer().getBoundingClientRect();
            return [[590,320],[590,740],[650,740],[650,320]].map(p=>{const q=map.latLngToContainerPoint(p);return {x:q.x+rect.left,y:q.y+rect.top};});
        }""")
        for point in corners + corners[:1]:
            page.mouse.click(point["x"], point["y"])
            page.wait_for_timeout(150)
        expect(page.locator("#work-dialog")).to_be_visible()
        page.locator("#field-title").fill("DXF上で登録した試験工事")
        page.locator("#field-location").fill("A棟 南側")
        page.locator("#field-start").fill("2026-11-14")
        page.locator("#field-end").fill("2026-11-13")
        page.locator("#work-form [type=submit]").click()
        expect(page.locator("#form-error")).to_contain_text("終了日は開始日以降")
        page.locator("#field-end").fill("2026-11-18")
        page.locator("#field-status").select_option("active")
        page.locator("#field-notes").fill("通路を迂回してください。")
        page.locator('[name=impact][value="通行止め"]').check()
        page.locator("#field-attachment").set_input_files(
            {"name": "notice.txt", "mimeType": "text/plain", "buffer": "試験の案内資料".encode()}
        )
        page.locator("#work-form [type=submit]").click()
        expect(page.locator("#work-dialog")).not_to_be_visible()
        expect(page.locator("#detail-pane h2")).to_have_text("DXF上で登録した試験工事")
        expect(page.locator('#detail-pane a[download="notice.txt"]')).to_be_visible()
        assert page.evaluate("window.factoryMap.state.works.length") == 7
        page.reload(wait_until="networkidle")
        page.wait_for_function("window.factoryMap")
        page.locator("#drawing-select").select_option(drawing_id)
        expect(page.locator("#record-list .record-card")).to_have_count(1)
        page.locator("#record-list .record-card").click()
        page.locator("#work-edit").click()
        page.locator("#field-title").fill("<img src=x onerror=alert(1)>")
        page.locator("#work-form [type=submit]").click()
        expect(page.locator("#detail-pane h2")).to_have_text("<img src=x onerror=alert(1)>")
        expect(page.locator("#detail-pane h2 img")).to_have_count(0)
        page.locator("#view-mode").click()
        expect(page.locator("#work-add")).not_to_be_visible()
        expect(page.locator("#work-edit")).not_to_be_visible()
        expect(page.locator("#import-open")).not_to_be_visible()

        result = page.evaluate("""() => {
            try{FactoryCAD.parse('not dxf');return false;}catch(e){return e.message.includes('DXF');}
        }""")
        assert result, "Invalid DXF must be rejected"
        binary = page.evaluate(
            """() => {try{FactoryCAD.parse('AutoCAD Binary DXF');return false;}catch(e){return e.message.includes('バイナリ');}}"""
        )
        assert binary
        page.locator("#drawing-select").select_option("site")
        page.locator("#view-mode").click()
        page.locator("#record-list .record-card").first.click()
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(300)
        page.locator("#detail-close").click()
        page.wait_for_timeout(150)
        expect(page.locator("#toast")).not_to_be_visible(timeout=6000)
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), (
            "Horizontal overflow on mobile"
        )
        assert page.evaluate("window.factoryMap.map.getBounds().contains([550,1000])"), (
            "The drawing must stay visible after resizing"
        )
        page.screenshot(path=str(ROOT / "preview-mobile.png"), full_page=True)
        assert not errors, errors
        print(
            json.dumps(
                {
                    "result": "PASS",
                    "dxf_features": len(cad["features"]),
                    "layers": cad["layers"],
                    "checks": [
                        "search/status/date filters",
                        "roadmap",
                        "real DXF import",
                        "CAD unit conversion",
                        "unsupported entity reporting",
                        "layer controls",
                        "polygon drawing",
                        "date validation",
                        "attachment",
                        "save and reload",
                        "safe text rendering",
                        "read mode",
                        "invalid/binary DXF rejection",
                        "mobile layout",
                    ],
                    "page_errors": errors,
                },
                ensure_ascii=False,
            )
        )
        browser.close()


if __name__ == "__main__":
    run()
