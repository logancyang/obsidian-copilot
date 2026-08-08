import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createNodeContextCacheFs } from "./contextCacheFs";

describe("createNodeContextCacheFs", () => {
  let parent: string;
  let root: string;

  beforeEach(async () => {
    // `parent` stands in for `vaults/<id>/`; `root` is the cache dir inside it.
    parent = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ctx-cache-fs-"));
    root = path.join(parent, "context-cache");
    await fs.promises.mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(parent, { recursive: true, force: true });
  });

  it("writes atomically and reads back the content (no temp left behind)", async () => {
    const cache = createNodeContextCacheFs(root);
    await cache.mkdirRecursive("remotes");
    await cache.writeText("remotes/web-1.md", "hello");

    expect(await cache.readText("remotes/web-1.md")).toBe("hello");
    // Only the final file — the staging temp must have been renamed away.
    expect(await fs.promises.readdir(path.join(root, "remotes"))).toEqual(["web-1.md"]);
  });

  it("list returns basenames and ignores in-progress temp files", async () => {
    const cache = createNodeContextCacheFs(root);
    await cache.mkdirRecursive("remotes");
    await cache.writeText("remotes/web-1.md", "a");
    // Simulate a temp left by a crashed/concurrent write.
    await fs.promises.writeFile(path.join(root, "remotes", ".copilot-cache-tmp-web-2.md-7"), "x");

    expect(await cache.list("remotes")).toEqual(["web-1.md"]);
  });

  it("list returns [] for a missing directory", async () => {
    const cache = createNodeContextCacheFs(root);
    expect(await cache.list("does-not-exist")).toEqual([]);
  });

  it("remove is idempotent on a missing file", async () => {
    const cache = createNodeContextCacheFs(root);
    await expect(cache.remove("remotes/gone.md")).resolves.toBeUndefined();
  });

  it("rejects a `..` segment before touching the filesystem (root-confined)", async () => {
    const cache = createNodeContextCacheFs(root);
    await expect(cache.writeText("../escape.md", "x")).rejects.toThrow('".." segment');
    // The escape target must not have been created in the parent.
    await expect(fs.promises.readdir(parent)).resolves.not.toContain("escape.md");
  });

  it("rejects an absolute path", async () => {
    const cache = createNodeContextCacheFs(root);
    await expect(cache.writeText(path.join(parent, "abs.md"), "x")).rejects.toThrow("absolute");
  });

  it("refuses to write the cache root itself (no temp leaks into the parent)", async () => {
    const cache = createNodeContextCacheFs(root);
    await expect(cache.writeText("", "x")).rejects.toThrow("cache root");
    // Nothing staged into the parent `vaults/<id>/` stand-in.
    expect(await fs.promises.readdir(parent)).toEqual(["context-cache"]);
  });

  it("exists returns false for a missing entry and true for a written one", async () => {
    const cache = createNodeContextCacheFs(root);
    expect(await cache.exists("remotes/web-1.md")).toBe(false);
    await cache.mkdirRecursive("remotes");
    await cache.writeText("remotes/web-1.md", "a");
    expect(await cache.exists("remotes/web-1.md")).toBe(true);
  });

  it("readText surfaces a missing-file error (symmetric with the vault adapter)", async () => {
    const cache = createNodeContextCacheFs(root);
    await expect(cache.readText("remotes/missing.md")).rejects.toBeDefined();
  });

  it("write throws (does not swallow) when the target directory is missing", async () => {
    const cache = createNodeContextCacheFs(root);
    // No mkdir for `remotes` → staging the temp fails. The error must surface
    // so the caller records a per-source failure instead of a silent success.
    await expect(cache.writeText("remotes/web-1.md", "x")).rejects.toBeDefined();
    // And no half-written temp is left lingering at the root.
    expect(await fs.promises.readdir(root)).toEqual([]);
  });

  it("clear wipes the cache root but never ascends to the parent vault dir", async () => {
    const cache = createNodeContextCacheFs(root);
    await cache.mkdirRecursive("remotes");
    await cache.writeText("remotes/web-1.md", "a");
    // A sibling of `root` standing in for `agent-chat-index.json`.
    const sibling = path.join(parent, "agent-chat-index.json");
    await fs.promises.writeFile(sibling, "{}");

    await cache.clear();

    expect(fs.existsSync(root)).toBe(false);
    expect(fs.existsSync(sibling)).toBe(true);
  });

  it("clear on an already-missing root is a no-op", async () => {
    const cache = createNodeContextCacheFs(root);
    await fs.promises.rm(root, { recursive: true, force: true });
    await expect(cache.clear()).resolves.toBeUndefined();
  });
});
