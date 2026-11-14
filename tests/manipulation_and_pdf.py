"""Real border/corner resizing, equipment dragging and rendered inspection PDFs."""

import os

import asyncio
import uuid
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = os.environ.get("FACTORY_MAP_TEST_URL", "http://127.0.0.1:18018")
PASSWORD = Path(os.environ["FACTORY_MAP_TEST_PASSWORD_FILE"]).read_text()
PREFIX = "manipulation-qa-" + uuid.uuid4().hex[:8]


def inspection_pdf():
    streams = []
    for text in ["INSPECTION CHECK SHEET", "MAINTENANCE MANUAL"]:
        streams.append(
            (
                "BT /F1 22 Tf 50 780 Td ("
                + text
                + ") Tj /F1 12 Tf 0 -40 Td (Fictional factory sample document) Tj ET\n0.6 w 50 650 480 80 re S 50 690 m 530 690 l S 200 650 m 200 730 l S\nBT /F1 12 Tf 60 710 Td (Equipment / Date / Result) Tj ET"
            ).encode()
        )
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    ]
    for content in [6, 7]:
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents {content} 0 R >>".encode()
        )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for stream in streams:
        objects.append(
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"
        )
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(data)
    data += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode() + b"".join(
        f"{x:010d} 00000 n \n".encode() for x in offsets[1:]
    )
    data += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(data)


