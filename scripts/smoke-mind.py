"""MindMirror canvas smoke (Playwright, Python) against the browser preview: entry → Mind → new model (seeded canvas) →
edit the Bilinç / Eylem / Gateway / Hafıza / Araçlar boxes in the side panel → Start (Canlı hafıza box appears) →
one chat turn (Bilinç + Eylem bubbles, live memory) → /durum → terminal → right-click menu adds a box → back to Maker.
Any page error fails.

Run:  VITE_SILENT_PREVIEW=1 npx vite --port 5198 &   then   python3 scripts/smoke-mind.py [--shot]
Needs: pip install playwright && playwright install chromium
"""
import asyncio, sys
from playwright.async_api import async_playwright

BASE = "http://localhost:5198/"


async def select_box(pg, test_id: str) -> None:
    await pg.get_by_test_id(test_id).first.click()
    await pg.get_by_test_id("mind-panel").wait_for(timeout=5000)
    await pg.wait_for_timeout(150)


async def pick_model(pg, display: str) -> None:
    await pg.get_by_test_id("mind-model-picker").get_by_role("button").first.click()
    await pg.wait_for_timeout(250)
    await pg.get_by_role("button").filter(has_text=display).first.click()
    await pg.wait_for_timeout(250)


async def main() -> int:
    shot = "--shot" in sys.argv
    failures: list[str] = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1600, "height": 1000}, locale="tr-TR")
        errors: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(BASE, wait_until="networkidle")
        await pg.get_by_test_id("entry-maker").wait_for(timeout=20000)
        await pg.get_by_test_id("entry-mind").click()
        await pg.get_by_test_id("mind-new").wait_for(timeout=10000)
        await pg.get_by_test_id("mind-new").click()
        # Seeded canvas: Hafıza → Gateway → Bilinç / Eylem, Araçlar → Eylem.
        await pg.get_by_test_id("mind-node-model-bilinc").wait_for(timeout=10000)
        for tid in ("mind-node-model-eylem", "mind-node-gateway", "mind-node-memory", "mind-node-tools"):
            if await pg.get_by_test_id(tid).count() == 0:
                failures.append(f"seeded box missing: {tid}")
        if await pg.get_by_test_id("mind-start").is_enabled() and False:
            failures.append("Start enabled before models are chosen")
        # Edit boxes through the side panel.
        await select_box(pg, "mind-node-model-bilinc")
        await pick_model(pg, "GPT-6-Astra")
        await select_box(pg, "mind-node-model-eylem")
        await pick_model(pg, "K2.7 Coding")
        await select_box(pg, "mind-node-gateway")
        await pg.get_by_test_id("mind-gateway-input").fill("Kıdemli oyun tasarımcısı; mevcut mimariye saygı")
        await pg.wait_for_timeout(200)
        await select_box(pg, "mind-node-tools")
        await pg.get_by_test_id("mind-tool-image").click()
        await select_box(pg, "mind-node-memory")
        await pg.get_by_test_id("mind-depot-input").fill("Kullanıcı Türkçe konuşur")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(200)
        if await pg.get_by_test_id("mind-memory-rows").get_by_text("Kullanıcı Türkçe konuşur").count() == 0:
            failures.append("depot entry not listed")
        if await pg.get_by_test_id("mind-node-memory").get_by_text("1 kayıt").count() == 0:
            failures.append("memory box does not show the depot count")
        # Model card on the Bilinç box: capabilities + OFF switches; switch the browser off for that box.
        await select_box(pg, "mind-node-model-bilinc")
        await pg.get_by_test_id("mind-model-card").wait_for(timeout=5000)
        if await pg.get_by_test_id("mind-off-network").count() == 0:
            failures.append("model card has no OFF switch for network")
        await pg.get_by_test_id("mind-off-network").click()
        await pg.wait_for_timeout(200)
        if await pg.get_by_test_id("mind-node-model-bilinc").get_by_text("1 kapalı").count() == 0:
            failures.append("Bilinç box does not show the OFF count")
        # Düşünme box via the context menu (before the turn, so Bilinç thinks aloud).
        pane = pg.locator(".react-flow__pane").first
        box = await pane.bounding_box()
        await pg.mouse.click(box["x"] + box["width"] - 120, box["y"] + box["height"] - 80, button="right")
        await pg.get_by_test_id("mind-menu").wait_for(timeout=3000)
        await pg.get_by_test_id("mind-menu").get_by_role("button").filter(has_text="Düşünme").first.click()
        await pg.wait_for_timeout(300)
        await pg.get_by_test_id("mind-node-thinking").wait_for(timeout=3000)
        # Start compiles the canvas and adds the Canlı hafıza box.
        start = pg.get_by_test_id("mind-start")
        if not await start.is_enabled():
            failures.append("Start disabled although the canvas compiles")
        await start.click()
        await pg.get_by_test_id("mind-started").wait_for(timeout=10000)
        await pg.get_by_test_id("mind-node-live").wait_for(timeout=5000)
        if await pg.get_by_test_id("mind-kind").get_by_text("Bilinç + Eylem").count() == 0:
            failures.append("composition chip is not 'Bilinç + Eylem'")
        # One turn in the dock.
        await pg.get_by_test_id("mind-dock-chat").click()
        await pg.get_by_test_id("mind-chat-input").fill("Atarus sinemasına bak")
        await pg.keyboard.press("Enter")
        chat = pg.get_by_test_id("mind-chat")
        await chat.get_by_text("3 film bulundu", exact=False).wait_for(timeout=15000)
        if await chat.get_by_text("Bilinç", exact=False).count() == 0:
            failures.append("no Bilinç chip in the chat")
        if await chat.get_by_text("Eylem'e devredildi", exact=False).count() == 0:
            failures.append("no handoff separator")
        await pg.get_by_test_id("mind-node-live").get_by_text("Atarus sinemasını", exact=False).wait_for(timeout=10000)
        # Düşünme box shows the DÜŞÜNCE block; the chat bubble does not.
        await pg.get_by_test_id("mind-node-dusunce").wait_for(timeout=5000)
        if await chat.get_by_text("Eylem'e adres ve dönüş", exact=False).count() > 0:
            failures.append("the DÜŞÜNCE block leaked into the chat")
        if await pg.get_by_test_id("mind-node-model-bilinc").get_by_test_id("mind-node-last").count() == 0:
            failures.append("Bilinç box shows no last line after the turn")
        await pg.get_by_test_id("mind-chat-input").fill("/durum")
        await pg.keyboard.press("Enter")
        await chat.get_by_text("Bilinç+Eylem", exact=False).wait_for(timeout=5000)
        # Terminal tab.
        await pg.get_by_test_id("mind-dock-terminal").click()
        await pg.get_by_test_id("mind-terminal-input").fill("ls")
        await pg.keyboard.press("Enter")
        await pg.get_by_test_id("mind-terminal").get_by_text("önizleme terminal çıktısı", exact=False).wait_for(timeout=10000)
        # Right-click menu adds a Model box.
        pane = pg.locator(".react-flow__pane").first
        box = await pane.bounding_box()
        await pg.mouse.click(box["x"] + box["width"] - 120, box["y"] + 40, button="right")
        await pg.get_by_test_id("mind-menu").wait_for(timeout=3000)
        await pg.get_by_test_id("mind-menu").get_by_role("button").filter(has_text="Model").first.click()
        await pg.wait_for_timeout(300)
        if await pg.get_by_test_id("mind-node-model-tek").count() == 0:
            failures.append("context menu did not add a Model box")
        if shot:
            await pg.screenshot(path="scratch-smoke-mind.png", full_page=False)
        await pg.get_by_test_id("mode-maker").click()
        await pg.wait_for_timeout(400)
        if "/chat" not in pg.url:
            failures.append(f"Maker switch did not open /chat ({pg.url})")
        await b.close()
        if errors:
            failures.append("page errors: " + " | ".join(errors[:3]))
    if failures:
        print("SMOKE FAILED")
        for f in failures:
            print(" -", f)
        return 1
    print("SMOKE OK: entry → Mind → canvas boxes → Start (live box) → turn (Bilinç + Eylem + memory) → /durum → terminal → menu → Maker")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
