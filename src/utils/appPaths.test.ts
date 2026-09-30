import type { App } from "obsidian";
import { FileSystemAdapter, Platform } from "obsidian";
import * as path from "node:path";
import { md5 } from "@/utils/hash";
import { copilotAppDataDir, getVaultId } from "./appPaths";

describe("appPaths", () => {
  describe("copilotAppDataDir()", () => {
    it("is ~/.obsidian-copilot under the given home dir", () => {
      expect(copilotAppDataDir("/Users/me")).toBe(path.join("/Users/me", ".obsidian-copilot"));
    });

    it("throws the desktop-only error on non-desktop runtimes instead of a TypeError", () => {
      const platform = Platform as { isMobile: boolean };
      platform.isMobile = true;
      try {
        expect(() => copilotAppDataDir("/Users/me")).toThrow(/unavailable outside the desktop/);
      } finally {
        platform.isMobile = false;
      }
    });
  });

  describe("getVaultId()", () => {
    const appWith = (adapter: unknown): App => ({ vault: { adapter } }) as unknown as App;
    const FsAdapter = FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter;

    it("is the first 8 hex chars of md5(vaultBasePath) for a desktop adapter", () => {
      const app = appWith(new FsAdapter("/Users/me/My Vault"));
      expect(getVaultId(app)).toBe(md5("/Users/me/My Vault").slice(0, 8));
      expect(getVaultId(app)).toHaveLength(8);
    });

    it('falls back to "default" when the adapter is not a FileSystemAdapter', () => {
      const app = appWith({ getBasePath: () => "/unused" });
      expect(getVaultId(app)).toBe("default");
    });
  });

  it("does not require Node built-ins at module evaluation time", () => {
    const throwingIds = ["path", "node:path"];
    try {
      jest.isolateModules(() => {
        for (const id of throwingIds) {
          jest.doMock(id, () => {
            throw new Error(`eager require of ${id}`);
          });
        }
        expect(() => void jest.requireActual("./appPaths")).not.toThrow();
      });
    } finally {
      for (const id of throwingIds) jest.dontMock(id);
    }
  });
});
