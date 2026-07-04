import type { App } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import * as path from "node:path";
import { md5 } from "@/utils/hash";
import { COPILOT_APP_DIR_NAME, copilotAppDataDir, getVaultId } from "./appPaths";

describe("copilotAppDataDir", () => {
  it("is ~/.obsidian-copilot under the given home dir", () => {
    expect(copilotAppDataDir("/Users/me")).toBe(path.join("/Users/me", ".obsidian-copilot"));
  });

  it("uses the dotted, obsidian-prefixed namespace (not ~/.copilot)", () => {
    expect(COPILOT_APP_DIR_NAME).toBe(".obsidian-copilot");
    // Guard against a regression to the GitHub-Copilot-CLI-colliding name.
    expect(COPILOT_APP_DIR_NAME).not.toBe(".copilot");
  });
});

describe("getVaultId", () => {
  const appWith = (adapter: unknown): App => ({ vault: { adapter } }) as unknown as App;
  // The jsdom mock's FileSystemAdapter takes a base path; the real obsidian
  // type declares a 0-arg constructor, so cast to build a hashable instance.
  const FsAdapter = FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter;

  it("is the first 8 hex chars of md5(vaultBasePath) for a desktop adapter", () => {
    const app = appWith(new FsAdapter("/Users/me/My Vault"));
    expect(getVaultId(app)).toBe(md5("/Users/me/My Vault").slice(0, 8));
    expect(getVaultId(app)).toHaveLength(8);
  });

  it("stays equivalent to the legacy inline computation it replaced", () => {
    const basePath = "/vault";
    const app = appWith(new FsAdapter(basePath));
    // The exact expression previously inlined in agentMode/index.ts.
    const legacy = basePath ? md5(basePath).slice(0, 8) : "default";
    expect(getVaultId(app)).toBe(legacy);
  });

  it('falls back to "default" when the adapter is not a FileSystemAdapter', () => {
    // e.g. mobile / in-memory adapters expose no stable absolute base path.
    const app = appWith({ getBasePath: () => "/unused" });
    expect(getVaultId(app)).toBe("default");
  });
});
