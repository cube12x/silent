#!/usr/bin/env python3
"""Silent "Uydurma" (placeholder) tool — no dependencies.

Assets are NOT produced by the expensive model. Instead the worker registers each asset with the prompt that
describes it; this tool writes a valid placeholder file whose visible content is the asset's name, and keeps
`uydurma.json` next to the assets so a cheaper/specialised AI can later generate the real thing from the prompt.

  python3 .silent/tools/uydurma.py add --kind image --path assets/uydurma/sprite__iron-man-idle.png --prompt "Iron Man idle, rubber-hose, 64x64" [--size 64x64] [--seconds 0.5]
  python3 .silent/tools/uydurma.py list [--pending]
  python3 .silent/tools/uydurma.py done --path assets/uydurma/sprite__iron-man-idle.png
  python3 .silent/tools/uydurma.py fill-brief            # prints the work list for the filling AI

Kinds: image, sprite (sheet with a frame grid), tileset, sfx, music, voice, text, font, model3d, video.
"""
import argparse, json, math, os, re, struct, sys, time, zlib

MANIFEST = "uydurma.json"
KINDS = ["image", "sprite", "tileset", "sfx", "music", "voice", "text", "font", "model3d", "video"]

# 5x7 bitmap font (uppercase, digits, a few marks); rows are 5-bit masks, MSB = left pixel.
FONT = {
    "A": [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11], "B": [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E], "C": [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
    "D": [0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E], "E": [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F], "F": [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
    "G": [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F], "H": [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11], "I": [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
    "J": [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C], "K": [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], "L": [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
    "M": [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11], "N": [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11], "O": [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
    "P": [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10], "Q": [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D], "R": [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
    "S": [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E], "T": [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04], "U": [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
    "V": [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04], "W": [0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11], "X": [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
    "Y": [0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04], "Z": [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
    "0": [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E], "1": [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E], "2": [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F],
    "3": [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E], "4": [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02], "5": [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
    "6": [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E], "7": [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08], "8": [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
    "9": [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C], "-": [0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00], "_": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1F],
    ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x0C, 0x0C], " ": [0, 0, 0, 0, 0, 0, 0], "?": [0x0E, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
}
TR = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")


def slug(text):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.translate(TR).lower())).strip("-")[:80] or "asset"


def label_for(path):
    name = os.path.splitext(os.path.basename(path))[0]
    return name.split("__", 1)[-1].replace("-", " ").replace("_", " ").upper()


# ---------- PNG ----------
def png_bytes(width, height, rgb_rows):
    raw = b"".join(b"\x00" + bytes(row) for row in rgb_rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def draw_text(pixels, width, height, text, scale, color):
    lines, cur = [], ""
    max_chars = max(1, (width - 4) // (6 * scale))
    for word in text.split(" "):
        if len(cur) + len(word) + (1 if cur else 0) <= max_chars:
            cur = f"{cur} {word}".strip()
        else:
            if cur:
                lines.append(cur)
            cur = word[:max_chars]
    if cur:
        lines.append(cur)
    lines = lines[: max(1, (height - 4) // (9 * scale))]
    y0 = max(2, (height - len(lines) * 9 * scale) // 2)
    for li, line in enumerate(lines):
        x0 = max(2, (width - len(line) * 6 * scale) // 2)
        for ci, ch in enumerate(line):
            glyph = FONT.get(ch, FONT["?"])
            for gy, mask in enumerate(glyph):
                for gx in range(5):
                    if mask & (0x10 >> gx):
                        for sy in range(scale):
                            for sx in range(scale):
                                px, py = x0 + (ci * 6 + gx) * scale + sx, y0 + (li * 9 + gy) * scale + sy
                                if 0 <= px < width and 0 <= py < height:
                                    pixels[py][px] = color


def make_png(path, kind, size):
    width, height = size
    hue = (zlib.crc32(os.path.basename(path).encode()) % 360) / 360.0
    bg = hsv(hue, 0.45, 0.35)
    fg = (245, 245, 235)
    pixels = [[bg for _ in range(width)] for _ in range(height)]
    # frame
    for x in range(width):
        pixels[0][x] = fg
        pixels[height - 1][x] = fg
    for y in range(height):
        pixels[y][0] = fg
        pixels[y][width - 1] = fg
    if kind in ("sprite", "tileset"):
        cell = 16 if min(width, height) >= 64 else 8
        for x in range(0, width, cell):
            for y in range(height):
                pixels[y][x] = hsv(hue, 0.35, 0.5)
        for y in range(0, height, cell):
            for x in range(width):
                pixels[y][x] = hsv(hue, 0.35, 0.5)
    scale = 2 if min(width, height) >= 128 else 1
    draw_text(pixels, width, height, label_for(path), scale, fg)
    with open(path, "wb") as f:
        f.write(png_bytes(width, height, [[c for px in row for c in px] for row in pixels]))


def hsv(h, s, v):
    i = int(h * 6) % 6
    f = h * 6 - int(h * 6)
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    r, g, b = [(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)][i]
    return (int(r * 255), int(g * 255), int(b * 255))


# ---------- WAV ----------
def make_wav(path, kind, seconds):
    rate = 22050
    n = int(rate * seconds)
    base = 220 + (zlib.crc32(os.path.basename(path).encode()) % 660)
    frames = bytearray()
    for i in range(n):
        t = i / rate
        env = min(1.0, t * 40) * max(0.0, 1 - t / seconds)
        if kind == "music":
            v = 0.3 * math.sin(2 * math.pi * base * t) + 0.2 * math.sin(2 * math.pi * base * 1.5 * t) + 0.15 * math.sin(2 * math.pi * base * 2 * t)
        elif kind == "voice":
            v = 0.4 * math.sin(2 * math.pi * (base / 2) * t) * (0.6 + 0.4 * math.sin(2 * math.pi * 6 * t))
        else:
            v = 0.5 * math.sin(2 * math.pi * base * t)
        frames += struct.pack("<h", int(max(-1, min(1, v * env)) * 32767))
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 36 + len(frames)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16) + b"data" + struct.pack("<I", len(frames)) + frames)


def make_text(path, kind, prompt):
    ext = os.path.splitext(path)[1].lower()
    label = label_for(path)
    if ext == ".json":
        body = json.dumps({"uydurma": True, "kind": kind, "name": label, "prompt": prompt, "note": "placeholder — replace with the real content"}, ensure_ascii=False, indent=2)
    elif kind == "model3d" and ext == ".obj":
        body = f"# UYDURMA placeholder: {label}\n# prompt: {prompt}\nv -1 -1 -1\nv 1 -1 -1\nv 1 1 -1\nv -1 1 -1\nv -1 -1 1\nv 1 -1 1\nv 1 1 1\nv -1 1 1\nf 1 2 3 4\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\n"
    else:
        body = f"UYDURMA placeholder: {label}\nkind: {kind}\nprompt: {prompt}\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)


def load_manifest(mpath):
    if os.path.exists(mpath):
        with open(mpath, encoding="utf-8") as f:
            return json.load(f)
    return {"version": 1, "assets": []}


def save_manifest(mpath, m):
    os.makedirs(os.path.dirname(mpath) or ".", exist_ok=True)
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(m, f, ensure_ascii=False, indent=2)


def manifest_path(asset_path, root):
    return os.path.join(root, MANIFEST)


def cmd_add(a):
    root = a.root
    path = a.path
    if not os.path.isabs(path):
        path = os.path.normpath(path)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    kind = a.kind
    size = tuple(int(x) for x in a.size.lower().split("x")) if a.size else ((64, 64) if kind in ("image", "sprite") else (256, 64) if kind == "tileset" else (64, 64))
    ext = os.path.splitext(path)[1].lower()
    if kind in ("image", "sprite", "tileset"):
        if ext != ".png":
            path = os.path.splitext(path)[0] + ".png"
        make_png(path, kind, size)
    elif kind in ("sfx", "music", "voice"):
        if ext != ".wav":
            path = os.path.splitext(path)[0] + ".wav"
        make_wav(path, kind, a.seconds or (2.0 if kind == "music" else 1.0 if kind == "voice" else 0.4))
    else:
        make_text(path, kind, a.prompt)
    m = load_manifest(manifest_path(path, root))
    entry = {"path": path, "kind": kind, "prompt": a.prompt, "size": f"{size[0]}x{size[1]}" if kind in ("image", "sprite", "tileset") else None, "seconds": a.seconds, "status": "placeholder", "createdAt": int(time.time())}
    m["assets"] = [e for e in m["assets"] if e["path"] != path] + [entry]
    save_manifest(manifest_path(path, root), m)
    print(f"placeholder {kind}: {path}")


def cmd_list(a):
    m = load_manifest(os.path.join(a.root, MANIFEST))
    for e in m["assets"]:
        if a.pending and e["status"] != "placeholder":
            continue
        print(f"{e['status']:12s} {e['kind']:8s} {e['path']}  ⟶  {e['prompt']}")


def cmd_done(a):
    mpath = os.path.join(a.root, MANIFEST)
    m = load_manifest(mpath)
    hit = False
    for e in m["assets"]:
        if e["path"] == os.path.normpath(a.path):
            e["status"] = "done"
            e["doneAt"] = int(time.time())
            hit = True
    save_manifest(mpath, m)
    print("done" if hit else "not in manifest", a.path)


def cmd_fill_brief(a):
    m = load_manifest(os.path.join(a.root, MANIFEST))
    pending = [e for e in m["assets"] if e["status"] == "placeholder"]
    print(f"{len(pending)} placeholder(s) to fill (manifest: {os.path.join(a.root, MANIFEST)}):")
    for e in pending:
        extra = f" size {e['size']}" if e.get("size") else (f" {e['seconds']} s" if e.get("seconds") else "")
        print(f"- [{e['kind']}] {e['path']}{extra}: {e['prompt']}")
    print("For each: generate the real asset from its prompt, overwrite the SAME path (same format), then run: python3 .silent/tools/uydurma.py done --path <path>")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--root", default="assets/uydurma", help="folder that holds uydurma.json (default assets/uydurma)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("add"); s.add_argument("--kind", choices=KINDS, required=True); s.add_argument("--path", required=True); s.add_argument("--prompt", required=True); s.add_argument("--size"); s.add_argument("--seconds", type=float); s.set_defaults(fn=cmd_add)
    s = sub.add_parser("list"); s.add_argument("--pending", action="store_true"); s.set_defaults(fn=cmd_list)
    s = sub.add_parser("done"); s.add_argument("--path", required=True); s.set_defaults(fn=cmd_done)
    s = sub.add_parser("fill-brief"); s.set_defaults(fn=cmd_fill_brief)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
