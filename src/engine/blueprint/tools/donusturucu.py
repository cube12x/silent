#!/usr/bin/env python3
"""Silent "Dönüştürücü" (asset converter) — Pillow + numpy, nothing else.

Brings produced assets (sprite sheets, photos, WAVs, 3D models) into the format the next step needs. The source folder is
never modified: every command writes under --out (default assets/converted) and ends with a `# CONVERTED`
manifest that the next AI reads.

  python3 .silent/tools/donusturucu.py inspect assets/art [--json]           # size, mode, alpha, frame guess
  python3 .silent/tools/donusturucu.py convert a.jpg b.webp --to png          # any raster → png/jpg/webp/bmp/gif
  python3 .silent/tools/donusturucu.py resize a.png --scale 2 | --size 32x32  # nearest-neighbour (pixel art)
  python3 .silent/tools/donusturucu.py trim a.png [--bg auto|transparent|#rrggbb] [--tol 24]
  python3 .silent/tools/donusturucu.py crop a.png --box x,y,w,h
  python3 .silent/tools/donusturucu.py removebg photo.jpg [--tol 24] [--key #ff00ff] [--no-rembg]
  python3 .silent/tools/donusturucu.py split sheet.png --frame 32x32 [--names idle,run,jump]
  python3 .silent/tools/donusturucu.py grid sheet.jpg --cols 8 --rows 4 --cell 125x125 [--origin 12,60] [--gap 3] [--label 30] [--names ...]  # regular grid with captions
  python3 .silent/tools/donusturucu.py pack f0.png f1.png --name hero [--frame 32x32] [--columns 8]
  python3 .silent/tools/donusturucu.py palette a.png --colors 16
  python3 .silent/tools/donusturucu.py wav a.wav [--rate 44100] [--bits 16] [--mono] [--normalize] [--trim-silence]
  python3 .silent/tools/donusturucu.py model inspect models/            # 3D: format, bounds, meshes, vertices, faces (needs trimesh)
  python3 .silent/tools/donusturucu.py model convert a.obj b.stl --to glb  # obj/stl/ply/gltf/glb/off/dae → glb (or obj/stl/ply/gltf)
  python3 .silent/tools/donusturucu.py model normalize a.glb --height 1.8   # centre on the origin, feet at y=0, scale to a height, +Y up

Existing output files are never overwritten unless --force is given (one step must not clobber another's work).
Exit codes: 0 ok · 1 failure (missing library, unreadable file, output exists) · 2 usage error.
"""
import argparse, json, math, os, struct, sys, wave

try:
    from PIL import Image, ImageDraw
    import numpy as np
except ImportError:  # pragma: no cover
    sys.stderr.write("donusturucu: Pillow/numpy missing — run: python3 -m pip install pillow numpy\n")
    sys.exit(1)

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
MANIFEST = []  # (src, dst, op, note)


def rel(path):
    return os.path.relpath(path).replace(os.sep, "/")


def note(src, dst, op, why=""):
    MANIFEST.append((rel(src), rel(dst), op, why))
    print(f"→ {rel(dst)}")


def out_path(args, src, stem=None, ext=None):
    base = os.path.splitext(os.path.basename(src))[0] if stem is None else stem
    dst = os.path.join(args.out, f"{base}{ext if ext is not None else '.png'}")
    inside_out = os.path.abspath(src).startswith(os.path.abspath(args.out) + os.sep)
    if not inside_out and os.path.abspath(os.path.dirname(dst)) == os.path.abspath(os.path.dirname(src)):
        raise SystemExit("donusturucu: refusing to write next to the source; pick another --out")
    if os.path.exists(dst) and not getattr(args, "force", False):
        raise SystemExit(f"donusturucu: {rel(dst)} exists (another step may have made it) — pick another --out or name, or pass --force before the command")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    return dst


def expand(paths):
    files = []
    for p in paths:
        if os.path.isdir(p):
            for name in sorted(os.listdir(p)):
                if os.path.splitext(name)[1].lower() in IMAGE_EXT | {".wav"}:
                    files.append(os.path.join(p, name))
        else:
            files.append(p)
    return files


