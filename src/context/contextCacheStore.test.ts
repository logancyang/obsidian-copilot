import { Mutex } from "async-mutex";
import { join } from "node:path";
import type { ContextCacheFs } from "./contextCacheFs";
import {
  CACHE_SCHEMA_VERSION,
  materializeSources,
  parseSnapshotMeta,
  reconcileMarkers,
  type CacheEntryMeta,
  type ContextConverters,
  type FileSource,
  type MaterializeProgress,
  type RemoteSource,
} from "./contextCacheStore";

/** Minimal in-memory {@link ContextCacheFs} for deterministic, network-free tests. */
function memFs(seed: Record<string, string> = {}): ContextCacheFs & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    files,
    async exists(p) {
      return files.has(p);
    },
    async mkdirRecursive() {
      // no-op: the flat map needs no directories
    },
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

// Snapshots are shared vault-wide (remotes/files); markers are bucketed per
// project. Keep three distinct dirs so a misrouted write surfaces immediately.
const REMOTES_DIR = "/cache/remotes";
const FILES_DIR = "/cache/files";
const MARKER_DIR = "/cache/markers/projA";
const MARKER_DIR_B = "/cache/markers/projB";
const DIRS = { remotesDir: REMOTES_DIR, filesDir: FILES_DIR, markerDir: MARKER_DIR };
const T0 = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** A real per-artifact lock (mirrors the materializer's global injection). */
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
    parseFile: jest.fn(async (_bytes: ArrayBuffer, ext: string) => `parsed ${ext}`),
    ...overrides,
  };
}

function fileSource(over: Partial<FileSource> = {}): FileSource {
  return {
    vaultPath: "Proj/doc.pdf",
    ext: "pdf",
    mtime: 1000,
    size: 50,
    read: jest.fn(async () => new ArrayBuffer(8)),
    ...over,
  };
}

const flushMicrotasks = () => new Promise((resolve) => window.setTimeout(resolve, 0));

