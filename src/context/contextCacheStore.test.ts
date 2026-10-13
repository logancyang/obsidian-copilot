import { Mutex } from "async-mutex";
import { posix } from "node:path";

import type { ContextCacheFs } from "./contextCacheFs";
import {
  CACHE_SCHEMA_VERSION,
  materializeSources,
  parseSnapshotMeta,
  reconcileMarkers,
  type CacheEntryMeta,
  type ContextConverters,
  type MaterializeProgress,
  type RemoteSource,
} from "./contextCacheStore";

// Cache keys use the POSIX-relative ContextCacheFs contract on every host.
// https://github.com/logancyang/obsidian-copilot/issues/2967
const { join } = posix;

function memFs(seed: Record<string, string> = {}): ContextCacheFs & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    files,
    async exists(p) {
      return files.has(p);
    },
    async mkdirRecursive() {},
    async list(dir) {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      return [...files.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .filter((name) => !name.includes("/"));
    },
    async readText(p) {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return files.get(p)!;
    },
    async writeText(p, content) {
      files.set(p, content);
    },
    async remove(p) {
      files.delete(p);
    },
  };
}

const REMOTES_DIR = "/cache/remotes";
const MARKER_DIR = "/cache/markers/projA";
const MARKER_DIR_B = "/cache/markers/projB";
const DIRS = { remotesDir: REMOTES_DIR, markerDir: MARKER_DIR };
const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

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

function converters(overrides: Partial<ContextConverters> = {}): ContextConverters {
  return {
    fetchRemote: jest.fn(async (s: RemoteSource) => `content for ${s.url}`),
    ...overrides,
  };
}

const flushMicrotasks = () => new Promise((resolve) => window.setTimeout(resolve, 0));

