"""Integration checks against the real Rust API and PostgreSQL; no mocked storage."""

import asyncio
import os
import uuid
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = os.environ.get("FACTORY_MAP_TEST_URL", "http://127.0.0.1:18017")
PREFIX = "qa-" + uuid.uuid4().hex[:8]


async def main():
    async with async_playwright() as p:
        client = await p.request.new_context(base_url=URL)

        async def req(method, path, body=None, expected=200, **kw):
            r = await client.fetch(
                path, method=method, **({"data": body} if body is not None else {}), **kw
            )
            assert r.status == expected, (method, path, r.status, (await r.text())[:240])
            return await r.json()

        public = await req("GET", "/api/state")
        assert public["state"]["assets"] == []
        await req("GET", "/api/assets", expected=401)
        await req("POST", "/api/assets", {}, 401)
        await req("POST", "/api/auth/login", {"password": "invalid-example"}, 401)
        await req(
            "POST",
            "/api/auth/login",
            {"password": (ROOT / ".runtime/initial-admin-password.txt").read_text()},
        )
        base = await req("GET", "/api/state")
        asset0 = next(a for a in base["state"]["assets"] if a["id"] == "a1")
        assert len(base["state"]["assets"]) >= 64
        await req(
            "PATCH",
            "/api/assets/a1",
            {"name": "blocked"},
            403,
            headers={"Origin": "https://untrusted.example"},
        )
        prop = PREFIX + "-number"
        sel = PREFIX + "-select"
        asset = PREFIX + "-asset"
        file_id = None
        try:
            await req(
                "POST",
                "/api/properties",
                {"id": prop, "name": PREFIX + "温度", "type": "number"},
                201,
            )
            await req(
                "POST",
                "/api/properties",
                {
                    "id": sel,
                    "name": PREFIX + "分類",
                    "type": "select",
                    "options": [{"id": "one", "label": "一号"}],
                },
                201,
            )
            a = {
                "id": asset,
                "name": PREFIX + "設備",
                "code": PREFIX,
                "drawingId": "site",
                "point": [100, 100],
                "properties": {prop: 2.5, sel: "one"},
                "history": [],
                "attachments": [],
            }
            await req("POST", "/api/assets", a, 201)
            await req("PATCH", "/api/assets/" + asset, {"properties": {prop: "wrong"}}, 422)
            await req("PATCH", "/api/assets/" + asset, {"properties": {sel: "missing"}}, 422)
            await req("PATCH", "/api/properties/" + prop, {"type": "date"}, 422)
            r = await req(
                "POST",
                "/api/files",
                expected=201,
                multipart={
                    "file": {
                        "name": "点検サンプル.pdf",
                        "mimeType": "application/pdf",
                        "buffer": (ROOT / "server/demo.pdf").read_bytes(),
                    }
                },
            )
            file = r["files"][0]
            file_id = file["fileId"]
            await req("PATCH", "/api/assets/" + asset, {"attachments": [file]})
            binary = await client.get("/api/files/" + file_id + "?inline=1")
            assert binary.headers["content-type"] == "application/pdf"
            assert (await binary.body()).startswith(b"%PDF-")
            # Another signed-in facility session sees the same records; visitors cannot.
            visitor = await p.request.new_context(base_url=URL)
            r = await visitor.get("/api/assets/" + asset)
            assert r.status == 401
            r = await visitor.get("/api/files/" + file_id)
            assert r.status == 404
            await visitor.post(
                "/api/auth/login",
                data={"password": (ROOT / ".runtime/initial-admin-password.txt").read_text()},
            )
            r = await visitor.get("/api/assets/" + asset)
            assert (await r.json())["attachments"][0]["fileId"] == file_id
            await visitor.dispose()
            h = await req(
                "POST",
                "/api/assets/" + asset + "/maintenance",
                {
                    "date": "2026-11-13",
                    "text": "点検確認",
                    "inspector": "QA",
                    "attachments": [file],
                },
            )
            hid = h["record"]["id"]
            await req(
                "PATCH", "/api/assets/" + asset + "/maintenance/" + hid, {"result": "attention"}
            )
            await req(
                "POST",
                "/api/assets/" + asset + "/maintenance",
                {"date": "2026-02-31", "text": "invalid"},
                422,
            )
            await req(
                "POST",
                "/api/batch",
                {
                    "operations": [
                        {
                            "kind": "assets",
                            "op": "update",
                            "id": asset,
                            "record": {"name": "SHOULD ROLLBACK"},
                        },
                        {"kind": "assets", "op": "update", "id": "missing", "record": {}},
                    ]
                },
                404,
            )
            assert (await req("GET", "/api/assets/" + asset))["name"] == a["name"]
            await req("PUT", "/api/state", base, 409)
            token = await req("POST", "/api/tokens", {"name": "QA viewer", "scope": "viewer"})
            tokenctx = await p.request.new_context(
                base_url=URL, extra_http_headers={"Authorization": "Bearer " + token["token"]}
            )
            r = await tokenctx.get("/api/assets/" + asset)
            assert r.status == 200
            r = await tokenctx.patch("/api/assets/" + asset, data={"name": "blocked"})
            assert r.status == 401
            await req("DELETE", "/api/tokens/" + token["id"])
            await tokenctx.dispose()
            await req("DELETE", "/api/properties/" + sel)
            assert sel not in (await req("GET", "/api/assets/" + asset))["properties"]
            await req("DELETE", "/api/assets/" + asset + "/maintenance/" + hid)
            for path in [
                "/.runtime/config.json",
                "/server/src/main.rs",
                "/README.md",
                "/vendor/../.runtime/config.json",
            ]:
                r = await client.get(path)
                assert r.status == 404, (path, r.status)
            docs = await req("GET", "/openapi.json")
            assert sum(len(v) for v in docs["paths"].values()) == 48
            print(
                "PASS: API auth, CSRF, typed properties, files, shared storage, inspections, atomic rollback, revision conflict, token scopes, private paths and OpenAPI"
            )
        finally:
            await req("DELETE", "/api/assets/" + asset)
            await req("DELETE", "/api/properties/" + prop)
            # The failed schema migration left the original values intact.
            assert (await req("GET", "/api/assets/a1")) == asset0
            await req("POST", "/api/auth/logout")
            await client.dispose()


asyncio.run(main())
