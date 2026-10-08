import { describe, expect, it } from "vitest"
import { newMindModel } from "@/domain"
import { resolveMind } from "./resolve"

const models = [newMindModel({ id: "mind_1", name: "Işık Zihni", now: 1 }), newMindModel({ id: "mind_2", name: "Deneme", now: 1 })]

describe("resolveMind", () => {
  it("matches by id, then by folded name", () => {
    expect(resolveMind(models, "mind_2")?.name).toBe("Deneme")
    expect(resolveMind(models, "deneme")?.id).toBe("mind_2")
    expect(resolveMind(models, "IŞIK ZİHNİ".normalize("NFC"))?.id).toBe("mind_1")
    expect(resolveMind(models, "")).toBeUndefined()
    expect(resolveMind(models, "yok")).toBeUndefined()
  })
})
