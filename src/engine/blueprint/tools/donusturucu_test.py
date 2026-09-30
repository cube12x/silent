"""Tests for donusturucu.py — run: python3 -m unittest src/engine/blueprint/tools/donusturucu_test.py -v"""
import json, os, subprocess, sys, tempfile, unittest, wave

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "donusturucu.py")

try:
    from PIL import Image
    import numpy as np
except ImportError:  # pragma: no cover
    Image = None


def img(path):
    with Image.open(path) as im:
        im.load()
        return im.copy()


def run(*args, cwd):
    p = subprocess.run([sys.executable, TOOL, *args], cwd=cwd, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


@unittest.skipIf(Image is None, "Pillow/numpy missing")
class ConverterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.src = os.path.join(self.root, "art")
        os.makedirs(self.src)
        # 64x32 sheet: two 32x32 frames on a solid magenta background, each frame a red 16x16 square
        sheet = Image.new("RGB", (64, 32), (255, 0, 255))
        for fx in (0, 32):
            for x in range(fx + 8, fx + 24):
                for y in range(8, 24):
                    sheet.putpixel((x, y), (200, 30, 30))
        sheet.save(os.path.join(self.src, "hero.png"))
        # 40x40 "photo": white background, centred red square 10..30
        photo = Image.new("RGB", (40, 40), (255, 255, 255))
        for x in range(10, 30):
            for y in range(10, 30):
                photo.putpixel((x, y), (220, 20, 20))
        photo.save(os.path.join(self.src, "photo.jpg"), quality=100, subsampling=0)
        # 1 s 8-bit mono 22050 Hz quiet sine
        rate = 22050
        t = np.arange(rate) / rate
        pcm = (128 + 20 * np.sin(2 * np.pi * 440 * t)).astype(np.uint8)
        with wave.open(os.path.join(self.src, "beep.wav"), "wb") as w:
            w.setnchannels(1); w.setsampwidth(1); w.setframerate(rate); w.writeframes(pcm.tobytes())
        self.before = sorted((f, os.path.getmtime(os.path.join(self.src, f))) for f in os.listdir(self.src))

    def tearDown(self):
        self.assertEqual(self.before, sorted((f, os.path.getmtime(os.path.join(self.src, f))) for f in os.listdir(self.src)), "source folder must stay untouched")
        self.tmp.cleanup()

    def out(self, *parts):
        return os.path.join(self.root, "assets", "converted", *parts)

    def test_inspect_reports_size_mode_and_frame_guess(self):
        code, so, se = run("inspect", "art", cwd=self.root)
        self.assertEqual(code, 0, se)
        self.assertIn("hero.png 64x32 RGB alpha=no frames?=2x1@32", so)
        code, so, _ = run("inspect", "art", "--json", cwd=self.root)
        data = json.loads(so)
        self.assertEqual({d["name"] for d in data}, {"hero.png", "photo.jpg", "beep.wav"})

    def test_convert_to_png_rgba(self):
        code, so, se = run("convert", "art/photo.jpg", "--to", "png", cwd=self.root)
        self.assertEqual(code, 0, se)
        im = img(self.out("photo.png"))
        self.assertEqual(im.mode, "RGBA")
        self.assertIn("# CONVERTED", so)
        self.assertIn("art/photo.jpg → assets/converted/photo.png · convert", so)

    def test_resize_scale_is_nearest_neighbour(self):
        code, _, se = run("resize", "art/hero.png", "--scale", "2", cwd=self.root)
        self.assertEqual(code, 0, se)
        im = img(self.out("hero.png")).convert("RGB")
        self.assertEqual(im.size, (128, 64))
        self.assertEqual(im.getpixel((1, 1)), (255, 0, 255))
        self.assertEqual(im.getpixel((17, 17)), (200, 30, 30))

    def test_trim_crops_to_content(self):
        code, _, se = run("trim", "art/photo.jpg", "--bg", "auto", cwd=self.root)
        self.assertEqual(code, 0, se)
        im = img(self.out("photo.png"))
        self.assertEqual(im.size, (20, 20))

    def test_removebg_flood_fill_without_rembg(self):
        code, so, se = run("removebg", "art/photo.jpg", "--no-rembg", cwd=self.root)
        self.assertEqual(code, 0, se)
        im = img(self.out("photo.png")).convert("RGBA")
        self.assertEqual(im.getpixel((0, 0))[3], 0)
        self.assertEqual(im.getpixel((39, 39))[3], 0)
        self.assertEqual(im.getpixel((20, 20))[3], 255)
        self.assertIn("removebg: flood-fill", so)

    def test_split_and_pack_roundtrip(self):
        code, _, se = run("split", "art/hero.png", "--frame", "32x32", cwd=self.root)
        self.assertEqual(code, 0, se)
        for i in range(2):
            self.assertEqual(img(self.out("hero_%d.png" % i)).size, (32, 32))
        code, _, se = run("pack", "assets/converted/hero_0.png", "assets/converted/hero_1.png", "--name", "hero_sheet", cwd=self.root)
        self.assertEqual(code, 0, se)
        self.assertEqual(img(self.out("hero_sheet.png")).size, (64, 32))
        atlas = json.load(open(self.out("hero_sheet.json")))
        self.assertEqual([f["name"] for f in atlas["frames"]], ["hero_0", "hero_1"])
        self.assertEqual(atlas["frames"][1], {"name": "hero_1", "x": 32, "y": 0, "w": 32, "h": 32})

    def test_palette_reduces_colours(self):
        code, _, se = run("palette", "art/photo.jpg", "--colors", "4", cwd=self.root)
        self.assertEqual(code, 0, se)
        im = img(self.out("photo.png"))
        self.assertEqual(im.mode, "P")
        self.assertLessEqual(len(im.getcolors(256)), 4)

    def test_wav_resample_and_normalize(self):
        code, _, se = run("wav", "art/beep.wav", "--rate", "44100", "--bits", "16", "--normalize", cwd=self.root)
        self.assertEqual(code, 0, se)
        with wave.open(self.out("beep.wav"), "rb") as w:
            self.assertEqual((w.getframerate(), w.getsampwidth(), w.getnchannels()), (44100, 2, 1))
            pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
        self.assertGreaterEqual(abs(pcm).max() / 32767, 0.9)

    def test_grid_crops_regular_cells_and_drops_label_strip(self):
        # 2 columns x 1 row, cells 32x32 at origin (0,0), gap 0 — same geometry as the hero sheet
        code, so, se = run("grid", "art/hero.png", "--cols", "2", "--rows", "1", "--cell", "32x32", "--origin", "0,0", "--names", "idle,run", cwd=self.root)
        self.assertEqual(code, 0, se)
        for name in ("idle", "run"):
            self.assertEqual(img(self.out(name + ".png")).size, (32, 32))
        self.assertEqual(img(self.out("run.png")).convert("RGB").getpixel((9, 9)), (200, 30, 30))
        # --label 8 keeps only the top 24 px of each 32 px cell (the caption strip is dropped)
        code, _, se = run("grid", "art/hero.png", "--cols", "2", "--rows", "1", "--cell", "32x32", "--label", "8", cwd=self.root)
        self.assertEqual(code, 0, se)
        self.assertEqual(img(self.out("hero_0.png")).size, (32, 24))
        self.assertIn("· grid ·", so)

    def test_never_overwrites_an_existing_output_unless_forced(self):
        code, _, se = run("convert", "art/photo.jpg", "--to", "png", cwd=self.root)
        self.assertEqual(code, 0, se)
        first = os.path.getmtime(self.out("photo.png"))
        code, so, se = run("resize", "art/photo.jpg", "--scale", "2", cwd=self.root)  # would also write photo.png
        self.assertEqual(code, 1)
        self.assertIn("exists", se)
        self.assertEqual(os.path.getmtime(self.out("photo.png")), first)
        code, _, se = run("--force", "resize", "art/photo.jpg", "--scale", "2", cwd=self.root)
        self.assertEqual(code, 0, se)
        self.assertEqual(img(self.out("photo.png")).size, (80, 80))

    def test_model_inspect_convert_normalize(self):
        try:
            import trimesh
        except ImportError:
            self.skipTest("trimesh not installed")
        mesh = trimesh.creation.box(extents=(2.0, 4.0, 1.0))
        mesh.apply_translation((5.0, 10.0, 0.0))
        mesh.export(os.path.join(self.src, "crate.obj"))
        self.before = sorted((f, os.path.getmtime(os.path.join(self.src, f))) for f in os.listdir(self.src))
        code, so, se = run("model", "inspect", "art", cwd=self.root)
        self.assertEqual(code, 0, se)
        self.assertIn("crate.obj obj meshes=1 vertices=", so)
        self.assertIn("size=2.0x4.0x1.0", so)
        code, so, se = run("model", "convert", "art/crate.obj", "--to", "glb", cwd=self.root)
        self.assertEqual(code, 0, se)
        self.assertTrue(os.path.exists(self.out("crate.glb")))
        self.assertIn("art/crate.obj → assets/converted/crate.glb · model-convert", so)
        code, so, se = run("--out", "assets/converted/norm", "model", "normalize", "art/crate.obj", "--height", "1.8", cwd=self.root)
        self.assertEqual(code, 0, se)
        out = trimesh.load(os.path.join(self.root, "assets", "converted", "norm", "crate.glb"), force="mesh")
        lo, hi = out.bounds
        self.assertAlmostEqual(float(hi[1] - lo[1]), 1.8, places=3)
        self.assertAlmostEqual(float(lo[1]), 0.0, places=3)
        self.assertAlmostEqual(float((lo[0] + hi[0]) / 2), 0.0, places=3)

    def test_usage_error_exit_code(self):
        code, _, _ = run("resize", "art/hero.png", cwd=self.root)  # neither --scale nor --size
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
