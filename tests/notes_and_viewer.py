"""付箋の保存・編集と、閲覧モードに工事のお知らせだけを返す境界を検証します。"""

import os

import asyncio
import uuid
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = os.environ.get("FACTORY_MAP_TEST_URL", "http://127.0.0.1:18018")
PREFIX = "note-qa-" + uuid.uuid4().hex[:8]
PASSWORD = (ROOT / ".runtime/initial-admin-password.txt").read_text()


async def main():
    async with async_playwright() as p:
        staff = await p.request.new_context(base_url=URL)
        visitor = await p.request.new_context(base_url=URL)

        async def req(client, method, path, data=None, expected=200, **kwargs):
            response = await client.fetch(
                path, method=method, **({"data": data} if data is not None else {}), **kwargs
            )
            assert response.status == expected, (
                method,
                path,
                response.status,
                (await response.text())[:150],
            )
            return await response.json()

        await req(staff, "POST", "/api/auth/login", {"password": PASSWORD})
        baseline = (await req(staff, "GET", "/api/state"))["state"]
        browser = None
        try:
            public = (await req(visitor, "GET", "/api/state"))["state"]
            assert public["assets"] == [] and public["propertyDefinitions"] == []
            assert all(not w.get("assetIds") for w in public["works"])
            for path in [
                "/api/assets",
                "/api/assets/a1",
                "/api/properties",
                "/api/properties/model",
                "/api/assets/a1/maintenance",
            ]:
                await req(visitor, "GET", path, expected=401)
            stats = await req(visitor, "GET", "/api/stats")
            assert not {"assets", "properties", "inspections"} & stats.keys()
            results = await req(visitor, "GET", "/api/search?limit=1000")
            assert all(i["kind"] != "assets" for i in results["items"])
            drawing = PREFIX + "-drawing"
            await req(
                staff,
                "POST",
                "/api/drawings",
                {
                    "id": drawing,
                    "type": "sample",
                    "name": "非公開設備図面",
                    "asset": "assets/floor-plan.svg",
                    "bounds": [[0, 0], [480, 800]],
                },
                201,
            )
            await req(visitor, "GET", "/api/drawings/" + drawing, expected=404)
            upload = await req(
                staff,
                "POST",
                "/api/files",
                expected=201,
                multipart={
                    "file": {
                        "name": "設備専用.pdf",
                        "mimeType": "application/pdf",
                        "buffer": (ROOT / "shared/demo/demo.pdf").read_bytes(),
                    }
                },
            )
            attachment = upload["files"][0]
            await req(
                staff,
                "POST",
                "/api/assets",
                {
                    "id": PREFIX + "-asset",
                    "name": "設備専用情報",
                    "code": PREFIX,
                    "drawingId": drawing,
                    "point": [100, 100],
                    "properties": {},
                    "attachments": [attachment],
                },
                201,
            )
            await req(visitor, "GET", "/api/files/" + attachment["fileId"], expected=404)
            binary = await staff.get("/api/files/" + attachment["fileId"])
            assert binary.status == 200
            note = {
                "id": PREFIX + "-api",
                "drawingId": "site",
                "point": [110, 150],
                "text": "API付箋\n複数行のお知らせ",
            }
            await req(visitor, "POST", "/api/notes", note, 401)
            for patch in [
                {"text": " "},
                {"text": "a" * 2001},
                {"text": 32},
                {"point": [1]},
                {"point": ["x", 20]},
                {"drawingId": "missing"},
            ]:
                await req(staff, "POST", "/api/notes", {**note, **patch}, 422)
            await req(staff, "POST", "/api/notes", note, 201)
            await req(staff, "PATCH", "/api/notes/" + note["id"], {"point": [130, 160]})
            assert (await req(visitor, "GET", "/api/notes/" + note["id"]))["point"] == [130, 160]
            # 付箋項目を持たない旧クライアントの保存でも、新しい付箋を消さないことを確認します。
            old = await req(staff, "GET", "/api/state")
            del old["state"]["notes"]
            await req(staff, "PUT", "/api/state", old)
            assert (await req(visitor, "GET", "/api/notes/" + note["id"]))["text"] == note["text"]
            await req(staff, "PUT", "/api/state", old, 409)
            revision = (await req(staff, "GET", "/api/state"))["revision"]
            await req(staff, "PUT", "/api/state", {"revision": revision, "state": None}, 422)
            await req(visitor, "GET", "/api/health")
            # 付箋が参照している図面は、そのまま削除できないことを確認します。
            await req(
                staff,
                "POST",
                "/api/notes",
                {
                    "id": PREFIX + "-drawing-note",
                    "drawingId": drawing,
                    "point": [20, 20],
                    "text": "図面ごとのお知らせ",
                },
                201,
            )
            await req(staff, "DELETE", "/api/drawings/" + drawing, expected=409)
            await req(staff, "DELETE", "/api/notes/" + PREFIX + "-drawing-note")

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
            assert (
                await page.locator("#assets-tab").is_hidden()
                and await page.locator("#note-add").is_hidden()
            )
            assert await page.locator(".asset-marker").count() == 0
            await page.locator("#view-mode").click()
            await page.locator("#login-dialog input").fill(PASSWORD)
            await page.locator("#login-dialog [type=submit]").click()
            await page.wait_for_function("factoryMap.editor")
            assert await page.locator("#assets-tab").is_visible()
            # 配置する項目の種類を変えたら、前の配置操作が取り消されることを確認します。
            await page.locator("#asset-add").click()
            await page.locator("#note-add").click()
            await page.locator("#map").click(position={"x": 350, "y": 320})
            assert await page.locator("#asset-dialog").count() == 0
            text = PREFIX + "\n資材置き場はこちらです。"
            await page.locator("#note-dialog textarea").fill(text)
            await page.locator("#note-dialog [type=submit]").click()
            await page.wait_for_function("t=>factoryMap.state.notes.some(n=>n.text===t)", arg=text)
            nid = await page.evaluate("t=>factoryMap.state.notes.find(n=>n.text===t).id", text)
            marker = page.locator('[data-note-id="' + nid + '"]')
            assert await marker.locator(".sticky-note-text").inner_text() == text
            original = (await req(visitor, "GET", "/api/notes/" + nid))["point"]
            box = await marker.bounding_box()
            await page.mouse.move(box["x"] + 22, box["y"] + 10)
            await page.mouse.down()
            await page.mouse.move(box["x"] + 105, box["y"] + 65, steps=12)
            await page.mouse.up()
            await page.wait_for_function(
                "a=>JSON.stringify(factoryMap.state.notes.find(n=>n.id===a.id).point)!==JSON.stringify(a.point)",
                arg={"id": nid, "point": original},
            )
            await page.wait_for_timeout(200)
            moved = (await req(visitor, "GET", "/api/notes/" + nid))["point"]
            assert moved != original
            # 入力したマークアップをHTMLとして実行せず、改行を含めて文字列として表示します。
            await marker.click()
            dangerous = text + '\n<img src=x onerror="window.noteXSS=1">'
            await page.locator("#note-dialog textarea").fill(dangerous)
            await page.locator("#note-dialog [type=submit]").click()
            await page.wait_for_function(
                "t=>factoryMap.state.notes.some(n=>n.text===t)", arg=dangerous
            )
            assert await marker.locator("img").count() == 0
            assert not await page.evaluate("window.noteXSS === 1")
            await page.reload()
            await page.wait_for_function("window.factoryMap")
            assert (
                await page.evaluate("id=>factoryMap.state.notes.find(n=>n.id===id).point", nid)
            ) == moved
            # 付箋の操作が、ネイティブWebMCPの登録ツールとして利用できることを確認します。
            for _ in range(100):
                tools = await page.webmcp.tools()
                if len(tools) == 29:
                    break
                await asyncio.sleep(0.05)
            assert len(tools) == 29
            await page.webmcp.call_tool("update_notes", {"id": nid, "record": {"text": text}})
            assert (await page.webmcp.call_tool("get_notes", {"id": nid}))["text"] == text
            await page.locator("#layers-toggle").click()
            await page.locator("#show-notes").uncheck()
            assert await page.locator("[data-note-id]").count() == 0
            await page.locator("#show-notes").check()
            await page.locator("#layers-toggle").click()
            await page.locator("#drawing-select").select_option("floor-a1")
            assert await page.locator('[data-note-id="' + nid + '"]').count() == 0
            await page.locator("#drawing-select").select_option("site")
            assert await marker.is_visible()
            await page.locator("#assets-tab").click()
            assert await page.locator(".asset-marker").count() > 0
            await page.locator("#view-mode").click()
            await page.wait_for_function("!factoryMap.editor && factoryMap.state.assets.length===0")
            assert (
                await page.locator("#assets-tab").is_hidden()
                and await page.locator(".asset-marker").count() == 0
            )
            assert await page.locator("#note-add").is_hidden()
            assert await page.locator("#works-tab").get_attribute("aria-selected") == "true"
            assert await marker.is_visible()
            await marker.click()
            assert await page.locator("#note-dialog textarea").count() == 0
            assert await page.locator("#note-dialog .sticky-note-fulltext").inner_text() == text
            await page.locator("#note-dialog .icon-close").click()
            try:
                await page.webmcp.call_tool("get_assets", {"id": "a1"})
                raise AssertionError("facility read was allowed")
            except Exception as e:
                assert not isinstance(e, AssertionError)
            try:
                await page.webmcp.call_tool(
                    "update_notes", {"id": nid, "record": {"text": "must not change"}}
                )
                raise AssertionError("note write was allowed")
            except Exception as e:
                assert not isinstance(e, AssertionError)
            assert (await req(visitor, "GET", "/api/notes/" + nid))["text"] == text
            await page.screenshot(path=str(ROOT / "preview-notes.png"), full_page=True)
            # 実際に開いた付箋の編集画面から削除し、表示と保存の両方を確認します。
            await page.locator("#view-mode").click()
            await page.locator("#login-dialog input").fill(PASSWORD)
            await page.locator("#login-dialog [type=submit]").click()
            await page.wait_for_function("factoryMap.editor")
            await marker.click()
            page.once("dialog", lambda d: asyncio.create_task(d.accept()))
            await page.locator("#note-dialog .note-delete").click()
            await page.wait_for_function("id=>!factoryMap.state.notes.some(n=>n.id===id)", arg=nid)
            await page.locator("#note-dialog").wait_for(state="hidden")
            await req(visitor, "GET", "/api/notes/" + nid, expected=404)
            assert not errors, errors
            print(
                "PASS: note create/edit/drag/delete, multiline and XSS, DB persistence, drawing/layer scope, native WebMCP, snapshot compatibility, viewer-only notices, private API/search/stats/drawings/files and logout from facility view"
            )
        finally:
            if browser:
                await browser.close()
            state = (await req(staff, "GET", "/api/state"))["state"]
            for note in state["notes"]:
                if note["id"].startswith(PREFIX) or note["text"].startswith(PREFIX):
                    await req(staff, "DELETE", "/api/notes/" + note["id"])
            for asset in state["assets"]:
                if asset["id"].startswith(PREFIX):
                    await req(staff, "DELETE", "/api/assets/" + asset["id"])
            for drawing in state["drawings"]:
                if drawing["id"].startswith(PREFIX):
                    await req(staff, "DELETE", "/api/drawings/" + drawing["id"])
            remaining = (await req(staff, "GET", "/api/state"))["state"]
            for key in ["works", "assets", "propertyDefinitions", "drawings", "notes"]:
                assert remaining[key] == baseline[key], key
            await req(staff, "POST", "/api/auth/logout")
            await staff.dispose()
            await visitor.dispose()


asyncio.run(main())
