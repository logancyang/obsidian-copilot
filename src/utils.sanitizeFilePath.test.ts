import { sanitizeFilePath } from "@/utils";

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

describe("utils", () => {
  describe("sanitizeFilePath()", () => {
    it("returns a nested path unchanged when its basename is within 255 bytes", () => {
      expect(sanitizeFilePath("folder/short-name.md")).toBe("folder/short-name.md");
    });

    it("returns a root-level path unchanged when its basename is within 255 bytes", () => {
      expect(sanitizeFilePath("readme.md")).toBe("readme.md");
    });

    it("truncates an over-long basename to 255 bytes and keeps the folder and extension", () => {
      const result = sanitizeFilePath(`a/b/c/d/${"x".repeat(300)}.canvas`);
      const parts = result.split("/");

      expect(parts.slice(0, -1).join("/")).toBe("a/b/c/d");
      expect(utf8Bytes(parts[parts.length - 1])).toBeLessThanOrEqual(255);
      expect(result.endsWith(".canvas")).toBe(true);
    });

    it("truncates an over-long basename that has no extension", () => {
      expect(utf8Bytes(sanitizeFilePath("a".repeat(300)))).toBeLessThanOrEqual(255);
    });

    it("measures multi-byte Cyrillic names in bytes, not characters", () => {
      const longName =
        "Интервью_О._Югина_глобальные_кризисы_экономика_США_Китая_России_AI_и_инвестиции.md";
      const result = sanitizeFilePath(`Документы/Library/${longName}`);

      expect(utf8Bytes(result.split("/").pop()!)).toBeLessThanOrEqual(255);
      expect(result.startsWith("Документы/Library/")).toBe(true);
      expect(result.endsWith(".md")).toBe(true);
    });

    it("does not split a surrogate pair when truncating emoji names", () => {
      const result = sanitizeFilePath(`${"\u{1F600}".repeat(80)}.md`);

      expect(utf8Bytes(result)).toBeLessThanOrEqual(255);
      expect(result.endsWith(".md")).toBe(true);
      expect(result).not.toContain("�");
    });
  });
});
