import { describe, expect, it } from "vitest"
import { parseDusunce, parseEylemBlock, parseHatirla, parseSonuc, stripEylem } from "./parse"

describe("parseDusunce", () => {
  it("splits the leading DÜŞÜNCE block from the answer", () => {
    const r = parseDusunce("DÜŞÜNCE:\n- önce README\n- sonra Eylem'e\n\nCevap burada.\n\nEYLEM:\n1. x")
    expect(r.thought).toBe("- önce README\n- sonra Eylem'e")
    expect(r.rest).toBe("Cevap burada.\n\nEYLEM:\n1. x")
    expect(parseDusunce("**DÜŞÜNCE:**\n- a\n\nb").thought).toBe("- a")
    expect(parseDusunce("düz cevap")).toEqual({ rest: "düz cevap" })
    expect(parseDusunce("DÜŞÜNCE:\n- sadece düşünce")).toEqual({ thought: "- sadece düşünce", rest: "" })
  })
})

describe("parseEylemBlock", () => {
  it("reads numbered steps and the return line", () => {
    const text = "Atarus sineması şu an üç film gösteriyor olabilir.\n\nEYLEM:\n1. https://atarus.example/sinema adresini aç\n2. Vizyondaki filmleri ve seansları listele\nDÖNÜŞ: film adı, seans saatleri, bilet fiyatı"
    const b = parseEylemBlock(text)
    expect(b?.steps).toEqual(["https://atarus.example/sinema adresini aç", "Vizyondaki filmleri ve seansları listele"])
    expect(b?.returns).toBe("film adı, seans saatleri, bilet fiyatı")
    expect(b?.raw.startsWith("EYLEM:")).toBe(true)
    expect(stripEylem(text)).toBe("Atarus sineması şu an üç film gösteriyor olabilir.")
  })
  it("reads a full work order: sections kept as lines, DOSYALAR paths collected", () => {
    const text = [
      "Kısa cevap.",
      "",
      "EYLEM:",
      "HEDEF: çalışan bir sayaç uygulaması",
      "DOSYALAR:",
      "- `src/counter.py` — sayaç mantığı — `Counter` sınıfı: `inc()`, `value` özelliği; negatif olmaz",
      "- src/main.py — giriş noktası — Counter'ı kurar, 3 kez artırır, değeri yazdırır",
      "- README.md — kullanım",
      "ADIMLAR:",
      "1. dosyaları yaz",
      "2. python3 src/main.py çalıştır",
      "KURALLAR:",
      "- yeni bağımlılık yok",
      "DOĞRULAMA:",
      "- python3 src/main.py → 3",
      "DÖNÜŞ: dosya listesi ve çıktı",
    ].join("\n")
    const b = parseEylemBlock(text)!
    expect(b.files).toEqual(["src/counter.py", "src/main.py", "README.md"])
    expect(b.steps[0]).toBe("HEDEF: çalışan bir sayaç uygulaması")
    expect(b.steps).toContain("DOSYALAR:")
    expect(b.steps).toContain("python3 src/main.py → 3")
    expect(b.returns).toBe("dosya listesi ve çıktı")
    expect(b.raw).toContain("KURALLAR:")
  })
  it("tolerates bold markers and bullets", () => {
    const b = parseEylemBlock("Önce bakayım.\n**EYLEM:**\n- **git pull** çalıştır\n- testleri koş\n**DÖNÜŞ:** test sonucu")
    expect(b?.steps).toEqual(["git pull çalıştır", "testleri koş"])
    expect(b?.returns).toBe("test sonucu")
  })
  it("ignores an EYLEM inside a code fence and answers without one", () => {
    expect(parseEylemBlock("Şöyle yazılır:\n```\nEYLEM:\n1. örnek\n```\nBu kadar.")).toBeUndefined()
    expect(parseEylemBlock("Sadece düşündüm, aksiyon gerekmez.")).toBeUndefined()
    expect(stripEylem("Şöyle yazılır:\n```\nEYLEM:\n1. örnek\n```\nBu kadar.")).toContain("Bu kadar.")
  })
  it("takes the last block when the mind wrote two", () => {
    const b = parseEylemBlock("EYLEM:\n1. eski\n\nDüzeltiyorum.\n\nEYLEM:\n1. yeni")
    expect(b?.steps).toEqual(["yeni"])
  })
})

describe("parseSonuc / parseHatirla", () => {
  it("returns the report body after # SONUÇ, or the whole text", () => {
    expect(parseSonuc("çalışıyorum…\n# SONUÇ\n3 film bulundu.")).toBe("3 film bulundu.")
    expect(parseSonuc("sadece metin")).toBe("sadece metin")
  })
  it("collects at most five facts and treats none as empty", () => {
    expect(parseHatirla("# HATIRLA\n- Kullanıcı İstanbul'da yaşıyor\n- Türkçe konuşmayı tercih ediyor\n")).toEqual(["Kullanıcı İstanbul'da yaşıyor", "Türkçe konuşmayı tercih ediyor"])
    expect(parseHatirla("**# HATIRLA**\nnone")).toEqual([])
    expect(parseHatirla("no header here")).toEqual([])
    expect(parseHatirla("# HATIRLA\n1. a\n2. b\n3. c\n4. d\n5. e\n6. f")).toHaveLength(5)
    expect(parseHatirla("# HATIRLA\n- a\n# SONRAKİ\n- b")).toEqual(["a"])
  })
})
