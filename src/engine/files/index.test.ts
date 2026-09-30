import { describe, expect, it } from "vitest"
import { buildHeuristicIndex, groupAtlasFrames, guessCategory, mergeIndex, parseIndex, type FilesIndex } from "./index"

describe("files index heuristics", () => {
  it("guesses categories from names", () => {
    expect(guessCategory("hero")).toBe("karakterler")
    expect(guessCategory("murkcap")).toBe("karakterler")
    expect(guessCategory("brassbolt")).toBe("dusmanlar")
    expect(guessCategory("spiker")).toBe("dusmanlar")
    expect(guessCategory("items")).toBe("nesneler")
    expect(guessCategory("goldAcorn")).toBe("nesneler")
    expect(guessCategory("tiles")).toBe("arkaplanlar")
    expect(guessCategory("sky_clouds")).toBe("arkaplanlar")
    expect(guessCategory("whatever")).toBe("diger")
  })
  it("groups atlas frame names into prefix → anim → ordered frames", () => {
    const g = groupAtlasFrames(["murkcap_run_01", "murkcap_idle_00", "murkcap_idle_01", "murkcap_run_00", "brassbolt_idle_01", "star", "grass_dirt_a"])
    expect(g.murkcap.idle).toEqual(["murkcap_idle_00", "murkcap_idle_01"])
    expect(g.murkcap.run).toEqual(["murkcap_run_00", "murkcap_run_01"])
    expect(g.brassbolt.idle).toEqual(["brassbolt_idle_01"])
    // names without a numbered suffix are single-frame anims under their own prefix
    expect(g.star.idle).toEqual(["star"])
    expect(g.grass_dirt_a.idle).toEqual(["grass_dirt_a"])
  })
  it("builds items from atlases, images, audio and source folders", () => {
    const files = ["assets/converted/hero.png", "assets/converted/hero.json", "assets/converted/tiles.png", "assets/converted/tiles.json", "assets/sprites/photo.jpg", "assets/uydurma/sfx__jump.wav", "src/game/player/index.ts", "src/game/player/physics.ts", "src/render/index.ts", "README.md"].map((rel) => ({ rel }))
    const atlases = {
      "assets/converted/hero.json": { frames: [{ name: "murkcap_idle_00" }, { name: "murkcap_idle_01" }, { name: "murkcap_run_00" }] },
      "assets/converted/tiles.json": { frames: [{ name: "grass_dirt_a" }, { name: "cave_dirt" }] },
    }
    const idx = buildHeuristicIndex("/p", files, atlases, 1000)
    expect(idx.version).toBe(1)
    expect(idx.builtAt).toBe(1000)
    const murkcap = idx.items.find((i) => i.id === "atlas:hero:murkcap")!
    expect(murkcap.category).toBe("karakterler")
    expect(murkcap.files).toEqual(["assets/converted/hero.png", "assets/converted/hero.json"])
    expect(murkcap.previews[0]).toEqual({ kind: "atlas", file: "assets/converted/hero.png", json: "assets/converted/hero.json", anims: { idle: ["murkcap_idle_00", "murkcap_idle_01"], run: ["murkcap_run_00"] } })
    // a tiles atlas is one item (backgrounds), not one item per frame
    const tiles = idx.items.find((i) => i.id === "atlas:tiles")!
    expect(tiles.category).toBe("arkaplanlar")
    expect(tiles.previews[0].kind).toBe("atlas")
    const photo = idx.items.find((i) => i.id === "image:assets/sprites/photo.jpg")!
    expect(photo.category).toBe("diger")
    expect(photo.previews[0]).toEqual({ kind: "image", file: "assets/sprites/photo.jpg" })
    const sfx = idx.items.find((i) => i.id === "audio:assets/uydurma/sfx__jump.wav")!
    expect(sfx.category).toBe("sesler")
    const player = idx.items.find((i) => i.id === "code:src/game/player")!
    expect(player.category).toBe("sistemler")
    expect(player.files).toEqual(["src/game/player/index.ts", "src/game/player/physics.ts"])
    expect(idx.items.some((i) => i.files.includes("README.md"))).toBe(false)
  })
  it("lists 3D models as items without a preview, categorised by name", () => {
    const idx = buildHeuristicIndex("/p", [{ rel: "assets/models/alien_brute.glb" }, { rel: "assets/models/rifle.gltf" }], {}, 1)
    const alien = idx.items.find((i) => i.id === "model:assets/models/alien_brute.glb")!
    expect(alien.category).toBe("dusmanlar")
    expect(alien.previews).toEqual([])
    expect(idx.items.find((i) => i.id === "model:assets/models/rifle.gltf")?.category).toBe("nesneler")
  })
  it("suffixes items that share a title across atlases", () => {
    const files = ["a/hero.png", "a/hero.json", "b/hero2.png", "b/hero2.json"].map((rel) => ({ rel }))
    const frames = { frames: [{ name: "murkcap_idle_00" }, { name: "murkcap_idle_01" }] }
    const idx = buildHeuristicIndex("/p", files, { "a/hero.json": frames, "b/hero2.json": frames }, 1)
    expect(idx.items.map((i) => i.title).sort()).toEqual(["murkcap (hero)", "murkcap (hero2)"])
  })
  it("merge keeps AI-assigned category, title and extra files of items that still exist", () => {
    const prev: FilesIndex = { version: 1, builtAt: 1, root: "/p", items: [
      { id: "atlas:hero:murkcap", title: "Mario", category: "karakterler", files: ["assets/converted/hero.png", "src/game/player/index.ts"], previews: [], ai: true },
      { id: "image:gone.png", title: "gone", category: "diger", files: ["gone.png"], previews: [], ai: true },
    ] }
    const next: FilesIndex = { version: 1, builtAt: 2, root: "/p", items: [
      { id: "atlas:hero:murkcap", title: "murkcap", category: "diger", files: ["assets/converted/hero.png", "assets/converted/hero.json"], previews: [{ kind: "image", file: "assets/converted/hero.png" }] },
    ] }
    const merged = mergeIndex(prev, next)
    const m = merged.items[0]
    expect(m.title).toBe("Mario")
    expect(m.category).toBe("karakterler")
    expect(m.files).toEqual(["assets/converted/hero.png", "assets/converted/hero.json", "src/game/player/index.ts"])
    expect(m.previews.length).toBe(1)
    expect(m.ai).toBe(true)
    expect(merged.items.length).toBe(1)
    expect(merged.builtAt).toBe(2)
  })
  it("parseIndex validates shape and categories", () => {
    expect(parseIndex("nope")).toBeNull()
    expect(parseIndex(JSON.stringify({ version: 1, builtAt: 1, root: "/p", items: [{ id: "x", title: "x", category: "bogus", files: [], previews: [] }] }))).toBeNull()
    expect(parseIndex(JSON.stringify({ version: 1, builtAt: 1, root: "/p", items: [{ id: "x", title: "x", category: "sesler", files: ["a.wav"], previews: [] }] }))?.items[0].category).toBe("sesler")
  })
})
