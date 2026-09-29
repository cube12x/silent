import { describe, expect, it } from "vitest"
import { UYDURMA_TOOL_SOURCE, stubFillerPolicy, stubProducerPolicy } from "./uydurma"

describe("uydurma policies", () => {
  it("ships the python tool and names every kind in the producer policy", () => {
    expect(UYDURMA_TOOL_SOURCE).toMatch(/def cmd_add/)
    const p = stubProducerPolicy([{ kinds: ["image", "sfx", "music"], folder: "assets/uydurma" }])
    expect(p).toMatch(/--root assets\/uydurma add --kind <image\|sfx\|music>/)
    const multi = stubProducerPolicy([{ kinds: ["sfx"], folder: "assets/ses" }, { kinds: ["model3d"], folder: "assets/model" }])
    expect(multi).toMatch(/--root assets\/ses add --kind <sfx>/)
    expect(multi).toMatch(/--root assets\/model add --kind <model3d>/)
    expect(p).toMatch(/image \(\.png\), sfx \(\.wav\), music \(\.wav\)/)
    expect(p).toMatch(/Do NOT draw/)
    const f = stubFillerPolicy([{ kinds: ["image"], folder: "art/stubs" }])
    expect(f).toMatch(/--root art\/stubs fill-brief/)
    expect(f).toMatch(/done --path/)
  })
})