def parse_color(text):
    t = text.lstrip("#")
    if len(t) != 6:
        raise argparse.ArgumentTypeError("colour must be #rrggbb")
    return tuple(int(t[i:i + 2], 16) for i in (0, 2, 4))


def parse_size(text):
    try:
        w, h = text.lower().split("x")
        return int(w), int(h)
    except ValueError:
        raise argparse.ArgumentTypeError("size must be WxH, e.g. 32x32")


def guess_frames(w, h):
    """Square-frame guess for a sheet: (columns, rows, size) or None."""
    if w == h:
        return None
    if w % h == 0:
        return (w // h, 1, h)
    if h % w == 0:
        return (1, h // w, w)
    for size in (64, 48, 32, 24, 16, 8):
        if w % size == 0 and h % size == 0 and (w // size) * (h // size) > 1:
            return (w // size, h // size, size)
    return None


def corner_color(im, tol):
    """Most common of the four corner colours (RGB); None when no two corners agree."""
    w, h = im.size
    rgb = im.convert("RGB")
    corners = [rgb.getpixel(p) for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    best, count = None, 0
    for c in corners:
        n = sum(1 for d in corners if max(abs(a - b) for a, b in zip(c, d)) <= tol)
        if n > count:
            best, count = c, n
    return best if count >= 2 else corners[0]


def has_alpha(im):
    return im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)


# ---------- commands ----------

def cmd_inspect(args):
    rows = []
    for f in expand(args.paths):
        ext = os.path.splitext(f)[1].lower()
        if ext == ".wav":
            with wave.open(f, "rb") as w:
                rows.append({"name": os.path.basename(f), "path": rel(f), "kind": "wav", "rate": w.getframerate(), "bits": 8 * w.getsampwidth(), "channels": w.getnchannels(), "seconds": round(w.getnframes() / w.getframerate(), 3)})
            continue
        try:
            im = Image.open(f)
        except Exception as e:  # unreadable → report, keep going
            rows.append({"name": os.path.basename(f), "path": rel(f), "kind": "unreadable", "error": str(e)[:80]})
            continue
        w, h = im.size
        alpha = has_alpha(im) and (im.mode != "RGBA" or im.getchannel("A").getextrema()[0] < 255)
        g = guess_frames(w, h)
        rows.append({"name": os.path.basename(f), "path": rel(f), "kind": "image", "width": w, "height": h, "mode": im.mode, "alpha": bool(alpha), "frames": ({"columns": g[0], "rows": g[1], "size": g[2]} if g else None), "colors": (len(im.convert("RGB").getcolors(4096) or []) or None)})
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return
    for r in rows:
        if r["kind"] == "wav":
            print(f"{r['name']} wav {r['rate']}Hz {r['bits']}bit ch={r['channels']} {r['seconds']}s")
        elif r["kind"] == "image":
            fr = f" frames?={r['frames']['columns']}x{r['frames']['rows']}@{r['frames']['size']}" if r["frames"] else ""
            col = f" colors={r['colors']}" if r["colors"] else ""
            print(f"{r['name']} {r['width']}x{r['height']} {r['mode']} alpha={'yes' if r['alpha'] else 'no'}{fr}{col}")
        else:
            print(f"{r['name']} unreadable: {r['error']}")


def save(im, dst, fmt=None):
    ext = os.path.splitext(dst)[1].lower()
    if ext in (".jpg", ".jpeg") and im.mode != "RGB":
        im = im.convert("RGB")
    im.save(dst, **({"quality": 95} if ext in (".jpg", ".jpeg", ".webp") else {}))


def cmd_convert(args):
    ext = "." + args.to.lower().lstrip(".")
    for f in expand(args.paths):
        im = Image.open(f)
        im = im.convert("RGBA") if ext == ".png" else im
        dst = out_path(args, f, ext=ext)
        save(im, dst)
        note(f, dst, "convert", f"{os.path.splitext(f)[1].lstrip('.')} → {ext.lstrip('.')}")


def cmd_resize(args):
    if not args.scale and not args.size:
        raise argparse.ArgumentTypeError("need --scale or --size")
    for f in expand(args.paths):
        im = Image.open(f)
        im = im.convert("RGBA") if not has_alpha(im) or im.mode == "P" else im
        size = args.size or (round(im.width * args.scale), round(im.height * args.scale))
        res = im.resize(size, Image.Resampling.LANCZOS if args.smooth else Image.Resampling.NEAREST)
        dst = out_path(args, f)
        save(res, dst)
        note(f, dst, "resize", f"{im.width}x{im.height} → {size[0]}x{size[1]} {'smooth' if args.smooth else 'nearest'}")


def content_bbox(im, bg, tol):
    """Bounding box of pixels that are not background (alpha, or colour distance > tol)."""
    rgba = im.convert("RGBA")
    a = np.asarray(rgba)
    if bg == "transparent" or (bg == "auto" and has_alpha(im) and a[..., 3].min() < 255):
        mask = a[..., 3] > 0
    else:
        col = corner_color(im, tol) if bg == "auto" else bg
        diff = np.abs(a[..., :3].astype(int) - np.array(col)).max(axis=2)
        mask = (diff > tol) & (a[..., 3] > 0)
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def cmd_trim(args):
    for f in expand(args.paths):
        im = Image.open(f)
        box = content_bbox(im, args.bg, args.tol)
        dst = out_path(args, f)
        if not box:
            print(f"skip {rel(f)}: nothing but background")
            continue
        save(im.convert("RGBA").crop(box), dst)
        note(f, dst, "trim", f"{im.width}x{im.height} → {box[2]-box[0]}x{box[3]-box[1]} at {box[0]},{box[1]}")


def cmd_crop(args):
    x, y, w, h = args.box
    for f in expand(args.paths):
        im = Image.open(f).convert("RGBA")
        dst = out_path(args, f)
        save(im.crop((x, y, x + w, y + h)), dst)
        note(f, dst, "crop", f"box {x},{y},{w},{h}")


def flood_bg(im, tol):
    """Make the background transparent: flood-fill from the four corners over near-corner-colour pixels."""
    rgba = im.convert("RGBA")
    w, h = rgba.size
    # Fill on an RGB copy with a sentinel that cannot collide (we track filled pixels by comparing to the original).
    work = rgba.copy()
    for corner in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        px = work.getpixel(corner)
        if px[3] == 0:
            continue
        ImageDraw.floodfill(work, corner, (0, 0, 0, 0), thresh=tol * 3)
    a = np.asarray(work)
    orig = np.asarray(rgba).copy()
    orig[..., 3] = np.where(a[..., 3] == 0, 0, orig[..., 3])
    return Image.fromarray(orig, "RGBA")


def cmd_removebg(args):
    method = None
    if not args.no_rembg:
        try:
            import rembg  # type: ignore
            method = "rembg"
        except ImportError:
            method = None
    for f in expand(args.paths):
        im = Image.open(f)
        if args.key:
            rgba = im.convert("RGBA")
            a = np.asarray(rgba).copy()
            diff = np.abs(a[..., :3].astype(int) - np.array(args.key)).max(axis=2)
            a[..., 3] = np.where(diff <= args.tol, 0, a[..., 3])
            res, how = Image.fromarray(a, "RGBA"), f"colour key #{''.join(f'{c:02x}' for c in args.key)}"
        elif method == "rembg":
            res, how = rembg.remove(im.convert("RGBA")), "rembg"
        else:
            res, how = flood_bg(im, args.tol), "flood-fill (rembg not installed)"
        dst = out_path(args, f)
        save(res, dst)
        print(f"removebg: {how}")
        note(f, dst, "removebg", how)


def cmd_split(args):
    fw, fh = args.frame
    names = args.names.split(",") if args.names else []
    for f in expand(args.paths):
        im = Image.open(f).convert("RGBA")
        cols, rows = im.width // fw, im.height // fh
        if cols * rows == 0:
            raise SystemExit(f"donusturucu: {rel(f)} is smaller than one {fw}x{fh} frame")
        stem = os.path.splitext(os.path.basename(f))[0]
        i = 0
        for r in range(rows):
            for c in range(cols):
                frame = im.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh))
                name = names[i] if i < len(names) else f"{stem}_{i}"
                dst = out_path(args, f, stem=name)
                save(frame, dst)
                note(f, dst, "split", f"frame {i} ({c},{r}) {fw}x{fh}")
                i += 1


def cmd_grid(args):
    """Crop a regular N×M grid of cells (AI-generated sheets: fixed cell size, optional gap and caption strip)."""
    cw, ch = args.cell
    ox, oy = args.origin
    names = args.names.split(",") if args.names else []
    for f in expand(args.paths):
        im = Image.open(f).convert("RGBA")
        stem = os.path.splitext(os.path.basename(f))[0]
        i = 0
        for r in range(args.rows):
            for c in range(args.cols):
                x, y = ox + c * (cw + args.gap), oy + r * (ch + args.gap)
                if x + cw > im.width or y + ch > im.height:
                    raise SystemExit(f"donusturucu: cell ({c},{r}) at {x},{y} falls outside {rel(f)} ({im.width}x{im.height})")
                frame = im.crop((x, y, x + cw, y + ch - args.label))
                name = names[i] if i < len(names) else f"{stem}_{i}"
                dst = out_path(args, f, stem=name)
                save(frame, dst)
                note(f, dst, "grid", f"cell ({c},{r}) at {x},{y} {cw}x{ch - args.label}")
                i += 1


def cmd_pack(args):
    files = expand(args.paths)
    if not files:
        raise SystemExit("donusturucu: no frames to pack")
    frames = [Image.open(f).convert("RGBA") for f in files]
    fw, fh = args.frame or (max(i.width for i in frames), max(i.height for i in frames))
    cols = args.columns or (len(frames) if len(frames) <= 8 else math.ceil(math.sqrt(len(frames))))
    rows = math.ceil(len(frames) / cols)
    sheet = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    atlas = {"frameW": fw, "frameH": fh, "columns": cols, "frames": []}
    for i, (f, im) in enumerate(zip(files, frames)):
        x, y = (i % cols) * fw, (i // cols) * fh
        if im.size != (fw, fh):
            im = im.resize((fw, fh), Image.Resampling.NEAREST)
        sheet.paste(im, (x, y))
        atlas["frames"].append({"name": os.path.splitext(os.path.basename(f))[0], "x": x, "y": y, "w": fw, "h": fh})
    dst = out_path(args, files[0], stem=args.name)
    save(sheet, dst)
    with open(os.path.splitext(dst)[0] + ".json", "w", encoding="utf-8") as fh_:
        json.dump(atlas, fh_, indent=1)
    note(files[0], dst, "pack", f"{len(frames)} frames {fw}x{fh}, {cols} columns, atlas {os.path.basename(os.path.splitext(dst)[0])}.json")


def cmd_palette(args):
    for f in expand(args.paths):
        im = Image.open(f).convert("RGBA")
        res = im.quantize(colors=args.colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        dst = out_path(args, f)
        res.save(dst)
        note(f, dst, "palette", f"{args.colors} colours")


def wav_read(path):
    with wave.open(path, "rb") as w:
        rate, width, ch, n = w.getframerate(), w.getsampwidth(), w.getnchannels(), w.getnframes()
        raw = w.readframes(n)
    if width == 1:
        data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128
    elif width == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
    elif width == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648
    else:
        raise SystemExit(f"donusturucu: unsupported sample width {width}")
    return rate, data.reshape(-1, ch)


def wav_write(path, rate, data, bits):
    data = np.clip(data, -1, 1)
    if bits == 8:
        pcm = (data * 127 + 128).astype(np.uint8)
    else:
        pcm = (data * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(data.shape[1]); w.setsampwidth(1 if bits == 8 else 2); w.setframerate(rate); w.writeframes(pcm.tobytes())


def cmd_wav(args):
    for f in expand(args.paths):
        rate, data = wav_read(f)
        steps = []
        if args.mono and data.shape[1] > 1:
            data = data.mean(axis=1, keepdims=True); steps.append("mono")
        if args.trim_silence:
            loud = np.nonzero(np.abs(data).max(axis=1) > 0.01)[0]
            if len(loud):
                data = data[loud[0]:loud[-1] + 1]; steps.append("trim-silence")
        if args.rate and args.rate != rate:
            n = int(round(len(data) * args.rate / rate))
            src_t = np.linspace(0, 1, len(data), endpoint=False)
            dst_t = np.linspace(0, 1, n, endpoint=False)
            data = np.stack([np.interp(dst_t, src_t, data[:, c]) for c in range(data.shape[1])], axis=1)
            steps.append(f"{rate}→{args.rate}Hz"); rate = args.rate
        if args.normalize:
            peak = float(np.abs(data).max()) or 1.0
            data = data / peak * 0.98; steps.append("normalize")
        dst = out_path(args, f, ext=".wav")
        wav_write(dst, rate, data, args.bits)
        steps.append(f"{args.bits}bit")
        note(f, dst, "wav", ", ".join(steps))


MODEL_EXT = {".glb", ".gltf", ".obj", ".stl", ".ply", ".off", ".dae", ".fbx", ".3ds"}


def _trimesh():
    try:
        import trimesh  # type: ignore
        return trimesh
    except ImportError:
        raise SystemExit("donusturucu: 3D commands need trimesh — run: python3 -m pip install --user trimesh  (on Homebrew Python add --break-system-packages)")


def expand_models(paths):
    files = []
    for p in paths:
        if os.path.isdir(p):
            for name in sorted(os.listdir(p)):
                if os.path.splitext(name)[1].lower() in MODEL_EXT:
                    files.append(os.path.join(p, name))
        else:
            files.append(p)
    return files


def _load_scene(trimesh, path):
    scene = trimesh.load(path, force="scene")
    meshes = [g for g in scene.geometry.values() if hasattr(g, "vertices")]
    return scene, meshes


def cmd_model(args):
    trimesh = _trimesh()
    if args.op == "inspect":
        rows = []
        for f in expand_models(args.paths):
            try:
                scene, meshes = _load_scene(trimesh, f)
            except Exception as e:  # unreadable/unsupported → report, keep going
                rows.append({"name": os.path.basename(f), "path": rel(f), "error": str(e)[:100]})
                continue
            ext = scene.extents.tolist() if len(meshes) else [0, 0, 0]
            rows.append({"name": os.path.basename(f), "path": rel(f), "format": os.path.splitext(f)[1].lstrip(".").lower(), "meshes": len(meshes), "vertices": int(sum(len(m.vertices) for m in meshes)), "faces": int(sum(len(m.faces) for m in meshes)), "extents": [round(float(v), 4) for v in ext], "bounds": [[round(float(v), 4) for v in b] for b in scene.bounds.tolist()] if len(meshes) else None})
        if args.json:
            print(json.dumps(rows, indent=1))
        else:
            for r in rows:
                if "error" in r:
                    print(f"{r['name']} unreadable: {r['error']}")
                else:
                    e = r["extents"]
                    print(f"{r['name']} {r['format']} meshes={r['meshes']} vertices={r['vertices']} faces={r['faces']} size={e[0]}x{e[1]}x{e[2]}")
        return
    to = "." + args.to.lower().lstrip(".") if args.to else ".glb"
    for f in expand_models(args.paths):
        scene, meshes = _load_scene(trimesh, f)
        if not meshes:
            print(f"skip {rel(f)}: no geometry")
            continue
        steps = []
        if args.op == "normalize":
            mesh = scene.to_geometry() if hasattr(scene, "to_geometry") else scene.dump(concatenate=True)
            lo, hi = mesh.bounds
            centre = (lo + hi) / 2.0
            mesh.apply_translation([-centre[0], -lo[1], -centre[2]])  # centre x/z, feet on y=0
            height = float(hi[1] - lo[1]) or 1.0
            if args.height:
                mesh.apply_scale(args.height / height)
                steps.append(f"height {height:.3f} → {args.height}")
            steps.append("centred, feet at y=0")
            out_obj = mesh
        else:
            out_obj = scene
            steps.append(f"{os.path.splitext(f)[1].lstrip('.')} → {to.lstrip('.')}")
        dst = out_path(args, f, ext=to)
        out_obj.export(dst)
        note(f, dst, args.op if args.op != "convert" else "model-convert", ", ".join(steps))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default="assets/converted", help="output folder (default assets/converted); never the source folder")
    p.add_argument("--no-manifest", action="store_true", help="do not print the # CONVERTED manifest")
    p.add_argument("--force", action="store_true", help="overwrite existing output files (default: refuse, so one step never clobbers another)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("inspect"); s.add_argument("paths", nargs="+"); s.add_argument("--json", action="store_true"); s.set_defaults(fn=cmd_inspect)
    s = sub.add_parser("convert"); s.add_argument("paths", nargs="+"); s.add_argument("--to", required=True, choices=["png", "jpg", "webp", "bmp", "gif"]); s.set_defaults(fn=cmd_convert)
    s = sub.add_parser("resize"); s.add_argument("paths", nargs="+"); s.add_argument("--scale", type=float); s.add_argument("--size", type=parse_size); s.add_argument("--smooth", action="store_true"); s.set_defaults(fn=cmd_resize)
    s = sub.add_parser("trim"); s.add_argument("paths", nargs="+"); s.add_argument("--bg", default="auto", help="auto | transparent | #rrggbb"); s.add_argument("--tol", type=int, default=24); s.set_defaults(fn=cmd_trim)
    s = sub.add_parser("crop"); s.add_argument("paths", nargs="+"); s.add_argument("--box", required=True, type=lambda t: tuple(int(v) for v in t.split(","))); s.set_defaults(fn=cmd_crop)
    s = sub.add_parser("removebg"); s.add_argument("paths", nargs="+"); s.add_argument("--tol", type=int, default=24); s.add_argument("--key", type=parse_color); s.add_argument("--no-rembg", action="store_true"); s.set_defaults(fn=cmd_removebg)
    s = sub.add_parser("split"); s.add_argument("paths", nargs="+"); s.add_argument("--frame", required=True, type=parse_size); s.add_argument("--names"); s.set_defaults(fn=cmd_split)
    s = sub.add_parser("grid"); s.add_argument("paths", nargs="+"); s.add_argument("--cols", type=int, required=True); s.add_argument("--rows", type=int, required=True); s.add_argument("--cell", type=parse_size, required=True); s.add_argument("--origin", type=lambda t: tuple(int(v) for v in t.split(",")), default=(0, 0)); s.add_argument("--gap", type=int, default=0); s.add_argument("--label", type=int, default=0, help="caption strip height to drop from the bottom of each cell"); s.add_argument("--names"); s.set_defaults(fn=cmd_grid)
    s = sub.add_parser("pack"); s.add_argument("paths", nargs="+"); s.add_argument("--name", required=True); s.add_argument("--frame", type=parse_size); s.add_argument("--columns", type=int); s.set_defaults(fn=cmd_pack)
    s = sub.add_parser("palette"); s.add_argument("paths", nargs="+"); s.add_argument("--colors", type=int, default=16); s.set_defaults(fn=cmd_palette)
    s = sub.add_parser("model"); s.add_argument("op", choices=["inspect", "convert", "normalize"]); s.add_argument("paths", nargs="+"); s.add_argument("--to", help="output format for convert/normalize (default glb)"); s.add_argument("--height", type=float, help="normalize: target height in metres"); s.add_argument("--json", action="store_true"); s.set_defaults(fn=cmd_model)
    s = sub.add_parser("wav"); s.add_argument("paths", nargs="+"); s.add_argument("--rate", type=int); s.add_argument("--bits", type=int, default=16, choices=[8, 16]); s.add_argument("--mono", action="store_true"); s.add_argument("--normalize", action="store_true"); s.add_argument("--trim-silence", action="store_true"); s.set_defaults(fn=cmd_wav)
    args = p.parse_args(argv)
    if args.cmd == "trim" and args.bg not in ("auto", "transparent"):
        args.bg = parse_color(args.bg)
    if len(args.box) != 4 if args.cmd == "crop" else False:
        p.error("--box must be x,y,w,h")
    try:
        args.fn(args)
    except argparse.ArgumentTypeError as e:
        p.error(str(e))
    except (OSError, ValueError) as e:
        sys.stderr.write(f"donusturucu: {e}\n")
        return 1
    if MANIFEST and not args.no_manifest:
        print("# CONVERTED")
        for src, dst, op, why in MANIFEST:
            print(f"- {src} → {dst} · {op}{' · ' + why if why else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
