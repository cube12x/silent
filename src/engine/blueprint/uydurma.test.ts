import { describe, expect, it } from "vitest"
import { UYDURMA_TOOL_SOURCE, stubFillerPolicy, stubProducerPolicy } from "./uydurma"

describe("uydurma policies", () => {
  it("ships the python tool and names every kind in the producer policy", () => {
    expect(UYDURMA_TOOL_SOURCE).toMatch(/def cmd_add/)
    const p = stubProducerPolicy([{ kinds: ["image", "sfx", "music"], folder: "assets/uydurma" }])
    expect(p).toMatch(/uydurma\.py add --kind <image\|sfx\|music>/)
    expect(p).toMatch(/image \(\.png\), sfx \(\.wav\), music \(\.wav\)/)
    expect(p).toMatch(/Do NOT draw/)
    const f = stubFillerPolicy([{ kinds: ["image"], folder: "art/stubs" }])
    expect(f).toMatch(/--root art\/stubs fill-brief/)
    expect(f).toMatch(/done --path/)
  })
})