describe("materializeSources", () => {
  it("writes remote snapshots to remotesDir and file snapshots to filesDir", async () => {
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
      files: [fileSource()],
      nowMs: T0,
    });

    expect(entries).toHaveLength(3);
    // Remote snapshots live under remotesDir, the file snapshot under filesDir.
    const written = [...fs.files.keys()];
    expect(written.filter((p) => p.startsWith(`${REMOTES_DIR}/`))).toHaveLength(2);
    expect(written.filter((p) => p.startsWith(`${FILES_DIR}/`))).toHaveLength(1);

    const webEntry = entries.find((e) => e.type === "web")!;
    const body = fs.files.get(join(REMOTES_DIR, webEntry.cacheFileName))!;
    expect(body).toContain("copilot-context-cache");
    expect(body).toContain('"sourceUrl":"https://a.com"');
    expect(body).toContain("content for https://a.com");
  });

  it("names snapshots by md5 of the source (lowercase 32-hex)", async () => {
    const fs = memFs();
    const { entries } = await materializeSources({
      ...DIRS,
      fs,
      converters: converters(),
      remotes: [{ type: "web", url: "https://a.com" }],
      files: [],
      nowMs: T0,
    });
    // md5 hex is 32 lowercase chars — distinct from the old cyrb53 14-char hash.
    expect(entries[0].cacheFileName).toMatch(/^web-[0-9a-f]{32}\.md$/);
  });

  it("cheap-skips an unchanged successful source indefinitely (no re-fetch / re-parse)", async () => {
    const fs = memFs();
    const conv = converters();
    const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];
    const file = fileSource();

    await materializeSources({ ...DIRS, fs, converters: conv, remotes, files: [file], nowMs: T0 }); // prettier-ignore
    // Second pass far in the future: a successful snapshot has no TTL, so its
    // identity / fingerprint match still cheap-skips both the fetch and parse.
    await materializeSources({ ...DIRS, fs, converters: conv, remotes, files: [file], nowMs: T0 + 365 * DAY }); // prettier-ignore

    expect(conv.fetchRemote).toHaveBeenCalledTimes(1);
    expect(conv.parseFile).toHaveBeenCalledTimes(1);
  });

  it("stamps the cache schema version into written snapshots", async () => {
    const fs = memFs();
    const { entries } = await materializeSources({
      ...DIRS,
      fs,
      converters: converters(),
      remotes: [{ type: "web", url: "https://a.com" }],
      files: [],
      nowMs: T0,
    });
    expect(fs.files.get(join(REMOTES_DIR, entries[0].cacheFileName))!).toContain('"schemaVersion":1'); // prettier-ignore
  });

  it("re-materializes a snapshot whose schema version no longer matches (not cheap-skipped)", async () => {
    const fs = memFs();
    const conv = converters();
    const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];

    const { entries } = await materializeSources({ ...DIRS, fs, converters: conv, remotes, files: [], nowMs: T0 }); // prettier-ignore
    // Simulate a future format change: an on-disk snapshot from a different
    // schema version. The version gate must treat it as a miss, not cheap-skip.
    const key = join(REMOTES_DIR, entries[0].cacheFileName);
    fs.files.set(key, fs.files.get(key)!.replace('"schemaVersion":1', '"schemaVersion":999'));

    await materializeSources({ ...DIRS, fs, converters: conv, remotes, files: [], nowMs: T0 + DAY }); // prettier-ignore

    expect(conv.fetchRemote).toHaveBeenCalledTimes(2); // re-fetched, not skipped
  });

  it("re-parses a file when its mtime/size fingerprint changes", async () => {
    const fs = memFs();
    const conv = converters();

    await materializeSources({ ...DIRS, fs, converters: conv, remotes: [], files: [fileSource({ mtime: 1000, size: 50 })], nowMs: T0 }); // prettier-ignore
    await materializeSources({ ...DIRS, fs, converters: conv, remotes: [], files: [fileSource({ mtime: 2000, size: 50 })], nowMs: T0 }); // prettier-ignore

    expect(conv.parseFile).toHaveBeenCalledTimes(2);
  });

  it("keeps a stale file snapshot when a re-parse fails", async () => {
    const fs = memFs();
    const good = converters();
    await materializeSources({ ...DIRS, fs, converters: good, remotes: [], files: [fileSource({ mtime: 1000, size: 50 })], nowMs: T0 }); // prettier-ignore
    const fileName = [...fs.files.keys()].find((k) => k.includes("file-"))!;
    const staleBody = fs.files.get(fileName)!;

    const failing = converters({
      parseFile: jest.fn(async () => {
        throw new Error("bad parse");
      }),
    });
    const { entries, failures } = await materializeSources({
      ...DIRS,
      fs,
      converters: failing,
      remotes: [],
      files: [fileSource({ mtime: 2000, size: 99 })], // edited → re-parse attempted
      nowMs: T0 + 1,
    });

    expect(failing.parseFile).toHaveBeenCalledTimes(1);
    expect(entries).toHaveLength(1); // stale entry still counts as present
    expect(fs.files.get(fileName)).toBe(staleBody); // content untouched
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ source: "Proj/doc.pdf", kind: "file", usedStaleSnapshot: true }); // prettier-ignore
    expect(failures[0].error).toContain("bad parse");
    // No failure marker is written when a stale snapshot remains usable.
    expect([...fs.files.keys()].some((k) => k.includes("failed-"))).toBe(false);
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
      files: [],
      nowMs: T0,
    });

    expect(entries).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ source: "https://a.com", kind: "web", usedStaleSnapshot: false }); // prettier-ignore
    expect(failures[0].error).toContain("boom");
    // The marker lives under the per-project markerDir, and it is wanted so a
    // same-run reconcile keeps it (the status panel reads it to surface the error).
    const marker = [...fs.files.keys()].find((k) => k.includes("failed-web-"))!;
    expect(marker.startsWith(`${MARKER_DIR}/`)).toBe(true);
    expect(wantedMarkerNames.has(marker.slice(`${MARKER_DIR}/`.length))).toBe(true);
  });

  it("cheap-skips a known-bad remote on the next automatic run (no re-fetch) but still surfaces it", async () => {
    const fs = memFs();
    const failing = converters({
      fetchRemote: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];
    await materializeSources({ ...DIRS, fs, converters: failing, remotes, files: [], nowMs: T0 }); // prettier-ignore
    const { failures, wantedMarkerNames } = await materializeSources({
      ...DIRS,
      fs,
      converters: failing,
      remotes,
      files: [],
      nowMs: T0 + 1,
    });

    expect(failing.fetchRemote).toHaveBeenCalledTimes(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ source: "https://a.com", kind: "web", usedStaleSnapshot: false }); // prettier-ignore
    expect(failures[0].error).toContain("boom");
    const markerKey = [...fs.files.keys()].find((k) => k.includes("failed-web-"))!;
    expect(wantedMarkerNames.has(markerKey.slice(`${MARKER_DIR}/`.length))).toBe(true);
  });

  it("emits no itemStart/itemFailed for a cheap-skipped failed source", async () => {
    const fs = memFs();
    const failing = converters({
      fetchRemote: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];
    await materializeSources({ ...DIRS, fs, converters: failing, remotes, files: [], nowMs: T0 }); // prettier-ignore
    const events: MaterializeProgress[] = [];
    await materializeSources({ ...DIRS, fs, converters: failing, remotes, files: [], nowMs: T0 + 1, onProgress: (p) => events.push(p) }); // prettier-ignore
    expect(events.some((p) => p.phase.startsWith("item"))).toBe(false);
  });

  it("re-fetches a known-bad remote when forceRetryFailed is set", async () => {
    const fs = memFs();
    const failing = converters({
      fetchRemote: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];
    await materializeSources({ ...DIRS, fs, converters: failing, remotes, files: [], nowMs: T0 }); // prettier-ignore
    await materializeSources({ ...DIRS, fs, converters: failing, remotes, files: [], nowMs: T0 + 1, forceRetryFailed: true }); // prettier-ignore

    expect(failing.fetchRemote).toHaveBeenCalledTimes(2);
  });

  it("cheap-skips a known-bad file on the next automatic run while unchanged", async () => {
    const fs = memFs();
    const failing = converters({
      parseFile: jest.fn(async () => {
        throw new Error("bad parse");
      }),
    });
    const file = fileSource({ mtime: 1000, size: 50 });
    await materializeSources({ ...DIRS, fs, converters: failing, remotes: [], files: [file], nowMs: T0 }); // prettier-ignore
    const { failures } = await materializeSources({ ...DIRS, fs, converters: failing, remotes: [], files: [file], nowMs: T0 + 1 }); // prettier-ignore

    expect(failing.parseFile).toHaveBeenCalledTimes(1); // marker honored, no re-parse
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ source: "Proj/doc.pdf", kind: "file", usedStaleSnapshot: false }); // prettier-ignore
  });

  it("re-parses a known-bad file when its mtime/size fingerprint changes (marker stale)", async () => {
    const fs = memFs();
    const failing = converters({
      parseFile: jest.fn(async () => {
        throw new Error("bad parse");
      }),
    });
    await materializeSources({ ...DIRS, fs, converters: failing, remotes: [], files: [fileSource({ mtime: 1000, size: 50 })], nowMs: T0 }); // prettier-ignore
    await materializeSources({ ...DIRS, fs, converters: failing, remotes: [], files: [fileSource({ mtime: 2000, size: 99 })], nowMs: T0 + 1 }); // prettier-ignore

    expect(failing.parseFile).toHaveBeenCalledTimes(2);
  });

  it("re-parses a known-bad file when its marker predates the fingerprint field", async () => {
    const fs = memFs();
    const failing = converters({
      parseFile: jest.fn(async () => {
        throw new Error("bad parse");
      }),
    });
    const file = fileSource({ mtime: 1000, size: 50 });
    await materializeSources({ ...DIRS, fs, converters: failing, remotes: [], files: [file], nowMs: T0 }); // prettier-ignore
    // Simulate a legacy marker written before the fingerprint field: strip it.
    const markerKey = [...fs.files.keys()].find((k) => k.includes("failed-file-"))!;
    const legacy = JSON.parse(fs.files.get(markerKey)!) as Record<string, unknown>;
    delete legacy.fingerprint;
    fs.files.set(markerKey, JSON.stringify(legacy));

    await materializeSources({ ...DIRS, fs, converters: failing, remotes: [], files: [file], nowMs: T0 + 1 }); // prettier-ignore
    expect(failing.parseFile).toHaveBeenCalledTimes(2);
  });

  it("does not honor a failure marker while a stale snapshot still exists (existing !== null wins)", async () => {
    const fs = memFs();
    await materializeSources({ ...DIRS, fs, converters: converters(), remotes: [], files: [fileSource({ mtime: 1000, size: 50 })], nowMs: T0 }); // prettier-ignore
    const failing = converters({
      parseFile: jest.fn(async () => {
        throw new Error("bad parse");
      }),
    });
    const { entries, failures } = await materializeSources({ ...DIRS, fs, converters: failing, remotes: [], files: [fileSource({ mtime: 2000, size: 99 })], nowMs: T0 + 1 }); // prettier-ignore

    expect(failing.parseFile).toHaveBeenCalledTimes(1); // re-attempted, not marker-skipped
    expect(entries).toHaveLength(1); // stale snapshot still present
    expect(failures[0]).toMatchObject({ usedStaleSnapshot: true });
    expect([...fs.files.keys()].some((k) => k.includes("failed-"))).toBe(false);
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
      files: [],
      nowMs: T0,
    });
    const markerKey = [...fs.files.keys()].find((k) => k.includes("failed-web-"))!;
    expect(markerKey).toBeDefined();
    expect(wantedMarkerNames.has(markerKey.slice(`${MARKER_DIR}/`.length))).toBe(true);
    await reconcileMarkers(fs, MARKER_DIR, wantedMarkerNames);
    expect(fs.files.has(markerKey)).toBe(true); // survived the reconcile
  });

  it("clears the failure marker once a previously-failed source succeeds", async () => {
    const fs = memFs();
    const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];
    const failing = converters({
      fetchRemote: jest.fn(async () => {
        throw new Error("boom");
      }),
    });
    await materializeSources({ ...DIRS, fs, converters: failing, remotes, files: [], nowMs: T0 }); // prettier-ignore
    expect([...fs.files.keys()].some((k) => k.includes("failed-web-"))).toBe(true);

    const { entries, failures } = await materializeSources({
      ...DIRS,
      fs,
      converters: converters(),
      remotes,
      files: [],
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
      files: [],
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
        { type: "web", url: "https://a.com" }, // duplicate → deduped to total 1
        { type: "youtube", url: "https://youtu.be/x" },
      ],
      files: [fileSource()],
      nowMs: T0,
      onProgress: (p) => progress.push(p),
    });

    expect(progress.filter((p) => p.phase === "prefetch")).toEqual([
      { phase: "prefetch", done: 0, total: 2 },
      { phase: "prefetch", done: 1, total: 2 },
      { phase: "prefetch", done: 2, total: 2 },
    ]);
    expect(progress.filter((p) => p.phase === "parse")).toEqual([
      { phase: "parse", done: 0, total: 1 },
      { phase: "parse", done: 1, total: 1 },
    ]);
  });

  it("emits itemStart/itemSettled only for sources that do work (cheap-skips stay silent)", async () => {
    const fs = memFs();
    const conv = converters();
    const remotes: RemoteSource[] = [{ type: "web", url: "https://a.com" }];
    const first: MaterializeProgress[] = [];
    await materializeSources({ ...DIRS, fs, converters: conv, remotes, files: [], nowMs: T0, onProgress: (p) => first.push(p) }); // prettier-ignore
    expect(first.filter((p) => p.phase === "itemStart")).toEqual([
      { phase: "itemStart", item: { kind: "web", source: "https://a.com" } },
    ]);
    expect(first.some((p) => p.phase === "itemSettled")).toBe(true);

    const second: MaterializeProgress[] = [];
    await materializeSources({ ...DIRS, fs, converters: conv, remotes, files: [], nowMs: T0 + 1, onProgress: (p) => second.push(p) }); // prettier-ignore
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
    await materializeSources({ ...DIRS, fs, converters: failing, remotes: [{ type: "web", url: "https://a.com" }], files: [], nowMs: T0, onProgress: (p) => events.push(p) }); // prettier-ignore
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
    const done = materializeSources({ ...DIRS, fs, converters: conv, remotes: [{ type: "web", url: "https://a.com" }, { type: "web", url: "https://b.com" }], files: [], nowMs: T0 }); // prettier-ignore
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
        await bGate; // keep B in flight until A has already failed its marker write
        return `content ${s.url}`;
      }),
    });
    const events: MaterializeProgress[] = [];
    const done = materializeSources({ ...DIRS, fs, converters: conv, remotes: [{ type: "web", url: "https://a.com" }, { type: "web", url: "https://b.com" }], files: [], nowMs: T0, onProgress: (p) => events.push(p) }); // prettier-ignore
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

  it("omits onProgress for an empty loop", async () => {
    const fs = memFs();
    const progress: MaterializeProgress[] = [];
    await materializeSources({
      ...DIRS,
      fs,
      converters: converters(),
      remotes: [{ type: "web", url: "https://a.com" }],
      files: [],
      nowMs: T0,
      onProgress: (p) => progress.push(p),
    });
    expect(progress.some((p) => p.phase === "parse")).toBe(false);
  });
});

