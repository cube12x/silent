"""MindMirror click-through smoke (Playwright, Python) against the browser preview: entry screen → Mind → new model →
pick both halves → Start → one chat turn (Bilinç + Eylem bubbles, live memory) → /durum → terminal → back to Maker.
Any page error fails.

Run:  VITE_SILENT_PREVIEW=1 npx vite --port 5198 &   then   python3 scripts/smoke-mind.py [--shot]
Needs: pip install playwright && playwright install chromium
"""
import asyncio, sys
from playwright.async_api import async_playwright

BASE = "http://localhost:5198/"


async def pick_model(pg, half: str, display: str) -> None:
    half_box = pg.get_by_test_id(f"mind-half-{half}")
    await half_box.get_by_role("button").first.click()
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
        # Entry screen: both cards, Mind is orange and opens MindMirror.
        await pg.get_by_test_id("entry-maker").wait_for(timeout=20000)
        await pg.get_by_test_id("entry-mind").click()
        await pg.get_by_test_id("mind-new").wait_for(timeout=10000)
        await pg.get_by_test_id("mind-new").click()
        await pg.get_by_test_id("mind-half-bilinc").wait_for(timeout=10000)
        await pick_model(pg, "bilinc", "GPT-6-Astra")
        await pick_model(pg, "eylem", "K2.7 Coding")
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(300)
        # Gateway + tools dialogs open and close.
        await pg.get_by_test_id("mind-btn-gateway").click()
        await pg.get_by_test_id("mind-gateway-input").fill("Kıdemli oyun tasarımcısı; mevcut mimariye saygı")
        await pg.get_by_test_id("mind-gateway-save").click()
        await pg.wait_for_timeout(200)
        await pg.get_by_test_id("mind-btn-tools").click()
        await pg.get_by_test_id("mind-tool-image").click()
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(200)
        await pg.get_by_test_id("mind-btn-depot").click()
        await pg.get_by_test_id("mind-depot-input").fill("Kullanıcı Türkçe konuşur")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(200)
        if await pg.get_by_test_id("mind-depot-list").get_by_text("Kullanıcı Türkçe konuşur").count() == 0:
            failures.append("depot entry not listed")
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(200)
        # Start.
        start = pg.get_by_test_id("mind-start")
        if not await start.is_enabled():
            failures.append("Start disabled although both halves are set")
        await start.click()
        await pg.get_by_test_id("mind-started").wait_for(timeout=10000)
        await pg.get_by_test_id("mind-live-memory").wait_for(timeout=5000)
        # One turn: Bilinç → Eylem, both bubbles with actor chips, memory extracted.
        await pg.get_by_test_id("mind-chat-input").fill("Atarus sinemasına bak")
        await pg.keyboard.press("Enter")
        chat = pg.get_by_test_id("mind-chat")
        await chat.get_by_text("3 film bulundu", exact=False).wait_for(timeout=15000)
        if await chat.get_by_text("Bilinç", exact=False).count() == 0:
            failures.append("no Bilinç chip in the chat")
        if await chat.get_by_text("Eylem'e devredildi", exact=False).count() == 0:
            failures.append("no handoff separator")
        await pg.get_by_test_id("mind-live-memory").get_by_text("Atarus sinemasını", exact=False).wait_for(timeout=10000)
        # Slash command and terminal.
        await pg.get_by_test_id("mind-chat-input").fill("/durum")
        await pg.keyboard.press("Enter")
        await chat.get_by_text("Bilinç codex:gpt-6-astra", exact=False).wait_for(timeout=5000)
        await pg.get_by_test_id("mind-terminal-input").fill("ls")
        await pg.keyboard.press("Enter")
        await pg.get_by_test_id("mind-terminal").get_by_text("önizleme terminal çıktısı", exact=False).wait_for(timeout=10000)
        if shot:
            await pg.screenshot(path="scratch-smoke-mind.png", full_page=False)
        # Sidebar lists the model; the switch goes back to Maker.
        if await pg.get_by_test_id("mode-mind").count() == 0:
            failures.append("mode switch missing")
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
    print("SMOKE OK: entry → Mind → model → Start → turn (Bilinç + Eylem + memory) → /durum → terminal → Maker")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
