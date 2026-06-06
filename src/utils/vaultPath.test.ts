import { isAbsolutePath, toVaultRelative } from "@/utils/vaultPath";

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

  it("does not treat a sibling vault as inside (path-segment boundary)", () => {
    expect(toVaultRelative("/Users/me/vault-other/x.md", base)).toBe("/Users/me/vault-other/x.md");
  });
});

describe("isAbsolutePath", () => {
  it("detects POSIX absolute paths", () => {
    expect(isAbsolutePath("/Users/me/vault/a.md")).toBe(true);
  });

  it("detects Windows drive-letter absolute paths", () => {
    expect(isAbsolutePath("C:\\Users\\me\\a.md")).toBe(true);
    expect(isAbsolutePath("C:/Users/me/a.md")).toBe(true);
  });

  it("treats relative paths as not absolute", () => {
    expect(isAbsolutePath("notes/a.md")).toBe(false);
    expect(isAbsolutePath("Some Note")).toBe(false);
  });
});