describe("materializeSources — per-artifact lock (cross-project dedup)", () => {
  it("merges two projects cold-converting the same URL into one fetch; the second does not overwrite", async () => {
    // Two projects share the same fs + remotesDir but have distinct markerDirs.
    // The injected lock (keyed by snapshot file name) serializes their upserts.
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
        await gate; // hold the lock so the second project is forced to wait
        return `content #${fetchCount} for ${s.url}`;
      }),
    });
    const remotes: RemoteSource[] = [{ type: "web", url: "https://shared.com" }];

    const runA = materializeSources({ remotesDir: REMOTES_DIR, filesDir: FILES_DIR, markerDir: MARKER_DIR, fs, converters: conv, remotes, files: [], nowMs: T0, withSourceLock }); // prettier-ignore
    await flushMicrotasks(); // A acquires the lock and reaches the gated fetch
    const runB = materializeSources({ remotesDir: REMOTES_DIR, filesDir: FILES_DIR, markerDir: MARKER_DIR_B, fs, converters: conv, remotes, files: [], nowMs: T0 + 1, withSourceLock }); // prettier-ignore
    await flushMicrotasks(); // B is now waiting on the same per-artifact lock
    release();
    const [resA, resB] = await Promise.all([runA, runB]);

    // One fetch total; B re-read the meta inside the lock and cheap-skipped.
    expect(conv.fetchRemote).toHaveBeenCalledTimes(1);
    // Both projects see a present entry pointing at the one shared snapshot.
    expect(resA.entries).toHaveLength(1);
    expect(resB.entries).toHaveLength(1);
    const snapshots = [...fs.files.keys()].filter((k) => k.startsWith(`${REMOTES_DIR}/`));
    expect(snapshots).toHaveLength(1);
    // A's content was NOT overwritten by B.
    expect(fs.files.get(snapshots[0])).toContain("content #1 for https://shared.com");
  });
});

