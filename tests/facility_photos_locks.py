"""Real database/API and browser checks for icons, photos, locks, type and work geometry."""

import os

import asyncio
import copy
import struct
import uuid
import zlib
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = os.environ.get("FACTORY_MAP_TEST_URL", "http://127.0.0.1:18018")
PASSWORD = Path(os.environ["FACTORY_MAP_TEST_PASSWORD_FILE"]).read_text()
PREFIX = "facility-qa-" + uuid.uuid4().hex[:8]


def png(red, green, blue):
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 640, 480, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress((b"\x00" + bytes([red, green, blue]) * 640) * 480))
        + chunk(b"IEND", b"")
    )


def normalized(state):
    result = copy.deepcopy(state)
    for asset in result["assets"]:
        if not any(asset.get("locks", {}).values()):
            asset.pop("locks", None)
    return result


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
                (await response.text())[:200],
            )
            return await response.json()

        await req(staff, "POST", "/api/auth/login", {"password": PASSWORD})
        baseline = (await req(staff, "GET", "/api/state"))["state"]
        browser = None
        aid = PREFIX + "-api"
        wid = PREFIX + "-work"

        async def upload(name, data):
            return (
                await req(
                    staff,
                    "POST",
                    "/api/files",
                    expected=201,
                    multipart={"file": {"name": name, "mimeType": "image/png", "buffer": data}},
                )
            )["files"][0]

        try:
            photo = await upload("設備の写真.png", png(70, 130, 180))
            workphoto = await upload("工事の写真.png", png(180, 130, 70))
            await req(
                staff,
                "POST",
                "/api/assets",
                {
                    "id": aid,
                    "name": "APIロック確認",
                    "code": aid,
                    "drawingId": "site",
                    "point": [1750, 500],
                    "properties": {"model": "QA"},
                    "icon": "pump",
                    "attachments": [photo],
                    "coverPhotoId": photo["fileId"],
                },
                201,
            )
            assert (await public.get("/api/files/" + photo["fileId"] + "/thumbnail")).status == 404
            image = await staff.get("/api/files/" + photo["fileId"] + "/thumbnail")
            assert image.status == 200 and image.headers["content-type"] == "image/png"
            body = await image.body()
            assert struct.unpack(">II", body[16:24]) == (320, 240)
            assert (
                body
                == await (await staff.get("/api/files/" + photo["fileId"] + "/thumbnail")).body()
            )
            for change in [
                {"icon": "<script>"},
                {"locks": {"position": "yes"}},
                {"locks": {"anything": True}},
                {"coverPhotoId": "missing"},
            ]:
                await req(staff, "PATCH", "/api/assets/" + aid, change, 422)
            await req(
                staff,
                "PATCH",
                "/api/assets/" + aid,
                {"locks": {"position": True, "attributes": True}},
            )
            for change in [
                {"point": [1, 2]},
                {"name": "changed"},
                {"properties": {"model": "changed"}},
                {"attachments": []},
                {"icon": "fan"},
                {"locks": {"position": False, "attributes": False}, "point": [1, 2]},
            ]:
                await req(staff, "PATCH", "/api/assets/" + aid, change, 423)
            await req(staff, "DELETE", "/api/assets/" + aid, expected=423)
            snap = await req(staff, "GET", "/api/state")
            next(a for a in snap["state"]["assets"] if a["id"] == aid)["point"] = [5, 6]
            await req(staff, "PUT", "/api/state", snap, 423)
            await req(
                staff,
                "POST",
                "/api/batch",
                {
                    "operations": [
                        {
                            "kind": "assets",
                            "op": "update",
                            "id": aid,
                            "record": {"locks": {"position": False, "attributes": False}},
                        },
                        {"kind": "assets", "op": "update", "id": aid, "record": {"point": [5, 6]}},
                    ]
                },
                423,
            )
            await req(staff, "DELETE", "/api/properties/model", expected=423)
            await req(
                staff,
                "POST",
                "/api/assets/" + aid + "/maintenance",
                {"date": "2026-11-13", "text": "ロック中の点検記録"},
            )
            await req(
                staff,
                "PATCH",
                "/api/assets/" + aid,
                {"locks": {"position": False, "attributes": True}},
            )
            await req(staff, "PATCH", "/api/assets/" + aid, {"point": [1750, 510]})
            await req(staff, "PATCH", "/api/assets/" + aid, {"name": "forbidden"}, 423)
            await req(
                staff,
                "PATCH",
                "/api/assets/" + aid,
                {"locks": {"position": False, "attributes": False}},
            )
            work = {
                "id": wid,
                "code": wid,
                "drawingId": "site",
                "title": "写真つき工事",
                "location": "QAエリア",
                "start": "2026-11-13",
                "end": "2026-11-14",
                "status": "active",
                "points": [[80, 800], [300, 800], [300, 980], [80, 980]],
                "impacts": [],
                "notes": "工事の写真を表示",
                "contact": "施設",
                "phone": "",
                "updatedAt": "2026-11-13T00:00:00Z",
                "attachments": [workphoto],
                "coverPhotoId": workphoto["fileId"],
                "assetIds": [],
            }
            await req(staff, "POST", "/api/works", work, 201)
            assert (
                await public.get("/api/files/" + workphoto["fileId"] + "/thumbnail")
            ).status == 200
            browser = await p.chromium.launch(
                executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"),
                args=["--enable-features=WebMCP"],
            )
            context = await browser.new_context(viewport={"width": 1600, "height": 1100})
            page = await context.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.goto(URL)
            await page.wait_for_function("window.factoryMap")
            await page.evaluate('id=>factoryMap.openRecord("works",id)', wid)
            await page.wait_for_timeout(350)

            async def mapmove(point):
                position = await page.evaluate(
                    'p=>{const v=factoryMap.map.latLngToContainerPoint([p[1],p[0]]),b=document.getElementById("map").getBoundingClientRect();return {x:b.left+v.x,y:b.top+v.y}}',
                    point,
                )
                await page.mouse.move(position["x"], position["y"])

            await mapmove([190, 890])
            hover = page.locator(
                '.has-photo-preview img[data-photo-file-id="' + workphoto["fileId"] + '"]'
            )
            await hover.wait_for(state="visible")
            await page.wait_for_function(
                "id=>[...document.images].some(img=>img.dataset.photoFileId===id&&img.naturalWidth>0)",
                arg=workphoto["fileId"],
            )
            assert await page.locator("#assets-tab").is_hidden()
            await page.locator("#view-mode").click()
            await page.locator("#login-dialog input").fill(PASSWORD)
            await page.locator("#login-dialog [type=submit]").click()
            await page.wait_for_function("factoryMap.editor")
            # Place a new equipment item and choose its symbol and representative photo.
            await page.evaluate("factoryMap.map.setView([1030,1930],0,{animate:false})")
            await page.locator("#asset-add").click()
            pos = await page.evaluate(
                '()=>{const b=document.getElementById("map").getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}}'
            )
            await page.mouse.click(pos["x"], pos["y"])
            await page.locator("#asset-dialog [name=name]").fill(PREFIX + "設備")
            await page.locator("#asset-dialog [name=code]").fill(PREFIX)
            await page.locator("#asset-dialog [data-equipment-icon-open]").click()
            await page.locator('#equipment-icons-dialog [data-icon-choice="fan"]').click()
            await page.locator("#asset-photos .photo-input").set_input_files(
                [
                    {"name": "現況1.png", "mimeType": "image/png", "buffer": png(120, 180, 80)},
                    {"name": "現況2.png", "mimeType": "image/png", "buffer": png(180, 80, 120)},
                ]
            )
            await page.locator('#asset-photos [data-cover="1"]').click()
            await page.locator("#asset-dialog [type=submit]").click()
            await page.locator("#asset-dialog").wait_for(state="hidden")
            asset = await page.evaluate("p=>factoryMap.state.assets.find(a=>a.code===p)", PREFIX)
            uid = asset["id"]
            assert (
                asset["icon"] == "fan"
                and len(asset["attachments"]) == 2
                and asset["coverPhotoId"] == asset["attachments"][1]["fileId"]
            )
            assert await page.locator('[data-asset-id="' + uid + '"] .symbol-fan').count() == 1
            await page.locator("#assets-tab").click()
            await page.locator('[data-asset-id="' + uid + '"]').hover()
            await page.wait_for_selector(".equipment-photo-tooltip img")
            assert (
                await page.locator(".equipment-photo-tooltip img").first.get_attribute(
                    "data-photo-file-id"
                )
                == asset["coverPhotoId"]
            )
            await page.locator('[data-asset-id="' + uid + '"]').click()
            await page.locator('[data-equipment-lock="position"]').check()
            await page.wait_for_function(
                "id=>factoryMap.state.assets.find(a=>a.id===id).locks?.position", arg=uid
            )
            assert "leaflet-marker-draggable" not in (
                await page.locator('[data-asset-id="' + uid + '"]').get_attribute("class")
            )
            await page.locator("#asset-edit").click()
            assert await page.locator("#asset-dialog [name=x]").is_disabled()
            await page.locator("#asset-dialog .icon-close").click()
            await page.locator('[data-equipment-lock="attributes"]').check()
            await page.wait_for_function(
                "id=>factoryMap.state.assets.find(a=>a.id===id).locks?.attributes", arg=uid
            )
            assert await page.locator("#asset-edit").is_disabled()
            await page.locator("#equipment-lock-all").click()
            await page.wait_for_function(
                "factoryMap.state.assets.every(a=>a.locks?.position&&a.locks?.attributes)"
            )
            await page.locator("#equipment-lock-all").click()
            await page.wait_for_function(
                "factoryMap.state.assets.every(a=>!a.locks?.position&&!a.locks?.attributes)"
            )
            # Font appearance is independent of the paper's percentage and aspect ratio.
            await page.locator("#note-add").click()
            await page.mouse.click(pos["x"] - 100, pos["y"] + 80)
            await page.locator("#note-dialog textarea").fill(PREFIX + "文字")
            await page.locator("#note-font-family").select_option("serif")
            await page.locator("#note-font-size").fill("26")
            await page.locator("#note-font-color").evaluate(
                "el=>{el.value='#aa1234';el.dispatchEvent(new Event('input',{bubbles:true}));}"
            )
            await page.locator("#note-dialog [type=submit]").click()
            await page.locator("#note-dialog").wait_for(state="hidden")
            note = await page.evaluate(
                'p=>factoryMap.state.notes.find(n=>n.text===p+"文字")', PREFIX
            )
            assert (
                note["fontFamily"] == "serif"
                and note["fontSize"] == 26
                and note["fontColor"] == "#aa1234"
            )
            paper = page.locator('[data-note-id="' + note["id"] + '"] .sticky-note-paper')
            assert await paper.evaluate("el=>getComputedStyle(el).fontSize") == "26px"
            assert await paper.evaluate("el=>getComputedStyle(el).color") == "rgb(170, 18, 52)"
            # Construction information and geometry can be edited at the same time.
            await page.evaluate('id=>factoryMap.openRecord("works",id)', wid)
            await page.wait_for_timeout(350)
            await page.locator("#work-edit").click()
            assert await page.locator("#work-dialog").evaluate('el=>!el.matches(":modal")')
            await page.locator("#field-title").fill("範囲も変更した工事")

            async def drag_vertex(dx, dy):
                position = await page.evaluate(
                    """()=>{const layer=[...Object.values(factoryMap.map._layers)].find(l=>l.pm?.enabled?.()&&l.getLatLngs);const p=layer.getLatLngs()[0][0],v=factoryMap.map.latLngToContainerPoint(p),b=document.getElementById('map').getBoundingClientRect();return {x:b.left+v.x,y:b.top+v.y}}"""
                )
                await page.mouse.move(position["x"], position["y"])
                await page.mouse.down()
                await page.mouse.move(position["x"] + dx, position["y"] + dy, steps=10)
                await page.mouse.up()

            before = await req(staff, "GET", "/api/works/" + wid)
            await drag_vertex(-45, 20)
            assert (await req(staff, "GET", "/api/works/" + wid))["points"] == before["points"]
            await page.locator("#work-form [type=submit]").click()
            await page.locator("#work-dialog").wait_for(state="hidden")
            changed = await req(staff, "GET", "/api/works/" + wid)
            assert (
                changed["title"] == "範囲も変更した工事" and changed["points"] != before["points"]
            )
            await page.locator("#work-edit").click()
            await drag_vertex(25, -25)
            await page.locator('#work-dialog [data-close="work-dialog"]').first.click()
            assert (await req(staff, "GET", "/api/works/" + wid))["points"] == changed["points"]
            assert await page.locator(".work-edit-panel[open]").count() == 0
            await page.reload()
            await page.wait_for_function("window.factoryMap")
            assert (
                await page.evaluate("id=>factoryMap.state.assets.find(a=>a.id===id).icon", uid)
                == "fan"
            )
            assert (
                await page.evaluate(
                    "id=>factoryMap.state.notes.find(n=>n.id===id).fontSize", note["id"]
                )
                == 26
            )
            await page.screenshot(path=str(ROOT / "preview-facility-photos.png"), full_page=True)
            assert not errors, errors
            print(
                "PASS: chosen SVG icon, photo uploads/cover/gallery/hover, cached private/public thumbnails; independent locks across CRUD/state/batch/schema and inspection exception; bulk lock UI; note fonts; simultaneous work information/vertex edit with save/cancel and reload"
            )
        finally:
            if browser:
                await browser.close()
            state = (await req(staff, "GET", "/api/state"))["state"]
            # Clear test/bulk locks before removing fixtures; do not alter any other record content.
            for asset in state["assets"]:
                if any(asset.get("locks", {}).values()):
                    await req(
                        staff,
                        "PATCH",
                        "/api/assets/" + asset["id"],
                        {"locks": {"position": False, "attributes": False}},
                    )
            for key in ["works", "assets", "notes"]:
                for record in state[key]:
                    if (
                        record["id"].startswith(PREFIX)
                        or str(record.get("name", "")).startswith(PREFIX)
                        or str(record.get("text", "")).startswith(PREFIX)
                    ):
                        await req(staff, "DELETE", "/api/" + key + "/" + record["id"])
            remaining = (await req(staff, "GET", "/api/state"))["state"]
            assert normalized(remaining) == normalized(baseline)
            await req(staff, "POST", "/api/auth/logout")
            await staff.dispose()
            await public.dispose()


if __name__ == "__main__":
    asyncio.run(main())
