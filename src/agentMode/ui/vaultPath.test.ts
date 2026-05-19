import { toVaultRelative } from "@/agentMode/ui/vaultPath";

describe("toVaultRelative", () => {
  const base = "/Users/me/vault";

  it("converts an absolute path inside the vault to a relative path", () => {
    expect(toVaultRelative("/Users/me/vault/notes/a.md", base)).toBe("notes/a.md");
  });

  it("returns the original path when it is outside the vault", () => {
    expect(toVaultRelative("/Users/me/other/x.md", base)).toBe("/Users/me/other/x.md");
  });

  it("leaves already-relative paths unchanged", () => {
    expect(toVaultRelative("notes/a.md", base)).toBe("notes/a.md");
  });

  it("returns the original path when no vault base is known", () => {
    expect(toVaultRelative("/Users/me/vault/notes/a.md", null)).toBe("/Users/me/vault/notes/a.md");
  });

  it("returns the original path when input is empty", () => {
    expect(toVaultRelative("", base)).toBe("");
  });

  it("normalizes the vault root itself to an empty-segment fallback (returns original)", () => {
    expect(toVaultRelative("/Users/me/vault", base)).toBe("/Users/me/vault");
  });

  it("handles nested subdirectories", () => {
    expect(toVaultRelative("/Users/me/vault/a/b/c/d.md", base)).toBe("a/b/c/d.md");
  });
});
