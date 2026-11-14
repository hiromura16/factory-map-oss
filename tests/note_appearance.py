"""付箋の寸法・文字・色・ズーム倍率と、保存後に同じ表示へ復元されることを検証します。"""

import os

import asyncio
import uuid
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = os.environ.get("FACTORY_MAP_TEST_URL", "http://127.0.0.1:18018")
PREFIX = "appearance-qa-" + uuid.uuid4().hex[:8]
PASSWORD = Path(
    os.environ.get(
        "FACTORY_MAP_TEST_PASSWORD_FILE", str(ROOT / ".runtime/initial-admin-password.txt")
    )
).read_text()


async def main():
    async with async_playwright() as p:
        staff = await p.request.new_context(base_url=URL)
        public = await p.request.new_context(base_url=URL)

        async def req(client, method, path, data=None, expected=200):
            r = await client.fetch(
                path, method=method, **({"data": data} if data is not None else {})
            )
            assert r.status == expected, (method, path, r.status, (await r.text())[:100])
            return await r.json()

        await req(staff, "POST", "/api/auth/login", {"password": PASSWORD})
        baseline = (await req(staff, "GET", "/api/state"))["state"]
        browser = None
        try:
            legacy = {
                "id": PREFIX + "-legacy",
                "text": PREFIX + " 既存形式",
                "drawingId": "site",
                "point": [200, 200],
            }
            await req(staff, "POST", "/api/notes", legacy, 201)
            for patch in [
                {"color": "red"},
                {"color": "#123"},
                {"color": "#gggggg"},
                {"color": None},
                {"size": 0},
                {"size": 301},
                {"size": 100.5},
                {"size": "150"},
                {"referenceZoom": 9},
                {"referenceZoom": None},
            ]:
                await req(staff, "PATCH", "/api/notes/" + legacy["id"], patch, 422)
            await req(public, "PATCH", "/api/notes/" + legacy["id"], {"color": "#ffffff"}, 401)
            browser = await p.chromium.launch(
                executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"),
                args=["--enable-features=WebMCP"],
            )
            context = await browser.new_context(viewport={"width": 1500, "height": 1050})
            page = await context.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.goto(URL)
            await page.wait_for_function("window.factoryMap && window.FactoryNotes")
            assert await page.locator("#note-add").is_hidden()
            await page.locator("#view-mode").click()
            await page.locator("#login-dialog input").fill(PASSWORD)
            await page.locator("#login-dialog [type=submit]").click()
            await page.wait_for_function("factoryMap.editor")
            await page.locator("#note-add").click()
            await page.locator("#map").click(position={"x": 370, "y": 310})
            await page.locator("#note-dialog textarea").fill(PREFIX + "\n図面と一緒に拡大縮小")
            await page.locator("#note-size").fill("170")
            assert await page.locator("#note-size-slider").input_value() == "170"
            await page.locator('[data-note-color="#d9eeff"]').click()
            assert await page.locator("#note-color").input_value() == "#d9eeff"
            await page.locator("#note-dialog [type=submit]").click()
            await page.locator("#note-dialog").wait_for(state="hidden")
            note = await page.evaluate(
                'p=>factoryMap.state.notes.find(n=>n.text.startsWith(p+"\\n"))', PREFIX
            )
            nid = note["id"]
            assert note["size"] == 170 and note["color"] == "#d9eeff"
            marker = page.locator('[data-note-id="' + nid + '"]')

            async def measure():
                return await page.evaluate(
                    """id=>{
     const el=document.querySelector('[data-note-id="'+id+'"]');
     const paper=el.querySelector('.sticky-note-paper'),box=paper.getBoundingClientRect();
     const outer=el.getBoundingClientRect(),drawing=document.querySelector('.leaflet-image-layer').getBoundingClientRect();
     const n=factoryMap.state.notes.find(n=>n.id===id),point=factoryMap.map.latLngToContainerPoint([n.point[1],n.point[0]]);
     const mapBox=document.getElementById('map').getBoundingClientRect();
     return {width:box.width,height:box.height,outerWidth:outer.width,outerHeight:outer.height,
      ratio:box.width/drawing.width,x:box.left-mapBox.left,y:box.top-mapBox.top,px:point.x,py:point.y,
      color:getComputedStyle(paper).backgroundColor,ink:getComputedStyle(paper).color};
    }""",
                    nid,
                )

            await page.evaluate(
                "n=>factoryMap.map.setView([n.point[1],n.point[0]],n.referenceZoom,{animate:false})",
                note,
            )
            first = await measure()
            assert abs(first["width"] - 204 * 1.7) < 0.5, first
            assert first["color"] == "rgb(217, 238, 255)"
            assert (
                abs(first["outerWidth"] - first["width"]) < 0.5
                and abs(first["outerHeight"] - first["height"]) < 0.5
            )
            assert (
                abs(first["x"] - (first["px"] - 14 * 1.7)) < 1
                and abs(first["y"] - (first["py"] - 14 * 1.7)) < 1
            )
            # ズームを1段階上げると図面と付箋全体がともに2倍になり、文字も同じ倍率になることを確認します。
            await page.evaluate(
                "factoryMap.map.setZoom(factoryMap.map.getZoom()+1,{animate:false})"
            )
            second = await measure()
            assert abs(second["width"] / first["width"] - 2) < 0.01
            assert abs(second["height"] / first["height"] - 2) < 0.01
            assert abs(second["ratio"] - first["ratio"]) < 0.001
            assert (
                abs(second["x"] - (second["px"] - 14 * 3.4)) < 1
                and abs(second["y"] - (second["py"] - 14 * 3.4)) < 1
            )
            # アニメーション付きズームの終了後も、同じ寸法へ落ち着くことを確認します。
            await page.evaluate("factoryMap.map.setZoom(factoryMap.map.getZoom()-1,{animate:true})")
            await page.wait_for_function("!factoryMap.map._animatingZoom")
            await page.wait_for_timeout(300)
            assert abs((await measure())["width"] - first["width"]) < 0.5
            await marker.click()
            assert await page.locator("#note-size").input_value() == "170"
            await page.locator("#note-size").fill("85")
            # ブラウザーの色選択から独自の色が返されたときと同じinputイベントを発生させます。
            await page.locator("#note-color").evaluate(
                "el=>{el.value='#102345';el.dispatchEvent(new Event('input',{bubbles:true}));}"
            )
            await page.locator("#note-dialog [type=submit]").click()
            await page.locator("#note-dialog").wait_for(state="hidden")
            edited = await req(public, "GET", "/api/notes/" + nid)
            assert (
                edited["size"] == 85
                and edited["color"] == "#102345"
                and edited["referenceZoom"] == note["referenceZoom"]
            )
            small = await measure()
            assert abs(small["width"] / first["width"] - 0.5) < 0.01
            assert small["ink"] == "rgb(255, 255, 255)"
            # 紙面を1%まで縮めても、編集できるクリック領域が残ることを確認します。
            await marker.click()
            await page.locator("#note-size").fill("1")
            assert await page.locator("#note-size-slider").input_value() == "1"
            await page.locator("#note-dialog [type=submit]").click()
            await page.locator("#note-dialog").wait_for(state="hidden")
            minimum = await measure()
            assert abs(minimum["width"] - 2.04) < 0.2, minimum
            assert minimum["outerWidth"] >= 24 and minimum["outerHeight"] >= 24
            assert (await req(public, "GET", "/api/notes/" + nid))["size"] == 1
            # 縮小した付箋をクリックしても、編集画面が開くことを確認します。
            await marker.click(position={"x": 10, "y": 10})
            assert await page.locator("#note-size").input_value() == "1"
            await page.locator("#note-size").fill("85")
            await page.locator("#note-dialog [type=submit]").click()
            await page.locator("#note-dialog").wait_for(state="hidden")
            # 古い画面が本文だけを変更しても、未対応の文字設定を失わないことを確認します。
            snapshot = await req(staff, "GET", "/api/state")
            old = next(n for n in snapshot["state"]["notes"] if n["id"] == nid)
            for key in ["size", "color", "referenceZoom"]:
                del old[key]
            await req(staff, "PUT", "/api/state", snapshot)
            stored = await req(public, "GET", "/api/notes/" + nid)
            assert all(stored[k] == edited[k] for k in ["size", "color", "referenceZoom"])
            await page.reload()
            await page.wait_for_function("window.factoryMap")
            await page.evaluate(
                "n=>factoryMap.map.setView([n.point[1],n.point[0]],n.referenceZoom,{animate:false})",
                edited,
            )
            desktop = await measure()
            assert abs(desktop["width"] - 204 * 0.85) < 0.5
            # 画面幅や全体表示でズームが変わっても、図面と付箋の表示比率を保つことを確認します。
            mobile = await browser.new_page(viewport={"width": 390, "height": 844})
            await mobile.goto(URL)
            await mobile.wait_for_function("window.factoryMap")
            await mobile.wait_for_timeout(250)
            ratio = await mobile.evaluate(
                'id=>document.querySelector("[data-note-id=\\""+id+"\\"] .sticky-note-paper").getBoundingClientRect().width/document.querySelector(".leaflet-image-layer").getBoundingClientRect().width',
                nid,
            )
            assert abs(ratio - desktop["ratio"]) < 0.001, (ratio, desktop["ratio"])
            assert await mobile.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
            await mobile.close()
            # 縮小中の付箋を移動し、見た目を保ったまま正しい図面座標で保存されることを確認します。
            previous = stored["point"]
            box = await marker.bounding_box()
            await page.mouse.move(box["x"] + 20, box["y"] + 10)
            await page.mouse.down()
            await page.mouse.move(box["x"] + 90, box["y"] + 45, steps=12)
            await page.mouse.up()
            for _ in range(100):
                moved = await req(public, "GET", "/api/notes/" + nid)
                if moved["point"] != previous:
                    break
                await asyncio.sleep(0.05)
            assert (
                moved["point"] != previous and moved["size"] == 85 and moved["color"] == "#102345"
            )
            for _ in range(100):
                tools = await page.webmcp.tools()
                if len(tools) == 29:
                    break
                await asyncio.sleep(0.05)
            assert len(tools) == 29
            await page.webmcp.call_tool(
                "update_notes", {"id": nid, "record": {"color": "#ffd6df", "size": 120}}
            )
            assert (await req(public, "GET", "/api/notes/" + nid))["size"] == 120
            await page.locator("#view-mode").click()
            await page.wait_for_function("!factoryMap.editor")
            assert (
                await page.locator("#assets-tab").is_hidden()
                and await page.locator("#note-add").is_hidden()
            )
            await marker.click()
            assert await page.locator("#note-dialog textarea").count() == 0
            assert (
                await page.locator("#note-dialog .sticky-note-fulltext").evaluate(
                    "el=>getComputedStyle(el).backgroundColor"
                )
                == "rgb(255, 214, 223)"
            )
            await page.locator("#note-dialog .icon-close").click()
            assert not errors, errors
            await page.screenshot(path=str(ROOT / "preview-note-appearance.png"), full_page=True)
            print(
                "PASS: paper/drawing zoom ratio, animated zoom, anchor and hit area, 1–300% controls, palette/custom colors, readable dark colors, DB/reload/mobile geometry, drag, old-client compatibility, native WebMCP styling and viewer restrictions"
            )
        finally:
            if browser:
                await browser.close()
            state = (await req(staff, "GET", "/api/state"))["state"]
            for note in state["notes"]:
                if note["id"].startswith(PREFIX) or note["text"].startswith(PREFIX):
                    await req(staff, "DELETE", "/api/notes/" + note["id"])
            remaining = (await req(staff, "GET", "/api/state"))["state"]
            for key in ["notes", "assets", "works", "propertyDefinitions", "drawings"]:
                assert remaining[key] == baseline[key], key
            await req(staff, "POST", "/api/auth/logout")
            await staff.dispose()
            await public.dispose()


asyncio.run(main())
