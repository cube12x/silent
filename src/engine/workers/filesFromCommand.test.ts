import { describe, expect, it } from "vitest"
import { filesFromCommand } from "./CliWorker"

describe("filesFromCommand", () => {
  it("extracts heredoc, tee, cp/mv and sed -i targets", () => {
    expect(filesFromCommand("/bin/zsh -lc \"cat > src/presentation/audio.ts <<'EOF'\nx\nEOF\"")).toEqual(["src/presentation/audio.ts"])
    expect(filesFromCommand("mkdir -p a && cat > ./a/b.ts <<EOF")).toEqual(["a/b.ts"])
    expect(filesFromCommand("echo hi | tee -a notes.md")).toEqual(["notes.md"])
    expect(filesFromCommand("cp -R src/x.ts src/y.ts && mv a.txt docs/b.txt")).toEqual(["src/y.ts", "docs/b.txt"])
    expect(filesFromCommand("sed -i '' 's/a/b/' src/game/enemy.ts")).toEqual(["src/game/enemy.ts"])
  })
  it("ignores reads, /dev/null and tmp", () => {
    expect(filesFromCommand("cat package.json")).toEqual([])
    expect(filesFromCommand("npm run build > /dev/null 2>&1")).toEqual([])
    expect(filesFromCommand("cat > /tmp/x.py <<EOF")).toEqual([])
  })
})
