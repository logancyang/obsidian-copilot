jest.mock("@/plusUtils", () => ({
  isSelfHostAccessValid: jest.fn(),
}));

import { getMiyoFilePath, getMiyoFolderName, getVaultRelativeMiyoPath } from "@/miyo/miyoUtils";
import type { App } from "obsidian";

describe("getMiyoFolderName", () => {
  it("uses the vault folder name even when an adapter exposes an absolute path", () => {
    const folderName = getMiyoFolderName({
      vault: {
        getName: () => "graham-essays-main",
        adapter: {
          getBasePath: () => "\\\\Mac\\Home\\Downloads\\graham-essays-main",
        },
      },
    } as unknown as App);

    expect(folderName).toBe("graham-essays-main");
  });
});

describe("getVaultRelativeMiyoPath", () => {
  const buildApp = (vaultName: string) =>
    ({
      vault: {
        getName: () => vaultName,
      },
    }) as unknown as App;

  it("strips the current vault folder-name prefix", () => {
    expect(getVaultRelativeMiyoPath(buildApp("MyVault"), "MyVault/notes/foo.md")).toBe(
      "notes/foo.md"
    );
  });

  it("returns the normalized path unchanged when the prefix matches a different vault", () => {
    expect(getVaultRelativeMiyoPath(buildApp("MyVault"), "OtherVault/notes/foo.md")).toBe(
      "OtherVault/notes/foo.md"
    );
  });

  it("normalizes separators even when the prefix does not match", () => {
    expect(getVaultRelativeMiyoPath(buildApp("MyVault"), "OtherVault\\notes\\foo.md")).toBe(
      "OtherVault/notes/foo.md"
    );
  });

  it("only strips the leading prefix once", () => {
    expect(getVaultRelativeMiyoPath(buildApp("Test"), "Test/Test/foo.md")).toBe("Test/foo.md");
  });

  it("normalizes backslash separators before stripping", () => {
    expect(getVaultRelativeMiyoPath(buildApp("MyVault"), "MyVault\\notes\\foo.md")).toBe(
      "notes/foo.md"
    );
  });

  it("returns the normalized path when the vault folder name is empty", () => {
    expect(getVaultRelativeMiyoPath(buildApp(""), "notes\\foo.md")).toBe("notes/foo.md");
  });
});

describe("getMiyoFilePath", () => {
  const buildApp = (vaultName: string) =>
    ({
      vault: {
        getName: () => vaultName,
      },
    }) as unknown as App;

  it("prefixes the vault folder name to a vault-relative path", () => {
    expect(getMiyoFilePath(buildApp("MyVault"), "notes/foo.md")).toBe("MyVault/notes/foo.md");
  });

  it("normalizes backslash separators before prefixing", () => {
    expect(getMiyoFilePath(buildApp("MyVault"), "notes\\foo.md")).toBe("MyVault/notes/foo.md");
  });

  it("strips a leading slash from the input so the result has no duplicate separator", () => {
    expect(getMiyoFilePath(buildApp("MyVault"), "/notes/foo.md")).toBe("MyVault/notes/foo.md");
  });

  it("round-trips with getVaultRelativeMiyoPath", () => {
    const app = buildApp("MyVault");
    const original = "notes/foo.md";
    expect(getVaultRelativeMiyoPath(app, getMiyoFilePath(app, original))).toBe(original);
  });

  it("returns the normalized path when the vault folder name is empty", () => {
    expect(getMiyoFilePath(buildApp(""), "notes/foo.md")).toBe("notes/foo.md");
  });
});