describe("materializeSources — stale marker cleanup on shared cheap-skip", () => {
  it("clears project A's marker once project B writes the shared snapshot (A cheap-skip hit)", async () => {
    const fs = memFs();
    const remotes: RemoteSource[] = [{ type: "web", url: "https://shared.com" }];

    // 1. Project A fails → marker in A's bucket, no snapshot.
    const failing = converters({
      fetchRemote: jest.fn(async () => {
        throw new Error("down");
      }),
    });
    await materializeSources({ remotesDir: REMOTES_DIR, filesDir: FILES_DIR, markerDir: MARKER_DIR, fs, converters: failing, remotes, files: [], nowMs: T0 }); // prettier-ignore
    const markerKey = [...fs.files.keys()].find((k) => k.startsWith(`${MARKER_DIR}/`))!;
    expect(markerKey).toBeDefined();

    // 2. Project B succeeds → shared snapshot written (B never had a marker).
    await materializeSources({ remotesDir: REMOTES_DIR, filesDir: FILES_DIR, markerDir: MARKER_DIR_B, fs, converters: converters(), remotes, files: [], nowMs: T0 + 1 }); // prettier-ignore
    expect([...fs.files.keys()].some((k) => k.startsWith(`${REMOTES_DIR}/`))).toBe(true);

    // 3. Project A re-runs: the shared snapshot now cheap-skips, and A's stale
    //    marker is cleared so its status panel stops reporting a failure.
    const conv = converters();
    const { failures } = await materializeSources({ remotesDir: REMOTES_DIR, filesDir: FILES_DIR, markerDir: MARKER_DIR, fs, converters: conv, remotes, files: [], nowMs: T0 + 2 }); // prettier-ignore

    expect(conv.fetchRemote).not.toHaveBeenCalled(); // cheap-skipped the shared snapshot
    expect(failures).toHaveLength(0);
    expect(fs.files.has(markerKey)).toBe(false); // A's stale marker was cleared
  });

  it("clears project A's marker when a re-parse fails but a usable (stale) snapshot exists", async () => {
    const fs = memFs();

    // 1. Project A fails to parse the file at fingerprint F1 → marker, no snapshot.
    const failingF1 = converters({
      parseFile: jest.fn(async () => {
        throw new Error("bad parse F1");
      }),
    });
    await materializeSources({ remotesDir: REMOTES_DIR, filesDir: FILES_DIR, markerDir: MARKER_DIR, fs, converters: failingF1, remotes: [], files: [fileSource({ mtime: 1000, size: 50 })], nowMs: T0 }); // prettier-ignore
    const markerKey = [...fs.files.keys()].find((k) => k.startsWith(`${MARKER_DIR}/`))!;
    expect(markerKey).toBeDefined();

    // 2. Project B parses the same file at F1 → shared snapshot (B's own bucket).
    await materializeSources({ remotesDir: REMOTES_DIR, filesDir: FILES_DIR, markerDir: MARKER_DIR_B, fs, converters: converters(), remotes: [], files: [fileSource({ mtime: 1000, size: 50 })], nowMs: T0 + 1 }); // prettier-ignore
    expect([...fs.files.keys()].some((k) => k.startsWith(`${FILES_DIR}/`))).toBe(true);

    // 3. The file changes to F2 and project A re-parses: the F1 snapshot is now
    //    stale (fingerprint mismatch) so it re-attempts, fails again, but keeps the
    //    usable stale snapshot. A's marker is no longer a "missing source" and must
    //    be cleared here — the single-source retry path skips the marker reconcile.
    const failingF2 = converters({
      parseFile: jest.fn(async () => {
        throw new Error("bad parse F2");
      }),
    });
    const { failures } = await materializeSources({ remotesDir: REMOTES_DIR, filesDir: FILES_DIR, markerDir: MARKER_DIR, fs, converters: failingF2, remotes: [], files: [fileSource({ mtime: 2000, size: 99 })], nowMs: T0 + 2 }); // prettier-ignore

    expect(failingF2.parseFile).toHaveBeenCalledTimes(1); // re-attempted, not marker-skipped
    expect(failures[0]).toMatchObject({ usedStaleSnapshot: true }); // stale snapshot still usable
    expect(fs.files.has(markerKey)).toBe(false); // A's now-wrong missing-source marker was cleared
  });
});

