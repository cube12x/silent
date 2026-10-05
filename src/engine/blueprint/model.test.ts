import { describe, expect, it } from "vitest"
import type { ModelRequest } from "@/domain"
import { artDirectorBrief, buildSheetPrompt, converterBrief, expectedFiles, matchDelivery, modelManifest, parseModelRequests, probePng, slugName, totalFrames, validateDelivery } from "./model"

const reply = `Rationale: the player and the coin need real art.
# MODEL_REQUESTS
[
  {"name":"Mario Kardeş","kind":"sprite sheet","subject":"Mario, the player","animations":[{"name":"walk","frames":8},{"name":"Jump","frames":4}],"frameSize":"64x64","view":"side","codeHook":"src/player.ts"},
  {"name":"coin_pickup","kind":"audio","subject":"coin pickup sound"},
  {"name":"mario kardeş","kind":"sprite-sheet","subject":"dupe"},
  {"name":"mystery","kind":"hologram","subject":"unknown kind is dropped"},
  {"kind":"texture","subject":"Grass Tile","size":{"w":32,"h":32}}
]`

describe("Model Plus: parsing the art director's contract", () => {
  it("slugs names, normalises kinds and frame sizes, dedupes, drops unknown kinds, fills target and a sheet prompt", () => {
    const reqs = parseModelRequests(reply, { folder: "assets/model-plus", style: "16-bit pixel art" })
    expect(reqs.map((r) => r.name)).toEqual(["mario_kardes", "coin_pickup", "grass_tile"])
    const mario = reqs[0]!
    expect(mario.kind).toBe("sprite-sheet")
    expect(mario.animations).toEqual([{ name: "walk", frames: 8 }, { name: "jump", frames: 4 }])
    expect(mario.frameSize).toBe("64x64")
    expect(mario.target).toBe("assets/model-plus/mario_kardes")
    expect(mario.status).toBe("pending")
    expect(mario.codeHook).toBe("src/player.ts")
    expect(mario.sheetPrompt).toContain("2 row(s) × 8 column(s)")
    expect(mario.sheetPrompt).toContain("walk × 8; jump × 4")
    expect(mario.sheetPrompt).toContain("16-bit pixel art")
    expect(reqs[2]!.frameSize).toBe("32x32")
    expect(totalFrames(mario)).toBe(12)
  })
  it("tolerates no heading / garbage", () => {
    expect(parseModelRequests("nothing here", { folder: "a" })).toEqual([])
    expect(parseModelRequests("# MODEL_REQUESTS\n[ broken", { folder: "a" })).toEqual([])
    expect(parseModelRequests("```json\n[{\"name\":\"x\",\"kind\":\"image\",\"subject\":\"x\"}]\n```", { folder: "a" })).toHaveLength(1)
  })
  it("slugName handles Turkish letters", () => {
    expect(slugName("Çılgın Şövalye-2")).toBe("cilgin_sovalye_2")
  })
})

const mario: ModelRequest = { id: "mr_mario", name: "mario", kind: "sprite-sheet", subject: "Mario", animations: [{ name: "walk", frames: 2 }, { name: "jump", frames: 1 }], frameSize: "4x4", sheetPrompt: "p", target: "assets/model-plus/mario", status: "pending" }

describe("Model Plus: expected files, briefs and manifest", () => {
  it("expectedFiles lists frames + sheet + atlas for a sprite sheet, a single file otherwise", () => {
    expect(expectedFiles(mario)).toEqual(["assets/model-plus/mario/mario_walk_00.png", "assets/model-plus/mario/mario_walk_01.png", "assets/model-plus/mario/mario_jump_00.png", "assets/model-plus/mario/mario.png", "assets/model-plus/mario/mario.json"])
    expect(expectedFiles({ ...mario, kind: "audio", animations: undefined })).toEqual(["assets/model-plus/mario/mario.wav"])
  })
  it("the director brief is read-only and demands the heading; the converter brief owns the target and lists the files", () => {
    const d = artDirectorBrief({ digest: "src/player.ts", folder: "assets/model-plus", style: "pixel", kit: "pixel-art-game", uydurma: "{}" })
    expect(d).toMatch(/READ-ONLY/)
    expect(d).toContain("# MODEL_REQUESTS")
    expect(d).toContain("pixel-art-game")
    const c = converterBrief({ req: mario, deliveredRel: "assets/model-plus/inbox/mario.png", build: "/tmp/x", expected: expectedFiles(mario) })
    expect(c).toContain("--out assets/model-plus/mario")
    expect(c).toContain("--force")
    expect(c).toContain("mario_walk_00,mario_walk_01,mario_jump_00")
    expect(c).toContain("# MODEL_DELIVERY")
    expect(c).toContain("- assets/model-plus/mario/mario.json")
  })
  it("the manifest lists accepted assets, the atlas format and unresolved ones", () => {
    const m = modelManifest([{ ...mario, status: "accepted" }, { ...mario, id: "x", name: "coin", kind: "audio", animations: undefined, target: "assets/model-plus/coin", status: "rejected", reasons: ["missing: a.wav"] }])
    expect(m.startsWith("# MODEL\n- mario (sprite-sheet) → assets/model-plus/mario/mario.png + mario.json · frames: walk×2, jump×1 · 4x4")).toBe(true)
    expect(m).toContain("Atlas format")
    expect(m).toContain("# UNRESOLVED\n- coin (audio) rejected: missing: a.wav")
  })
  it("buildSheetPrompt for a texture asks for one tileable image", () => {
    expect(buildSheetPrompt({ ...mario, kind: "texture", animations: undefined, frameSize: "128x128" })).toMatch(/seamless\/tileable/)
  })
})

