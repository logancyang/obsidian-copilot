import { deriveProjectFolderName, sanitizeVaultPathSegment } from "@/projects/projectPaths";

// Mock dependencies required by projectPaths imports
jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ projectsFolder: "copilot-projects" })),
}));

describe("deriveProjectFolderName", () => {
  it("uses project name when available", () => {
    expect(deriveProjectFolderName("id-123", "My Project")).toBe("My Project");
  });

  it("falls back to project id when name is empty", () => {
    expect(deriveProjectFolderName("id-123", "")).toBe("id-123");
    expect(deriveProjectFolderName("id-123")).toBe("id-123");
  });

  it("falls back to project id when name is whitespace-only", () => {
    expect(deriveProjectFolderName("id-123", "   ")).toBe("id-123");
  });

  it("sanitizes special characters in project name", () => {
    const result = deriveProjectFolderName("id-1", "My/Project: v1");
    expect(result).not.toContain("/");
    expect(result).not.toContain(":");
    expect(result.length).toBeGreaterThan(0);
  });

  it('prefixes "unsupported" with underscore (reserved folder name)', () => {
    expect(deriveProjectFolderName("id-1", "unsupported")).toBe("_unsupported");
    expect(deriveProjectFolderName("id-1", "Unsupported")).toBe("_Unsupported");
    expect(deriveProjectFolderName("id-1", "UNSUPPORTED")).toBe("_UNSUPPORTED");
  });

  it("preserves CJK and emoji in project names", () => {
    expect(deriveProjectFolderName("id-1", "我的项目")).toBe("我的项目");
    expect(deriveProjectFolderName("id-1", "🎵 Music")).toContain("🎵");
  });
});

describe("folder name collision scenarios", () => {
  it('different names sanitize to the same folder: "a/b" and "a|b"', () => {
    // Both "/" and "|" are replaced with "_", so both produce "a_b"
    const name1 = sanitizeVaultPathSegment("a/b");
    const name2 = sanitizeVaultPathSegment("a|b");
    // Reason: demonstrates that collision detection in migration is necessary
    expect(name1).toBe(name2);
  });

  it("case-insensitive collision: MyProject vs myproject", () => {
    const name1 = sanitizeVaultPathSegment("MyProject");
    const name2 = sanitizeVaultPathSegment("myproject");
    // Reason: on macOS/Windows, these map to the same disk folder
    expect(name1.toLowerCase()).toBe(name2.toLowerCase());
    // But the raw sanitized values differ in case
    expect(name1).not.toBe(name2);
  });

  it("all-special-chars names collide at fallback underscore", () => {
    // "***" → "___", "???" → "___" — same result
    const name1 = sanitizeVaultPathSegment("***");
    const name2 = sanitizeVaultPathSegment("???");
    expect(name1).toBe(name2);
    expect(name1).toBe("___");
  });
});
