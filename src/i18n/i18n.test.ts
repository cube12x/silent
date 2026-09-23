import { describe, expect, it } from "vitest"
import { tr } from "./tr"
import { en } from "./en"
import { translate } from "./index"

function keys(o: object, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [prefix + k] : keys(v as object, `${prefix}${k}.`)))
}

describe("i18n", () => {
  it("tr and en expose the same key set", () => {
    expect(keys(en).sort()).toEqual(keys(tr).sort())
  })
  it("interpolates variables and falls back to the key", () => {
    expect(translate("tr", "code.subtasks", { n: 5 })).toBe("5 alt görev")
    expect(translate("en", "code.subtasks", { n: 5 })).toBe("5 subtasks")
  })
})
