jest.mock("@/plusUtils", () => ({
  isSelfHostAccessValid: jest.fn(),
}));

import { getMiyoFolderName, getVaultRelativeMiyoPath } from "@/miyo/miyoUtils";

describe("getMiyoFolderName", () => {
  it("uses the vault folder name even when an adapter exposes an absolute path", () => {
    const folderName = getMiyoFolderName({
      vault: {
        getName: () => "graham-essays-main",
        adapter: {
          getBasePath: () => "\\\\Mac\\Home\\Downloads\\graham-essays-main",
        },
      },
    } as any);

    expect(folderName).toBe("graham-essays-main");
  });
});

describe("getVaultRelativeMiyoPath", () => {
  const buildApp = (vaultName: string) =>
    ({
      vault: {
        getName: () => vaultName,
      },
    }) as any;

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
