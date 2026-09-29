"""Blueprint preview smoke (Playwright, Python): node terminal opens on four clicks, Esc closes it.

Run:  VITE_SILENT_PREVIEW=1 npx vite --port 5198 &   then   python3 scripts/smoke-blueprint.py
Needs: pip install playwright && playwright install chromium
"""
import asyncio, sys
from playwright.async_api import async_playwright

BASE = "http://localhost:5198/"

async def main() -> int:
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1500, "height": 900})
        errors: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(BASE, wait_until="networkidle")
        await pg.get_by_text("Yeni blueprint", exact=True).first.click()
        await pg.wait_for_timeout(400)
        await pg.get_by_role("button", name="Yeni blueprint").first.click()
        await pg.wait_for_timeout(600)
        pane = pg.locator(".react-flow__pane").first
        box = await pane.bounding_box()
        await pg.mouse.click(box["x"] + 300, box["y"] + 200, button="right")
        await pg.get_by_text("Özel AI", exact=False).first.click()
        await pg.wait_for_timeout(500)
        node = pg.locator(".react-flow__node").first
        nb = await node.bounding_box()
        for _ in range(4):  # four quick clicks on the node header (Silent counts them itself)
            await pg.mouse.click(nb["x"] + 40, nb["y"] + 10)
            await pg.wait_for_timeout(80)
        await pg.wait_for_timeout(500)
        sheet = pg.get_by_role("dialog")
        opened = await sheet.count() > 0 and await sheet.first.is_visible()
        title = (await sheet.first.text_content()) or "" if opened else ""
        print("terminal opened:", opened, "| title has 'Terminal':", "Terminal" in title)
        await pg.screenshot(path="scratch-smoke-terminal.png") if "--shot" in sys.argv else None
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(500)
        closed = await sheet.count() == 0 or not await sheet.first.is_visible()
        print("esc closed:", closed)
        # the panel still edits the Özel AI fields
        await node.click()
        await pg.wait_for_timeout(300)
        has_fields = await pg.get_by_text("Temel talimat", exact=True).count() > 0 and await pg.get_by_text("GitHub repoları", exact=True).count() > 0
        print("custom ai fields:", has_fields)
        print("page errors:", errors)
        await b.close()
        return 0 if opened and closed and has_fields and not errors else 1

sys.exit(asyncio.run(main()))
