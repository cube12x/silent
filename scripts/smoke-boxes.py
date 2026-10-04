"""Blueprint click-through smoke (Playwright, Python): every context-menu box is added, selected and (where runnable) run in
the browser preview; the Settings dosage rows and the Silent Code composer toggles are checked too. Any page error fails.

Run:  VITE_SILENT_PREVIEW=1 npx vite --port 5198 &   then   python3 scripts/smoke-boxes.py [--shot]
Needs: pip install playwright && playwright install chromium
"""
import asyncio, sys
from playwright.async_api import async_playwright

BASE = "http://localhost:5198/"
# (menu label prefix, expected panel header text, runnable from the panel)
MENU = [
    ("Prompt", "Prompt", True),
    ("Özel AI", "AI", True),
    ("Bilinç", "AI", True),
    ("Eylem", "AI", True),
    ("Dönüştürücü", "AI", True),
    ("Keşifçi", "AI", True),
    ("Bölücü", "AI", True),
    ("Dikiş", "AI", True),
    ("Denetçi", "Denetçi", True),
    ("Sıra", "Sıra", True),
    ("Anlık Görüntü", "Anlık Görüntü", True),
    ("Çoklu Tarayıcı", "Çoklu Tarayıcı", True),
    ("Bütçe", "Bütçe", False),
    ("Build", "Build", False),
    ("Build Foto", "Build Foto", False),
    ("Buton: Start", "Buton", True),
    ("Buton: Send", "Buton", True),
    ("Buton: Reload", "Buton", True),
    ("Buton: Paralel", "Buton", True),
    ("Yetenek Sihirbazı", "Yetenek Sihirbazı", True),
    ("Değişken", "Değişken", False),
    ("Uydurma", "Uydurma", False),
    ("AI", "AI", True),
]


async def main() -> int:
    shot = "--shot" in sys.argv
    failures: list[str] = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1600, "height": 1000}, locale="tr-TR")
        errors: list[str] = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(BASE, wait_until="networkidle")
        await pg.get_by_text("Yeni blueprint", exact=True).first.click()
        await pg.wait_for_timeout(400)
        await pg.get_by_role("button", name="Yeni blueprint").first.click()
        await pg.wait_for_timeout(600)
        pane = pg.locator(".react-flow__pane").first
        box = await pane.bounding_box()
        added = 0
        for i, (label, header, runnable) in enumerate(MENU):
            box = await pane.bounding_box()  # the side panel narrows the canvas once a node is selected
            x = box["x"] + 40 + (i % 4) * min(200, (box["width"] - 80) / 4)
            y = box["y"] + 40 + (i // 4) * min(140, (box["height"] - 80) / 6)
            await pg.mouse.click(x, y, button="right")
            await pg.wait_for_timeout(200)
            menu = pg.locator("div.absolute.z-30.w-52")
            item = menu.get_by_role("button").filter(has_text=label).first
            try:
                await item.click(timeout=3000)
            except Exception as e:  # noqa: BLE001
                failures.append(f"menu '{label}': {e}")
                await pg.keyboard.press("Escape")
                continue
            await pg.wait_for_timeout(350)
            nodes = pg.locator(".react-flow__node")
            n = await nodes.count()
            if n < added + 1:
                failures.append(f"'{label}' did not add a node ({n} vs {added + 1})")
                continue
            if n > added + 1:
                print(f"note: '{label}' — {n - added - 1} extra node(s) appeared (a run created a Build box); tolerated")
            added = n
            node = nodes.nth(n - 1)
            await node.click()
            await pg.wait_for_timeout(300)
            panel_text = (await pg.locator("aside.w-\\[340px\\]").first.text_content()) or ""
            if header.casefold() not in panel_text.casefold():
                failures.append(f"'{label}': panel header '{header}' not found")
            if runnable:
                panel = pg.locator("aside.w-\\[340px\\]").first
                btns = panel.get_by_role("button").filter(has_text="Çalıştır")
                run_btn = btns.first if await btns.count() else None
                if run_btn is not None:
                    try:
                        await run_btn.click(timeout=2000)
                        await pg.wait_for_timeout(700)
                    except Exception as e:  # noqa: BLE001
                        failures.append(f"'{label}': run click failed: {e}")
            if label == "Denetçi":
                # 2026-10-04: soft commands + continueOnFail fields must exist and keep what is typed
                panel = pg.locator("aside.w-\\[340px\\]").first
                soft = panel.get_by_placeholder("npm run e2e")
                cont = panel.get_by_label("Kırmızıysa da devam et")
                if await soft.count() == 0 or await cont.count() == 0:
                    failures.append("'Denetçi': soft commands / continueOnFail fields missing")
                else:
                    await soft.first.fill("npm run e2e")
                    await cont.first.check()
                    await pg.wait_for_timeout(300)
                    if (await soft.first.input_value()) != "npm run e2e" or not await cont.first.is_checked():
                        failures.append("'Denetçi': soft/continueOnFail edits did not stick")
            if errors:
                failures.append(f"'{label}': page errors {errors[:2]}")
                errors.clear()
        print(f"added {added}/{len(MENU)} boxes")
        # four quick clicks open the terminal, Esc closes it
        first = pg.locator(".react-flow__node").first
        nb = await first.bounding_box()
        for _ in range(4):
            await pg.mouse.click(nb["x"] + 40, nb["y"] + 10)
            await pg.wait_for_timeout(80)
        await pg.wait_for_timeout(500)
        sheet = pg.get_by_role("dialog")
        opened = await sheet.count() > 0 and await sheet.first.is_visible()
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(400)
        closed = await sheet.count() == 0 or not await sheet.first.is_visible()
        print("terminal 4-click:", opened, "| esc:", closed)
        if not (opened and closed):
            failures.append("terminal 4-click/esc")
        # undo removes the last box
        before = await pg.locator(".react-flow__node").count()
        await pg.keyboard.press("Meta+z")
        await pg.wait_for_timeout(400)
        after = await pg.locator(".react-flow__node").count()
        print("undo:", before, "->", after)
        if shot:
            await pg.screenshot(path="scratch-smoke-boxes.png")
        # Settings: routing section shows dosage rows
        await pg.get_by_text("Ayarlar", exact=True).first.click()
        await pg.wait_for_timeout(600)
        await pg.get_by_role("button", name="Yönlendirme").first.click()
        await pg.wait_for_timeout(400)
        dosage_ok = await pg.get_by_text("Model dozajı", exact=False).count() > 0 and await pg.get_by_text("Çok az", exact=True).count() > 0
        print("settings dosage rows:", dosage_ok)
        if not dosage_ok:
            failures.append("settings dosage rows missing")
        # Silent Code composer: Turbo / Ucuz işçi toggles exist
        await pg.get_by_text("Yeni çalıştırma", exact=True).first.click()
        await pg.wait_for_timeout(600)
        turbo = await pg.get_by_text("Turbo", exact=True).count() > 0 and await pg.get_by_text("Ucuz işçi", exact=True).count() > 0
        print("composer turbo/mechanical:", turbo)
        if not turbo:
            failures.append("composer toggles missing")
        if errors:
            failures.append(f"page errors: {errors[:3]}")
        await b.close()
    for f in failures:
        print("FAIL:", f)
    return 0 if not failures else 1


sys.exit(asyncio.run(main()))