function png(width: number, height: number, colorType: number, trns = false): Uint8Array {
  const b: number[] = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  b.push(...u32(width), ...u32(height), 8, colorType, 0, 0, 0, 0, 0, 0, 0)
  if (trns) b.push(0, 0, 0, 1, 116, 82, 78, 83, 0, 0, 0, 0, 0)
  b.push(0, 0, 0, 0, 73, 68, 65, 84, 0, 0, 0, 0)
  return new Uint8Array(b)
}

describe("Model Plus: delivery matching and the deterministic validator", () => {
  const reqs: ModelRequest[] = [mario, { ...mario, id: "mr_goomba", name: "goomba", subject: "Goomba", status: "accepted" }, { ...mario, id: "mr_coin", name: "coin", kind: "audio", animations: undefined, status: "rejected" }]
  it("matchDelivery: --for wins (even accepted), else the longest name in the file name, else the first pending/rejected", () => {
    expect(matchDelivery(reqs, "sheet.png", "goomba")?.name).toBe("goomba")
    expect(matchDelivery(reqs, "Mario-Sheet-v2.png")?.name).toBe("mario")
    expect(matchDelivery(reqs, "goomba_final.png")?.name).toBe("mario") // accepted ones are not re-opened by name
    expect(matchDelivery(reqs, "random.png")?.name).toBe("mario")
    expect(matchDelivery([reqs[2]!], "random.wav")?.name).toBe("coin")
  })
  it("probePng reads size and alpha (RGBA, RGB+tRNS) and rejects non-PNG bytes", () => {
    expect(probePng(png(4, 4, 6))).toMatchObject({ width: 4, height: 4, hasAlpha: true })
    expect(probePng(png(4, 4, 2))).toMatchObject({ hasAlpha: false })
    expect(probePng(png(4, 4, 2, true))).toMatchObject({ hasAlpha: true })
    expect(probePng(new Uint8Array([1, 2, 3]))).toBeNull()
  })
  const good = () => {
    const files = new Set(expectedFiles(mario))
    const atlas = { frameW: 4, frameH: 4, columns: 2, frames: [{ name: "mario_walk_00", x: 0, y: 0, w: 4, h: 4 }, { name: "mario_walk_01", x: 4, y: 0, w: 4, h: 4 }, { name: "mario_jump_00", x: 0, y: 4, w: 4, h: 4 }] }
    const pngs = new Map<string, ReturnType<typeof probePng>>([
      ["assets/model-plus/mario/mario.png", probePng(png(8, 8, 6))],
      ["assets/model-plus/mario/mario_walk_00.png", probePng(png(4, 4, 6))],
      ["assets/model-plus/mario/mario_jump_00.png", probePng(png(4, 4, 6))],
    ])
    return { files, atlas, png: pngs }
  }
  it("accepts a complete, correctly sized, transparent delivery", () => {
    expect(validateDelivery(mario, good())).toEqual({ ok: true, reasons: [], warnings: [] })
  })
  it("rejects with precise reasons: missing frame, short animation, wrong size, no alpha", () => {
    const io = good()
    io.files.delete("assets/model-plus/mario/mario_walk_01.png")
    io.atlas.frames = io.atlas.frames.filter((f) => f.name !== "mario_walk_01")
    io.png.set("assets/model-plus/mario/mario.png", probePng(png(8, 8, 2)))
    io.png.set("assets/model-plus/mario/mario_jump_00.png", probePng(png(6, 4, 6)))
    const r = validateDelivery(mario, io)
    expect(r.ok).toBe(false)
    expect(r.reasons).toEqual(expect.arrayContaining(["missing: assets/model-plus/mario/mario_walk_01.png", "frames walk: 1/2 in the atlas", "sheet has no alpha channel (background not removed)", "mario_jump_00.png is 6x4, expected 4x4"]))
  })
  it("audio and 3D only need the file to exist (any allowed extension)", () => {
    const coin = reqs[2]!
    expect(validateDelivery(coin, { files: new Set(["assets/model-plus/mario/coin.ogg"]), atlas: null, png: new Map() }).ok).toBe(true)
    expect(validateDelivery(coin, { files: new Set(), atlas: null, png: new Map() }).reasons[0]).toBe("missing: assets/model-plus/mario/coin.(wav|ogg|mp3)")
  })
})
