"""Dosyalar tab + Tamirci smoke (Playwright, Python). Run: VITE_SILENT_PREVIEW=1 npx vite --port 5198 &  then  python3 scripts/smoke-files.py"""
import asyncio, sys, re
from playwright.async_api import async_playwright
BASE = "http://localhost:5198/"
async def main() -> int:
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1500, "height": 900}, locale="tr-TR")
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)[:160]))
        await pg.goto(BASE, wait_until="networkidle")
        await pg.get_by_text("Yeni blueprint", exact=True).first.click(); await pg.wait_for_timeout(400)
        await pg.get_by_role("button", name="Yeni blueprint").first.click(); await pg.wait_for_timeout(600)
        pane = pg.locator(".react-flow__pane").first
        box = await pane.bounding_box()
        await pg.mouse.click(box["x"] + 300, box["y"] + 200, button="right"); await pg.wait_for_timeout(300)
        await pg.get_by_role("button", name=re.compile(r"^\s*Build\s*$")).first.click(); await pg.wait_for_timeout(500)
        await pg.get_by_role("button", name=re.compile("Gözat|Browse")).first.click(); await pg.wait_for_timeout(400)
        folder_set = "demo-game" in ((await pg.locator("body").text_content()) or "")
        await pg.get_by_role("button", name="Dosyalar", exact=True).click()
        await pg.get_by_role("button", name=re.compile("murkcap")).first.wait_for(timeout=20000)
        body = (await pg.locator("body").text_content()) or ""
        cats = [c for c in ("Karakterler", "Arka planlar", "Sesler", "Sistemler") if c in body]
        await pg.get_by_role("button", name=re.compile("murkcap")).first.click(); await pg.wait_for_timeout(1200)
        canvas = await pg.locator("canvas").count() > 0
        anim_tabs = "idle" in ((await pg.locator("body").text_content()) or "")
        await pg.screenshot(path="smoke-files.png")
        # 3D: the crate model opens in the three.js viewer (WebGL via SwiftShader in headless Chromium)
        await pg.get_by_role("button", name=re.compile("crate")).first.click(); await pg.wait_for_timeout(2500)
        model_body = (await pg.locator("body").text_content()) or ""
        model_ok = ("Döndür" in model_body or "Rotate" in model_body) and "açılamadı" not in model_body and "Could not open" not in model_body
        await pg.screenshot(path="smoke-model.png")
        await pg.get_by_role("button", name=re.compile("murkcap")).first.click(button="right"); await pg.wait_for_timeout(300)
        await pg.get_by_text("Tamirci AI çağır", exact=True).first.click(); await pg.wait_for_timeout(600)
        dialog_open = await pg.get_by_role("dialog").count() > 0
        await pg.get_by_placeholder(re.compile("çiçekler")).fill("Zemindeki çiçekler duvara girmiş")
        await pg.screenshot(path="smoke-tamirci.png")
        await pg.keyboard.press("Enter"); await pg.wait_for_timeout(1500)
        dialog_closed = await pg.get_by_role("dialog").count() == 0
        await pg.get_by_role("button", name="Blueprint", exact=True).click(); await pg.wait_for_timeout(800)
        nodes_text = " ".join([(await n.text_content()) or "" for n in await pg.locator(".react-flow__node").all()])
        tamirci_box = "Tamirci AI" in nodes_text or "TAMİRCİ AI" in nodes_text.upper()
        await pg.screenshot(path="smoke-tamirci-canvas.png")
        print("folder set:", folder_set, "| categories:", cats, "| preview canvas:", canvas, "| anim tabs:", anim_tabs, "| 3D viewer:", model_ok, "| dialog:", dialog_open, "→ closed:", dialog_closed, "| Tamirci box on canvas:", tamirci_box, "| errors:", errors[:3])
        await b.close()
        return 0 if folder_set and len(cats) >= 3 and canvas and model_ok and dialog_open and dialog_closed and tamirci_box and not errors else 1
sys.exit(asyncio.run(main()))
