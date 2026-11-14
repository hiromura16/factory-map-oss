"""Real browser flows and native WebMCP calls, including authorization failures."""

import os

import asyncio
import uuid
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = os.environ.get("FACTORY_MAP_TEST_URL", "http://127.0.0.1:18017")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE"),
            args=["--enable-features=WebMCP"],
        )
        context = await browser.new_context(viewport={"width": 1500, "height": 1050})
        page = await context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(URL)
        await page.wait_for_function(
            "async()=>window.factoryMap && (await document.modelContext.getTools()).length===29"
        )
        assert await page.locator("#work-add").is_hidden()
        stats = await page.webmcp.call_tool("get_site_stats", {})
        assert "assets" not in stats, stats
        try:
            await page.webmcp.call_tool("get_assets", {"id": 32})
            raise AssertionError("invalid input accepted")
        except Exception as e:
            assert not isinstance(e, AssertionError)
        try:
            await page.webmcp.call_tool(
                "update_assets", {"id": "a1", "record": {"name": "MUST NOT SAVE"}}
            )
            raise AssertionError("unauthorized write accepted")
        except Exception as e:
            assert not isinstance(e, AssertionError)
        try:
            await page.webmcp.call_tool("get_assets", {"id": "a1"})
            raise AssertionError("unauthorized read accepted")
        except Exception as e:
            assert not isinstance(e, AssertionError)
        await page.locator("#view-mode").click()
        await page.locator("#login-dialog input").fill(
            (ROOT / ".runtime/initial-admin-password.txt").read_text()
        )
        await page.locator("#login-dialog [type=submit]").click()
        await page.wait_for_function("window.factoryMap.editor")
        prefix = "ui-" + uuid.uuid4().hex[:8]
        pid = None
        aid = None
        try:
            # Create a field using the same visible controls used by facility staff.
            await page.locator("#properties-open").click()
            await page.locator("#property-add").click()
            await page.locator("#property-dialog [name=name]").fill(prefix + "温度")
            await page.locator("#property-dialog [name=type]").select_option("number")
            await page.locator("#property-dialog [name=unit]").fill("℃")
            await page.locator("#property-dialog [type=submit]").click()
            await page.wait_for_function(
                "p=>window.factoryMap.state.propertyDefinitions.some(d=>d.name===p+'温度')",
                arg=prefix,
            )
            pid = await page.evaluate(
                "p=>window.factoryMap.state.propertyDefinitions.find(d=>d.name===p+'温度').id",
                prefix,
            )
            # Add an equipment marker by clicking the map, fill a typed custom value, attach PDF.
            await page.locator("#asset-add").click()
            await page.locator("#map").click(position={"x": 300, "y": 300})
            await page.locator("#asset-dialog [name=name]").fill(prefix + "テスト設備")
            await page.locator("#asset-dialog [name=code]").fill(prefix)
            await page.locator('#asset-dialog [name="prop-' + pid + '"]').fill("23.5")
            await page.locator("#asset-files input[type=file]").set_input_files(
                str(ROOT / "server/demo.pdf")
            )
            await page.locator("#asset-dialog [type=submit]").click()
            await page.wait_for_function(
                "p=>window.factoryMap.state.assets.some(a=>a.code===p)", arg=prefix
            )
            aid = await page.evaluate(
                "p=>window.factoryMap.state.assets.find(a=>a.code===p).id", prefix
            )
            await page.locator("#asset-history-add").click()
            await page.locator("#inspection-dialog [name=text]").fill("画面からの点検登録")
            await page.locator("#inspection-dialog [name=inspector]").fill("施設担当QA")
            await page.locator("#inspection-dialog [type=submit]").click()
            await page.wait_for_function(
                "id=>window.factoryMap.state.assets.find(a=>a.id===id).history.length===1", arg=aid
            )
            # A real WebMCP write must commit and update both visible and server state.
            await page.webmcp.call_tool(
                "update_assets", {"id": aid, "record": {"location": "WebMCPによる更新"}}
            )
            assert (await page.webmcp.call_tool("get_assets", {"id": aid}))[
                "location"
            ] == "WebMCPによる更新"
            assert (
                await page.locator("#detail-pane")
                .get_by_text("WebMCPによる更新", exact=True)
                .count()
                == 1
            )
            await page.reload()
            await page.wait_for_function("window.factoryMap")
            await page.evaluate('id=>window.factoryMap.openRecord("assets",id)', aid)
            assert (
                await page.locator("#detail-pane")
                .get_by_text("画面からの点検登録", exact=True)
                .count()
                == 1
            )
            await page.screenshot(path=str(ROOT / "preview-equipment.png"), full_page=True)
            await page.locator("#asset-edit").click()
            await page.locator("#asset-dialog .icon-close").click()
            # Existing work: multiple attachments, link equipment, reopen and remove one.
            await page.evaluate('window.factoryMap.openRecord("works","w1")')
            await page.locator("#work-edit").click()
            await page.locator("#field-attachment").set_input_files(
                [str(ROOT / "server/demo.pdf"), str(ROOT / "samples/factory-layout.dxf")]
            )
            await page.locator("#work-form [type=submit]").click()
            await page.wait_for_function(
                'window.factoryMap.state.works.find(w=>w.id==="w1").attachments.length===3'
            )
            await page.locator("#detail-pane [data-preview]").first.click()
            await page.wait_for_function(
                'document.getElementById("file-preview").dataset.pdfReady==="true"'
            )
            assert await page.locator("#file-preview canvas").is_visible()
            await page.locator("#file-preview .icon-close").click()
            await page.locator("#work-edit").click()
            await page.locator('[data-remove-work-file="2"]').click()
            await page.locator("#work-form [type=submit]").click()
            await page.wait_for_function(
                'window.factoryMap.state.works.find(w=>w.id==="w1").attachments.length===2'
            )
            # Revert only test changes to seeded sample work.
            await page.evaluate(
                "async()=>{await FactoryAPI.request('/api/works/w1',{method:'PATCH',body:{attachments:window.factoryMap.state.works.find(w=>w.id==='w1').attachments.slice(0,1)}});await factoryMap.refresh();}"
            )
            await page.locator("#import-open").click()
            await page.locator("#sample-import").click()
            await page.wait_for_function(
                'window.factoryMap.currentDrawing!=="site" && window.factoryMap.state.drawings.find(d=>d.id===window.factoryMap.currentDrawing)?.type==="dxf"'
            )
            did = await page.evaluate("window.factoryMap.currentDrawing")
            await page.evaluate(
                "async id=>{await FactoryAPI.request('/api/drawings/'+id,{method:'DELETE'});await factoryMap.refresh();}",
                did,
            )
            docs = await context.new_page()
            await docs.goto(URL + "/api-docs")
            await docs.wait_for_selector(".swagger-ui .opblock")
            assert await docs.locator(".opblock").count() == 48
            await docs.close()
            await page.locator("#view-mode").click()
            await page.wait_for_function("!window.factoryMap.editor")
            assert await page.locator("#work-add").is_hidden()
            mobile = await browser.new_page(viewport={"width": 390, "height": 844})
            await mobile.goto(URL)
            await mobile.wait_for_function("window.factoryMap")
            assert await mobile.evaluate("document.documentElement.scrollWidth<=innerWidth+1")
            await mobile.screenshot(path=str(ROOT / "preview-mobile.png"), full_page=True)
            await mobile.close()
            assert not errors, errors
            print(
                "PASS: typed property UI, equipment marker, inspection, multiple files + removal + PDF preview, persistence across reload, DXF import, Swagger 48 operations, mobile and 29 native WebMCP tools (read, authenticated write, invalid input and unauthorized failure)"
            )
        finally:
            await context.request.post(
                URL + "/api/auth/login",
                data={"password": (ROOT / ".runtime/initial-admin-password.txt").read_text()},
            )
            if aid:
                await context.request.delete(URL + "/api/assets/" + aid)
            if pid:
                await context.request.delete(URL + "/api/properties/" + pid)
            await context.request.post(URL + "/api/auth/logout")
            await browser.close()


asyncio.run(main())
