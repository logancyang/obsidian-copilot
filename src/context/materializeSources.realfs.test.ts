import { Mutex } from "async-mutex";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createNodeContextCacheFs } from "./contextCacheFs";
import {
  cacheFileName,
  materializeSources,
  type ContextConverters,
  type FileSource,
  type RemoteSource,
} from "./contextCacheStore";

describe("materializeSources.realfs", () => {
  describe("materializeSources()", () => {
    let parent: string;
    let root: string;

    const REMOTES = "remotes";
    const FILES = "files";
    const MARKERS_A = "markers/projA";
    const MARKERS_B = "markers/projB";
    const T0 = 1_700_000_000_000;

    beforeEach(async () => {
      parent = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ctx-cache-e2e-"));
      root = path.join(parent, "context-cache");
      await fs.promises.mkdir(root, { recursive: true });
    });

    afterEach(async () => {
      await fs.promises.rm(parent, { recursive: true, force: true });
    });

    function sharedLock(): <T>(key: string, run: () => Promise<T>) => Promise<T> {
      const mutexes = new Map<string, Mutex>();
      return (key, run) => {
        let mutex = mutexes.get(key);
        if (!mutex) {
          mutex = new Mutex();
          mutexes.set(key, mutex);
        }
        return mutex.runExclusive(run);
      };
    }

    const onDisk = (rel: string): string[] => {
      try {
        return fs.readdirSync(path.join(root, rel)).sort();
      } catch {
        return [];
      }
    };

    it("on the real filesystem, stores a URL shared by two projects as one remotes/web-<md5>.md fetched once", async () => {
      const url = "https://shared.example.com/page";
      const remotes: RemoteSource[] = [{ type: "web", url }];
      const fetchRemote = jest.fn(async (s: RemoteSource) => `content for ${s.url}`);
      const converters: ContextConverters = { fetchRemote, parseFile: jest.fn() };
      const withSourceLock = sharedLock();

      const cacheA = createNodeContextCacheFs(root);
      const resA = await materializeSources({
      remotesDir: REMOTES, filesDir: FILES, markerDir: MARKERS_A,
      fs: cacheA, converters, remotes, files: [], nowMs: T0, withSourceLock,
    }); // prettier-ignore

      const expectedName = cacheFileName("web", url);
      expect(onDisk(REMOTES)).toEqual([expectedName]);
      expect(expectedName).toMatch(/^web-[0-9a-f]{32}\.md$/);
      expect(resA.entries).toHaveLength(1);

      const cacheB = createNodeContextCacheFs(root);
      const resB = await materializeSources({
      remotesDir: REMOTES, filesDir: FILES, markerDir: MARKERS_B,
      fs: cacheB, converters, remotes, files: [], nowMs: T0 + 1, withSourceLock,
    }); // prettier-ignore

      expect(fetchRemote).toHaveBeenCalledTimes(1);
      expect(onDisk(REMOTES)).toEqual([expectedName]);
      expect(resB.entries).toHaveLength(1);
      expect(fs.readFileSync(path.join(root, REMOTES, expectedName), "utf-8")).toContain(
        `content for ${url}`
      );
    });

    it("on the real filesystem, stores a PDF shared by two projects as one files/file-<md5>.md parsed once", async () => {
      const vaultPath = "Shared/report.pdf";
      const parseFile = jest.fn(async (_bytes: ArrayBuffer, ext: string) => `parsed ${ext}`);
      const converters: ContextConverters = { fetchRemote: jest.fn(), parseFile };
      const withSourceLock = sharedLock();
      const makeFile = (): FileSource => ({
        vaultPath,
        ext: "pdf",
        mtime: 1000,
        size: 2048,
        read: async () => new ArrayBuffer(8),
      });

      await materializeSources({
      remotesDir: REMOTES, filesDir: FILES, markerDir: MARKERS_A,
      fs: createNodeContextCacheFs(root), converters, remotes: [], files: [makeFile()], nowMs: T0, withSourceLock,
    }); // prettier-ignore
      const expectedName = cacheFileName("file", vaultPath);
      expect(onDisk(FILES)).toEqual([expectedName]);

      await materializeSources({
      remotesDir: REMOTES, filesDir: FILES, markerDir: MARKERS_B,
      fs: createNodeContextCacheFs(root), converters, remotes: [], files: [makeFile()], nowMs: T0 + 1, withSourceLock,
    }); // prettier-ignore

      expect(parseFile).toHaveBeenCalledTimes(1);
      expect(onDisk(FILES)).toEqual([expectedName]);
    });
  });
});
