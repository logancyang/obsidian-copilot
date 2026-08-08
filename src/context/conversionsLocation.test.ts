import type { App } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import * as path from "node:path";
import { getVaultId } from "@/utils/appPaths";
import { md5 } from "@/utils/hash";
import { cacheRoot, filesDir, markersDir, remotesDir } from "./conversionsLocation";

// The jsdom mock's FileSystemAdapter takes a base path; the real obsidian type
// declares a 0-arg constructor, so cast to build a hashable instance.
const FsAdapter = FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter;
const appWith = (basePath: string): App =>
  ({ vault: { adapter: new FsAdapter(basePath) } }) as unknown as App;

describe("conversionsLocation", () => {
  const app = appWith("/Users/me/My Vault");

  it("roots the cache at ~/.obsidian-copilot/vaults/<vaultId>/context-cache", () => {
    const root = cacheRoot(app);
    // The vaultId comes from the shared helper, so the two always agree.
    expect(
      root.endsWith(path.join(".obsidian-copilot", "vaults", getVaultId(app), "context-cache"))
    ).toBe(true);
  });

  it("derives every subdirectory from the single cacheRoot (layout §2)", () => {
    const root = cacheRoot(app);
    expect(remotesDir(app)).toBe(path.join(root, "remotes"));
    expect(filesDir(app)).toBe(path.join(root, "files"));
    expect(markersDir(app, "proj-1")).toBe(path.join(root, "markers", md5("proj-1")));
  });

  it("buckets failure markers by md5(projectId), not the raw id", () => {
    const dir = markersDir(app, "proj-1");
    expect(path.basename(dir)).toBe(md5("proj-1"));
    expect(dir).not.toContain("proj-1");
  });
});