async def main():
    async with async_playwright() as p:
        staff = await p.request.new_context(base_url=URL)
        public = await p.request.new_context(base_url=URL)

        async def req(client, method, path, data=None, expected=200, **kwargs):
            response = await client.fetch(
                path, method=method, **({"data": data} if data is not None else {}), **kwargs
            )
            assert response.status == expected, (
                method,
                path,
                response.status,
                (await response.text())[:120],
            )
            return await response.json()

        await req(staff, "POST", "/api/auth/login", {"password": PASSWORD})
        baseline = (await req(staff, "GET", "/api/state"))["state"]
        browser = None
        nid = PREFIX + "-note"
        aid = PREFIX + "-asset"
        try:
            await req(
                staff,
                "POST",
                "/api/notes",
                {
                    "id": nid,
                    "drawingId": "site",
                    "point": [1000, 500],
                    "text": PREFIX + "\n縦横のサイズを変更",
                    "size": 100,
                    "color": "#d9eeff",
                    "referenceZoom": -1.5,
                },
                201,
            )
            for fields in [
                {"width": 0},
                {"height": -1},
                {"width": "200"},
                {"height": None},
                {"width": 100001},
            ]:
                await req(staff, "PATCH", "/api/notes/" + nid, fields, 422)
            uploaded = await req(
                staff,
                "POST",
                "/api/files",
                expected=201,
                multipart={
                    "file": {
                        "name": "点検用紙とマニュアル.pdf",
                        "mimeType": "application/pdf",
                        "buffer": inspection_pdf(),
                    }
                },
            )
            file = uploaded["files"][0]
            await req(
                staff,
                "POST",
                "/api/assets",
                {
                    "id": aid,
                    "code": PREFIX,
                    "name": "ドラッグ確認用設備",
                    "drawingId": "site",
                    "point": [1250, 400],
                    "properties": {},
                    "attachments": [file],
                },
                201,
            )
            await req(
                staff,
                "POST",
                "/api/assets/" + aid + "/maintenance",
                {"date": "2026-11-12", "text": "点検用紙サンプル", "attachments": [file]},
            )
            await req(public, "GET", "/api/files/" + file["fileId"], expected=404)
            browser = await p.chromium.launch(
                executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"),
                args=["--enable-features=WebMCP"],
            )
            context = await browser.new_context(viewport={"width": 1500, "height": 1050})
            page = await context.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.goto(URL)
            await page.wait_for_function("window.factoryMap")
            assert await page.locator("[data-note-resize]").count() == 0
            # The public construction document also uses the actual canvas renderer.
            await page.locator("#detail-pane [data-preview]").first.click()
            await page.wait_for_function(
                'document.getElementById("file-preview").dataset.pdfReady==="true"'
            )
            assert await page.locator("#file-preview canvas").count() == 1
            await page.locator("#file-preview .icon-close").click()
            await page.locator("#view-mode").click()
            await page.locator("#login-dialog input").fill(PASSWORD)
            await page.locator("#login-dialog [type=submit]").click()
            await page.wait_for_function("factoryMap.editor")
            await page.evaluate("factoryMap.map.setView([500,1000],-1.5,{animate:false})")
            marker = page.locator('[data-note-id="' + nid + '"]')

            async def bounds():
                return await marker.locator(".sticky-note-paper").bounding_box()

            async def resized(edge, dx, dy, cancel=False):
                before = await bounds()
                old = await req(staff, "GET", "/api/notes/" + nid)
                handle = marker.locator('[data-note-resize="' + edge + '"]')
                await marker.hover()
                box = await handle.bounding_box()
                x = box["x"] + box["width"] / 2
                y = box["y"] + box["height"] / 2
                await page.mouse.move(x, y)
                await page.mouse.down()
                await page.mouse.move(x + dx, y + dy, steps=10)
                assert not await page.evaluate("factoryMap.map.dragging.enabled()")
                if cancel:
                    await page.keyboard.press("Escape")
                await page.mouse.up()
                if cancel:
                    await page.wait_for_timeout(100)
                    new = await req(staff, "GET", "/api/notes/" + nid)
                    assert new == old
                else:
                    for _ in range(100):
                        new = await req(staff, "GET", "/api/notes/" + nid)
                        if new.get("updatedAt") != old.get("updatedAt"):
                            break
                        await asyncio.sleep(0.05)
                    assert new.get("updatedAt") != old.get("updatedAt")
                assert await page.evaluate("factoryMap.map.dragging.enabled()")
                assert (
                    not await page.locator("#note-dialog").count()
                    or not await page.locator("#note-dialog").is_visible()
                )
                return before, await bounds(), old, new

            before, after, old, new = await resized("e", 90, 0)
            assert (
                abs(after["width"] - before["width"] - 90) < 2
                and abs(after["height"] - before["height"]) < 2
            )
            assert abs(after["x"] - before["x"]) < 1 and new["point"] == old["point"]
            before, after, _, _ = await resized("s", 0, 65)
            assert (
                abs(after["height"] - before["height"] - 65) < 2
                and abs(after["width"] - before["width"]) < 2
            )
            before, after, _, _ = await resized("nw", -45, -30)
            assert (
                abs(after["width"] - before["width"] - 45) < 2
                and abs(after["height"] - before["height"] - 30) < 2
            )
            assert abs((after["x"] + after["width"]) - (before["x"] + before["width"])) < 2
            assert abs((after["y"] + after["height"]) - (before["y"] + before["height"])) < 2
            await resized("se", 50, 40, cancel=True)
            # Width and height remain in proportion to the drawing on zoom, not to each other.
            note = await req(staff, "GET", "/api/notes/" + nid)
            before = await bounds()
            await page.evaluate(
                "factoryMap.map.setZoom(factoryMap.map.getZoom()+1,{animate:false})"
            )
            after = await bounds()
            assert (
                abs(after["width"] / before["width"] - 2) < 0.01
                and abs(after["height"] / before["height"] - 2) < 0.01
            )
            await page.evaluate(
                "factoryMap.map.setZoom(factoryMap.map.getZoom()-1,{animate:false})"
            )
            snapshot = await req(staff, "GET", "/api/state")
            old = next(n for n in snapshot["state"]["notes"] if n["id"] == nid)
            del old["width"]
            del old["height"]
            await req(staff, "PUT", "/api/state", snapshot)
            kept = await req(staff, "GET", "/api/notes/" + nid)
            assert kept["width"] == note["width"] and kept["height"] == note["height"]
            await page.reload()
            await page.wait_for_function("window.factoryMap")
            assert (
                await page.evaluate("id=>factoryMap.state.notes.find(n=>n.id===id).width", nid)
                == note["width"]
            )
            # Hide the deliberately enlarged note so it does not cover the equipment under test.
            await page.locator("#layers-toggle").click()
            await page.locator("#show-notes").uncheck()
            await page.locator("#layers-toggle").click()
            # An equipment's icon is now its direct manipulation control.
            await page.locator("#assets-tab").click()
            await page.evaluate("factoryMap.map.setView([400,1250],-1.5,{animate:false})")
            asset = page.locator('[data-asset-id="' + aid + '"]')
            box = await asset.bounding_box()
            old = await req(staff, "GET", "/api/assets/" + aid)
            await page.mouse.move(box["x"] + 10, box["y"] + 10)
            await page.mouse.down()
            await page.mouse.move(box["x"] + 95, box["y"] + 60, steps=12)
            await page.mouse.up()
            for _ in range(100):
                moved = await req(staff, "GET", "/api/assets/" + aid)
                if moved["point"] != old["point"]:
                    break
                await asyncio.sleep(0.05)
            assert (
                moved["point"] != old["point"]
                and moved["attachments"] == old["attachments"]
                and moved["history"] == old["history"]
            )
            await page.reload()
            await page.wait_for_function("window.factoryMap")
            assert (
                await page.evaluate("id=>factoryMap.state.assets.find(a=>a.id===id).point", aid)
                == moved["point"]
            )
            await page.evaluate('id=>factoryMap.openRecord("assets",id)', aid)
            # Both the equipment manual and the inspection's attachment render all pages.
            pdf_buttons = page.locator("#detail-pane [data-preview]")
            assert await pdf_buttons.count() == 2
            for index in [0, 1]:
                await pdf_buttons.nth(index).click()
                await page.wait_for_function(
                    'document.getElementById("file-preview").dataset.pdfReady==="true"'
                )
                assert await page.locator("#pdf-page-total").inner_text() == "/ 2", (
                    await page.locator("#pdf-page-total").inner_text()
                )
                dark = await page.locator("#file-preview canvas").evaluate(
                    'c=>{const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let count=0;for(let i=0;i<d.length;i+=4)if(d[i]<180&&d[i+1]<180&&d[i+2]<180&&d[i+3]>0)count++;return count;}'
                )
                assert dark > 100, dark
                await page.locator("#pdf-next").click()
                await page.wait_for_function(
                    'document.getElementById("pdf-page").value==="2" && document.getElementById("file-preview").dataset.pdfReady==="true"'
                )
                width = await page.locator("#file-preview canvas").evaluate(
                    "c=>c.getBoundingClientRect().width"
                )
                await page.locator("#pdf-zoom-in").click()
                await page.wait_for_function(
                    'document.getElementById("pdf-zoom-label").textContent==="125%" && document.getElementById("file-preview").dataset.pdfReady==="true"'
                )
                assert (
                    await page.locator("#file-preview canvas").evaluate(
                        "c=>c.getBoundingClientRect().width"
                    )
                    > width
                )
                await page.locator("#pdf-prev").click()
                await page.wait_for_function(
                    'document.getElementById("pdf-page").value==="1" && document.getElementById("file-preview").dataset.pdfReady==="true"'
                )
                await page.screenshot(path=str(ROOT / "preview-inspection-pdf.png"), full_page=True)
                await page.locator("#file-preview .icon-close").click()
            await page.locator("#view-mode").click()
            await page.wait_for_function("!factoryMap.editor")
            assert (
                await page.locator("[data-asset-id]").count() == 0
                and await page.locator("[data-note-resize]").count() == 0
            )
            await req(public, "PATCH", "/api/assets/" + aid, {"point": [1, 2]}, 401)
            await req(public, "PATCH", "/api/notes/" + nid, {"width": 400}, 401)
            assert not errors, errors
            print(
                "PASS: independent edge/corner resize, fixed opposite edge, Escape rollback, DB/reload/zoom and legacy compatibility; equipment drag and persistence; actual two-page manual + inspection PDF canvases, navigation and zoom; readonly restrictions"
            )
        finally:
            if browser:
                await browser.close()
            state = (await req(staff, "GET", "/api/state"))["state"]
            for key in ["notes", "assets"]:
                for record in state[key]:
                    if record["id"].startswith(PREFIX):
                        await req(staff, "DELETE", "/api/" + key + "/" + record["id"])
            remaining = (await req(staff, "GET", "/api/state"))["state"]
            for key in ["notes", "assets", "works", "propertyDefinitions", "drawings"]:
                assert remaining[key] == baseline[key], key
            await req(staff, "POST", "/api/auth/logout")
            await staff.dispose()
            await public.dispose()


asyncio.run(main())