describe("reconcileMarkers", () => {
  it("deletes obsolete owned markers in markerDir but preserves unknown files", async () => {
    const fs = memFs({
      [join(MARKER_DIR, "failed-web-deadbeef01.json")]: "{}",
      [join(MARKER_DIR, "failed-file-cafe02.json")]: "{}", // wanted
      [join(MARKER_DIR, "user-notes.md")]: "not ours",
    });
    const wanted = new Set(["failed-file-cafe02.json"]);

    await reconcileMarkers(fs, MARKER_DIR, wanted);

    expect(fs.files.has(join(MARKER_DIR, "failed-web-deadbeef01.json"))).toBe(false);
    expect(fs.files.has(join(MARKER_DIR, "failed-file-cafe02.json"))).toBe(true);
    expect(fs.files.has(join(MARKER_DIR, "user-notes.md"))).toBe(true);
  });

  it("never touches shared snapshots — it only lists and prunes the marker dir", async () => {
    // Snapshots live in remotesDir/filesDir, never in markerDir, so a marker
    // reconcile can't reach them even with an empty wanted set.
    const fs = memFs({
      [join(REMOTES_DIR, "web-abc01.md")]: "shared snapshot",
      [join(FILES_DIR, "file-abc02.md")]: "shared snapshot",
      [join(MARKER_DIR, "failed-youtube-abc03.json")]: "{}",
    });

    await reconcileMarkers(fs, MARKER_DIR, new Set());

    expect(fs.files.has(join(REMOTES_DIR, "web-abc01.md"))).toBe(true);
    expect(fs.files.has(join(FILES_DIR, "file-abc02.md"))).toBe(true);
    expect(fs.files.has(join(MARKER_DIR, "failed-youtube-abc03.json"))).toBe(false);
  });
});

describe("parseSnapshotMeta", () => {
  // Mirror the writer's exact framing (META_OPEN / META_CLOSE are module-private).
  const buildSnapshot = (meta: CacheEntryMeta): string =>
    `<!-- copilot-context-cache\n${JSON.stringify(meta)}\n-->\n\n# File: x\n\ncontent\n`;

  const fileMeta = (sourcePath: string): CacheEntryMeta => ({
    schemaVersion: CACHE_SCHEMA_VERSION,
    sourceType: "file",
    sourcePath,
    fetchedAt: "2026-01-01T00:00:00.000Z",
    fingerprint: "123:456",
  });

  it("parses a well-formed meta block", () => {
    const meta = fileMeta("Notes/foo.md");
    expect(parseSnapshotMeta(buildSnapshot(meta))).toEqual(meta);
  });

  it("does not truncate the JSON on a '-->' inside the source path", () => {
    // Regression: indexOf("-->") matched the marker embedded in the JSON value,
    // cutting the JSON short -> JSON.parse threw -> permanent cache miss. The
    // close marker is now anchored to a line boundary.
    const meta = fileMeta("Notes/a-->b.md");
    expect(parseSnapshotMeta(buildSnapshot(meta))).toEqual(meta);
  });
});
