import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createNodeContextCacheFs } from "./contextCacheFs";

describe("contextCacheFs", () => {
  describe("createNodeContextCacheFs()", () => {
    let parent: string;
    let root: string;

    beforeEach(async () => {
      parent = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ctx-cache-fs-"));
      root = path.join(parent, "context-cache");
      await fs.promises.mkdir(root, { recursive: true });
    });

    afterEach(async () => {
      await fs.promises.rm(parent, { recursive: true, force: true });
    });

    it("writeText() stores content that readText() returns, leaving no temp file behind", async () => {
      const cache = createNodeContextCacheFs(root);
      await cache.mkdirRecursive("remotes");
      await cache.writeText("remotes/web-1.md", "hello");

      expect(await cache.readText("remotes/web-1.md")).toBe("hello");
      expect(await fs.promises.readdir(path.join(root, "remotes"))).toEqual(["web-1.md"]);
    });

    it("list() returns entry basenames and ignores in-progress temp files", async () => {
      const cache = createNodeContextCacheFs(root);
      await cache.mkdirRecursive("remotes");
      await cache.writeText("remotes/web-1.md", "a");
      await fs.promises.writeFile(path.join(root, "remotes", ".copilot-cache-tmp-web-2.md-7"), "x");

      expect(await cache.list("remotes")).toEqual(["web-1.md"]);
    });

    it("list() returns an empty array for a missing directory", async () => {
      const cache = createNodeContextCacheFs(root);
      expect(await cache.list("does-not-exist")).toEqual([]);
    });

    it("remove() resolves without error for a missing file", async () => {
      const cache = createNodeContextCacheFs(root);
      await expect(cache.remove("remotes/gone.md")).resolves.toBeUndefined();
    });

    it("writeText() rejects a path containing a parent-directory segment before touching the filesystem", async () => {
      const cache = createNodeContextCacheFs(root);
      await expect(cache.writeText("../escape.md", "x")).rejects.toThrow('".." segment');
      await expect(fs.promises.readdir(parent)).resolves.not.toContain("escape.md");
    });

    it("writeText() rejects an absolute path", async () => {
      const cache = createNodeContextCacheFs(root);
      await expect(cache.writeText(path.join(parent, "abs.md"), "x")).rejects.toThrow("absolute");
    });

    it("writeText() refuses to write the cache root itself and leaves no temp file in its parent", async () => {
      const cache = createNodeContextCacheFs(root);
      await expect(cache.writeText("", "x")).rejects.toThrow("cache root");
      expect(await fs.promises.readdir(parent)).toEqual(["context-cache"]);
    });

    it("exists() is false for a missing entry and true once it is written", async () => {
      const cache = createNodeContextCacheFs(root);
      expect(await cache.exists("remotes/web-1.md")).toBe(false);
      await cache.mkdirRecursive("remotes");
      await cache.writeText("remotes/web-1.md", "a");
      expect(await cache.exists("remotes/web-1.md")).toBe(true);
    });

    it("readText() rejects for a missing file", async () => {
      const cache = createNodeContextCacheFs(root);
      await expect(cache.readText("remotes/missing.md")).rejects.toBeDefined();
    });

    it("writeText() rejects and leaves the root empty when the target directory is missing", async () => {
      const cache = createNodeContextCacheFs(root);
      await expect(cache.writeText("remotes/web-1.md", "x")).rejects.toBeDefined();
      expect(await fs.promises.readdir(root)).toEqual([]);
    });

    it("clear() removes the cache root without touching its parent directory", async () => {
      const cache = createNodeContextCacheFs(root);
      await cache.mkdirRecursive("remotes");
      await cache.writeText("remotes/web-1.md", "a");
      const sibling = path.join(parent, "agent-chat-index.json");
      await fs.promises.writeFile(sibling, "{}");

      await cache.clear();

      expect(fs.existsSync(root)).toBe(false);
      expect(fs.existsSync(sibling)).toBe(true);
    });

    it("clear() resolves without error when the root is already gone", async () => {
      const cache = createNodeContextCacheFs(root);
      await fs.promises.rm(root, { recursive: true, force: true });
      await expect(cache.clear()).resolves.toBeUndefined();
    });
  });
});
