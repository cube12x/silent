import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

/** Every column the TauriBackend writes must exist in the SQLite schema (all migrations applied). */
describe("sqlite schema vs repositories", () => {
  const dir = join(here, "../../src-tauri/migrations")
  const sql = readdirSync(dir).sort().map((f: string) => readFileSync(join(dir, f), "utf8")).join("\n")
  const tables = new Map<string, Set<string>>()
  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\);/g)) {
    const cols = String(m[2]).split("\n").map((l: string) => l.trim()).filter((l: string) => l && !/^(PRIMARY|CREATE)/.test(l)).map((l: string) => l.split(/\s+/)[0])
    tables.set(m[1], new Set(cols))
  }
  for (const m of sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)) tables.get(m[1])?.add(m[2])
  const backend = readFileSync(join(here, "tauriBackend.ts"), "utf8")

  it("has every inserted column", () => {
    for (const m of backend.matchAll(/INSERT (?:OR REPLACE )?INTO (\w+) \(([^)]*)\)/g)) {
      const cols = String(m[2]).split(",").map((c: string) => c.trim())
      const missing = cols.filter((c) => !tables.get(m[1])?.has(c))
      expect(missing, `table ${m[1]}`).toEqual([])
    }
  })
})