describe("contextCacheStore", () => {
  describe("materializeSources()", () => {
    it("writes remote snapshots to remotesDir, named by source md5 and stamped with the schema version", async () => {
      const fs = memFs();
      const remotes: RemoteSource[] = [
        { type: "web", url: "https://a.com" },
        { type: "youtube", url: "https://youtu.be/x" },
      ];
      const { entries } = await materializeSources({
        ...DIRS,
        fs,
        converters: converters(),
        remotes,
        nowMs: T0,
      });

      expect(entries).toHaveLength(2);
      const written = [...fs.files.keys()];
      expect(written.filter((p) => p.startsWith(`${REMOTES_DIR}/`))).toHaveLength(2);

      const webEntry = entries.find((e) => e.type === "web")!;
      const body = fs.files.get(join(REMOTES_DIR, webEntry.cacheFileName))!;
      expect(webEntry.cacheFileName).toMatch(/^web-[0-9a-f]{32}\.md$/);
      expect(body).toContain("copilot-context-cache");
      expect(body).toContain('"schemaVersion":1');
      expect(body).toContain('"sourceUrl":"https://a.com"');
      expect(body).toContain("content for https://a.com");
    });

    it("cheap-skips an unchanged successful source indefinitely (no re-fetch)", async () => {
      const fs = memFs();
      const conv = converters();
      const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];

      await materializeSources({ ...DIRS, fs, converters: conv, remotes, nowMs: T0 });
      await materializeSources({ ...DIRS, fs, converters: conv, remotes, nowMs: T0 + 365 * DAY });

      expect(conv.fetchRemote).toHaveBeenCalledTimes(1);
    });

    it("re-materializes a snapshot whose schema version no longer matches (not cheap-skipped)", async () => {
      const fs = memFs();
      const conv = converters();
      const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];

      const { entries } = await materializeSources({ ...DIRS, fs, converters: conv, remotes, nowMs: T0 }); // prettier-ignore
      const key = join(REMOTES_DIR, entries[0].cacheFileName);
      fs.files.set(key, fs.files.get(key)!.replace('"schemaVersion":1', '"schemaVersion":999'));

      await materializeSources({ ...DIRS, fs, converters: conv, remotes, nowMs: T0 + DAY }); // prettier-ignore

      expect(conv.fetchRemote).toHaveBeenCalledTimes(2);
    });

    it("skips a brand-new source whose fetch fails (no file written) and writes a marker in markerDir", async () => {
      const fs = memFs();
      const failing = converters({
        fetchRemote: jest.fn(async () => {
          throw new Error("boom");
        }),
      });
      const { entries, failures, wantedMarkerNames } = await materializeSources({
        ...DIRS,
        fs,
        converters: failing,
        remotes: [{ type: "web", url: "https://a.com" }],
        nowMs: T0,
      });

      expect(entries).toHaveLength(0);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ source: "https://a.com", kind: "web", usedStaleSnapshot: false }); // prettier-ignore
      expect(failures[0].error).toContain("boom");
      const marker = [...fs.files.keys()].find((k) => k.includes("failed-web-"))!;
      expect(marker.startsWith(`${MARKER_DIR}/`)).toBe(true);
      expect(wantedMarkerNames.has(marker.slice(`${MARKER_DIR}/`.length))).toBe(true);
    });

    it("cheap-skips a known-bad remote on the next automatic run, still reporting its failure without item progress events", async () => {
      const fs = memFs();
      const failing = converters({
        fetchRemote: jest.fn(async () => {
          throw new Error("boom");
        }),
      });
      const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];
      await materializeSources({ ...DIRS, fs, converters: failing, remotes, nowMs: T0 }); // prettier-ignore
      const events: MaterializeProgress[] = [];
      const { failures, wantedMarkerNames } = await materializeSources({
        ...DIRS,
        fs,
        converters: failing,
        remotes,
        nowMs: T0 + 1,
        onProgress: (p) => events.push(p),
      });

      expect(failing.fetchRemote).toHaveBeenCalledTimes(1);
      expect(events.some((p) => p.phase.startsWith("item"))).toBe(false);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ source: "https://a.com", kind: "web", usedStaleSnapshot: false }); // prettier-ignore
      expect(failures[0].error).toContain("boom");
      const markerKey = [...fs.files.keys()].find((k) => k.includes("failed-web-"))!;
      expect(wantedMarkerNames.has(markerKey.slice(`${MARKER_DIR}/`.length))).toBe(true);
    });

    it("re-fetches a known-bad remote when forceRetryFailed is set", async () => {
      const fs = memFs();
      const failing = converters({
        fetchRemote: jest.fn(async () => {
          throw new Error("boom");
        }),
      });
      const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];
      await materializeSources({ ...DIRS, fs, converters: failing, remotes, nowMs: T0 }); // prettier-ignore
      await materializeSources({ ...DIRS, fs, converters: failing, remotes, nowMs: T0 + 1, forceRetryFailed: true }); // prettier-ignore

      expect(failing.fetchRemote).toHaveBeenCalledTimes(2);
    });

    it("keeps a newly-written failure marker wanted so a same-run reconcile can't delete it", async () => {
      const fs = memFs();
      const failing = converters({
        fetchRemote: jest.fn(async () => {
          throw new Error("boom");
        }),
      });
      const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];
      const { wantedMarkerNames } = await materializeSources({
        ...DIRS,
        fs,
        converters: failing,
        remotes,
        nowMs: T0,
      });
      const markerKey = [...fs.files.keys()].find((k) => k.includes("failed-web-"))!;
      expect(markerKey).toBeDefined();
      expect(wantedMarkerNames.has(markerKey.slice(`${MARKER_DIR}/`.length))).toBe(true);
      await reconcileMarkers(fs, MARKER_DIR, wantedMarkerNames);
      expect(fs.files.has(markerKey)).toBe(true);
    });

    it("clears the failure marker once a previously-failed source succeeds", async () => {
      const fs = memFs();
      const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];
      const failing = converters({
        fetchRemote: jest.fn(async () => {
          throw new Error("boom");
        }),
      });
      await materializeSources({ ...DIRS, fs, converters: failing, remotes, nowMs: T0 }); // prettier-ignore
      expect([...fs.files.keys()].some((k) => k.includes("failed-web-"))).toBe(true);

      const { entries, failures } = await materializeSources({
        ...DIRS,
        fs,
        converters: converters(),
        remotes,
        nowMs: T0 + 1,
        forceRetryFailed: true,
      });
      expect(entries).toHaveLength(1);
      expect(failures).toHaveLength(0);
      expect([...fs.files.keys()].some((k) => k.includes("failed-web-"))).toBe(false);
    });

    it("deduplicates repeated sources to a single cache file", async () => {
      const fs = memFs();
      const conv = converters();
      await materializeSources({
        ...DIRS,
        fs,
        converters: conv,
        remotes: [
          { type: "web", url: "https://a.com" },
          { type: "web", url: "https://a.com" },
        ],
        nowMs: T0,
      });
      expect(conv.fetchRemote).toHaveBeenCalledTimes(1);
      expect([...fs.files.keys()]).toHaveLength(1);
    });

    it("emits per-item onProgress for each loop with deduped totals", async () => {
      const fs = memFs();
      const progress: MaterializeProgress[] = [];
      await materializeSources({
        ...DIRS,
        fs,
        converters: converters(),
        remotes: [
          { type: "web", url: "https://a.com" },
          { type: "web", url: "https://a.com" },
          { type: "youtube", url: "https://youtu.be/x" },
        ],
        nowMs: T0,
        onProgress: (p) => progress.push(p),
      });

      expect(progress.filter((p) => p.phase === "prefetch")).toEqual([
        { phase: "prefetch", done: 0, total: 2 },
        { phase: "prefetch", done: 1, total: 2 },
        { phase: "prefetch", done: 2, total: 2 },
      ]);
    });

    it("emits itemStart/itemSettled only for sources that do work (cheap-skips stay silent)", async () => {
      const fs = memFs();
      const conv = converters();
      const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];
      const first: MaterializeProgress[] = [];
      await materializeSources({ ...DIRS, fs, converters: conv, remotes, nowMs: T0, onProgress: (p) => first.push(p) }); // prettier-ignore
      expect(first.filter((p) => p.phase === "itemStart")).toEqual([
        { phase: "itemStart", item: { kind: "web", source: "https://a.com" } },
      ]);
      expect(first.some((p) => p.phase === "itemSettled")).toBe(true);

      const second: MaterializeProgress[] = [];
      await materializeSources({ ...DIRS, fs, converters: conv, remotes, nowMs: T0 + 1, onProgress: (p) => second.push(p) }); // prettier-ignore
      expect(second.some((p) => p.phase.startsWith("item"))).toBe(false);
    });

    it("emits itemFailed (carrying the error) for a failed source, never itemSettled", async () => {
      const fs = memFs();
      const failing = converters({
        fetchRemote: jest.fn(async () => {
          throw new Error("boom");
        }),
      });
      const events: MaterializeProgress[] = [];
      await materializeSources({ ...DIRS, fs, converters: failing, remotes: [{ type: "web", url: "https://a.com" }], nowMs: T0, onProgress: (p) => events.push(p) }); // prettier-ignore
      expect(events.filter((p) => p.phase.startsWith("item")).map((p) => p.phase)).toEqual([
        "itemStart",
        "itemFailed",
      ]);
      const failed = events.find((p) => p.phase === "itemFailed");
      expect(failed?.phase).toBe("itemFailed");
      if (failed?.phase === "itemFailed") {
        expect(failed.item).toEqual({ kind: "web", source: "https://a.com" });
        expect(failed.failure.error).toContain("boom");
      }
    });

    it("fetches URLs in parallel — both are in flight before either settles", async () => {
      const fs = memFs();
      const gates: Record<string, () => void> = {};
      const inFlight: string[] = [];
      const conv = converters({
        fetchRemote: jest.fn(async (s: RemoteSource) => {
          inFlight.push(s.url);
          await new Promise<void>((resolve) => {
            gates[s.url] = resolve;
          });
          return `content ${s.url}`;
        }),
      });
      const done = materializeSources({ ...DIRS, fs, converters: conv, remotes: [{ type: "web", url: "https://a.com" }, { type: "web", url: "https://b.com" }], nowMs: T0 }); // prettier-ignore
      await flushMicrotasks();
      expect(new Set(inFlight)).toEqual(new Set(["https://a.com", "https://b.com"]));
      gates["https://a.com"]();
      gates["https://b.com"]();
      await done;
    });

    it("isolates a marker-write failure to its own source — the parallel run still resolves", async () => {
      const fs = memFs();
      const writeText = fs.writeText;
      fs.writeText = async (p: string, content: string) => {
        if (p.includes("failed-")) throw new Error("disk full");
        await writeText(p, content);
      };
      let releaseB!: () => void;
      const bGate = new Promise<void>((resolve) => {
        releaseB = resolve;
      });
      const conv = converters({
        fetchRemote: jest.fn(async (s: RemoteSource) => {
          if (s.url === "https://a.com") throw new Error("net down");
          await bGate;
          return `content ${s.url}`;
        }),
      });
      const events: MaterializeProgress[] = [];
      const done = materializeSources({ ...DIRS, fs, converters: conv, remotes: [{ type: "web", url: "https://a.com" }, { type: "web", url: "https://b.com" }], nowMs: T0, onProgress: (p) => events.push(p) }); // prettier-ignore
      await flushMicrotasks();
      releaseB();
      const result = await done;

      expect(result.failures.map((f) => f.source)).toEqual(["https://a.com"]);
      expect(result.entries.map((e) => e.source)).toEqual(["https://b.com"]);

      const itemPhasesFor = (url: string) =>
        events.filter((p) => "item" in p && p.item.source === url).map((p) => p.phase);
      expect(itemPhasesFor("https://a.com")).toEqual(["itemStart", "itemFailed"]);
      expect(itemPhasesFor("https://b.com")).toEqual(["itemStart", "itemSettled"]);
      const prefetch = events.filter((p) => p.phase === "prefetch");
      expect(prefetch[prefetch.length - 1]).toEqual({ phase: "prefetch", done: 2, total: 2 });
    });

    it("merges two projects cold-converting the same URL into one fetch; the second does not overwrite", async () => {
      const fs = memFs();
      const withSourceLock = sharedLock();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let fetchCount = 0;
      const conv = converters({
        fetchRemote: jest.fn(async (s: RemoteSource) => {
          fetchCount += 1;
          await gate;
          return `content #${fetchCount} for ${s.url}`;
        }),
      });
      const remotes: RemoteSource[] = [{ type: "web", url: "https://shared.com" }];

      const runA = materializeSources({ remotesDir: REMOTES_DIR, markerDir: MARKER_DIR, fs, converters: conv, remotes, nowMs: T0, withSourceLock }); // prettier-ignore
      await flushMicrotasks();
      const runB = materializeSources({ remotesDir: REMOTES_DIR, markerDir: MARKER_DIR_B, fs, converters: conv, remotes, nowMs: T0 + 1, withSourceLock }); // prettier-ignore
      await flushMicrotasks();
      release();
      const [resA, resB] = await Promise.all([runA, runB]);

      expect(conv.fetchRemote).toHaveBeenCalledTimes(1);
      expect(resA.entries).toHaveLength(1);
      expect(resB.entries).toHaveLength(1);
      const snapshots = [...fs.files.keys()].filter((k) => k.startsWith(`${REMOTES_DIR}/`));
      expect(snapshots).toHaveLength(1);
      expect(fs.files.get(snapshots[0])).toContain("content #1 for https://shared.com");
    });

    it("clears project A's marker once project B writes the shared snapshot (A cheap-skip hit)", async () => {
      const fs = memFs();
      const remotes: RemoteSource[] = [{ type: "web", url: "https://shared.com" }];

      const failing = converters({
        fetchRemote: jest.fn(async () => {
          throw new Error("down");
        }),
      });
      await materializeSources({ remotesDir: REMOTES_DIR, markerDir: MARKER_DIR, fs, converters: failing, remotes, nowMs: T0 }); // prettier-ignore
      const markerKey = [...fs.files.keys()].find((k) => k.startsWith(`${MARKER_DIR}/`))!;
      expect(markerKey).toBeDefined();

      await materializeSources({ remotesDir: REMOTES_DIR, markerDir: MARKER_DIR_B, fs, converters: converters(), remotes, nowMs: T0 + 1 }); // prettier-ignore
      expect([...fs.files.keys()].some((k) => k.startsWith(`${REMOTES_DIR}/`))).toBe(true);

      const conv = converters();
      const { failures } = await materializeSources({ remotesDir: REMOTES_DIR, markerDir: MARKER_DIR, fs, converters: conv, remotes, nowMs: T0 + 2 }); // prettier-ignore

      expect(conv.fetchRemote).not.toHaveBeenCalled();
      expect(failures).toHaveLength(0);
      expect(fs.files.has(markerKey)).toBe(false);
    });
  });

  describe("reconcileMarkers()", () => {
    it("deletes obsolete owned markers in markerDir but preserves unknown files", async () => {
      const fs = memFs({
        [join(MARKER_DIR, "failed-web-deadbeef01.json")]: "{}",
        [join(MARKER_DIR, "failed-youtube-cafe02.json")]: "{}",
        [join(MARKER_DIR, "user-notes.md")]: "not ours",
      });
      const wanted = new Set(["failed-youtube-cafe02.json"]);

      await reconcileMarkers(fs, MARKER_DIR, wanted);

      expect(fs.files.has(join(MARKER_DIR, "failed-web-deadbeef01.json"))).toBe(false);
      expect(fs.files.has(join(MARKER_DIR, "failed-youtube-cafe02.json"))).toBe(true);
      expect(fs.files.has(join(MARKER_DIR, "user-notes.md"))).toBe(true);
    });

    it("never touches shared snapshots — it only lists and prunes the marker dir", async () => {
      const fs = memFs({
        [join(REMOTES_DIR, "web-abc01.md")]: "shared snapshot",
        [join(MARKER_DIR, "failed-youtube-abc03.json")]: "{}",
      });

      await reconcileMarkers(fs, MARKER_DIR, new Set());

      expect(fs.files.has(join(REMOTES_DIR, "web-abc01.md"))).toBe(true);
      expect(fs.files.has(join(MARKER_DIR, "failed-youtube-abc03.json"))).toBe(false);
    });
  });

  describe("parseSnapshotMeta()", () => {
    const buildSnapshot = (meta: object): string =>
      `<!-- copilot-context-cache\n${JSON.stringify(meta)}\n-->\n\n# URL: x\n\ncontent\n`;

    const remoteMeta = (sourceUrl: string): CacheEntryMeta => ({
      schemaVersion: CACHE_SCHEMA_VERSION,
      sourceType: "web",
      sourceUrl,
      fetchedAt: "2026-01-01T00:00:00.000Z",
      fingerprint: `web:${sourceUrl}`,
    });

    it("parses a well-formed meta block", () => {
      const meta = remoteMeta("https://a.com/foo");
      expect(parseSnapshotMeta(buildSnapshot(meta))).toEqual(meta);
    });

    it("does not truncate the JSON on a '-->' inside the source URL", () => {
      const meta = remoteMeta("https://a.com/a-->b");
      expect(parseSnapshotMeta(buildSnapshot(meta))).toEqual(meta);
    });
  });
});
